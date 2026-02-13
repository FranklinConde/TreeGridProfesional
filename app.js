'use strict';
(function () {
    let expandedNodes = new Set(), searchQuery = "";
    const s = () => tableau.extensions.settings;

    tableau.extensions.initializeAsync({
        'configure': () => {
            const url = `${window.location.origin}/configure.html`;
            tableau.extensions.ui.displayDialogAsync(url, "", { height: 600, width: 400 }).then(p => p === "refresh" && render());
        }
    }).then(() => {
        // Sincronización inicial de botones superiores
        const gt = document.getElementById('chkGrandTotal'), st = document.getElementById('chkSubtotals');
        gt.checked = s().get('cfg_gt') !== 'false';
        st.checked = s().get('cfg_st') !== 'false';
        gt.onclick = () => saveOpt('cfg_gt', gt.checked);
        st.onclick = () => saveOpt('cfg_st', st.checked);
        document.getElementById('txtSearch').oninput = (e) => { searchQuery = e.target.value.toLowerCase(); render(); };

        render();
        s().addEventListener(tableau.TableauSettingsEventType.SettingsChanged, render);
        tableau.extensions.worksheetContent.worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, render);
    });

    const saveOpt = (k, v) => s().set(k, v.toString()) || s().saveAsync().then(render);

    window.toggle = (id, field, val) => {
        expandedNodes.has(id) ? expandedNodes.delete(id) : expandedNodes.add(id);
        if (field && val) tableau.extensions.worksheetContent.worksheet.applyFilterAsync(field, [val], 'replace');
        render();
    };

    async function render() {
        const ws = tableau.extensions.worksheetContent.worksheet;
        const data = await ws.getSummaryDataAsync();
        const cfg = {
            bg: s().get('cfg_bg') || '#1a2b3c', tx: s().get('cfg_txt') || '#fff',
            pos: s().get('cfg_pos') || '#27ae60', neg: s().get('cfg_neg') || '#e74c3c',
            sh: s().get('cfg_sz_h') || '14', sl: s().get('cfg_sz_l') || '13', sd: s().get('cfg_sz_d') || '12',
            dec: parseInt(s().get('cfg_dec') || '2'),
            gt: s().get('cfg_gt') !== 'false', st: s().get('cfg_st') !== 'false'
        };

        if (!data || data.data.length === 0) return;
        const dims = data.columns.filter(c => c.dataType === 'string'), meas = data.columns.filter(c => c.dataType !== 'string');
        const root = { name: "Root", children: [], values: {}, id: "root" }, gTots = {};
        meas.forEach(m => gTots[m.fieldName] = 0);

        data.data.forEach(row => {
            let curr = root;
            dims.forEach((d, i) => {
                const v = row[d.index].formattedValue || "Nulo";
                let ch = curr.children.find(c => c.name === v);
                if (!ch) {
                    ch = { name: v, field: d.fieldName, children: [], values: {}, id: curr.id + "_" + v.replace(/\s/g, '') };
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

        let html = `<table style="width:100%; border-collapse:collapse; font-family:sans-serif;">
            <thead><tr style="background:${cfg.bg}; color:${cfg.tx}; font-size:${cfg.sh}px;">
            <th style="padding:12px; text-align:left;">Estructura</th>${meas.map(m => `<th style="text-align:right; padding:12px;">${m.fieldName.replace(/SUM|AGG|\(|\)/g, '')}</th>`).join('')}
            </tr></thead><tbody>`;

        if (cfg.gt) {
            html += `<tr style="background:#f8f9fa; font-weight:800; border-bottom:2px solid #ddd;">
                <td style="padding:12px;" onclick="tableau.extensions.worksheetContent.worksheet.clearFilterAsync(dims[0].fieldName).then(render)">📈 TOTAL GENERAL</td>
                ${meas.map(m => `<td style="text-align:right; padding:12px; color:${gTots[m.fieldName] < 0 ? cfg.neg : cfg.pos}">${gTots[m.fieldName].toLocaleString('en-US', { minimumFractionDigits: cfg.dec })}</td>`).join('')}</tr>`;
        }

        const buildRows = (nodes, depth) => {
            nodes.forEach(n => {
                const match = searchQuery && n.name.toLowerCase().includes(searchQuery);
                if (match) expandedNodes.add(n.id);
                const open = expandedNodes.has(n.id), hasCh = n.children.length > 0;
                const icon = depth === 0 ? '🏛️' : (hasCh ? '💼' : '🪙');

                html += `<tr style="border-bottom:1px solid #eee; background:${depth === 0 ? '#fcfcfc' : '#fff'};">
                    <td style="padding:10px 10px 10px ${depth * 20 + 12}px; cursor:pointer; font-size:${cfg.sl}px;" onclick="window.toggle('${n.id}','${n.field}','${n.name}')">
                    <span style="font-size:10px; color:#999;">${hasCh ? (open ? '▼' : '►') : ''}</span> ${icon} 
                    <span style="font-weight:${depth === 0 ? 700 : 400}; background:${match ? '#fff3cd' : ''}">${n.name}</span></td>
                    ${meas.map(m => {
                    const v = n.values[m.fieldName] || 0;
                    return (cfg.st || !hasCh) ? `<td style="text-align:right; padding:10px; font-size:${cfg.sd}px; color:${v < 0 ? cfg.neg : cfg.pos}; font-weight:600;">
                            ${v.toLocaleString('en-US', { minimumFractionDigits: cfg.dec })}</td>` : `<td></td>`;
                }).join('')}</tr>`;
                if (open && hasCh) buildRows(n.children, depth + 1);
            });
        };

        buildRows(root.children, 0);
        document.getElementById('content').innerHTML = html + `</tbody></table>`;
    }
})();
