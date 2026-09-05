'use strict';

function initPagebreakExternal() {

  /* ==========================================================
     STATE
     ========================================================== */
  let ext_dirHandle = null, ext_fileHandle = null, ext_fileHandles = {};
  let ext_pageMap = {}; // "116" -> { fileName: "10_63860_ch2.xhtml", chPrefix: "ch2" }
  let ext_srcContent = '', ext_candidates = [], ext_fixedContent = '', ext_applied = false;
  let ext_filterQuery = '';
  const ext_history = [], EXT_MAX_HISTORY = 50;

  const ext_mainBody = document.getElementById('ext_mainBody'),
    ext_summaryBar = document.getElementById('ext_summaryBar'),
    ext_saveBtn = document.getElementById('ext_saveBtn'),
    ext_copyBtn = document.getElementById('ext_copyBtn'),
    ext_runBtn = document.getElementById('extRunBtn'),
    ext_runBtnText = document.getElementById('extRunBtnText');

  function checkReady() {
    ext_runBtn.disabled = !(ext_dirHandle && ext_fileHandle);
  }

  function pushHistory(action) {
    ext_history.push(action);
    if (ext_history.length > EXT_MAX_HISTORY) ext_history.shift();
  }

  function undo() {
    if (!ext_history.length) { toast('Nothing to undo', 'error'); return; }
    const action = ext_history.pop();
    if (action.type === 'cycleState') {
      const c = ext_candidates[action.i];
      c.state = action.prevState;
      paintSpan(action.i);
      updateSelCount();
      updateStats(false);
      toast('Undone: state change', 'success');
    } else if (action.type === 'bulkState') {
      action.indices.forEach((i, idx) => {
        if (ext_candidates[i]) ext_candidates[i].state = action.prevStates[idx];
      });
      paintAll();
      toast('Undone: bulk change', 'success');
    }
  }

  // Ctrl+Z listener (scoped to tab 3)
  document.addEventListener('keydown', e => {
    const pane3 = document.getElementById('tabPane3');
    if (!pane3 || pane3.hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
  });

  /* ==========================================================
     STEP 1 — Folder Picker
     ========================================================== */
  document.getElementById('ext_pickFolder').addEventListener('click', async () => {
    try {
      ext_dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        id: 'epub-folder-ext',
        startIn: 'documents'
      });
      ext_fileHandles = {};
      let count = 0;
      for await (const [name, handle] of ext_dirHandle.entries()) {
        if (handle.kind === 'file' && (name.endsWith('.xhtml') || name.endsWith('.html'))) {
          ext_fileHandles[name] = handle;
          count++;
        }
      }
      document.getElementById('ext_folderBtnText').textContent = ext_dirHandle.name;
      document.getElementById('ext_pickFolder').classList.add('selected');
      document.getElementById('ext_step1').classList.add('done');
      const st = document.getElementById('ext_folderStatus');
      st.textContent = `${count} xhtml file${count === 1 ? '' : 's'} found`;
      st.className = 'step-status ok';
      document.getElementById('ext_pickFile').disabled = false;
      checkReady();
    } catch (e) {
      if (e.name !== 'AbortError') toast('Error: ' + e.message, 'error');
    }
  });

  /* ==========================================================
     STEP 2 — Index File Picker
     ========================================================== */
  document.getElementById('ext_pickFile').addEventListener('click', async () => {
    try {
      [ext_fileHandle] = await window.showOpenFilePicker({
        id: 'index-file-ext',
        startIn: ext_dirHandle || 'documents',
        types: [{ description: 'XHTML/HTML', accept: { 'text/html': ['.xhtml', '.html'] } }],
        multiple: false
      });
      document.getElementById('ext_fileBtnText').textContent = ext_fileHandle.name;
      document.getElementById('ext_pickFile').classList.add('selected');
      document.getElementById('ext_step2').classList.add('done');
      const st = document.getElementById('ext_fileStatus');
      st.textContent = 'Ready to scan';
      st.className = 'step-status ok';
      checkReady();
    } catch (e) {
      if (e.name !== 'AbortError') toast('Error: ' + e.message, 'error');
    }
  });

  /* ==========================================================
     CHAPTER PREFIX EXTRACTION
     ========================================================== */
  function getChapterPrefix(fileName) {
    const base = fileName.replace(/\.(xhtml|html)$/i, '');
    const parts = base.split('_');
    return parts[parts.length - 1];
  }

  /* ==========================================================
     BUILD PAGEBREAK MAP ACROSS ALL FILES
     ========================================================== */
  async function buildPagebreakMap(onProgress) {
    const map = {};
    const entries = Object.entries(ext_fileHandles);
    let done = 0;
    for (const [fname, handle] of entries) {
      const content = await readFile(handle);
      const re = /<[^>]+\bid="page_([a-zA-Z0-9_\-]+)"[^>]*>/gi;
      let m;
      const chPrefix = getChapterPrefix(fname);
      while ((m = re.exec(content)) !== null) {
        const pageNum = m[1].toLowerCase();
        map[pageNum] = { fileName: fname, chPrefix };
      }
      done++;
      if (onProgress) onProgress(done, entries.length, fname);
      await new Promise(r => requestAnimationFrame(r));
    }
    return map;
  }

  /* ==========================================================
     CANDIDATE DETECTION
     ========================================================== */
  function collectExternalCandidates(content, pageMap) {
    const out = [];
    const P_RE = /(<(li|p|td|dd|dt)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi;
    let pm;
    P_RE.lastIndex = 0;

    while ((pm = P_RE.exec(content)) !== null) {
      const inner = pm[3];
      // Quick pre-check for number + n
      if (!/\d+\s*n/i.test(inner)) continue;

      const innerStart = pm.index + pm[1].length;
      // Mask existing links to prevent double-linking
      const masked = inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, m => ' '.repeat(m.length));

      // Range regex matching with flexible spacing and optional dot: 190n.6-7, 190 n. 6 – 8, 116n23-24, etc.
      const RANGE_RE = /\b(\d+)\s*n\s*(?:\.\s*)?(\d+)\s*([-–—]|&#x2013;|&#8211;|&#x2014;|&#8212;|&ndash;|&mdash;)\s*(\d+)\b/gi;
      const rangeZones = [];
      let rm;
      RANGE_RE.lastIndex = 0;

      while ((rm = RANGE_RE.exec(masked)) !== null) {
        const fullMatch = rm[0];
        const pageNum = rm[1];
        const fn1 = rm[2];
        const sep = rm[3];
        const fn2 = rm[4];

        const matchStart = rm.index;
        const pageLower = pageNum.toLowerCase();
        const pageInfo = pageMap[pageLower] || null;
        const targetFile = pageInfo ? pageInfo.fileName : null;

        // Find the first part before the separator
        const sepIdx = fullMatch.indexOf(sep);
        const part1Text = fullMatch.slice(0, sepIdx).trim();
        const part1Offset = fullMatch.indexOf(part1Text);
        const part1Start = matchStart + (part1Offset >= 0 ? part1Offset : 0);
        const part1End = part1Start + part1Text.length;

        const anchor1 = pageInfo ? `${pageInfo.chPrefix}_fn${fn1}` : null;
        out.push({
          start: innerStart + part1Start,
          end: innerStart + part1End,
          num: part1Text,
          pageNum,
          fnNum: fn1,
          targetFile,
          anchorId: anchor1,
          state: targetFile ? 'linked' : 'noanchor'
        });

        // Second candidate: fn2
        const part2Offset = fullMatch.lastIndexOf(fn2);
        const part2Start = matchStart + (part2Offset >= 0 ? part2Offset : fullMatch.length - fn2.length);
        const part2End = part2Start + fn2.length;

        const anchor2 = pageInfo ? `${pageInfo.chPrefix}_fn${fn2}` : null;
        out.push({
          start: innerStart + part2Start,
          end: innerStart + part2End,
          num: fn2,
          pageNum,
          fnNum: fn2,
          targetFile,
          anchorId: anchor2,
          state: targetFile ? 'linked' : 'noanchor'
        });

        rangeZones.push([matchStart, matchStart + fullMatch.length]);
      }

      // Helper to check if a position overlaps with any already detected range
      function inRangeZone(pos, len) {
        return rangeZones.some(([s, e]) => pos < e && pos + len > s);
      }

      // Single regex matching with flexible spacing and optional dot: 190n.6, 190 n 6, 190 n.6, 190n. 8, 190 n. 6, 116n23
      const SINGLE_RE = /\b(\d+)\s*n\s*(?:\.\s*)?(\d+)\b/gi;
      let sm;
      SINGLE_RE.lastIndex = 0;

      while ((sm = SINGLE_RE.exec(masked)) !== null) {
        const matchStart = sm.index;
        const fullMatch = sm[0];
        if (inRangeZone(matchStart, fullMatch.length)) continue;

        const pageNum = sm[1];
        const fnNum = sm[2];
        const pageLower = pageNum.toLowerCase();
        const pageInfo = pageMap[pageLower] || null;
        const targetFile = pageInfo ? pageInfo.fileName : null;
        const anchorId = pageInfo ? `${pageInfo.chPrefix}_fn${fnNum}` : null;

        out.push({
          start: innerStart + matchStart,
          end: innerStart + matchStart + fullMatch.length,
          num: fullMatch,
          pageNum,
          fnNum,
          targetFile,
          anchorId,
          state: targetFile ? 'linked' : 'noanchor'
        });
      }
    }

    out.sort((a, b) => a.start - b.start);
    return out;
  }

  /* ==========================================================
     OUTPUT GENERATION
     ========================================================== */
  function buildOutput() {
    let out = '', last = 0, linked = 0, forcedNoAnchor = 0;
    for (const c of ext_candidates) {
      if (c.state !== 'linked') continue;
      if (!c.targetFile) { forcedNoAnchor++; continue; }
      out += ext_srcContent.slice(last, c.start);
      out += `<a epub:type="index-locator" href="${c.targetFile}#${c.anchorId}">${c.num}</a>`;
      last = c.end;
      linked++;
    }
    out += ext_srcContent.slice(last);
    return { text: out, linked, forcedNoAnchor };
  }

  /* ==========================================================
     COUNTS & STATS
     ========================================================== */
  function counts() {
    let sel = 0, noAnchor = 0;
    for (const c of ext_candidates) {
      if (c.state === 'linked' && c.targetFile) sel++;
      if (!c.targetFile) noAnchor++;
    }
    return { sel, noAnchor, total: ext_candidates.length };
  }

  function updateStats(animate) {
    const { sel, noAnchor, total } = counts();
    const fileCount = Object.keys(ext_fileHandles).length;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (animate) countUp(el, v); else el.textContent = v.toLocaleString();
    };
    set('ext_cTotal', total);
    set('ext_cFixed', sel);
    set('ext_cNotFound', noAnchor);
    set('ext_cFiles', fileCount);
  }

  function updateSelCount() {
    const { sel, total } = counts();
    const el = document.getElementById('ext_selCount');
    if (el) el.innerHTML = `<b>${sel.toLocaleString()}</b> of ${total.toLocaleString()} external refs selected`;
  }

  /* ==========================================================
     PAINT & TOGGLE
     ========================================================== */
  function paintSpan(i) {
    const c = ext_candidates[i];
    const span = document.querySelector(`#ext_previewContainer .num-highlight[data-i="${i}"]`);
    if (span) {
      span.dataset.state = c.state;
      span.classList.remove('linked', 'skipped', 'noanchor');
      span.classList.add(c.state);
    }
    const row = document.querySelector(`#ext_fixBody tr[data-i="${i}"]`);
    if (row) row.replaceWith(buildRow(i));
    icons();
  }

  function paintAll() {
    ext_candidates.forEach((c, i) => {
      const span = document.querySelector(`#ext_previewContainer .num-highlight[data-i="${i}"]`);
      if (span) {
        span.dataset.state = c.state;
        span.classList.remove('linked', 'skipped', 'noanchor');
        span.classList.add(c.state);
      }
    });
    renderTable(false);
    updateSelCount();
    updateStats(false);
  }

  function cycleState(span) {
    const i = Number(span.dataset.i);
    const c = ext_candidates[i];
    if (!c || !c.targetFile) return;
    const prevState = c.state;
    c.state = c.state === 'linked' ? 'skipped' : 'linked';
    paintSpan(i);
    updateSelCount();
    updateStats(false);
    pushHistory({ type: 'cycleState', i, prevState });
  }

  /* ==========================================================
     TABLE & ROWS
     ========================================================== */
  const MAX_ROWS = 500;

  function statusPill(c) {
    if (c.state === 'linked') {
      return c.targetFile
        ? `<span class="pill pill-pass"><i data-lucide="check"></i>Linked</span>`
        : `<span class="pill pill-warn"><i data-lucide="alert-triangle"></i>No Anchor</span>`;
    }
    if (c.state === 'noanchor') {
      return `<span class="pill pill-fail"><i data-lucide="x"></i>No Pagebreak</span>`;
    }
    return `<span class="pill pill-skip"><i data-lucide="minus"></i>Skipped</span>`;
  }

  function buildRow(i) {
    const c = ext_candidates[i];
    const tr = document.createElement('tr');
    tr.dataset.i = i;
    if (c.state !== 'linked') tr.className = 'is-skipped';
    tr.innerHTML =
      `<td class="cell-num">${c.num}</td>` +
      `<td class="cell-mono">${c.pageNum}</td>` +
      `<td class="cell-mono">${c.targetFile ? c.targetFile : '<span class="cell-dash">&mdash;</span>'}</td>` +
      `<td class="cell-mono">${c.anchorId ? '#' + c.anchorId : '<span class="cell-dash">&mdash;</span>'}</td>` +
      `<td>${statusPill(c)}</td>`;
    return tr;
  }

  function renderTable(onlyApplied) {
    const tbody = document.getElementById('ext_fixBody');
    if (!tbody) return;

    const q = ext_filterQuery.trim().toLowerCase();
    let idx = ext_candidates.map((c, i) => i);

    if (onlyApplied) {
      idx = idx.filter(i => ext_candidates[i].state === 'linked' && ext_candidates[i].targetFile);
    }
    if (q) {
      idx = idx.filter(i => {
        const c = ext_candidates[i];
        return c.num.toLowerCase().includes(q) ||
          c.pageNum.toLowerCase().includes(q) ||
          (c.targetFile && c.targetFile.toLowerCase().includes(q)) ||
          (c.anchorId && c.anchorId.toLowerCase().includes(q));
      });
    }

    const shown = idx.slice(0, MAX_ROWS);
    tbody.innerHTML = '';
    for (const i of shown) tbody.appendChild(buildRow(i));

    const note = document.getElementById('ext_tableNote');
    if (note) {
      note.innerHTML = idx.length > MAX_ROWS
        ? `${(idx.length - MAX_ROWS).toLocaleString()} more entries not listed &mdash; all are processed on the left.`
        : '';
      note.hidden = idx.length <= MAX_ROWS;
    }
    const sub = document.getElementById('ext_tableSub');
    if (sub) sub.textContent = `${idx.length.toLocaleString()} ${onlyApplied ? 'applied' : 'detected'}`;
    icons();
  }

  /* ==========================================================
     PREVIEW
     ========================================================== */
  function buildPreviewHTML() {
    let out = '', last = 0;
    ext_candidates.forEach((c, i) => {
      out += ext_srcContent.slice(last, c.start);
      out += `<span class="num-highlight ${c.state}"` +
        ` data-i="${i}"` +
        ` data-num="${escAttr(c.num)}"` +
        ` data-target="${escAttr(c.targetFile || '')}"` +
        ` data-anchor="${escAttr(c.anchorId || '')}"` +
        ` data-state="${c.state}"` +
        ` role="button" tabindex="0">${c.num}</span>`;
      last = c.end;
    });
    out += ext_srcContent.slice(last);
    return sanitizeDoc(out);
  }

  function sanitizeDoc(s) {
    const b = /<body[^>]*>([\s\S]*?)<\/body\s*>/i.exec(s);
    let h = b ? b[1] : s;
    h = h.replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<(script|style|link|meta|base|img|input|form)\b[^>]*\/?>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(?:src|href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
    if (!h.trim()) {
      const head = /<head\b[\s\S]*?<\/head\s*>/i.exec(s);
      h = head ? s.slice(head.index + head[0].length) : s;
    }
    return h;
  }

  /* ==========================================================
     RENDER MAIN RESULTS VIEW
     ========================================================== */
  function renderResults() {
    ext_mainBody.innerHTML = `
      <div class="split">

        <section class="panel">
          <div class="panel-head">
            <i data-lucide="eye"></i>
            <span class="panel-title">Preview</span>
          </div>

          <div class="apply-row">
            <span class="sel-count" id="ext_selCount"></span>
            <div style="display:flex;gap:6px;margin-left:auto;align-items:center;">
              <button class="pill pill-pass" id="ext_linkAllBtn" type="button" style="cursor:pointer;padding:4px 10px;">Link All</button>
              <button class="pill pill-skip" id="ext_unlinkAllBtn" type="button" style="cursor:pointer;padding:4px 10px;">Unlink All</button>
              <button class="btn-apply" id="ext_applyBtn">
                <i data-lucide="check-check"></i>Apply Selected
              </button>
            </div>
          </div>

          <div class="panel-body">
            <div class="preview-doc" id="ext_previewContainer">${buildPreviewHTML()}</div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <i data-lucide="list-checks"></i>
            <span class="panel-title">External Links</span>
            <span class="panel-sub"><span id="ext_tableSub"></span></span>
          </div>

          <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;background:var(--surface-2);">
            <i data-lucide="search" style="width:14px;height:14px;color:var(--muted);"></i>
            <input type="text" id="ext_tableSearch" placeholder="Search ref, page, file or anchor..." 
              style="flex:1;background:transparent;border:none;outline:none;font-size:var(--fs-12);color:var(--text);" autocomplete="off" spellcheck="false" />
          </div>

          <div class="panel-body">
            <table class="fix-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Page</th>
                  <th>Target File</th>
                  <th>Anchor ID</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="ext_fixBody"></tbody>
            </table>
            <div class="table-note" id="ext_tableNote" hidden></div>
          </div>
        </section>

      </div>`;

    renderTable(false);
    updateSelCount();

    // Table search input
    const searchInput = document.getElementById('ext_tableSearch');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        ext_filterQuery = e.target.value;
        renderTable(ext_applied);
      });
    }

    // Link all / Unlink all buttons
    document.getElementById('ext_linkAllBtn').addEventListener('click', () => {
      const affected = ext_candidates.map((c, i) => i).filter(i => ext_candidates[i].targetFile);
      const prevStates = affected.map(i => ext_candidates[i].state);
      affected.forEach(i => { ext_candidates[i].state = 'linked'; });
      paintAll();
      pushHistory({ type: 'bulkState', indices: affected, prevStates });
      toast('All valid refs linked', 'success');
    });

    document.getElementById('ext_unlinkAllBtn').addEventListener('click', () => {
      const affected = ext_candidates.map((c, i) => i).filter(i => ext_candidates[i].targetFile);
      const prevStates = affected.map(i => ext_candidates[i].state);
      affected.forEach(i => { ext_candidates[i].state = 'skipped'; });
      paintAll();
      pushHistory({ type: 'bulkState', indices: affected, prevStates });
      toast('All refs unlinked', 'success');
    });

    icons();
  }

  /* ==========================================================
     APPLY SELECTED
     ========================================================== */
  function applySelected() {
    const { text, linked, forcedNoAnchor } = buildOutput();
    ext_fixedContent = text;
    ext_applied = true;
    ext_saveBtn.disabled = false;
    ext_copyBtn.disabled = false;
    renderTable(true);
    let msg = `Applied — ${linked.toLocaleString()} external note link${linked === 1 ? '' : 's'} in output`;
    if (forcedNoAnchor) msg += `, ${forcedNoAnchor} skipped (pagebreak missing)`;
    toast(msg, 'success');
  }

  /* ==========================================================
     EVENT DELEGATION
     ========================================================== */
  ext_mainBody.addEventListener('click', e => {
    const span = e.target.closest('.num-highlight');
    if (span) { cycleState(span); return; }
    if (e.target.closest('#ext_applyBtn')) { applySelected(); return; }
    const row = e.target.closest('#ext_fixBody tr');
    if (row && row.dataset.i !== undefined) {
      const span2 = document.querySelector(`#ext_previewContainer .num-highlight[data-i="${row.dataset.i}"]`);
      if (span2) {
        span2.scrollIntoView({ behavior: 'smooth', block: 'center' });
        span2.classList.remove('flash');
        void span2.offsetWidth;
        span2.classList.add('flash');
      }
      return;
    }
  });

  ext_mainBody.addEventListener('keydown', e => {
    const span = e.target.closest && e.target.closest('.num-highlight');
    if (span && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      cycleState(span);
    }
  });

  /* ==========================================================
     SCAN ACTION
     ========================================================== */
  ext_runBtn.addEventListener('click', async () => {
    ext_runBtn.disabled = true;
    ext_runBtnText.textContent = 'Scanning...';
    const spinIcon = ext_runBtn.querySelector('svg,i');
    if (spinIcon) spinIcon.classList.add('spin');

    showSkeletons(ext_summaryBar, ext_mainBody);
    showProgress('Scanning chapter files for pagebreaks');
    ext_saveBtn.disabled = true;
    ext_copyBtn.disabled = true;
    ext_applied = false;
    ext_fixedContent = '';
    ext_filterQuery = '';

    try {
      ext_pageMap = await buildPagebreakMap((done, total, fname) => {
        setProgress(done, total, `Reading ${fname}`);
      });

      setProgress(1, 1, 'Detecting external footnote refs');
      ext_srcContent = await readFile(ext_fileHandle);
      ext_candidates = collectExternalCandidates(ext_srcContent, ext_pageMap);

      hideProgress();
      ext_summaryBar.hidden = false;
      updateStats(true);
      renderResults();

      const linked = ext_candidates.filter(c => c.state === 'linked').length;
      const missing = ext_candidates.filter(c => c.state === 'noanchor').length;

      toast(
        `${ext_candidates.length} ref(s) found — ${linked} ready to link` +
        (missing ? `, ${missing} pagebreak missing` : '') +
        '. Review and Apply Selected.',
        'success', 4200
      );
    } catch (e) {
      hideProgress();
      console.error(e);
      toast('Error: ' + e.message, 'error');
      ext_summaryBar.hidden = true;
      ext_mainBody.innerHTML = `
        <div class="empty-state is-error">
          <span class="empty-icon"><i data-lucide="alert-triangle"></i></span>
          <h2>Scan failed</h2>
          <p>${esc(e.message)}</p>
        </div>`;
      icons();
    }

    const doneIcon = ext_runBtn.querySelector('svg,i');
    if (doneIcon) doneIcon.classList.remove('spin');
    ext_runBtnText.textContent = 'Scan External Notes';
    checkReady();
  });

  /* ==========================================================
     SAVE / COPY
     ========================================================== */
  ext_saveBtn.addEventListener('click', async () => {
    if (!ext_fileHandle || !ext_applied) { toast('Click "Apply Selected" first', 'error'); return; }
    try {
      const writable = await ext_fileHandle.createWritable();
      await writable.write(ext_fixedContent);
      await writable.close();
      toast(`Saved: ${ext_fileHandle.name}`, 'success');
    } catch (e) { toast('Save error: ' + e.message, 'error'); }
  });

  ext_copyBtn.addEventListener('click', () => {
    if (!ext_applied) { toast('Click "Apply Selected" first', 'error'); return; }
    navigator.clipboard.writeText(ext_fixedContent)
      .then(() => toast('Copied to clipboard', 'success'))
      .catch(e => toast('Copy failed: ' + e.message, 'error'));
  });

}

initPagebreakExternal();
