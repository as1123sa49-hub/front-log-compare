const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

const modeEl = qs('#cmp-match-mode');
const customWrap = qs('#cmp-custom-wrap');
const enableOuter = qs('#cmp-enable-outer');
const outerWrap = qs('#cmp-outer-wrap');
const runBtn = qs('#cmp-run');
const downloadBtn = qs('#cmp-download');
const summaryEl = qs('#cmp-summary');
const tabsEl = qs('#cmp-tabs');
const panelAll = qs('#cmp-panel-all');
const panelMissing = qs('#cmp-panel-missing-group');
const panelJson = qs('#cmp-panel-jsondata');
const panelOuter = qs('#cmp-panel-outer');
let lastDiffRows = [];

function esc(v) { return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function t(v) { if (Array.isArray(v)) return 'array'; if (v === null) return 'null'; return typeof v; }
function parseMaybeJson(v) { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } } return v && typeof v === 'object' ? v : {}; }
function fmtSample(v) { if (v === undefined) return ''; if (v === null) return 'null'; if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch { return String(v); } }
function pathLabel(p) { return p === '$' ? 'jsondata(根節點)' : p; }
function issueLabel(k) {
  return ({
    match: '一致',
    missing_group: '整組缺失',
    extra_path: '新增欄位',
    missing_path: '缺少欄位',
    type_mismatch: '型別變更',
    outer_extra: '外層新增欄位',
    outer_missing: '外層缺少欄位',
    outer_type_mismatch: '外層型別變更'
  })[k] || k;
}
function issueDesc(row) {
  if (row.issue_type === 'missing_group') return `此匹配組在新舊其中一側不存在（舊版 ${row.old_value} 筆 / 新版 ${row.new_value} 筆）。`;
  if (row.issue_type === 'extra_path') return '新版出現舊版沒有的 jsondata 欄位。';
  if (row.issue_type === 'missing_path') return '新版缺少舊版已有的 jsondata 欄位。';
  if (row.issue_type === 'type_mismatch') return '同一路徑欄位型別不同，可能影響下游解析。';
  if (row.issue_type === 'outer_extra') return '新版多出外層欄位。';
  if (row.issue_type === 'outer_missing') return '新版缺少外層欄位。';
  if (row.issue_type === 'outer_type_mismatch') return '外層欄位型別不同。';
  if (row.issue_type === 'match') return '路徑存在且型別一致。';
  return '';
}
function matchTarget(key) { return key.replaceAll('(empty:function_name)', 'function_name(空)').replaceAll('(empty:event)', 'event(空)').replaceAll('|', ' / '); }

function getPathValue(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (path === '$') return obj;
  const parts = path.split('.');
  let cur = obj;
  for (const p0 of parts) {
    const p = p0.endsWith('[]') ? p0.slice(0, -2) : p0;
    cur = p ? cur?.[p] : cur;
    if (p0.endsWith('[]')) cur = Array.isArray(cur) ? cur[0] : undefined;
    if (cur === undefined || cur === null) return cur;
  }
  return cur;
}

function collectSchema(value, prefix, out, ignore) {
  const p = prefix || '$';
  const leaf = p.split('.').pop().replace('[]', '');
  if (ignore.has(p) || ignore.has(leaf)) return;
  out[p] = t(value);
  if (out[p] === 'array') {
    if (value.length > 0) collectSchema(value[0], `${p}[]`, out, ignore); else out[`${p}[]`] = 'unknown';
    return;
  }
  if (out[p] === 'object') {
    Object.keys(value).sort().forEach((k) => {
      if (ignore.has(k)) return;
      collectSchema(value[k], p === '$' ? k : `${p}.${k}`, out, ignore);
    });
  }
}

function normalize(payload, ignore) {
  return (Array.isArray(payload) ? payload : []).map((item) => {
    const root = item && typeof item === 'object' ? item : {};
    const body = root.payload && typeof root.payload === 'object' ? root.payload : root;
    const outer = body.data && typeof body.data === 'object' ? body.data : body;
    const json = parseMaybeJson(outer.jsondata);
    const schema = {};
    collectSchema(json, '$', schema, ignore);
    return {
      function_name: json.function_name || outer.function_name || body.function_name || '',
      event: body.event || outer.event || json.event || '',
      outer,
      json,
      schema
    };
  });
}

function keyOf(r, mode, fields) {
  if (mode === 'function_name') return r.function_name || '(empty:function_name)';
  if (mode === 'custom') {
    const x = fields.map((f) => `${f}=${r.outer[f] ?? ''}`).join('|');
    return x || '(custom:empty)';
  }
  return `${r.function_name || '(empty:function_name)'}|${r.event || '(empty:event)'}`;
}

function groupBy(list, mode, fields) {
  const m = new Map();
  list.forEach((r) => {
    const k = keyOf(r, mode, fields);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  return m;
}

function mergeSchema(records) {
  const m = new Map();
  records.forEach((r) => Object.entries(r.schema).forEach(([p, ty]) => {
    if (!m.has(p)) m.set(p, new Set());
    m.get(p).add(ty);
  }));
  return m;
}

function mergeOuter(records, fields) {
  const m = new Map();
  records.forEach((r) => fields.forEach((f) => {
    if (!(f in r.outer)) return;
    if (!m.has(f)) m.set(f, new Set());
    m.get(f).add(t(r.outer[f]));
  }));
  return m;
}

function samplePath(records, path, source) {
  const vals = new Set();
  records.forEach((r) => {
    const raw = source === 'outer' ? r.outer[path] : getPathValue(r.json, path);
    const fv = fmtSample(raw);
    if (fv !== '') vals.add(fv);
  });
  const a = Array.from(vals);
  if (!a.length) return '';
  if (a.length <= 2) return a.join(' | ');
  return `${a.slice(0, 2).join(' | ')} ... (共${a.length}種)`;
}

function seqText(records) {
  const s = new Set();
  records.forEach((r) => { const v = r.outer?.seq_index; if (v !== undefined && v !== null && v !== '') s.add(String(v)); });
  const a = Array.from(s);
  if (!a.length) return '';
  if (a.length <= 3) return a.join(' | ');
  return `${a.slice(0, 3).join(' | ')} ... (共${a.length}筆)`;
}

function tableRows(rows) {
  if (!rows.length) return '<p class="status-pass">此分頁未發現差異。</p>';
  return `<table><thead><tr><th>比對對象</th><th>狀態</th><th>差異分類</th><th>差異欄位</th><th>舊版</th><th>新版</th><th>舊版 seq_index</th><th>新版 seq_index</th><th>說明</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(matchTarget(r.key))}</td><td>${esc(r.status)}</td><td>${esc(issueLabel(r.issue_type))}</td><td>${esc(r.field || '-')}</td><td>${esc(r.old_value || '-')}</td><td>${esc(r.new_value || '-')}</td><td>${esc(r.old_seq_index || '-')}</td><td>${esc(r.new_seq_index || '-')}</td><td>${esc(issueDesc(r))}</td></tr>`).join('')
  }</tbody></table>`;
}

function accordion(groups, type) {
  if (!groups.length) return '<p class="status-pass">此分頁目前沒有可展開資料。</p>';
  return groups.map((g, i) => {
    const id = `${type}-${i}`;
    const header = type === 'json'
      ? `PASS ${g.passCount} / WARN ${g.warnCount} / FAIL ${g.failCount}`
      : `PASS ${g.passCount} / WARN ${g.warnCount} / FAIL ${g.failCount}`;
    const headCols = type === 'json'
      ? '<th>欄位路徑</th><th>結果</th><th>差異分類</th><th>舊版型別</th><th>新版型別</th><th>舊版樣本值</th><th>新版樣本值</th><th>說明</th>'
      : '<th>外層欄位</th><th>結果</th><th>差異分類</th><th>舊版型別</th><th>新版型別</th><th>舊版樣本值</th><th>新版樣本值</th><th>說明</th>';
    return `<article class="json-acc-card">
      <button class="json-acc-toggle" data-target="${id}" type="button">
        <span class="json-acc-title">${esc(matchTarget(g.key))}</span>
        <span class="json-acc-meta">${header}</span>
        <span class="json-acc-meta">舊版 seq_index: ${esc(g.oldSeq || '-')}</span>
        <span class="json-acc-meta">新版 seq_index: ${esc(g.newSeq || '-')}</span>
      </button>
      <div id="${id}" class="json-acc-panel">
        <table><thead><tr>${headCols}</tr></thead><tbody>${
          g.details.map((d) => `<tr>
            <td>${esc(type === 'json' ? pathLabel(d.path) : (d.field || '-'))}</td>
            <td>${esc(d.status)}</td>
            <td>${esc(issueLabel(d.issue_type))}</td>
            <td>${esc(d.old_type || d.old_value || '-')}</td>
            <td>${esc(d.new_type || d.new_value || '-')}</td>
            <td>${esc(d.old_sample || '-')}</td>
            <td>${esc(d.new_sample || '-')}</td>
            <td>${esc(issueDesc({ issue_type: d.issue_type, old_value: d.old_type || d.old_value, new_value: d.new_type || d.new_value }) || '結構一致')}</td>
          </tr>`).join('')
        }</tbody></table>
      </div>
    </article>`;
  }).join('');
}

qsa('.cmp-tab-btn').forEach((btn) => btn.addEventListener('click', () => {
  qsa('.cmp-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
  panelAll.classList.toggle('hidden', btn.dataset.tab !== 'all');
  panelMissing.classList.toggle('hidden', btn.dataset.tab !== 'missing-group');
  panelJson.classList.toggle('hidden', btn.dataset.tab !== 'jsondata');
  panelOuter.classList.toggle('hidden', btn.dataset.tab !== 'outer');
}));
modeEl.addEventListener('change', () => customWrap.classList.toggle('hidden', modeEl.value !== 'custom'));
enableOuter.addEventListener('change', () => outerWrap.classList.toggle('hidden', !enableOuter.checked));
panelJson.addEventListener('click', (e) => { const b = e.target.closest('.json-acc-toggle'); if (b) qs(`#${b.dataset.target}`).classList.toggle('hidden'); });
panelOuter.addEventListener('click', (e) => { const b = e.target.closest('.json-acc-toggle'); if (b) qs(`#${b.dataset.target}`).classList.toggle('hidden'); });

runBtn.addEventListener('click', async () => {
  const oldFile = qs('#cmp-old-file').files?.[0];
  const newFile = qs('#cmp-new-file').files?.[0];
  if (!oldFile || !newFile) { summaryEl.innerHTML = '<p class="status-fail">請先上傳舊版與新版 JSON。</p>'; return; }

  try {
    const oldJson = JSON.parse(await oldFile.text());
    const newJson = JSON.parse(await newFile.text());
    const ignore = new Set(qs('#cmp-ignore-fields').value.split(',').map((s) => s.trim()).filter(Boolean));
    const rawOld = normalize(oldJson, ignore);
    const rawNew = normalize(newJson, ignore);
    const onlyFn = qs('#cmp-only-has-function-name').checked;
    const oldList = onlyFn ? rawOld.filter((r) => String(r.function_name || '').trim()) : rawOld;
    const newList = onlyFn ? rawNew.filter((r) => String(r.function_name || '').trim()) : rawNew;
    const oldSkip = rawOld.length - oldList.length;
    const newSkip = rawNew.length - newList.length;
    const mode = modeEl.value;
    const customFields = qs('#cmp-custom-fields').value.split(',').map((s) => s.trim()).filter(Boolean);
    const outerFields = qs('#cmp-outer-fields').value.split(',').map((s) => s.trim()).filter(Boolean);
    const compareOuter = enableOuter.checked && outerFields.length > 0;

    const oldMap = groupBy(oldList, mode, customFields);
    const newMap = groupBy(newList, mode, customFields);
    const keys = Array.from(new Set([...oldMap.keys(), ...newMap.keys()])).sort();

    const rows = []; const jsonGroups = []; const outerGroups = [];
    let pass = 0; let warn = 0; let fail = 0;
    keys.forEach((key) => {
      const og = oldMap.get(key) || []; const ng = newMap.get(key) || [];
      const oldSeq = seqText(og); const newSeq = seqText(ng);
      if (!og.length || !ng.length) { fail += 1; rows.push({ key, status: 'FAIL', issue_type: 'missing_group', field: '', old_value: String(og.length), new_value: String(ng.length), old_seq_index: oldSeq, new_seq_index: newSeq }); return; }

      let hasFail = false; let hasWarn = false;
      const oldS = mergeSchema(og); const newS = mergeSchema(ng);
      const paths = Array.from(new Set([...oldS.keys(), ...newS.keys()])).sort();
      let jp = 0; let jw = 0; let jf = 0; const jd = [];
      paths.forEach((p) => {
        const ot = oldS.get(p); const nt = newS.get(p);
        const osv = samplePath(og, p, 'json'); const nsv = samplePath(ng, p, 'json');
        if (!ot && nt) { hasWarn = true; jw += 1; jd.push({ path: p, status: 'WARN', issue_type: 'extra_path', old_type: '', new_type: Array.from(nt).sort().join('|'), old_sample: osv, new_sample: nsv }); rows.push({ key, status: 'WARN', issue_type: 'extra_path', field: p, old_value: '', new_value: Array.from(nt).join('|'), old_seq_index: oldSeq, new_seq_index: newSeq }); return; }
        if (ot && !nt) { hasFail = true; jf += 1; jd.push({ path: p, status: 'FAIL', issue_type: 'missing_path', old_type: Array.from(ot).sort().join('|'), new_type: '', old_sample: osv, new_sample: nsv }); rows.push({ key, status: 'FAIL', issue_type: 'missing_path', field: p, old_value: Array.from(ot).join('|'), new_value: '', old_seq_index: oldSeq, new_seq_index: newSeq }); return; }
        const ots = Array.from(ot).sort().join('|'); const nts = Array.from(nt).sort().join('|');
        if (ots !== nts) { hasFail = true; jf += 1; jd.push({ path: p, status: 'FAIL', issue_type: 'type_mismatch', old_type: ots, new_type: nts, old_sample: osv, new_sample: nsv }); rows.push({ key, status: 'FAIL', issue_type: 'type_mismatch', field: p, old_value: ots, new_value: nts, old_seq_index: oldSeq, new_seq_index: newSeq }); }
        else { jp += 1; jd.push({ path: p, status: 'PASS', issue_type: 'match', old_type: ots, new_type: nts, old_sample: osv, new_sample: nsv }); }
      });
      jsonGroups.push({ key, oldSeq, newSeq, passCount: jp, warnCount: jw, failCount: jf, details: jd });

      if (compareOuter) {
        const oO = mergeOuter(og, outerFields); const nO = mergeOuter(ng, outerFields);
        let op = 0; let ow = 0; let of = 0; const od = [];
        outerFields.forEach((f) => {
          const ot = oO.get(f); const nt = nO.get(f); if (!ot && !nt) return;
          const osv = samplePath(og, f, 'outer'); const nsv = samplePath(ng, f, 'outer');
          if (!ot && nt) { hasWarn = true; ow += 1; od.push({ field: f, status: 'WARN', issue_type: 'outer_extra', old_value: '', new_value: Array.from(nt).join('|'), old_sample: osv, new_sample: nsv }); rows.push({ key, status: 'WARN', issue_type: 'outer_extra', field: f, old_value: '', new_value: Array.from(nt).join('|'), old_seq_index: oldSeq, new_seq_index: newSeq }); return; }
          if (ot && !nt) { hasFail = true; of += 1; od.push({ field: f, status: 'FAIL', issue_type: 'outer_missing', old_value: Array.from(ot).join('|'), new_value: '', old_sample: osv, new_sample: nsv }); rows.push({ key, status: 'FAIL', issue_type: 'outer_missing', field: f, old_value: Array.from(ot).join('|'), new_value: '', old_seq_index: oldSeq, new_seq_index: newSeq }); return; }
          const ots = Array.from(ot).sort().join('|'); const nts = Array.from(nt).sort().join('|');
          if (ots !== nts) { hasFail = true; of += 1; od.push({ field: f, status: 'FAIL', issue_type: 'outer_type_mismatch', old_value: ots, new_value: nts, old_sample: osv, new_sample: nsv }); rows.push({ key, status: 'FAIL', issue_type: 'outer_type_mismatch', field: f, old_value: ots, new_value: nts, old_seq_index: oldSeq, new_seq_index: newSeq }); }
          else { op += 1; od.push({ field: f, status: 'PASS', issue_type: 'match', old_value: ots, new_value: nts, old_sample: osv, new_sample: nsv }); }
        });
        outerGroups.push({ key, oldSeq, newSeq, passCount: op, warnCount: ow, failCount: of, details: od });
      }
      if (hasFail) fail += 1; else if (hasWarn) warn += 1; else pass += 1;
    });

    lastDiffRows = rows;
    downloadBtn.disabled = rows.length === 0;
    const cls = fail > 0 ? 'status-fail' : (warn > 0 ? 'status-warn' : 'status-pass');
    summaryEl.innerHTML = `<p class="${cls}">比對完成：PASS ${pass} / WARN ${warn} / FAIL ${fail}（共 ${keys.length} 組）</p><p>參與比對筆數：舊版 ${oldList.length} / 新版 ${newList.length}${onlyFn ? `（已跳過無 function_name：舊版 ${oldSkip} / 新版 ${newSkip}）` : ''}</p>`;
    panelAll.innerHTML = tableRows(rows);
    panelMissing.innerHTML = tableRows(rows.filter((r) => r.issue_type === 'missing_group'));
    panelJson.innerHTML = accordion(jsonGroups, 'json');
    panelOuter.innerHTML = compareOuter ? accordion(outerGroups, 'outer') : '<p>未啟用外層比對，本次無外層差異資料。</p>';
    tabsEl.classList.remove('hidden');
  } catch (e) {
    summaryEl.innerHTML = `<p class="status-fail">比對失敗：${esc(e.message || '請確認上傳的是有效 JSON')}</p>`;
    tabsEl.classList.add('hidden');
    panelAll.innerHTML = ''; panelMissing.innerHTML = ''; panelJson.innerHTML = ''; panelOuter.innerHTML = '';
    lastDiffRows = []; downloadBtn.disabled = true;
  }
});

downloadBtn.addEventListener('click', () => {
  if (!lastDiffRows.length) return;
  const rows = lastDiffRows.map((r) => ({
    compare_target: matchTarget(r.key),
    status: r.status,
    issue_type: issueLabel(r.issue_type),
    field: r.field || '',
    old_value: r.old_value || '',
    new_value: r.new_value || '',
    old_seq_index: r.old_seq_index || '',
    new_seq_index: r.new_seq_index || '',
    description: issueDesc(r)
  }));
  const headers = ['compare_target', 'status', 'issue_type', 'field', 'old_value', 'new_value', 'old_seq_index', 'new_seq_index', 'description'];
  const blob = new Blob([toCsv(rows, headers)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `log_compare_diff_${Date.now()}.csv`;
  a.click();
});
