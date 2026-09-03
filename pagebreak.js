'use strict';

function initPagebreak() {

  /* ==========================================================
     STATE
     ========================================================== */
  let pb_dirHandle = null, pb_fileHandle = null, pb_fileHandles = {}, pb_fixedContent = '';
  let pb_srcContent = '', pb_candidates = [], pb_anchorOnly = true;
  let pb_manualAnchorMap = {}, pb_seeAlsoLinks = [];
  let pb_rangeMin = null, pb_rangeMax = null, pb_applied = false, pb_romanMode = false, pb_nSuffixMode = false;
  const pb_history = [], PB_MAX_HISTORY = 50;

  // crop-select state
  let pb_cropMode = false, pb_cropDragging = false, pb_cropStartX = 0, pb_cropStartY = 0;
  let pb_cropRectEl = null, pb_cropContainerEl = null;

  const pb_runBtn = document.getElementById('runBtn'),
    pb_runBtnText = document.getElementById('runBtnText'),
    pb_mainBody = document.getElementById('mainBody'),
    pb_summaryBar = document.getElementById('summaryBar'),
    pb_saveBtn = document.getElementById('saveBtn'),
    pb_copyBtn = document.getElementById('copyBtn');

  function pushHistory(action) {
    pb_history.push(action);
    if (pb_history.length > PB_MAX_HISTORY) pb_history.shift();
  }

  function undo() {
    if (!pb_history.length) { toast('Nothing to undo', 'error'); return; }
    const action = pb_history.pop();

    if (action.type === 'cycleState') {
      const c = pb_candidates[action.i];
      c.state = action.prevState;
      paintSpan(action.i);
      updateSelCount();
      updateStats(false);
      toast('Undone: state change', 'success');
    }

    else if (action.type === 'manualAnchor') {
      const c = pb_candidates[action.candIndex];
      c.targetFile = action.prevTargetFile;
      c.state = action.prevState;
      if (action.prevState === 'manual') {
        pb_manualAnchorMap[c.id] = action.prevTargetFile;
      } else {
        delete pb_manualAnchorMap[c.id];
      }
      paintSpan(action.candIndex);
      updateSelCount();
      updateStats(false);
      toast('Undone: manual anchor', 'success');
    }

    else if (action.type === 'seeAlso') {
      pb_seeAlsoLinks.splice(action.saIndex, 1);
      const mark = document.querySelector(`.sa-linked[data-sa-i="${action.saIndex}"]`);
      if (mark) {
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      }
      renderSeeAlsoTable();
      toast('Undone: see-also link', 'success');
    }

    else if (action.type === 'cropBulk') {
      action.indices.forEach((i, idx) => {
        const c = pb_candidates[i];
        if (!c) return;
        c.state = action.prevStates[idx];
        paintSpan(i);
      });
      updateSelCount();
      updateStats(false);
      toast('Undone: bulk crop action', 'success');
    }
  }

  // Ctrl+Z listener (scoped to tab 1 only)
  document.addEventListener('keydown', e => {
    if (document.getElementById('tabPane1').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
  });

  /* ==========================================================
     CROP SELECT — Alt+C toggles a drag-to-select rectangle over
     the preview that bulk-links or bulk-unlinks the numbers it covers.
     ========================================================== */
  function getCropIndicator() {
    let el = document.getElementById('cropIndicator');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cropIndicator';
      el.hidden = true;
      el.textContent = '✂ Crop Mode  ·  Alt+C to exit  ·  Esc to cancel selection';
      document.body.appendChild(el);
    }
    return el;
  }

  function activateCropMode() {
    pb_cropMode = true;
    document.body.classList.add('crop-mode');
    getCropIndicator().hidden = false;
    toast('Crop mode ON — drag to select numbers', 'success');
  }
  function deactivateCropMode() {
    pb_cropMode = false;
    pb_cropDragging = false;
    removeCropRect();
    document.querySelectorAll('.crop-popup').forEach(p => p.remove());
    document.body.classList.remove('crop-mode');
    getCropIndicator().hidden = true;
    toast('Crop mode OFF', 'success');
  }
  function toggleCropMode() {
    if (document.getElementById('tabPane1').hidden) return;
    if (pb_cropMode) deactivateCropMode(); else activateCropMode();
  }
  function removeCropRect() {
    if (pb_cropRectEl) { pb_cropRectEl.remove(); pb_cropRectEl = null; }
  }

  document.addEventListener('keydown', e => {
    if (document.getElementById('tabPane1').hidden) return;
    if (e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      toggleCropMode();
      return;
    }
    if (e.key === 'Escape' && pb_cropMode) {
      deactivateCropMode();
    }
  });

  // auto-deactivate crop mode if tab 1 is hidden (tab switch away)
  (() => {
    const tabPane1El = document.getElementById('tabPane1');
    if (!tabPane1El) return;
    const cropTabObserver = new MutationObserver(() => {
      if (tabPane1El.hidden && pb_cropMode) deactivateCropMode();
    });
    cropTabObserver.observe(tabPane1El, { attributes: true, attributeFilter: ['hidden'] });
  })();

  function showCropPopup(spans, zoneRect) {
    document.querySelectorAll('.crop-popup').forEach(p => p.remove());

    const indices = spans.map(s => Number(s.dataset.i));
    const noAnchorCount = indices.filter(i => pb_candidates[i] && pb_candidates[i].state === 'noanchor').length;

    const popup = document.createElement('div');
    popup.className = 'crop-popup';
    popup.innerHTML = `
    <div class="crop-popup-label">${indices.length} number${indices.length === 1 ? '' : 's'} selected</div>
    <div class="crop-popup-actions">
      <button class="pill pill-pass crop-link-btn" type="button">Link</button>
      <button class="pill pill-skip crop-unlink-btn" type="button">Unlink</button>
      <button class="crop-close-btn" type="button" aria-label="Cancel">✕</button>
    </div>
    ${noAnchorCount ? `<div class="crop-popup-note">${noAnchorCount} with no anchor (shown in red) will be excluded from linking</div>` : ''}`;

    document.body.appendChild(popup);
    icons();

    const cx = zoneRect.left + zoneRect.width / 2 + window.scrollX;
    const cy = zoneRect.top + zoneRect.height / 2 + window.scrollY;
    const x = Math.min(Math.max(8, cx - 100), window.innerWidth - 220);
    const y = Math.max(8, cy);
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';

    function bulkSet(newState, verb) {
      const affected = indices.filter(i => pb_candidates[i] && pb_candidates[i].state !== 'noanchor');
      if (!affected.length) { toast('No linkable numbers in selection', 'error'); popup.remove(); return; }
      const prevStates = affected.map(i => pb_candidates[i].state);
      affected.forEach(i => { pb_candidates[i].state = newState; });
      affected.forEach(i => paintSpan(i));
      updateSelCount();
      updateStats(false);
      pushHistory({ type: 'cropBulk', indices: affected, prevStates });
      toast(`${affected.length} number${affected.length === 1 ? '' : 's'} ${verb}`, 'success');
      popup.remove();
    }

    popup.querySelector('.crop-link-btn').addEventListener('click', () => bulkSet('linked', 'linked'));
    popup.querySelector('.crop-unlink-btn').addEventListener('click', () => bulkSet('skipped', 'unlinked'));
    popup.querySelector('.crop-close-btn').addEventListener('click', () => popup.remove());
    document.addEventListener('mousedown', function outside(e) {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', outside); }
    });
  }

  function checkReady() {
    pb_runBtn.disabled = !(pb_dirHandle && pb_fileHandle);
  }
  function checkIdReady() {
    const prefix = document.getElementById('idPrefixInput').value.trim();
    document.getElementById('applyIdBtn').disabled = !(pb_dirHandle && pb_fileHandle && prefix);
  }

  function getTopLevelLiEntries() {
    const allLi = /<(li|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    const positions = [];
    let mm;
    while ((mm = allLi.exec(pb_srcContent)) !== null) {
      positions.push({ index: mm.index, attrs: mm[2], inner: mm[3] });
    }
    const entries = [];
    for (const pos of positions) {
      const before = pb_srcContent.slice(0, pos.index);
      const openCount = (before.match(/<(li|td)\b/gi) || []).length;
      const closeCount = (before.match(/<\/(li|td)>/gi) || []).length;
      if (openCount === closeCount) {
        const idMatch = /\bid="([^"]+)"/.exec(pos.attrs);
        const id = idMatch ? idMatch[1] : null;
        const text = pos.inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (id) entries.push({ id, text });
      }
    }
    return entries;
  }

  /* ==========================================================
     TOOLTIP
     ========================================================== */
  const tip = (() => {
    let t = document.getElementById('tip');
    if (!t) { t = document.createElement('div'); t.id = 'tip'; t.setAttribute('role', 'tooltip'); }
    t.className = 'tip';
    t.hidden = true;
    document.body.appendChild(t);
    return t;
  })();

  function showTooltip(span) {
    const c = pb_candidates[Number(span.dataset.i)];
    if (!c) return;
    const target = span.dataset.target, id = span.dataset.id, num = span.dataset.num;
    tip.innerHTML =
      `<div class="tip-row"><span class="tip-key">Number</span><span class="tip-val">${num}</span></div>` +
      (target
        ? `<div class="tip-row"><span class="tip-key">Becomes</span><span class="tip-val tip-code">${esc(`<a href="${target}#${id}">${num}</a>`)}</span></div>` +
        `<div class="tip-row"><span class="tip-key">File</span><span class="tip-val tip-code">${esc(target)}</span></div>` +
        `<div class="tip-row"><span class="tip-key">Anchor</span><span class="tip-val tip-code">#${esc(id)}</span></div>`
        : `<div class="tip-row"><span class="tip-key">Anchor</span><span class="tip-val tip-warn">No matching anchor found</span></div>`) +
      `<div class="tip-hint">${c.state === 'linked' ? 'Will be linked — click to skip'
        : c.state === 'noanchor' ? 'No anchor — click to force-select'
          : 'Skipped — click to include'}</div>`;
    tip.hidden = false;
  }
  function positionTooltip(e) {
    const pad = 12, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }
  function hideTooltip() { tip.hidden = true; }

  /* ==========================================================
     STEP 1 — folder picker
     ========================================================== */
  document.getElementById('pickFolder').addEventListener('click', async () => {
    try {
      pb_dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        id: 'epub-folder',
        startIn: 'documents'
      });
      pb_fileHandles = {};
      let count = 0;
      for await (const [name, handle] of pb_dirHandle.entries()) {
        if (handle.kind === 'file' && (name.endsWith('.xhtml') || name.endsWith('.html'))) {
          pb_fileHandles[name] = handle; count++;
        }
      }
      document.getElementById('folderBtnText').textContent = pb_dirHandle.name;
      document.getElementById('pickFolder').classList.add('selected');
      document.getElementById('step1').classList.add('done');
      const st = document.getElementById('folderStatus');
      st.textContent = `${count} xhtml file${count === 1 ? '' : 's'} found`;
      st.className = 'step-status ok';
      document.getElementById('pickFile').disabled = false;
      checkReady();
      checkIdReady();
    } catch (e) { if (e.name !== 'AbortError') toast('Error: ' + e.message, 'error'); }
  });

  /* ==========================================================
     STEP 2 — index file picker
     ========================================================== */
  document.getElementById('pickFile').addEventListener('click', async () => {
    try {
      [pb_fileHandle] = await window.showOpenFilePicker({
        id: 'index-file',
        startIn: pb_dirHandle || 'documents',
        types: [{ description: 'XHTML/HTML', accept: { 'text/html': ['.xhtml', '.html'] } }],
        multiple: false
      });
      document.getElementById('fileBtnText').textContent = pb_fileHandle.name;
      document.getElementById('pickFile').classList.add('selected');
      document.getElementById('step2').classList.add('done');
      const st = document.getElementById('fileStatus');
      st.textContent = 'Ready to scan';
      st.className = 'step-status ok';
      checkReady();
      checkIdReady();
    } catch (e) { if (e.name !== 'AbortError') toast('Error: ' + e.message, 'error'); }
  });

  /* Build anchor map: "pagebreak_54" -> "chapter1.xhtml" */
  async function buildAnchorMap(onProgress) {
    const map = {};
    const entries = Object.entries(pb_fileHandles);
    let done = 0;
    for (const [fname, handle] of entries) {
      const content = await readFile(handle);
      const re = /<span\s+id="(page_[\w]+)"[^>]*\/?>/g;
      let m;
      while ((m = re.exec(content)) !== null) map[m[1].toLowerCase()] = fname;
      done++;
      if (onProgress) onProgress(done, entries.length, fname);
      await new Promise(r => requestAnimationFrame(r));
    }
    return map;
  }

  /* Extract unique numbers from inside a <p> tag's text content (ignores existing links) */
  function extractNumbers(pContent) {
    const stripped = pContent.replace(/<a\s+href="[^"]*"[^>]*>(\d+)<\/a>/g, '$1');
    const nums = new Set();
    const re = /\b(\d+)\b/g; let m;
    while ((m = re.exec(stripped)) !== null) nums.add(m[1]);
    return [...nums];
  }

  /* ==========================================================
     DETECTION
     ========================================================== */
  const P_RE = /(<(li|td|p)\b[^>]*>)([\s\S]*?)(<\/\2>)/g;
  const NUM_RE = /(?<!href="[^"]*#page_\d*)(?<!id="page_\d*)(?<!")\b(\d+)\b(?![\-–—\.]?\d*n\b)(?![^<]*<\/a>)/g;

  function collectCandidates(content, anchorMap) {
    console.log('collectCandidates: pb_nSuffixMode=', pb_nSuffixMode);
    const out = [];
    P_RE.lastIndex = 0;
    let pm;
    while ((pm = P_RE.exec(content)) !== null) {
      const inner = pm[3];

      if (!/\b\d+/.test(inner) && !(pb_romanMode && /\b[IVXLCDMivxlcdm]+\b/i.test(inner))) continue;
      const innerStart = pm.index + pm[1].length;

      const masked2 = inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, m => ' '.repeat(m.length));

      // Find all n-suffix tokens: numbers/ranges followed by n (e.g. 154n, 250-1n, 250.1n)
      const masked2Normalized = masked2.replace(
        /&#x2013;|&#8211;|&#x2014;|&#8212;|&ndash;|&mdash;/g,
        m => '-'.padEnd(m.length, ' ')
      );
      // Dot-style: always skip (154n.20)
      const N_DOT_RE = /\b(\d+(?:[-–—\. ]+\d+)*n\.\d+)\b/g;
      // Bare-style: 154n20 — skip unless pb_nSuffixMode
      const N_BARE_RE = /\b(\d+)n(\d+)\b/g;
      const nZones = [];
      let nz;
      N_DOT_RE.lastIndex = 0;
      while ((nz = N_DOT_RE.exec(masked2Normalized)) !== null) {
        nZones.push([nz.index, nz.index + nz[0].length]);
      }
      if (!pb_nSuffixMode) {
        N_BARE_RE.lastIndex = 0;
        while ((nz = N_BARE_RE.exec(masked2Normalized)) !== null) {
          nZones.push([nz.index, nz.index + nz[0].length]);
        }
      } else {
        // When enabled: only block the n20 part, let 154 be picked up by NUM_RE
        N_BARE_RE.lastIndex = 0;
        while ((nz = N_BARE_RE.exec(masked2Normalized)) !== null) {
          // Block from the 'n' onward only (index of 'n' = nz.index + nz[1].length)
          const nStart = nz.index + nz[1].length;
          nZones.push([nStart, nz.index + nz[0].length]);
        }
      }

      // Helper: check if a position falls inside any n-suffix zone
      function isInNZone(pos) {
        const blocked = nZones.some(([s, e]) => pos >= s && pos < e);
        if (nZones.length) console.log(`isInNZone(${pos}) → ${blocked}`, nZones);
        return blocked;
      }

      const RANGE_RE = /\b(\d+)\s*(?:[-–—]|&#x2013;|&#8211;|&#x2014;|&#8212;|&ndash;|&mdash;)\s*(\d+)\b/g;
      const rangePositions = [];
      let rr;
      RANGE_RE.lastIndex = 0;
      while ((rr = RANGE_RE.exec(masked2)) !== null) {
        if (isInNZone(rr.index)) continue;
        const startNum = rr[1], endShort = rr[2];
        const fullEnd = endShort.length < startNum.length
          ? startNum.slice(0, startNum.length - endShort.length) + endShort
          : endShort;
        const sepEnd = rr.index + rr[0].length - endShort.length;
        out.push({
          start: innerStart + rr.index,
          end: innerStart + rr.index + startNum.length,
          num: startNum, id: 'page_' + startNum,
          targetFile: anchorMap['page_' + startNum] || null,
          state: 'skipped'
        });
        out.push({
          start: innerStart + sepEnd,
          end: innerStart + rr.index + rr[0].length,
          num: endShort, id: 'page_' + fullEnd,
          targetFile: anchorMap['page_' + fullEnd] || null,
          state: 'skipped'
        });
        rangePositions.push([rr.index, rr.index + rr[0].length]);
      }

      const ACTIVE_NUM_RE = pb_nSuffixMode

        ? /(?<!href="[^"]*#page_\d*)(?<!id="page_\d*)(?<!")\b(\d+)(?=n\d+\b|(?![n\d]))(?![^<]*<\/a>)/g

        : NUM_RE;
      let nm;
      ACTIVE_NUM_RE.lastIndex = 0;
      while ((nm = ACTIVE_NUM_RE.exec(masked2)) !== null) {
        const pos = nm.index;
        if (rangePositions.some(([s, e]) => pos >= s && pos < e)) continue;
        if (isInNZone(pos)) continue;
        const num = nm[1];
        const id = 'page_' + num;
        out.push({
          start: innerStart + nm.index,
          end: innerStart + nm.index + num.length,
          num, id,
          targetFile: anchorMap[id] || null,
          state: 'skipped'
        });
      }
      if (pb_romanMode) {
        const masked = inner
          .replace(/<[^>]*>/g, m => ' '.repeat(m.length))
          .replace(/&[^;]+;/g, m => ' '.repeat(m.length));

        const ROM_SCAN = /(?<![A-Za-z])([A-Za-z]+)(?![A-Za-z])/g;
        let rm;
        ROM_SCAN.lastIndex = 0;
        while ((rm = ROM_SCAN.exec(masked)) !== null) {
          const num = rm[1];
          if (!ROMAN_LIST.has(num)) continue;
          const before = inner.slice(0, rm.index);
          const afterMatch = inner.slice(rm.index + num.length);
          const insideAnchor = (/(<a\b[^>]*>)[^<]*$/.test(before)) && (/<\/a>/.test(afterMatch));
          if (insideAnchor) continue;
          const numLower = num.toLowerCase();
          const id = 'page_' + numLower;
          out.push({
            start: innerStart + rm.index,
            end: innerStart + rm.index + num.length,
            num,
            id,
            targetFile: anchorMap[id] || null,
            state: 'skipped'
          });
        }
      }
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  /* ==========================================================
     AUTO-SAFETY RULES
     ========================================================== */
  function inRange(num) {
    if (ROMAN_LIST.has(num)) return true;
    const n = Number(num);
    if (pb_rangeMin !== null && n < pb_rangeMin) return false;
    if (pb_rangeMax !== null && n > pb_rangeMax) return false;
    return true;
  }
  function defaultState(c) {
    if (!c.targetFile) return 'noanchor';
    if (!inRange(c.num)) return 'skipped';
    return 'linked';
  }
  function applyAutoRules() {
    for (const c of pb_candidates) c.state = defaultState(c);
  }

  /* ==========================================================
     COMMIT
     ========================================================== */
  function buildOutput() {
    let out = '', last = 0, linked = 0, forcedNoAnchor = 0;
    for (const c of pb_candidates) {
      if (c.state !== 'linked' && c.state !== 'manual') continue;
      if (!c.targetFile) { forcedNoAnchor++; continue; }
      out += pb_srcContent.slice(last, c.start);
      out += `<a epub:type="index-locator" href="${c.targetFile}#${c.id}">${c.num}</a>`;
      last = c.end;
      linked++;
    }
    out += pb_srcContent.slice(last);
    return { text: out, linked, forcedNoAnchor };
  }

  /* ==========================================================
     SEE-ALSO
     ========================================================== */
  function findLiRangeById(id) {
    const re = /<(li|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(pb_srcContent)) !== null) {
      const idMatch = /\bid="([^"]+)"/.exec(m[2]);
      if (idMatch && idMatch[1] === id) {
        return { start: m.index, end: m.index + m[0].length };
      }
    }
    return null;
  }
  function isInsideExistingAnchor(pos) {
    const window_ = pb_srcContent.slice(Math.max(0, pos - 2000), pos);
    const lastOpen = window_.lastIndexOf('<a ');
    const lastClose = window_.lastIndexOf('</a>');
    return lastOpen > lastClose;
  }
  function findSeeAlsoOffset(selectedText, targetId, sourceLiId = null) {
    const targetLiRange = findLiRangeById(targetId);

    let searchScope, scopeOffset = 0;
    if (sourceLiId) {
      const srcLiRange = findLiRangeById(sourceLiId);
      if (srcLiRange) {
        searchScope = pb_srcContent.slice(srcLiRange.start, srcLiRange.end);
        scopeOffset = srcLiRange.start;
      }
    }
    if (!searchScope) {
      searchScope = pb_srcContent;
      scopeOffset = 0;
    }

    const parts = selectedText.split(/(\s+)/);
    const regexParts = parts.map(p => {
      if (/^\s+$/.test(p)) return '\\s*(?:<[^>]+>\\s*)*';
      return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    const re = new RegExp(regexParts.join(''));

    let searchStart = 0;
    while (true) {
      const sub = searchScope.slice(searchStart);
      const m = re.exec(sub);
      if (!m) return null;
      const found = scopeOffset + searchStart + m.index;
      const end = found + m[0].length;
      const insideAnchor = isInsideExistingAnchor(found);
      const insideTargetLi = targetLiRange && found >= targetLiRange.start && found < targetLiRange.end;
      if (!insideAnchor && !insideTargetLi) return { srcStart: found, srcEnd: end };
      searchStart += m.index + 1;
    }
  }

  /* ==========================================================
     SYNTAX HIGHLIGHTING (code view)
     ========================================================== */
  function hlAttrs(raw) {
    return esc(raw).replace(
      /([\w:.\-]+)(\s*=\s*)("[^"]*"|'[^']*')/g,
      (m, name, eq, val) => `<span class="t-attr">${name}</span><span class="t-punct">${eq}</span><span class="t-str">${val}</span>`
    );
  }
  function hlTag(tag) {
    const m = /^(<\/?)([A-Za-z][\w:.\-]*)([\s\S]*?)(\/?>)$/.exec(tag);
    if (!m) return `<span class="t-punct">${esc(tag)}</span>`;
    return `<span class="t-punct">${esc(m[1])}</span>` +
      `<span class="t-tag">${esc(m[2])}</span>` +
      hlAttrs(m[3]) +
      `<span class="t-punct">${esc(m[4])}</span>`;
  }
  function syntaxHighlight(raw) {
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z][^>]*>/g;
    let out = '', last = 0, m;
    while ((m = re.exec(raw)) !== null) {
      out += esc(raw.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('<!--')) out += `<span class="t-com">${esc(t)}</span>`;
      else if (t.startsWith('<!') || t.startsWith('<?')) out += `<span class="t-meta">${esc(t)}</span>`;
      else out += hlTag(t);
      last = m.index + t.length;
    }
    return out + esc(raw.slice(last));
  }
  function highlightCode(content, links) {
    const uniq = [...new Set(links)];
    const store = [];
    let work = content;
    for (const tag of uniq) {
      if (!work.includes(tag)) continue;
      const i = store.push(tag) - 1;
      work = work.split(tag).join(' ' + i + '');
    }
    let out = syntaxHighlight(work);
    out = out.replace(/ (\d+)/g, (m, i) => `<span class="hi">${syntaxHighlight(store[+i])}</span>`);
    return out;
  }
  function gutterFor(content) {
    const n = content.split('\n').length;
    let s = '';
    for (let i = 1; i <= n; i++) s += i + (i < n ? '\n' : '');
    return s;
  }

  /* ==========================================================
     PREVIEW
     ========================================================== */
  function buildPreviewHTML() {
    let out = '', last = 0;
    pb_candidates.forEach((c, i) => {
      out += pb_srcContent.slice(last, c.start);
      out += `<span class="num-highlight ${c.state}"` +
        ` data-i="${i}"` +
        ` data-num="${escAttr(c.num)}"` +
        ` data-id="${escAttr(c.id)}"` +
        ` data-target="${escAttr(c.targetFile || '')}"` +
        ` data-state="${c.state}"` +
        ` role="button" tabindex="0">${c.num}</span>`;
      last = c.end;
    });
    out += pb_srcContent.slice(last);
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

  function pagebreakAnchorsToSpans(html) {
    return html.replace(/<a\s+id="(pagebreak_[^"]+)"\s*\/?>(<\/a>)?/gi, '<span id="$1"></span>');
  }
  function pagebreakSpansToAnchors(html) {
    return html.replace(/<span\s+id="(pagebreak_[^"]+)">\s*<\/span>/gi, '<a id="$1"/>');
  }

  /* ==========================================================
     COUNTS / SYNC
     ========================================================== */
  function counts() {
    let sel = 0, noAnchor = 0;
    for (const c of pb_candidates) {
      if (c.state === 'linked' && c.targetFile) sel++;
      if (!c.targetFile) noAnchor++;
    }
    return { sel, noAnchor, total: pb_candidates.length };
  }
  function updateStats(animate) {
    const { sel, noAnchor, total } = counts();
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (animate) countUp(el, v); else el.textContent = v.toLocaleString();
    };
    set('cTotal', total);
    set('cFixed', sel);
    set('cNotFound', noAnchor);
    set('cFiles', Object.keys(pb_fileHandles).length);
  }
  function updateSelCount() {
    const { sel, total } = counts();
    const el = document.getElementById('selCount');
    if (el) el.innerHTML = `<b>${sel.toLocaleString()}</b> of ${total.toLocaleString()} numbers selected`;
  }

  /* ==========================================================
     ROMAN NUMERAL SELECTION LINKING (Enter key)
     ========================================================== */
  pb_mainBody.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (!pb_romanMode) return;

    const preview = document.getElementById('previewContainer');
    if (!preview) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if (!preview.contains(range.commonAncestorContainer)) return;

    let count = 0;
    preview.querySelectorAll('.num-highlight').forEach(span => {
      const i = Number(span.dataset.i);
      const c = pb_candidates[i];
      if (!c) return;
      if (!ROMAN_LIST.has(c.num) && !ROMAN_LIST.has(c.num.toLowerCase())) return;
      if (!c.targetFile) return;

      const spanRange = document.createRange();
      spanRange.selectNode(span);
      const selRange = sel.getRangeAt(0);
      const afterEnd = selRange.compareBoundaryPoints(Range.START_TO_END, spanRange) < 0;
      const beforeStart = selRange.compareBoundaryPoints(Range.END_TO_START, spanRange) > 0;
      if (afterEnd || beforeStart) return;

      c.state = 'linked';
      paintSpan(i);
      count++;
    });

    if (!count) { toast('No Roman numerals with anchors found in selection', 'error'); return; }

    updateSelCount();
    updateStats(false);
    toast(`${count} Roman numeral${count === 1 ? '' : 's'} linked`, 'success');
    sel.removeAllRanges();
    e.preventDefault();
  });

  function paintSpan(i) {
    const c = pb_candidates[i];
    const span = document.querySelector(`.num-highlight[data-i="${i}"]`);
    if (span) {
      span.dataset.state = c.state;
      span.classList.remove('linked', 'skipped', 'noanchor', 'manual');
      span.classList.add(c.state);
      if (c.state === 'manual') span.classList.add('manual');
    }
    const row = document.querySelector(`#fixBody tr[data-i="${i}"]`);
    if (row) row.replaceWith(buildRow(i));
    icons();
  }
  function paintAll() {
    pb_candidates.forEach((c, i) => {
      const span = document.querySelector(`.num-highlight[data-i="${i}"]`);
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

  /* ==========================================================
     TOGGLE
     ========================================================== */
  function cycleState(span) {
    const i = Number(span.dataset.i);
    const c = pb_candidates[i];
    if (!c) return;
    if (c.state === 'manual') {
      showManualEditPopup(i);
      return;
    }
    if (!c.targetFile) {
      showManualAnchorPopup(i);
      return;
    }
    const prevState = c.state;
    c.state = c.state === 'linked' ? 'skipped' : 'linked';
    pushHistory({ type: 'cycleState', i, prevState });
    paintSpan(i);
    updateSelCount();
    updateStats(false);
  }

  function showManualAnchorPopup(candIndex) {
    const c = pb_candidates[candIndex];
    const files = Object.keys(pb_fileHandles).sort();
    if (!files.length) { toast('No folder loaded', 'error'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'manual-anchor-overlay';
    overlay.innerHTML = `
    <div class="manual-anchor-popup">
      <div class="manual-anchor-head">
        <span>Link <code>${c.id}</code> to file:</span>
        <button class="manual-anchor-close" aria-label="Cancel">✕</button>
      </div>
      <div class="manual-anchor-list">
        ${files.map(f => `<button class="manual-anchor-item" data-file="${f}">${f}</button>`).join('')}
      </div>
    </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.manual-anchor-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.manual-anchor-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const fname = btn.dataset.file;
        overlay.remove();
        pushHistory({ type: 'manualAnchor', candIndex, prevTargetFile: c.targetFile, prevState: c.state });
        c.targetFile = fname;
        c.state = 'manual';
        pb_manualAnchorMap[c.id] = fname;
        paintSpan(candIndex);
        updateSelCount();
        updateStats(false);
        toast(`${c.id} linked to ${fname}`, 'success');
      });
    });
  }

  function showManualEditPopup(candIndex) {
    const c = pb_candidates[candIndex];

    const overlay = document.createElement('div');
    overlay.className = 'manual-anchor-overlay';
    overlay.innerHTML = `
    <div class="manual-anchor-popup">
      <div class="manual-anchor-head">
        <span><code>${c.id}</code> → ${c.targetFile}</span>
        <button class="manual-anchor-close" aria-label="Cancel">✕</button>
      </div>
      <div class="manual-anchor-actions">
        <button class="manual-action-btn manual-action-change"><i data-lucide="pencil"></i> Change File</button>
        <button class="manual-action-btn manual-action-delete"><i data-lucide="trash-2"></i> Remove Link</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    icons();

    overlay.querySelector('.manual-anchor-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.manual-action-change').addEventListener('click', () => {
      overlay.remove();
      showManualAnchorPopup(candIndex);
    });

    overlay.querySelector('.manual-action-delete').addEventListener('click', () => {
      overlay.remove();
      pushHistory({ type: 'manualAnchor', candIndex, prevTargetFile: c.targetFile, prevState: c.state });
      c.targetFile = null;
      c.state = 'noanchor';
      delete pb_manualAnchorMap[c.id];
      paintSpan(candIndex);
      updateSelCount();
      updateStats(false);
      toast(`${c.id} unlinked`, 'success');
    });
  }

  /* ==========================================================
     RIGHT COLUMN — fixes table
     ========================================================== */
  const MAX_ROWS = 400;

  function statusPill(c) {
    if (c.state === 'linked') {
      return c.targetFile
        ? `<span class="pill pill-pass"><i data-lucide="check"></i>Linked</span>`
        : `<span class="pill pill-warn"><i data-lucide="alert-triangle"></i>No Anchor</span>`;
    }
    if (c.state === 'noanchor')
      return `<span class="pill pill-fail"><i data-lucide="x"></i>No Anchor</span>`;
    if (c.state === 'manual')
      return `<span class="pill pill-manual"><i data-lucide="plus-circle"></i>Manual</span>`;
    return `<span class="pill pill-skip"><i data-lucide="minus"></i>Skipped</span>`;
  }

  function buildRow(i) {
    const c = pb_candidates[i];
    const tr = document.createElement('tr');
    tr.dataset.i = i;
    if (c.state !== 'linked' && c.state !== 'manual') tr.className = 'is-skipped';
    tr.innerHTML =
      `<td class="cell-num">${c.num}</td>` +
      `<td class="cell-mono">${c.id}</td>` +
      `<td class="cell-mono">${c.targetFile ? c.targetFile : '<span class="cell-dash">&mdash;</span>'}</td>` +
      `<td>${statusPill(c)}</td>`;
    return tr;
  }

  function renderTable(onlyApplied) {
    const tbody = document.getElementById('fixBody');
    if (!tbody) return;
    const idx = pb_candidates.map((c, i) => i)
      .filter(i => onlyApplied ? ((pb_candidates[i].state === 'linked' || pb_candidates[i].state === 'manual') && pb_candidates[i].targetFile) : true);
    const shown = idx.slice(0, MAX_ROWS);
    tbody.innerHTML = '';
    for (const i of shown) tbody.appendChild(buildRow(i));

    const note = document.getElementById('tableNote');
    if (note) {
      note.innerHTML = idx.length > MAX_ROWS
        ? `${(idx.length - MAX_ROWS).toLocaleString()} more entries not listed &mdash; all are applied in the file on the left.`
        : '';
      note.hidden = idx.length <= MAX_ROWS;
    }
    const sub = document.getElementById('tableSub');
    const saCount = onlyApplied ? pb_seeAlsoLinks.filter(s => s.applied).length : pb_seeAlsoLinks.length;
    if (sub) sub.textContent = `${(idx.length + saCount).toLocaleString()} ${onlyApplied ? 'applied' : 'detected'}`;
    icons();
  }

  /* ==========================================================
     RENDER
     ========================================================== */
  function renderResults() {
    pb_mainBody.innerHTML = `
    <div class="split">

      <section class="panel">
        <div class="panel-head">
          <i data-lucide="eye"></i>
          <span class="panel-title">Preview &amp; Edit</span>
          <div class="seg" id="viewSeg"></div>
        </div>

        <div class="review-bar">
          <label class="switch">
            <input type="checkbox" id="anchorOnly" ${pb_anchorOnly ? 'checked' : ''}/>
            <span class="track"></span>
            <span>Only link numbers with a matching anchor</span>
          </label>
          <div class="range-filter">
            <span>Range</span>
            <input type="number" id="rangeMin" placeholder="min" min="0"
                   value="${pb_rangeMin === null ? '' : pb_rangeMin}"/>
            <span>&ndash;</span>
            <input type="number" id="rangeMax" placeholder="max" min="0"
                   value="${pb_rangeMax === null ? '' : pb_rangeMax}"/>
          </div>
        </div>

        <div class="apply-row">
          <span class="sel-count" id="selCount"></span>

          <div class="num-search">
            <div class="ns-field">
              <i data-lucide="search" class="ns-icon"></i>
              <input type="text" id="numSearchInput" inputmode="numeric"
                     autocomplete="off" spellcheck="false"
                     placeholder="Find number" aria-label="Find a page number"/>
              <button class="ns-clear" id="numSearchClear" type="button"
                      hidden aria-label="Clear search"><i data-lucide="x"></i></button>
            </div>
            <div class="ns-nav" id="numSearchNav" hidden>
              <button class="ns-arrow" id="numSearchPrev" type="button"
                      aria-label="Previous match"><i data-lucide="chevron-left"></i></button>
              <span class="ns-count" id="numSearchCount"></span>
              <button class="ns-arrow" id="numSearchNext" type="button"
                      aria-label="Next match"><i data-lucide="chevron-right"></i></button>
            </div>
            <span class="ns-empty" id="numSearchEmpty" hidden role="status">Not found</span>
          </div>

          <span class="hint">Click a number to include or skip it</span>
          <button class="btn-apply" id="applyBtn">
            <i data-lucide="check-check"></i>Apply Selected
          </button>
        </div>

        <div class="panel-body">
          <div class="preview-doc" id="previewContainer">${buildPreviewHTML()}</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <i data-lucide="list-checks"></i>
          <span class="panel-title">Fixes</span>
          <span class="panel-sub"><span id="tableSub"></span></span>
        </div>
        <div class="panel-body">
          <table class="fix-table">
            <thead>
              <tr><th>Number</th><th>Pagebreak ID</th><th>Target File</th><th>Status</th></tr>
            </thead>
            <tbody id="fixBody"></tbody>
          </table>
          <div class="table-note" id="tableNote" hidden></div>
        </div>
      </section>

    </div>`;

    renderTable(false);
    updateSelCount();
    resetSearch();
    icons();
  }

  /* ==========================================================
     NUMBER SEARCH
     ========================================================== */
  let searchMatches = [], searchPos = 0;

  function resetSearch() {
    searchMatches = []; searchPos = 0;
    const input = document.getElementById('numSearchInput');
    if (input) input.value = '';
    paintSearchUI();
  }

  function paintSearchUI() {
    const clear = document.getElementById('numSearchClear'),
      nav = document.getElementById('numSearchNav'),
      count = document.getElementById('numSearchCount'),
      empty = document.getElementById('numSearchEmpty'),
      input = document.getElementById('numSearchInput');
    if (!input) return;
    const q = input.value.trim();
    if (clear) clear.hidden = q === '';
    if (nav) nav.hidden = searchMatches.length < 2;
    if (count) count.textContent = searchMatches.length
      ? `${searchPos + 1} of ${searchMatches.length}` : '';
    if (empty) empty.hidden = !(q !== '' && searchMatches.length === 0);
  }

  function runSearch() {
    const input = document.getElementById('numSearchInput');
    if (!input) return;
    const q = input.value.trim();
    searchMatches = []; searchPos = 0;
    if (q !== '') {
      const exact = [], partial = [];
      pb_candidates.forEach((c, i) => {
        if (c.num === q) exact.push(i);
        else if (c.num.includes(q)) partial.push(i);
      });
      searchMatches = exact.length ? exact : partial;
    }
    paintSearchUI();
    if (searchMatches.length) focusNumber(searchMatches[0]);
  }

  function stepSearch(delta) {
    if (!searchMatches.length) return;
    const n = searchMatches.length;
    searchPos = (searchPos + delta + n) % n;
    paintSearchUI();
    focusNumber(searchMatches[searchPos]);
  }

  /* ==========================================================
     ACTIONS
     ========================================================== */
  function focusNumber(i) {
    const span = document.querySelector(`.num-highlight[data-i="${i}"]`);
    if (!span) return;
    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    span.classList.remove('flash');
    void span.offsetWidth;
    span.classList.add('flash');
  }

  function readRange() {
    const a = document.getElementById('rangeMin'), b = document.getElementById('rangeMax');
    if (!a || !b) return;
    pb_rangeMin = a.value.trim() === '' ? null : Number(a.value.trim());
    pb_rangeMax = b.value.trim() === '' ? null : Number(b.value.trim());
    applyAutoRules();
    paintAll();
    const { sel, total } = counts();
    toast(`Range applied — ${sel.toLocaleString()} of ${total.toLocaleString()} selected`, 'success');
  }

  function toggleAnchorOnly(on) {
    pb_anchorOnly = on;
    if (on) {
      let n = 0;
      for (const c of pb_candidates)
        if (!c.targetFile && c.state === 'linked') { c.state = 'noanchor'; n++; }
      paintAll();
      toast(n ? `${n} anchorless number(s) skipped` : 'Anchor-only filter on', 'success');
    } else {
      toast('Anchor-only filter off — anchorless numbers can be force-selected', 'success');
    }
  }

  function applySelected() {
    const { linked, forcedNoAnchor } = buildOutput();

    const segs = [];
    for (const c of pb_candidates) {
      if (c.state !== 'linked' && c.state !== 'manual') continue;
      if (!c.targetFile) continue;
      segs.push({
        start: c.start, end: c.end,
        html: `<a epub:type="index-locator" href="${c.targetFile}#${c.id}">${c.num}</a>`
      });
    }
    for (const s of pb_seeAlsoLinks) {
      if (s.srcStart == null) {
        s.applied = false;
        toast(`Could not locate "${truncate(s.selectedText, 30)}" in source — skipped`, 'error');
        continue;
      }
      segs.push({
        start: s.srcStart, end: s.srcEnd, isSeeAlso: true, ref: s,
        html: `<a href="#${s.targetId}">${s.selectedText}</a>`
      });
    }
    segs.sort((a, b) => a.start - b.start);

    let out = '', last = 0;
    for (const seg of segs) {
      if (seg.start < last) continue;
      out += pb_srcContent.slice(last, seg.start);
      out += seg.html;
      last = seg.end;
      if (seg.isSeeAlso) seg.ref.applied = true;
    }
    out += pb_srcContent.slice(last);
    pb_fixedContent = out;

    pb_applied = true;
    pb_saveBtn.disabled = false;
    pb_copyBtn.disabled = false;
    renderTable(true);
    renderSeeAlsoTable();
    const seeAlsoCount = pb_seeAlsoLinks.filter(s => s.applied).length;
    let msg = `Applied — ${linked.toLocaleString()} link${linked === 1 ? '' : 's'} in the output`;
    if (seeAlsoCount) msg += `, ${seeAlsoCount} see-also link${seeAlsoCount === 1 ? '' : 's'}`;
    if (forcedNoAnchor) msg += `, ${forcedNoAnchor} skipped (no anchor)`;
    toast(msg, 'success');
  }

  /* ==========================================================
     DELEGATED EVENTS
     ========================================================== */
  pb_mainBody.addEventListener('click', e => {
    const span = e.target.closest('.num-highlight');
    if (span) { cycleState(span); return; }

    if (e.target.closest('#applyBtn')) { applySelected(); return; }

    if (e.target.closest('#numSearchPrev')) { stepSearch(-1); return; }
    if (e.target.closest('#numSearchNext')) { stepSearch(1); return; }
    if (e.target.closest('#numSearchClear')) {
      resetSearch();
      const input = document.getElementById('numSearchInput');
      if (input) input.focus();
      return;
    }

    const row = e.target.closest('#fixBody tr');
    if (row && row.dataset.i !== undefined) { focusNumber(row.dataset.i); return; }
  });

  pb_mainBody.addEventListener('keydown', e => {
    if (e.target.id === 'numSearchInput') {
      if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); resetSearch(); }
      return;
    }
    const span = e.target.closest && e.target.closest('.num-highlight');
    if (span && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cycleState(span); }
  });

  pb_mainBody.addEventListener('input', e => {
    if (e.target.id === 'numSearchInput') runSearch();
  });

  pb_mainBody.addEventListener('mouseover', e => {
    const span = e.target.closest('.num-highlight');
    if (span) { showTooltip(span); positionTooltip(e); }
  });
  pb_mainBody.addEventListener('mousemove', e => {
    const span = e.target.closest('.num-highlight');
    if (span) { if (tip.hidden) showTooltip(span); positionTooltip(e); }
    else if (!tip.hidden) hideTooltip();
  });
  pb_mainBody.addEventListener('mouseout', e => {
    if (e.target.closest('.num-highlight')) hideTooltip();
  });
  pb_mainBody.addEventListener('focusin', e => {
    const span = e.target.closest && e.target.closest('.num-highlight');
    if (span) {
      showTooltip(span);
      const r = span.getBoundingClientRect();
      positionTooltip({ clientX: r.left, clientY: r.bottom });
    }
  });
  pb_mainBody.addEventListener('focusout', e => {
    if (e.target.closest && e.target.closest('.num-highlight')) hideTooltip();
  });
  pb_mainBody.addEventListener('scroll', () => { if (!tip.hidden) hideTooltip(); }, true);

  pb_mainBody.addEventListener('mouseup', (e) => {
    const clickedMark = e.target.closest('mark.sa-linked');
    if (clickedMark) {
      showSeeAlsoEditPopup(clickedMark);
      return;
    }

    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 1) {
      const container = document.getElementById('previewContainer');
      if (container && container.contains(sel.anchorNode)) {
        const selectedText = sel.toString().trim();
        const entries = getTopLevelLiEntries();
        if (entries.length === 0) return;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const anchorLi = sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('li, td');
        const sourceLiId = anchorLi ? anchorLi.id : null;
        showSeeAlsoPopup(selectedText, entries, rect, range, null, sourceLiId);
        sel.removeAllRanges();
        return;
      }
    }
  });

  pb_mainBody.addEventListener('change', e => {
    if (e.target.id === 'anchorOnly') { toggleAnchorOnly(e.target.checked); return; }
    if (e.target.id === 'rangeMin' || e.target.id === 'rangeMax') { readRange(); return; }
  });

  pb_mainBody.addEventListener('mousedown', e => {
    if (!pb_cropMode) return;
    const container = document.getElementById('previewContainer');
    if (!container || !container.contains(e.target)) return;
    e.preventDefault();
    document.querySelectorAll('.crop-popup').forEach(p => p.remove());
    pb_cropContainerEl = container;
    const rect = container.getBoundingClientRect();
    pb_cropStartX = e.clientX - rect.left + container.scrollLeft;
    pb_cropStartY = e.clientY - rect.top + container.scrollTop;
    pb_cropDragging = true;
    removeCropRect();
    pb_cropRectEl = document.createElement('div');
    pb_cropRectEl.id = 'cropRect';
    pb_cropRectEl.style.left = pb_cropStartX + 'px';
    pb_cropRectEl.style.top = pb_cropStartY + 'px';
    pb_cropRectEl.style.width = '0px';
    pb_cropRectEl.style.height = '0px';
    container.appendChild(pb_cropRectEl);
  });

  pb_mainBody.addEventListener('mousemove', e => {
    if (!pb_cropMode || !pb_cropDragging || !pb_cropRectEl || !pb_cropContainerEl) return;
    const rect = pb_cropContainerEl.getBoundingClientRect();
    const curX = e.clientX - rect.left + pb_cropContainerEl.scrollLeft;
    const curY = e.clientY - rect.top + pb_cropContainerEl.scrollTop;
    const x = Math.min(curX, pb_cropStartX), y = Math.min(curY, pb_cropStartY);
    const w = Math.abs(curX - pb_cropStartX), h = Math.abs(curY - pb_cropStartY);
    pb_cropRectEl.style.left = x + 'px';
    pb_cropRectEl.style.top = y + 'px';
    pb_cropRectEl.style.width = w + 'px';
    pb_cropRectEl.style.height = h + 'px';
  });

  pb_mainBody.addEventListener('mouseup', e => {
    if (!pb_cropMode || !pb_cropDragging) return;
    pb_cropDragging = false;
    if (!pb_cropRectEl) return;
    const zoneRect = pb_cropRectEl.getBoundingClientRect();
    removeCropRect();
    if (zoneRect.width < 3 || zoneRect.height < 3) return;

    const spans = [...document.querySelectorAll('#previewContainer .num-highlight')].filter(span => {
      const r = span.getBoundingClientRect();
      return !(r.right < zoneRect.left || r.left > zoneRect.right || r.bottom < zoneRect.top || r.top > zoneRect.bottom);
    });
    if (!spans.length) { toast('No numbers in selection', 'error'); return; }
    showCropPopup(spans, zoneRect);
  });

  document.getElementById('applyIdBtn').addEventListener('click', async () => {
    if (!pb_fileHandle) { toast('Pick an index file first', 'error'); return; }
    const rawPrefix = document.getElementById('idPrefixInput').value.trim();
    if (!rawPrefix) { toast('Enter an ID prefix first', 'error'); return; }

    try {
      let content = await readFile(pb_fileHandle);
      content = content.replace(/<(li|td)(\s[^>]*?)?\s+id="[^"]*"/gi, (m, tag, attrs) => {
        return '<' + tag + (attrs || '');
      });
      let counter = 1;
      content = content.replace(/<(li|td)(\b[^>]*)?>/gi, (m, tag, attrs) => {
        const id = `${rawPrefix}${String(counter++).padStart(4, '0')}`;
        if (attrs) {
          attrs = attrs.replace(/\s+id="[^"]*"/, '');
          return `<${tag}${attrs} id="${id}">`;
        }
        return `<${tag} id="${id}">`;
      });
      const writable = await pb_fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      toast(`IDs applied: ${counter - 1} <li>/<td > tags updated`, 'success');
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  });

  function showSeeAlsoEditPopup(mark) {
    document.querySelectorAll('.see-also-edit-popup').forEach(p => p.remove());

    const saI = Number(mark.dataset.saI);
    const s = pb_seeAlsoLinks[saI];
    if (!s) return;

    const rect = mark.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'see-also-edit-popup';
    popup.innerHTML = `
    <div class="sa-edit-head">
      <span class="sa-edit-text">"${truncate(s.selectedText, 30)}"</span>
      <button class="sa-edit-close">✕</button>
    </div>
    <div class="sa-edit-info">→ <span class="sa-id">#${s.targetId}</span></div>
    <div class="sa-edit-actions">
      <button class="sa-edit-btn sa-edit-change"><i data-lucide="pencil"></i> Change Target</button>
      <button class="sa-edit-btn sa-edit-remove"><i data-lucide="trash-2"></i> Remove Link</button>
    </div>`;

    document.body.appendChild(popup);
    icons();

    const x = Math.min(rect.left + window.scrollX, window.innerWidth - 260);
    const y = rect.bottom + window.scrollY + 6;
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';

    popup.querySelector('.sa-edit-close').addEventListener('click', () => popup.remove());
    document.addEventListener('mousedown', function outside(e) {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', outside); }
    });

    popup.querySelector('.sa-edit-change').addEventListener('click', () => {
      popup.remove();
      const entries = getTopLevelLiEntries();
      const rect2 = mark.getBoundingClientRect();
      showSeeAlsoPopup(s.selectedText, entries, rect2, null, (targetId, targetText) => {
        s.targetId = targetId;
        s.targetText = targetText;
        s.applied = false;
        const offset = findSeeAlsoOffset(s.selectedText, targetId);
        s.srcStart = offset ? offset.srcStart : null;
        s.srcEnd = offset ? offset.srcEnd : null;
        mark.dataset.targetId = targetId;
        mark.title = `→ #${targetId}`;
        renderSeeAlsoTable();
        if (offset) {
          toast(`Updated → #${targetId}`, 'success');
        } else {
          toast(`Could not find "${truncate(s.selectedText, 30)}" in source — see-also skipped`, 'error');
        }
      });
    });

    popup.querySelector('.sa-edit-remove').addEventListener('click', () => {
      popup.remove();
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      pb_seeAlsoLinks.splice(saI, 1);
      document.querySelectorAll('mark.sa-linked').forEach(m => {
        const i = Number(m.dataset.saI);
        if (i > saI) m.dataset.saI = i - 1;
      });
      renderSeeAlsoTable();
      toast('See-also link removed', 'success');
    });
  }

  function showSeeAlsoPopup(selectedText, entries, rect, range, onPick = null, sourceLiId = null) {
    document.querySelectorAll('.see-also-popup').forEach(p => p.remove());

    const popup = document.createElement('div');
    popup.className = 'see-also-popup';
    popup.innerHTML = `
    <div class="sa-head">
      <span class="sa-sel-text">"${truncate(selectedText, 40)}"</span>
      <button class="sa-close">✕</button>
    </div>
    <div class="sa-search-wrap">
      <i data-lucide="search"></i>
      <input type="text" class="sa-search" placeholder="Filter entries..." autocomplete="off"/>
    </div>
    <div class="sa-scroll">
      <div class="sa-body" id="saBody"></div>
    </div>`;

    document.body.appendChild(popup);
    icons();

    const x = Math.min(rect.left + window.scrollX, window.innerWidth - 320);
    const y = rect.bottom + window.scrollY + 6;
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';

    const fuse = new Fuse(entries, {
      keys: ['text'],
      threshold: 0.4,
      distance: 200,
      includeScore: true,
      minMatchCharLength: 2
    });

    function makeBtn(e, isFuzzy) {
      return `<button class="sa-item${isFuzzy ? ' sa-best' : ''}"
      data-id="${e.id}"
      data-text="${e.text.replace(/"/g, '&quot;')}">
      <span class="sa-item-text">${e.text.length > 55 ? e.text.slice(0, 55) + '…' : e.text}</span>
      <span class="sa-id">#${e.id}</span>
    </button>`;
    }

    function makeDivider() { return `<div class="sa-divider"></div>`; }
    function makeLetterHead(letter) { return `<div class="sa-letter">${letter}</div>`; }

    function renderLists(filter) {
      const query = filter || selectedText;
      const fuzzyResults = fuse.search(query);
      const fuzzyIds = new Set(fuzzyResults.map(r => r.item.id));
      const fl = (filter || '').toLowerCase();

      const startLetter = (selectedText.trim()[0] || 'A').toUpperCase();

      const allSorted = entries
        .filter(e => !fl || e.text.toLowerCase().includes(fl))
        .sort((a, b) => a.text.localeCompare(b.text));

      const startIdx = allSorted.findIndex(e => e.text.toUpperCase()[0] >= startLetter);
      const reordered = startIdx > 0
        ? [...allSorted.slice(startIdx), ...allSorted.slice(0, startIdx)]
        : allSorted;

      let html = '';

      if (fuzzyResults.length) {
        html += `<div class="sa-section-label">Fuzzy Matches</div>`;
        html += fuzzyResults.slice(0, 15).map(r => makeBtn(r.item, true)).join('');
      } else {
        html += `<div class="sa-section-label">Fuzzy Matches</div>`;
        html += `<div class="sa-empty">No fuzzy matches</div>`;
      }

      html += makeDivider();

      let currentLetter = '';
      for (const e of reordered) {
        const letter = (e.text[0] || '').toUpperCase();
        if (letter !== currentLetter) {
          currentLetter = letter;
          html += makeLetterHead(letter);
        }
        html += makeBtn(e, fuzzyIds.has(e.id));
      }

      document.getElementById('saBody').innerHTML = html;
      icons();
    }

    renderLists('');

    popup.querySelector('.sa-search').addEventListener('input', e => renderLists(e.target.value));
    popup.querySelector('.sa-close').addEventListener('click', () => popup.remove());
    document.addEventListener('mousedown', function outside(e) {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', outside); }
    });

    popup.addEventListener('click', e => {
      const btn = e.target.closest('.sa-item');
      if (!btn) return;
      popup.remove();
      if (onPick) {
        onPick(btn.dataset.id, btn.dataset.text);
      } else {
        applySeeAlsoLink(selectedText, btn.dataset.id, btn.dataset.text, range, sourceLiId);
      }
    });

    requestAnimationFrame(() => {
      const first = popup.querySelector('.sa-best');
      if (first) first.scrollIntoView({ block: 'nearest' });
      popup.querySelector('.sa-search').focus();
    });
  }

  function applySeeAlsoLink(selectedText, targetId, targetText, range, sourceLiId = null) {
    const saIndex = pb_seeAlsoLinks.length;
    const offset = findSeeAlsoOffset(selectedText, targetId, sourceLiId);
    pb_seeAlsoLinks.push({
      selectedText, targetId, targetText, applied: false,
      srcStart: offset ? offset.srcStart : null,
      srcEnd: offset ? offset.srcEnd : null
    });
    pushHistory({ type: 'seeAlso', saIndex });

    if (!offset) {
      toast(`Could not find "${truncate(selectedText, 30)}" in source — see-also skipped`, 'error');
    }

    try {
      const mark = document.createElement('mark');
      mark.className = 'sa-linked';
      mark.dataset.saI = pb_seeAlsoLinks.length - 1;
      mark.dataset.targetId = targetId;
      mark.title = `→ #${targetId}`;
      range.surroundContents(mark);
    } catch (e) {
      const frag = range.extractContents();
      const mark = document.createElement('mark');
      mark.className = 'sa-linked';
      mark.dataset.saI = pb_seeAlsoLinks.length - 1;
      mark.dataset.targetId = targetId;
      mark.title = `→ #${targetId}`;
      mark.appendChild(frag);
      range.insertNode(mark);
    }

    renderSeeAlsoTable();
    if (offset) toast(`Linked "${truncate(selectedText, 30)}" → #${targetId}`, 'success');
  }

  function renderSeeAlsoTable() {
    const tbody = document.getElementById('fixBody');
    if (!tbody) return;
    tbody.querySelectorAll('tr.sa-row').forEach(r => r.remove());
    for (let i = 0; i < pb_seeAlsoLinks.length; i++) {
      const s = pb_seeAlsoLinks[i];
      const tr = document.createElement('tr');
      tr.className = 'sa-row';
      tr.dataset.saI = i;
      tr.innerHTML =
        `<td class="cell-num">${truncate(s.selectedText, 20)}</td>` +
        `<td class="cell-mono">#${s.targetId}</td>` +
        `<td class="cell-mono">${truncate(s.targetText, 20)}</td>` +
        `<td>${(s.srcStart == null || s.applied === false)
          ? '<span class="pill pill-warn"><i data-lucide="alert-triangle"></i>Not Found</span>'
          : '<span class="pill pill-manual"><i data-lucide="link"></i>See Also</span>'}</td>`;
      tbody.appendChild(tr);
    }
    icons();
  }

  /* ==========================================================
     RUN — scan, then hand over to review
     ========================================================== */
  // Show scan options modal
  pb_runBtn.addEventListener('click', () => {
    document.getElementById('scanModalOverlay').hidden = false;
    lucide.createIcons();
  });

  document.getElementById('scanModalClose').addEventListener('click', () => {
    document.getElementById('scanModalOverlay').hidden = true;
  });
  document.getElementById('scanModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget)
      document.getElementById('scanModalOverlay').hidden = true;
  });

  document.getElementById('romanToggle').addEventListener('change', e => {
    pb_romanMode = e.target.checked;
    localStorage.setItem('pb_romanMode', pb_romanMode ? '1' : '0');
  });
  document.getElementById('nSuffixToggle').addEventListener('change', e => {
    pb_nSuffixMode = e.target.checked;
    localStorage.setItem('pb_nSuffixMode', pb_nSuffixMode ? '1' : '0');
  });

  // Restore saved toggle states
  (() => {
    const r = localStorage.getItem('pb_romanMode');
    const n = localStorage.getItem('pb_nSuffixMode');
    if (r === '1') { pb_romanMode = true; document.getElementById('romanToggle').checked = true; }
    if (n === '1') { pb_nSuffixMode = true; document.getElementById('nSuffixToggle').checked = true; }
  })();

  document.getElementById('scanModalRun').addEventListener('click', async () => {
    document.getElementById('scanModalOverlay').hidden = true;
    pb_runBtn.disabled = true;
    pb_runBtnText.textContent = 'Scanning...';
    const spinIcon = pb_runBtn.querySelector('svg,i');
    if (spinIcon) spinIcon.classList.add('spin');
    showSkeletons(pb_summaryBar, pb_mainBody);
    showProgress('Mapping anchors');
    pb_saveBtn.disabled = true;
    pb_copyBtn.disabled = true;
    pb_applied = false;
    pb_fixedContent = '';
    hideTooltip();
    try {
      const anchorMap = await buildAnchorMap((done, total, fname) => {
        setProgress(done, total, `${done}/${total} · ${fname}`);
      });
      setProgress(1, 1, 'Detecting numbers');
      pb_srcContent = await readFile(pb_fileHandle);
      pb_candidates = collectCandidates(pb_srcContent, anchorMap);
      applyAutoRules();
      hideProgress();

      pb_summaryBar.hidden = false;
      updateStats(true);
      renderResults();

      const { sel, noAnchor, total } = counts();
      toast(`${total.toLocaleString()} number(s) found — ${sel.toLocaleString()} ready to link` +
        (noAnchor ? `, ${noAnchor.toLocaleString()} without an anchor` : '') +
        '. Review, then Apply Selected.', 'success', 4200);

    } catch (e) {
      hideProgress();
      console.error(e);
      toast('Error: ' + e.message, 'error');
      pb_summaryBar.hidden = true;
      pb_mainBody.innerHTML = `
      <div class="empty-state is-error">
        <span class="empty-icon"><i data-lucide="alert-triangle"></i></span>
        <h2>Scan failed</h2>
        <p>${esc(e.message)}</p>
      </div>`;
      icons();
    }
    const doneIcon = pb_runBtn.querySelector('svg,i');
    if (doneIcon) doneIcon.classList.remove('spin');
    pb_runBtnText.textContent = 'Scan & Fix';
    checkReady();
  });

  /* ==========================================================
     SAVE / COPY
     ========================================================== */
  pb_saveBtn.addEventListener('click', async () => {
    if (!pb_fileHandle || !pb_applied) { toast('Click "Apply Selected" first', 'error'); return; }
    try {
      const writable = await pb_fileHandle.createWritable();
      await writable.write(pb_fixedContent);
      await writable.close();
      toast(`Saved: ${pb_fileHandle.name}`, 'success');
    } catch (e) { toast('Save error: ' + e.message, 'error'); }
  });

  pb_copyBtn.addEventListener('click', () => {
    if (!pb_applied) { toast('Click "Apply Selected" first', 'error'); return; }
    navigator.clipboard.writeText(pb_fixedContent)
      .then(() => toast('Copied to clipboard', 'success'))
      .catch(e => toast('Copy failed: ' + e.message, 'error'));
  });

  document.getElementById('idPrefixInput').addEventListener('input', checkIdReady);

}

initPagebreak();
