'use strict';
(function () {
    let expandedNodes = new Set(), searchQuery = "", selectedId = null;
    let sortConfig = { col: null, dir: 'desc' };
    const s = () => tableau.extensions.settings;

    tableau.extensions.initializeAsync({
        'configure': () => {
            const url = window.location.href.replace('index.html', 'configure.html');
            tableau.extensions.ui.displayDialogAsync(url, "", { height: 600, width: 400 }).then(p => p === "refresh" && render());
        }
    }).then(() => {
        const gt = document.getElementById('chkGrandTotal'), st = document.getElementById('chkSubtotals');
        gt.checked = s().get('cfg_gt') !== 'false'; st.checked = s().get('cfg_st') !== 'false';
        gt.onclick = () => saveOpt('cfg_gt', gt.checked);
        st.onclick = () => saveOpt('cfg_st', st.checked);
        document.getElementById('txtSearch').oninput = (e) => { searchQuery = e.target.value.toLowerCase(); render(); };

        tableau.extensions.worksheetContent.worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, () => render());
        render();
    });

    const saveOpt = (k, v) => s().set(k, v.toString()) || s().saveAsync().then(render);

    window.applySort = (col) => {
        sortConfig.dir = (sortConfig.col === col && sortConfig.dir === 'desc') ? 'asc' : 'desc';
        sortConfig.col = col;
        render();
    };

    function sortRecursive(nodes) {
        nodes.sort((a, b) => {
            let aV = sortConfig.col === 'name' ? a.name.toLowerCase() : (a.values[sortConfig.col] || 0);
            let bV = sortConfig.col === 'name' ? b.name.toLowerCase() : (b.values[sortConfig.col] || 0);
            return sortConfig.dir === 'asc' ? (aV > bV ? 1 : -1) : (aV < bV ? 1 : -1);
        });
        nodes.forEach(n => { if (n.children.length) sortRecursive(n.children); });
    }

    window.toggle = (id) => { expandedNodes.has(id) ? expandedNodes.delete(id) : expandedNodes.add(id); render(); };

    // --- NUEVA LÓGICA: FILTRO EN CASCADA (RUTA COMPLETA) ---
    window.filterToggle = async (id, path) => {
        const ws = tableau.extensions.worksheetContent.worksheet;
        try {
            if (selectedId === id) {
                // Si ya está seleccionado, limpiamos todos los niveles de la ruta
                for (const f of path) {
                    await ws.clearFilterAsync(f.field);
                }
                selectedId = null;
            } else {
                // Si es nuevo, aplicamos CADA nivel del path como un filtro
                // Esto asegura que se filtre Producto AND Subproducto AND Banca
                for (const f of path) {
                    await ws.applyFilterAsync(f.field, [f.value], tableau.FilterUpdateType.Replace);
                }
                selectedId = id;
            }
            render();
        } catch (err) { console.error("Error en cascada:", err); }
    };

    async function render() {
        const ws = tableau.extensions.worksheetContent.worksheet;
        const data = await ws.getSummaryDataAsync();
        const cfg = {
            bg: s().get('cfg_bg') || '#1a2b3c', tx: s().get('cfg_txt') || '#fff',
            pos: s().get('cfg_pos') || '#27ae60', neg: s().get('cfg_neg') || '#e74c3c',
            sh: s().get('cfg_sz_h') || '14', sl: s().get('cfg_sz_l') || '13', sd: s().get('cfg_sz_d') || '12',
            dec: parseInt(s().get('cfg_dec') || '2'), sep: s().get('cfg_sep') !== 'false',
            ico: s().get('cfg_icons') !== 'false', gt: s().get('cfg_gt') !== 'false', st: s().get('cfg_st') !== 'false'
        };

        if (!data || data.data.length === 0) return;
        const dims = data.columns.filter(c => c.dataType === 'string'), meas = data.columns.filter(c => c.dataType !== 'string');
        const root = { name: "Root", children: [], values: {}, id: "root", path: [] };
        let gTots = {};
        meas.forEach(m => gTots[m.fieldName] = 0);

        data.data.forEach(row => {
            let curr = root;
            dims.forEach((d, i) => {
                const v = row[d.index].formattedValue || "Nulo";
                let ch = curr.children.find(c => c.name === v);
                if (!ch) {
                    // Creamos la "Ruta de filtros" heredando del padre y añadiendo el actual
                    const nodePath = [...(curr.path || []), { field: d.fieldName, value: v }];
                    ch = {
                        name: v,
                        path: nodePath, // Guardamos la ruta completa (Producto + Subprod + Banca)
                        children: [],
                        values: {},
                        id: curr.id + "_" + i + "_" + v.replace(/\s+/g, '')
                    };
                    curr.children.push(ch);
                }
                meas.forEach(m => {
                    const n = parseFloat(row[m.index].value) || 0;
                    ch.values[m.fieldName] = (ch.values[m.fieldName] || 0) + n;
                    if (i === dims.length - 1) gTots[m.fieldName] += n;
                });
                curr = ch;
            });
        });

        if (sortConfig.col) sortRecursive(root.children);
        const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: cfg.dec, maximumFractionDigits: cfg.dec, useGrouping: cfg.sep });

        let html = `<style>.selected { background-color: #e8f4fd !important; outline: 1px solid #005a9e; } th:hover { background: rgba(255,255,255,0.1); }</style>
            <table style="width:100%; border-collapse:collapse; font-family:sans-serif;">
            <thead><tr style="background:${cfg.bg}; color:${cfg.tx}; font-size:${cfg.sh}px;">
            <th style="padding:12px; text-align:left; cursor:pointer;" onclick="window.applySort('name')">Estructura</th>
            ${meas.map(m => `<th style="text-align:right; padding:12px; cursor:pointer;" onclick="window.applySort('${m.fieldName}')">${m.fieldName.replace(/SUM|AGG|\(|\)/g, '')}</th>`).join('')}
            </tr></thead><tbody>`;

        if (cfg.gt) {
            html += `<tr style="background:#f8f9fa; font-weight:800; border-bottom:2px solid #ddd;"><td style="padding:12px;">📈 TOTAL</td>
                ${meas.map(m => `<td style="text-align:right; padding:12px; color:${gTots[m.fieldName] < 0 ? cfg.neg : cfg.pos}">${fmt(gTots[m.fieldName])}</td>`).join('')}</tr>`;
        }

        const buildRows = (nodes, depth) => {
            nodes.forEach(n => {
                const match = searchQuery && n.name.toLowerCase().includes(searchQuery); if (match) expandedNodes.add(n.id);
                const open = expandedNodes.has(n.id), hasCh = n.children.length > 0, isSel = selectedId === n.id;
                const icon = cfg.ico ? (depth === 0 ? '🏛️' : (hasCh ? '💼' : '🪙')) : '';

                // Serializamos el path para pasarlo a la función de filtro
                const pathStr = JSON.stringify(n.path).replace(/"/g, '&quot;');

                html += `<tr class="${isSel ? 'selected' : ''}" style="border-bottom:1px solid #eee; background:${depth === 0 ? '#fcfcfc' : '#fff'};">
                    <td style="padding:10px 10px 10px ${depth * 20 + 12}px; cursor:pointer; font-size:${cfg.sl}px;" onclick="window.toggle('${n.id}')">
                    <span style="font-size:10px; color:#999;">${hasCh ? (open ? '▼' : '►') : ''}</span> ${icon} 
                    <span style="font-weight:${depth === 0 ? 700 : 400}; background:${match ? '#fff3cd' : ''}">${n.name}</span></td>
                    ${meas.map(m => {
                    const v = n.values[m.fieldName] || 0;
                    return (cfg.st || !hasCh) ? `<td style="text-align:right; padding:10px; font-size:${cfg.sd}px; color:${v < 0 ? cfg.neg : cfg.pos}; font-weight:600; cursor:cell;" 
                            onclick="window.filterToggle('${n.id}', ${pathStr})">${fmt(v)}</td>` : `<td></td>`;
                }).join('')}</tr>`;
                if (open && hasCh) buildRows(n.children, depth + 1);
            });
        };
        buildRows(root.children, 0);
        document.getElementById('content').innerHTML = html + `</tbody></table>`;
    }
})();
