'use strict';
(function () {
    let expandedNodes = new Set(), searchQuery = "", selectedId = null, allIds = new Set();
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

    window.expandAll = (expand) => {
        if (expand) expandedNodes = new Set(allIds); else expandedNodes.clear();
        render();
    };

    window.toggle = (id) => { expandedNodes.has(id) ? expandedNodes.delete(id) : expandedNodes.add(id); render(); };

    window.toggleCol = (colName) => {
        let hidden = JSON.parse(s().get('cfg_hide_cols') || "[]");
        hidden.includes(colName) ? hidden = hidden.filter(c => c !== colName) : hidden.push(colName);
        saveOpt('cfg_hide_cols', JSON.stringify(hidden));
    };

    window.applySort = (col) => {
        sortConfig.dir = (sortConfig.col === col && sortConfig.dir === 'desc') ? 'asc' : 'desc';
        sortConfig.col = col; render();
    };

    function sortRecursive(nodes) {
        nodes.sort((a, b) => {
            let aV = sortConfig.col === 'name' ? a.name.toLowerCase() : (a.values[sortConfig.col] || 0);
            let bV = sortConfig.col === 'name' ? b.name.toLowerCase() : (b.values[sortConfig.col] || 0);
            return sortConfig.dir === 'asc' ? (aV > bV ? 1 : -1) : (aV < bV ? 1 : -1);
        });
        nodes.forEach(n => { if (n.children.length) sortRecursive(n.children); });
    }

    window.filterToggle = async (id, path) => {
        const ws = tableau.extensions.worksheetContent.worksheet;
        if (selectedId === id) { for (const f of path) await ws.clearFilterAsync(f.field); selectedId = null; }
        else { for (const f of path) await ws.applyFilterAsync(f.field, [f.value], 'replace'); selectedId = id; }
        render();
    };

    async function render() {
        const ws = tableau.extensions.worksheetContent.worksheet;
        const data = await ws.getSummaryDataAsync();
        const cfg = {
            bg: s().get('cfg_bg') || '#1a2b3c', tx: s().get('cfg_txt') || '#fff',
            pos: s().get('cfg_pos') || '#27ae60', neg: s().get('cfg_neg') || '#e74c3c',
            sh: s().get('cfg_sz_h') || '14', sl: s().get('cfg_sz_l') || '13', sd: s().get('cfg_sz_d') || '12',
            dec: parseInt(s().get('cfg_dec') || '2'), sep: s().get('cfg_sep') !== 'false',
            ico: s().get('cfg_icons') !== 'false', gt: s().get('cfg_gt') !== 'false', st: s().get('cfg_st') !== 'false',
            hideCols: JSON.parse(s().get('cfg_hide_cols') || "[]")
        };

        if (!data || data.data.length === 0) return;
        const dims = data.columns.filter(c => c.dataType === 'string'), meas = data.columns.filter(c => c.dataType !== 'string');
        const activeMeas = meas.filter(m => !cfg.hideCols.includes(m.fieldName));

        document.getElementById('colList').innerHTML = meas.map(m => `
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#333; padding:2px 0;">
                <input type="checkbox" ${!cfg.hideCols.includes(m.fieldName) ? 'checked' : ''} onclick="window.toggleCol('${m.fieldName}')"> 
                ${m.fieldName.replace(/SUM|AGG|\(|\)/g, '')}
            </label>
        `).join('');

        const root = { name: "Root", children: [], values: {}, id: "root", path: [] };
        let gTots = {}; meas.forEach(m => gTots[m.fieldName] = 0);
        allIds.clear();

        data.data.forEach(row => {
            let curr = root;
            dims.forEach((d, i) => {
                const v = row[d.index].formattedValue || "Nulo";
                let ch = curr.children.find(c => c.name === v);
                if (!ch) {
                    const nodePath = [...(curr.path || []), { field: d.fieldName, value: v }];
                    ch = { name: v, path: nodePath, children: [], values: {}, id: curr.id + "_" + i + "_" + v.replace(/\s+/g, '') };
                    curr.children.push(ch);
                }
                allIds.add(ch.id);
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

        // --- DISEÑO DE TABLA PROFESIONAL ---
        let html = `<style>
            table { width: 100%; border-collapse: collapse; table-layout: auto; border: 1px solid #ccc; font-variant-numeric: tabular-nums; }
            th { border: 1px solid rgba(255,255,255,0.2); position: sticky; top: 0; z-index: 10; font-weight: 600; }
            td { border: 1px solid #eee; }
            tr:nth-child(even) { background-color: #fafafa; }
            tr:hover { background-color: #f0f4f8 !important; }
            .selected { background-color: #e8f4fd !important; outline: 2px solid #005a9e; z-index: 5; position: relative; }
            .selected td { border-color: #005a9e33; }
        </style>
        <table>
            <thead><tr style="background:${cfg.bg}; color:${cfg.tx}; font-size:${cfg.sh}px;">
            <th style="padding:12px; text-align:left; cursor:pointer;" onclick="window.applySort('name')">Estructura</th>
            ${activeMeas.map(m => `<th style="text-align:right; padding:12px; cursor:pointer;" onclick="window.applySort('${m.fieldName}')">${m.fieldName.replace(/SUM|AGG|\(|\)/g, '')}</th>`).join('')}
            </tr></thead><tbody>`;

        if (cfg.gt) {
            html += `<tr style="background:#f0f2f5; font-weight:800; border-bottom:2px solid #999;"><td style="padding:12px; border-right: 1px solid #ccc;">📈 TOTAL GENERAL</td>
                ${activeMeas.map(m => `<td style="text-align:right; padding:12px; color:${gTots[m.fieldName] < 0 ? cfg.neg : cfg.pos}; border-right: 1px solid #ccc;">${fmt(gTots[m.fieldName])}</td>`).join('')}</tr>`;
        }

        const buildRows = (nodes, depth) => {
            nodes.forEach(n => {
                const match = searchQuery && n.name.toLowerCase().includes(searchQuery); if (match) expandedNodes.add(n.id);
                const open = expandedNodes.has(n.id), hasCh = n.children.length > 0, isSel = selectedId === n.id;
                const pathStr = JSON.stringify(n.path).replace(/"/g, '&quot;');
                const icon = cfg.ico ? (depth === 0 ? '🏛️' : (hasCh ? '💼' : '🪙')) : '';

                html += `<tr class="${isSel ? 'selected' : ''}" style="font-size:${cfg.sd}px;">
                    <td style="padding:10px 10px 10px ${depth * 20 + 12}px; cursor:pointer; font-size:${cfg.sl}px;" onclick="window.toggle('${n.id}')">
                    ${icon} <span style="font-weight:${depth === 0 ? 700 : 400}; background:${match ? '#fff3cd' : ''}; margin-left: 5px;">${n.name}</span></td>
                    ${activeMeas.map(m => {
                    const v = n.values[m.fieldName] || 0;
                    return (cfg.st || !hasCh) ? `<td style="text-align:right; padding:10px; color:${v < 0 ? cfg.neg : cfg.pos}; font-weight:600; cursor:cell;" 
                            onclick="window.filterToggle('${n.id}', ${pathStr})">${fmt(v)}</td>` : `<td style="background:#fdfdfd;"></td>`;
                }).join('')}</tr>`;
                if (open && hasCh) buildRows(n.children, depth + 1);
            });
        };
        buildRows(root.children, 0);
        document.getElementById('content').innerHTML = html + `</tbody></table>`;
    }
})();
