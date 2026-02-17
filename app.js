'use strict';

// --- ESTADO GLOBAL ---
window.swapSourceId = null;
window.selectedFilterId = null; // Persistencia de selección por filtro
let expandedNodes = new Set();
let allIds = new Set();
let searchQuery = "";
let sortConfig = { col: null, dir: 'desc' };

window.onerror = function (msg) {
    const div = document.getElementById('content');
    if (div) div.innerHTML = `<div style="color:red; padding:20px;"><strong>Error de sistema:</strong> ${msg}</div>`;
    return false;
};

// --- 1. FUNCIONES GLOBALES (Control del Toolbar) ---
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

window.applySort = (col) => {
    sortConfig.dir = (sortConfig.col === col && sortConfig.dir === 'desc') ? 'asc' : 'desc';
    sortConfig.col = col;
    renderApp();
};

// FILTRADO CON RESALTADO VISUAL PERSISTENTE
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

// INTERCAMBIO DINÁMICO (Anula orden por columna para permitir diseño manual)
window.handleSwapClick = async function (id, name) {
    const s = tableau.extensions.settings;
    if (window.swapSourceId === null) {
        window.swapSourceId = id;
        renderApp();
    } else {
        if (window.swapSourceId === id) { window.swapSourceId = null; renderApp(); return; }
        const sourceRow = document.querySelector(`tr[data-id="${window.swapSourceId}"]`);
        if (!sourceRow) { window.swapSourceId = null; renderApp(); return; }

        const sourceName = sourceRow.getAttribute('data-name');
        let currentOrder = JSON.parse(s.get('cfg_custom_order') || "[]");
        if (currentOrder.length === 0) {
            currentOrder = Array.from(document.querySelectorAll('tr[data-depth="0"]')).map(tr => tr.getAttribute('data-name'));
        }
        const idx1 = currentOrder.indexOf(sourceName);
        const idx2 = currentOrder.indexOf(name);
        if (idx1 !== -1 && idx2 !== -1) {
            [currentOrder[idx1], currentOrder[idx2]] = [currentOrder[idx2], currentOrder[idx1]];
            s.set('cfg_custom_order', JSON.stringify(currentOrder));
            sortConfig.col = null; // Prioridad al diseño manual
            await s.saveAsync();
        }
        window.swapSourceId = null;
        renderApp();
    }
};

// --- 2. MOTORES DE APOYO ---
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

// --- 3. RENDER ---
async function renderApp() {
    const contentDiv = document.getElementById('content');
    const s = () => tableau.extensions.settings;
    try {
        const ws = tableau.extensions.worksheetContent.worksheet;
        const data = await ws.getSummaryDataAsync();

        // CONFIGURACIÓN: Totales y Subtotales ON por defecto si no existen
        const cfg = {
            bg: s().get('cfg_bg') || '#1a2b3c', tx: s().get('cfg_txt') || '#ffffff',
            pos: s().get('cfg_pos') || '#27ae60', neg: s().get('cfg_neg') || '#e74c3c',
            sh: s().get('cfg_sz_h') || '14', sl: s().get('cfg_sz_l') || '13', sd: s().get('cfg_sz_d') || '12',
            dec: parseInt(s().get('cfg_dec') || '2'), sep: s().get('cfg_sep') !== 'false',
            ico: s().get('cfg_icons') !== 'false', trends: s().get('cfg_trends') !== 'false',
            trendCols: (s().get('cfg_trend_cols') || "").split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)),
            gt: s().get('cfg_gt') !== 'false', st: s().get('cfg_st') !== 'false',
            ico0: s().get('cfg_ico0') || '➕', ico1: s().get('cfg_ico1') || '➖', ico2: s().get('cfg_ico2') || '🪙',
            movable: s().get('cfg_movable') !== 'false',
            customOrder: JSON.parse(s().get('cfg_custom_order') || "[]"),
            hideCols: JSON.parse(s().get('cfg_hide_cols') || "[]")
        };

        const tb = document.getElementById('toolbar');
        if (tb) tb.style.cssText = `background-color:${cfg.bg} !important; color:${cfg.tx} !important; display: flex; align-items: center; padding: 5px 15px; gap: 15px;`;

        document.getElementById('chkGrandTotal').checked = cfg.gt;
        document.getElementById('chkSubtotals').checked = cfg.st;

        const dims = data.columns.filter(c => c.dataType === 'string');
        const meas = data.columns.filter(c => c.dataType !== 'string');
        const activeMeas = meas.filter(m => !cfg.hideCols.includes(m.fieldName));

        // --- DROPDOWN COLUMNAS (Bootstrap) ---
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
                                ${m.fieldName.replace(/SUM|AGG|\(|\)/g, '')}
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

        // Aplicar Orden Dual
        if (sortConfig.col) {
            sortRecursive(root.children);
        } else if (cfg.customOrder.length > 0) {
            root.children.sort((a, b) => (cfg.customOrder.indexOf(a.name) === -1 ? 999 : cfg.customOrder.indexOf(a.name)) - (cfg.customOrder.indexOf(b.name) === -1 ? 999 : cfg.customOrder.indexOf(b.name)));
        }

        if (searchQuery) tagSearchMatches(root, searchQuery);

        const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: cfg.dec, maximumFractionDigits: cfg.dec, useGrouping: cfg.sep });
        const getArrow = (v, i) => (cfg.trends && (cfg.trendCols.length === 0 || cfg.trendCols.includes(i + 1))) ? (v >= 0 ? '▲ ' : '▼ ') : '';

        let html = `<style>
            table { width: 100%; border-collapse: collapse; }
            thead th { background: ${cfg.bg} !important; color: ${cfg.tx} !important; position: sticky; top: 0; padding: 12px; font-size: ${cfg.sh}px; text-align: right; cursor: pointer; border-bottom: 2px solid rgba(0,0,0,0.1); }
            td { border-bottom: 1px solid #dee2e6; padding: ${cfg.sl}px 10px; font-size: ${cfg.sd}px; cursor: pointer; }
            .pos { color: ${cfg.pos} !important; font-weight: 600; text-align: right; }
            .neg { color: ${cfg.neg} !important; font-weight: 600; text-align: right; }
            .row-selected { background-color: rgba(13, 110, 253, 0.15) !important; font-weight: bold; border-left: 4px solid #0d6efd; }
            .highlight { background-color: #ffc107; padding: 0 2px; }
            .grab-icon { cursor: pointer; font-size: 16px; color: #aaa; margin-right: 8px; font-weight: bold; }
            .grab-selected { color: #0d6efd !important; font-weight: bold; }
        </style>
        <table><thead><tr><th style="text-align:left;" onclick="window.applySort('name')">Niveles</th>
        ${activeMeas.map(m => `<th onclick="window.applySort('${m.fieldName}')">${m.fieldName.replace(/SUM|AGG|\(|\)/g, '')}</th>`).join('')}
        </tr></thead><tbody>`;

        if (cfg.gt) {
            html += `<tr style="background:#f8f9fa; font-weight:bold; border-bottom: 2px solid #aaa;"><td>📈 TOTAL GENERAL</td>
            ${activeMeas.map((m, i) => `<td class="${gTots[m.fieldName] >= 0 ? 'pos' : 'neg'}">${getArrow(gTots[m.fieldName], i)}${fmt(gTots[m.fieldName])}</td>`).join('')}</tr>`;
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

                html += `<tr class="${isSelected || isFiltered ? 'row-selected' : ''}" data-id="${n.id}" data-depth="${depth}" data-name="${n.name}">
                    <td style="padding-left:${depth * 22 + 12}px;" onclick="window.toggle('${n.id}')">
                        ${swapBtn} ${icon} <span style="font-weight:${depth === 0 ? 700 : 400}">${searchQuery ? n.name.replace(new RegExp(`(${searchQuery})`, 'gi'), '<span class="highlight">$1</span>') : n.name}</span>
                    </td>
                    ${activeMeas.map((m, idx) => {
                    const v = n.values[m.fieldName] || 0;
                    const showVal = (cfg.st || !hasCh);
                    const pathStr = encodeURIComponent(JSON.stringify(n.path));
                    return `<td class="${v >= 0 ? 'pos' : 'neg'}" onclick="window.filterToggle('${n.id}', '${pathStr}')">
                            ${showVal ? getArrow(v, idx) + fmt(v) : ''}
                        </td>`;
                }).join('')}</tr>`;
                if (open && hasCh) buildRows(n.children, depth + 1);
            });
        };
        buildRows(root.children, 0);
        contentDiv.innerHTML = html + "</tbody></table>";
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
