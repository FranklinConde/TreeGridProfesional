'use strict';

// --- ESTADO GLOBAL ---
window.swapSourceId = null;
window.selectedFilterId = null;
let expandedNodes = new Set();
let allIds = new Set();
let searchQuery = "";
let sortConfig = { col: null, dir: 'desc' };
window.currentTooltips = [];

window.onerror = function (msg) {
    const div = document.getElementById('content');
    if (div) div.innerHTML = `<div style="color:red; padding:20px;"><strong>Error de sistema:</strong> ${msg}</div>`;
    return false;
};

// --- 1. FUNCIONES GLOBALES ---
window.expandToggle = (checkbox) => {
    if (checkbox.checked) expandedNodes = new Set(allIds);
    else expandedNodes.clear();
    renderApp();
};

window.toggle = (id) => {
    if (expandedNodes.has(id)) expandedNodes.delete(id);
    else expandedNodes.add(id);
    renderApp();
};

window.toggleCol = (colName) => {
    const s = tableau.extensions.settings;
    let hidden = JSON.parse(s.get('cfg_hide_cols') || "[]");
    hidden.includes(colName) ? hidden = hidden.filter(c => c !== colName) : hidden.push(colName);
    s.set('cfg_hide_cols', JSON.stringify(hidden));
    s.saveAsync().then(renderApp);
};

// MODIFICADO: Ahora guarda el ordenamiento en la configuración de Tableau
window.applySort = (col) => {
    sortConfig.dir = (sortConfig.col === col && sortConfig.dir === 'desc') ? 'asc' : 'desc';
    sortConfig.col = col;
    const s = tableau.extensions.settings;
    s.set('cfg_sort_col', sortConfig.col);
    s.set('cfg_sort_dir', sortConfig.dir);
    s.saveAsync().then(renderApp);
};

window.filterToggle = async (id, pathJSON) => {
    const path = JSON.parse(decodeURIComponent(pathJSON));
    const ws = tableau.extensions.worksheetContent.worksheet;
    if (window.selectedFilterId === id) {
        for (const f of path) await ws.clearFilterAsync(f.field);
        window.selectedFilterId = null;
    } else {
        for (const f of path) await ws.applyFilterAsync(f.field, [f.value], 'replace');
        window.selectedFilterId = id;
    }
    renderApp();
};

window.handleSwapClick = async function (id, name) {
    const s = tableau.extensions.settings;
    if (window.swapSourceId === null) {
        window.swapSourceId = id;
        renderApp();
    } else {
        if (window.swapSourceId === id) { window.swapSourceId = null; renderApp(); return; }
        const sourceRow = document.querySelector(`div[data-id="${window.swapSourceId}"]`);
        if (!sourceRow) { window.swapSourceId = null; renderApp(); return; }

        const sourceName = sourceRow.getAttribute('data-name');
        let currentOrder = JSON.parse(s.get('cfg_custom_order') || "[]");
        if (currentOrder.length === 0) {
            currentOrder = Array.from(document.querySelectorAll('div[data-depth="0"]')).map(el => el.getAttribute('data-name'));
        }
        const idx1 = currentOrder.indexOf(sourceName);
        const idx2 = currentOrder.indexOf(name);
        if (idx1 !== -1 && idx2 !== -1) {
            [currentOrder[idx1], currentOrder[idx2]] = [currentOrder[idx2], currentOrder[idx1]];
            s.set('cfg_custom_order', JSON.stringify(currentOrder));

            // MODIFICADO: Si reordena manualmente, borra el orden por columna guardado
            sortConfig.col = null;
            s.set('cfg_sort_col', '');

            await s.saveAsync();
        }
        window.swapSourceId = null;
        renderApp();
    }
};

// --- MOTORES ---
function tagSearchMatches(node, query) {
    let isSelfMatch = node.name.toLowerCase().includes(query);
    let hasChildMatch = false;
    if (node.children) {
        node.children.forEach(child => { if (tagSearchMatches(child, query)) hasChildMatch = true; });
    }
    node._isMatch = isSelfMatch || hasChildMatch;
    node._autoExpand = hasChildMatch;
    return node._isMatch;
}

function sortRecursive(nodes) {
    nodes.sort((a, b) => {
        let aV = sortConfig.col === 'name' ? a.name.toLowerCase() : (a.values[sortConfig.col] || 0);
        let bV = sortConfig.col === 'name' ? b.name.toLowerCase() : (b.values[sortConfig.col] || 0);
        return sortConfig.dir === 'asc' ? (aV > bV ? 1 : -1) : (aV < bV ? 1 : -1);
    });
    nodes.forEach(n => { if (n.children.length) sortRecursive(n.children); });
}

// --- RENDER ---
async function renderApp() {
    const contentDiv = document.getElementById('content');
    const s = () => tableau.extensions.settings;
    try {
        const ws = tableau.extensions.worksheetContent.worksheet;
        const data = await ws.getSummaryDataAsync();

        const cfg = {
            bg: s().get('cfg_bg') || '#1a2b3c', tx: s().get('cfg_txt') || '#ffffff',
            pos: s().get('cfg_pos') || '#27ae60', neg: s().get('cfg_neg') || '#e74c3c',
            sh: s().get('cfg_sz_h') || '14', sl: s().get('cfg_sz_l') || '13', sd: s().get('cfg_sz_d') || '12',
            dec: parseInt(s().get('cfg_dec') || '2'),
            pct_dec: parseInt(s().get('cfg_pct_dec') || '2'),
            sep: s().get('cfg_sep') !== 'false',
            ico: s().get('cfg_icons') !== 'false', trends: s().get('cfg_trends') !== 'false',
            trendCols: (s().get('cfg_trend_cols') || "").split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)),
            gt: s().get('cfg_gt') !== 'false', st: s().get('cfg_st') !== 'false',
            ico0: s().get('cfg_ico0') || '➕', ico1: s().get('cfg_ico1') || '➖', ico2: s().get('cfg_ico2') || '🪙',
            movable: s().get('cfg_movable') !== 'false',
            customOrder: JSON.parse(s().get('cfg_custom_order') || "[]"),
            hideCols: JSON.parse(s().get('cfg_hide_cols') || "[]"),
            dimOrder: (s().get('cfg_dim_order') || "").split(',').map(x => x.trim().toLowerCase()).filter(x => x),
            measOrder: (s().get('cfg_meas_order') || "").split(',').map(x => x.trim()).filter(x => x),
            measRename: (s().get('cfg_meas_rename') || "").split(',').map(x => x.trim()),
            pctCols: (s().get('cfg_pct_cols') || "").split(',').map(x => x.trim()).filter(x => x),
            fitView: s().get('cfg_fit_view') === 'true',
            title: s().get('cfg_title') || ""
        };

        const titleEl = document.getElementById('appTitle');
        if (titleEl) {
            titleEl.textContent = cfg.title.trim() !== "" ? cfg.title : ws.name;
        }

        const tb = document.getElementById('toolbar');
        if (tb) {
            tb.style.setProperty('background-color', cfg.bg, 'important');
            tb.style.setProperty('color', cfg.tx, 'important');
        }

        if (contentDiv) {
            contentDiv.style.overflowX = cfg.fitView ? 'hidden' : 'auto';
        }

        document.getElementById('chkGrandTotal').checked = cfg.gt;
        document.getElementById('chkSubtotals').checked = cfg.st;

        // --- 1. DIMENSIONES ---
        let dims = data.columns.filter(c => c.dataType === 'string');
        if (cfg.dimOrder.length > 0) {
            dims.sort((a, b) => {
                const idxA = cfg.dimOrder.indexOf(a.fieldName.toLowerCase());
                const idxB = cfg.dimOrder.indexOf(b.fieldName.toLowerCase());
                if (idxA > -1 && idxB > -1) return idxA - idxB;
                if (idxA > -1) return -1;
                if (idxB > -1) return 1;
                return a.index - b.index;
            });
        } else {
            dims.sort((a, b) => a.index - b.index);
        }

        // --- 2. MEDIDAS ---
        const meas = data.columns.filter(c => c.dataType !== 'string');

        if (cfg.measOrder.length > 0) {
            meas.sort((a, b) => {
                const idxA = cfg.measOrder.findIndex(name => a.fieldName.includes(name));
                const idxB = cfg.measOrder.findIndex(name => b.fieldName.includes(name));
                if (idxA > -1 && idxB > -1) return idxA - idxB;
                if (idxA > -1) return -1;
                if (idxB > -1) return 1;
                return a.index - b.index;
            });
        }

        let activeMeas = meas.filter(m => !cfg.hideCols.includes(m.fieldName));

        // Helper Nombre Columna
        const getColName = (fieldName) => {
            let cleanName = fieldName.replace(/SUM|AGG|\(|\)/g, '');
            if (cfg.measOrder.length > 0 && cfg.measRename.length > 0) {
                const orderIdx = cfg.measOrder.findIndex(name => fieldName.includes(name));
                if (orderIdx > -1 && cfg.measRename[orderIdx] !== undefined && cfg.measRename[orderIdx] !== "") {
                    return cfg.measRename[orderIdx];
                }
            }
            return cleanName;
        };

        const isPercentage = (fieldName) => {
            return cfg.pctCols.some(p => fieldName.includes(p));
        };

        const fmt = (v, isPct) => {
            if (isPct) {
                return v.toLocaleString('en-US', { style: 'percent', minimumFractionDigits: cfg.pct_dec, maximumFractionDigits: cfg.pct_dec });
            }
            return v.toLocaleString('en-US', { minimumFractionDigits: cfg.dec, maximumFractionDigits: cfg.dec, useGrouping: cfg.sep });
        };

        // Dropdown Columnas
        const colDropdown = document.getElementById('colListDropdown');
        if (colDropdown) {
            colDropdown.innerHTML = `<li><h6 class="dropdown-header">MEDIDAS</h6></li>` +
                meas.map(m => {
                    const isChecked = !cfg.hideCols.includes(m.fieldName);
                    return `
                <li onclick="event.stopPropagation()">
                    <div class="dropdown-item py-1">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="sw_${m.fieldName.replace(/\s+/g, '')}" 
                                ${isChecked ? 'checked' : ''} onclick="window.toggleCol('${m.fieldName}')">
                            <label class="form-check-label text-dark" for="sw_${m.fieldName.replace(/\s+/g, '')}" style="font-size:12px; cursor:pointer;">
                                ${getColName(m.fieldName)}
                            </label>
                        </div>
                    </div>
                </li>`;
                }).join('');
        }

        const root = { name: "Root", children: [], values: {}, id: "root" };
        let gTots = {}; activeMeas.forEach(m => gTots[m.fieldName] = 0);
        allIds.clear();

        data.data.forEach(row => {
            let curr = root;
            dims.forEach((d, i) => {
                const v = row[d.index].formattedValue || "Nulo";
                let ch = curr.children.find(c => c.name === v);
                if (!ch) {
                    ch = { name: v, children: [], values: {}, id: curr.id + "_" + v.replace(/\s+/g, ''), path: [...(curr.path || []), { field: d.fieldName, value: v }] };
                    curr.children.push(ch);
                }
                allIds.add(ch.id);
                activeMeas.forEach(m => {
                    const n = parseFloat(row[m.index].value) || 0;
                    ch.values[m.fieldName] = (ch.values[m.fieldName] || 0) + n;
                    if (i === dims.length - 1) gTots[m.fieldName] += n;
                });
                curr = ch;
            });
        });

        if (sortConfig.col) {
            sortRecursive(root.children);
        } else if (cfg.customOrder.length > 0) {
            root.children.sort((a, b) => (cfg.customOrder.indexOf(a.name) === -1 ? 999 : cfg.customOrder.indexOf(a.name)) - (cfg.customOrder.indexOf(b.name) === -1 ? 999 : cfg.customOrder.indexOf(b.name)));
        }

        if (searchQuery) tagSearchMatches(root, searchQuery);

        const getArrow = (v, i) => (cfg.trends && (cfg.trendCols.length === 0 || cfg.trendCols.includes(i + 1))) ? (v >= 0 ? ' ▲' : ' ▼') : '';

        // --- SISTEMA GRID CSS DINÁMICO ---
        let html = `<style>
            .grid-container { 
                width: ${cfg.fitView ? '100%' : 'max-content'}; 
                min-width: 100%; 
                display: flex; flex-direction: column; background-color: #fff; 
            }
            .grid-header { background: ${cfg.bg} !important; color: ${cfg.tx} !important; position: sticky; top: 0; z-index: 10; border-bottom: 2px solid rgba(0,0,0,0.1); }
            .grid-header > div { padding: 12px 10px; font-size: ${cfg.sh}px; font-weight: bold; cursor: pointer; }
            .grid-row { border-bottom: 1px solid #dee2e6; cursor: pointer; transition: background-color 0.15s; background-color: #ffffff; }
            .grid-row:hover { background-color: #f8f9fa; }
            .row-selected { background-color: #e5f0ff !important; border-left: 4px solid #0d6efd; font-weight: bold; }
            
            .grid-cell { 
                padding: ${cfg.sl}px 10px; font-size: ${cfg.sd}px; display: flex; align-items: center; 
                white-space: nowrap; overflow: ${cfg.fitView ? 'hidden' : 'visible'}; text-overflow: ${cfg.fitView ? 'ellipsis' : 'clip'};
            }
            
            .grid-cell-first { 
                flex: ${cfg.fitView ? '2 1 0' : '0 0 280px'};
                min-width: ${cfg.fitView ? '50px' : '280px'}; 
                justify-content: flex-start; position: sticky; left: 0; z-index: 5; 
                background: inherit; border-right: 1px solid rgba(0,0,0,0.05); 
            }
            .grid-header .grid-cell-first { z-index: 11; } 
            
            .grid-cell-meas { 
                flex: ${cfg.fitView ? '1 1 0' : '1 1 120px'}; 
                min-width: ${cfg.fitView ? '30px' : '110px'}; 
                justify-content: flex-end; 
            }
            
            .pos { color: ${cfg.pos} !important; font-weight: 600; }
            .neg { color: ${cfg.neg} !important; font-weight: 600; }
            .highlight { background-color: #ffc107; padding: 0 2px; }
            .grab-icon { cursor: pointer; font-size: 16px; color: #aaa; margin-right: 8px; font-weight: bold; }
            .grab-selected { color: #0d6efd !important; font-weight: bold; }
            .tooltip-inner { text-align: left; padding: 8px 12px; font-size: 12px; }
        </style>
        
        <div class="grid-container">
            <div class="row m-0 flex-nowrap grid-header">
                <div class="grid-cell grid-cell-first" onclick="window.applySort('name')">Niveles</div>
                ${activeMeas.map(m => `<div class="grid-cell grid-cell-meas" onclick="window.applySort('${m.fieldName}')"><span class="text-truncate">${getColName(m.fieldName)}</span></div>`).join('')}
            </div>`;

        if (cfg.gt) {
            html += `<div class="row m-0 flex-nowrap" style="background-color:#f1f3f5; font-weight:bold; border-bottom: 2px solid #aaa;">
                <div class="grid-cell grid-cell-first">📈 TOTAL GENERAL</div>
                ${activeMeas.map((m, i) => {
                const isPct = isPercentage(m.fieldName);
                const v = gTots[m.fieldName];
                const formattedVal = fmt(v, isPct);
                const colName = getColName(m.fieldName);

                const tooltipTitle = `<b>${colName} : ${formattedVal}</b><br/><span style='color:#ccc'>TOTAL GENERAL</span>`;

                return `<div class="grid-cell grid-cell-meas ${v >= 0 ? 'pos' : 'neg'}">
                            <span class="text-truncate" data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="top" data-bs-container="body" data-bs-custom-class="custom-tooltip" title="${tooltipTitle}">
                                ${formattedVal}${getArrow(v, i)}
                            </span>
                        </div>`;
            }).join('')}</div>`;
        }

        const buildRows = (nodes, depth) => {
            nodes.forEach(n => {
                if (searchQuery && !n._isMatch) return;
                const open = expandedNodes.has(n.id) || (searchQuery && n._autoExpand);
                const hasCh = n.children.length > 0;
                const isSelected = window.swapSourceId === n.id;
                const isFiltered = window.selectedFilterId === n.id;
                const icon = cfg.ico ? (!hasCh ? cfg.ico2 : (open ? cfg.ico1 : cfg.ico0)) : '';
                const swapBtn = (depth === 0 && cfg.movable) ? `<span class="grab-icon ${isSelected ? 'grab-selected' : ''}" onclick="event.stopPropagation(); window.handleSwapClick('${n.id}', '${n.name}')">⠿</span>` : '';

                html += `<div class="row m-0 flex-nowrap grid-row ${isSelected || isFiltered ? 'row-selected' : ''}" data-id="${n.id}" data-depth="${depth}" data-name="${n.name}">
                    <div class="grid-cell grid-cell-first" style="padding-left:${depth * 22 + 12}px;" onclick="window.toggle('${n.id}')">
                        ${swapBtn} ${icon} <span class="text-truncate" style="font-weight:${depth === 0 ? 700 : 400}">${searchQuery ? n.name.replace(new RegExp(`(${searchQuery})`, 'gi'), '<span class="highlight">$1</span>') : n.name}</span>
                    </div>
                    ${activeMeas.map((m, idx) => {
                    const v = n.values[m.fieldName] || 0;
                    const showVal = (cfg.st || !hasCh);
                    const pathStr = encodeURIComponent(JSON.stringify(n.path));
                    const isPct = isPercentage(m.fieldName);
                    const formattedVal = fmt(v, isPct);
                    const colName = getColName(m.fieldName);

                    let tooltipAttr = "";
                    if (showVal) {
                        const tooltipTitle = `<b>${colName} : ${formattedVal}</b><br/>${n.name}`;
                        tooltipAttr = `data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="top" data-bs-container="body" data-bs-custom-class="custom-tooltip" title="${tooltipTitle}"`;
                    }

                    return `<div class="grid-cell grid-cell-meas ${v >= 0 ? 'pos' : 'neg'}" onclick="window.filterToggle('${n.id}', '${pathStr}')">
                            ${showVal ? `<span class="text-truncate" ${tooltipAttr}>${formattedVal}${getArrow(v, idx)}</span>` : ''}
                        </div>`;
                }).join('')}</div>`;
                if (open && hasCh) buildRows(n.children, depth + 1);
            });
        };
        buildRows(root.children, 0);
        contentDiv.innerHTML = html + "</div>";

        // --- INICIALIZAR TOOLTIPS ---
        if (window.currentTooltips) {
            window.currentTooltips.forEach(t => t.dispose());
        }
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        window.currentTooltips = [...tooltipTriggerList].map(el => new bootstrap.Tooltip(el, { animation: false }));

    } catch (e) { console.error(e); }
}

// Inicialización
(function start() {
    if (typeof tableau === 'undefined') { setTimeout(start, 100); return; }
    tableau.extensions.initializeAsync({
        'configure': () => {
            const url = window.location.href.replace('index.html', 'configure.html');
            tableau.extensions.ui.displayDialogAsync(url, "", { height: 650, width: 450 }).then(p => p === "refresh" && renderApp());
        }
    }).then(() => {
        const s = tableau.extensions.settings;

        // MODIFICADO: Recuperar el estado de ordenamiento guardado al iniciar
        const savedSortCol = s.get('cfg_sort_col');
        if (savedSortCol) {
            sortConfig.col = savedSortCol;
            sortConfig.dir = s.get('cfg_sort_dir') || 'desc';
        }

        // MODIFICADO: Recuperar el estado del Toolbar y modificar el DOM antes de renderizar
        const isToolbarOpen = s.get('cfg_toolbar_open') !== 'false';
        const toolbarEl = document.getElementById('toolbarOptions');
        const btnToggle = document.querySelector('[data-bs-target="#toolbarOptions"]');

        if (!isToolbarOpen && toolbarEl) {
            toolbarEl.classList.remove('show');
            if (btnToggle) btnToggle.setAttribute('aria-expanded', 'false');
        }

        // MODIFICADO: Guardar automáticamente el estado cada vez que se abre/cierra el Toolbar
        if (toolbarEl) {
            toolbarEl.addEventListener('hidden.bs.collapse', () => {
                s.set('cfg_toolbar_open', 'false');
                s.saveAsync();
            });
            toolbarEl.addEventListener('shown.bs.collapse', () => {
                s.set('cfg_toolbar_open', 'true');
                s.saveAsync();
            });
        }

        renderApp();

        const searchInput = document.getElementById('txtSearch');
        if (searchInput) {
            searchInput.style.width = "220px";
            searchInput.oninput = (e) => { searchQuery = e.target.value.toLowerCase(); renderApp(); };
        }
        document.getElementById('chkGrandTotal').onclick = (e) => { tableau.extensions.settings.set('cfg_gt', e.target.checked.toString()); tableau.extensions.settings.saveAsync().then(renderApp); };
        document.getElementById('chkSubtotals').onclick = (e) => { tableau.extensions.settings.set('cfg_st', e.target.checked.toString()); tableau.extensions.settings.saveAsync().then(renderApp); };

        const expSwitch = document.getElementById('chkExpandAll');
        if (expSwitch) expSwitch.onclick = (e) => window.expandToggle(e.target);

        tableau.extensions.worksheetContent.worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, renderApp);
    });
})();
