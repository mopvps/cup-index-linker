'use strict';

function initFootnote(){

/* ==========================================================
   STATE
   ========================================================== */
let fn_notesHandle=null, fn_notesFileName='', fn_notesAnchorMap={};
let fn_fileHandle=null;
let fn_srcContent='', fn_candidates=[], fn_fixedContent='', fn_applied=false;

const fn_mainBody=document.getElementById('fn_mainBody'),
      fn_summaryBar=document.getElementById('fn_summaryBar'),
      fn_saveBtn=document.getElementById('fn_saveBtn'),
      fn_copyBtn=document.getElementById('fn_copyBtn'),
      fn_runBtn=document.getElementById('fnRunBtn'),
      fn_runBtnText=document.getElementById('fnRunBtnText');

function checkReady(){
  fn_runBtn.disabled=!(fn_notesHandle&&fn_fileHandle);
}

/* ==========================================================
   STEP 1 — notes file picker
   ========================================================== */
document.getElementById('fn_pickNotes').addEventListener('click', async () => {
  try {
    [fn_notesHandle] = await window.showOpenFilePicker({
      id: 'fn-notes-file',
      startIn: 'documents',
      types: [{ description: 'XHTML/HTML', accept: { 'text/html': ['.xhtml', '.html'] } }],
      multiple: false
    });
    fn_notesFileName = fn_notesHandle.name;
    document.getElementById('fn_notesBtnText').textContent = fn_notesFileName;
    document.getElementById('fn_pickNotes').classList.add('selected');
    document.getElementById('fn_step1').classList.add('done');
    const st = document.getElementById('fn_notesStatus');
    st.textContent = 'Notes file ready';
    st.className = 'step-status ok';
    checkReady();
  } catch(e) {
    if (e.name !== 'AbortError') toast('Error: ' + e.message, 'error');
  }
});

/* ==========================================================
   STEP 2 — index file picker
   ========================================================== */
document.getElementById('fn_pickFile').addEventListener('click', async () => {
  try {
    [fn_fileHandle] = await window.showOpenFilePicker({
      id: 'fn-index-file',
      startIn: 'documents',
      types: [{ description: 'XHTML/HTML', accept: { 'text/html': ['.xhtml', '.html'] } }],
      multiple: false
    });
    document.getElementById('fn_fileBtnText').textContent = fn_fileHandle.name;
    document.getElementById('fn_pickFile').classList.add('selected');
    document.getElementById('fn_step2').classList.add('done');
    const st = document.getElementById('fn_fileStatus');
    st.textContent = 'Ready to scan';
    st.className = 'step-status ok';
    checkReady();
  } catch(e) {
    if (e.name !== 'AbortError') toast('Error: ' + e.message, 'error');
  }
});

/* Build footnote anchor map from the notes file: "pageNum:fnNum" -> anchorId */
async function buildNotesAnchorMap() {
  if (!fn_notesHandle) return {};
  const content = await readFile(fn_notesHandle);

  const pagebreakRe = /<[^>]+\bid="page_(\d+)"[^>]*>/gi;
  const pagebreaks = [];
  let pb;
  while ((pb = pagebreakRe.exec(content)) !== null) {
    pagebreaks.push({ page: pb[1], index: pb.index });
  }

  const fnRe = /<[a-z][a-z0-9]*\s[^>]*\bid="([^"]+)"/gi;
  const fnAnchors = [];
  let fa;
  while ((fa = fnRe.exec(content)) !== null) {
    const id = fa[1];
    if (id.startsWith('page_')) continue;
    const numMatch = /(\d+)$/.exec(id);
    if (numMatch) fnAnchors.push({ id, index: fa.index, fnNum: numMatch[1] });
  }

  const preciseMap = {};
  for (const fn of fnAnchors) {
    let page = null;
    for (const p of pagebreaks) {
      if (p.index < fn.index) page = p.page;
      else break;
    }
    if (page) preciseMap[`${page}:${fn.fnNum}`] = fn.id;
  }
  return preciseMap;
}

/* Scan fn_srcContent for ONLY \d+n\.\d+ footnote refs */
function collectFootnoteCandidates(content) {
  const out = [];
  const P_RE_FN = /(<li\b[^>]*>)([\s\S]*?)(<\/li>)/g;
  let pm;
  P_RE_FN.lastIndex = 0;
  while ((pm = P_RE_FN.exec(content)) !== null) {
    const inner = pm[2];
    if (!/\d+\s*n\.\s*\d+/.test(inner)) continue;
    const innerStart = pm.index + pm[1].length;
    const masked = inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, m => ' '.repeat(m.length));
    const FN_RE = /\b(\d+)\s*n\.\s*(\d+)\b/g;
    let fn;
    FN_RE.lastIndex = 0;
    while ((fn = FN_RE.exec(masked)) !== null) {
      const fullMatch = fn[0];
      const pageNum = fn[1];
      const fnNum = fn[2];
      const key = `${pageNum}:${fnNum}`;
      const anchorId = fn_notesAnchorMap[key] || null;
      out.push({
        start: innerStart + fn.index,
        end: innerStart + fn.index + fullMatch.length,
        num: fullMatch,
        id: anchorId || `fn_${pageNum}_${fnNum}`,
        targetFile: anchorId ? fn_notesFileName : null,
        anchorId: anchorId,
        isFootnote: true,
        state: 'skipped'
      });
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/* ==========================================================
   COMMIT
   ========================================================== */
function buildOutput(){
  let out='',last=0,linked=0,forcedNoAnchor=0;
  for(const c of fn_candidates){
    if(c.state!=='linked') continue;
    if(!c.targetFile){forcedNoAnchor++;continue;}
    out+=fn_srcContent.slice(last,c.start);
    out+=`<a epub:type="index-locator" href="${c.targetFile}#${c.anchorId}">${c.num}</a>`;
    last=c.end;
    linked++;
  }
  out+=fn_srcContent.slice(last);
  return {text:out,linked,forcedNoAnchor};
}

/* ==========================================================
   COUNTS
   ========================================================== */
function counts(){
  let sel=0,noAnchor=0;
  for(const c of fn_candidates){
    if(c.state==='linked'&&c.targetFile) sel++;
    if(!c.targetFile) noAnchor++;
  }
  return {sel,noAnchor,total:fn_candidates.length};
}
function updateStats(animate){
  const {sel,noAnchor,total}=counts();
  const set=(id,v)=>{
    const el=document.getElementById(id);
    if(!el) return;
    if(animate) countUp(el,v); else el.textContent=v.toLocaleString();
  };
  set('fn_cTotal',total);
  set('fn_cFixed',sel);
  set('fn_cNotFound',noAnchor);
}
function updateSelCount(){
  const {sel,total}=counts();
  const el=document.getElementById('fn_selCount');
  if(el) el.innerHTML=`<b>${sel.toLocaleString()}</b> of ${total.toLocaleString()} footnote refs selected`;
}

/* ==========================================================
   PAINT
   ========================================================== */
function paintSpan(i){
  const c=fn_candidates[i];
  const span=document.querySelector(`#fn_previewContainer .num-highlight[data-i="${i}"]`);
  if(span){
    span.dataset.state=c.state;
    span.classList.remove('linked','skipped','noanchor');
    span.classList.add(c.state);
  }
  const row=document.querySelector(`#fn_fixBody tr[data-i="${i}"]`);
  if(row) row.replaceWith(buildRow(i));
  icons();
}
function paintAll(){
  fn_candidates.forEach((c,i)=>{
    const span=document.querySelector(`#fn_previewContainer .num-highlight[data-i="${i}"]`);
    if(span){
      span.dataset.state=c.state;
      span.classList.remove('linked','skipped','noanchor');
      span.classList.add(c.state);
    }
  });
  renderTable(false);
  updateSelCount();
  updateStats(false);
}

function cycleState(span){
  const i=Number(span.dataset.i);
  const c=fn_candidates[i];
  if(!c || !c.targetFile) return; // no manual anchor picker for footnote refs
  c.state = c.state==='linked' ? 'skipped' : 'linked';
  paintSpan(i);
  updateSelCount();
  updateStats(false);
}

/* ==========================================================
   TABLE
   ========================================================== */
const MAX_ROWS=400;

function statusPill(c){
  if(c.state==='linked'){
    return c.targetFile
      ? `<span class="pill pill-pass"><i data-lucide="check"></i>Linked</span>`
      : `<span class="pill pill-warn"><i data-lucide="alert-triangle"></i>No Anchor</span>`;
  }
  if(c.state==='noanchor')
    return `<span class="pill pill-fail"><i data-lucide="x"></i>No Anchor</span>`;
  return `<span class="pill pill-skip"><i data-lucide="minus"></i>Skipped</span>`;
}

function buildRow(i){
  const c=fn_candidates[i];
  const tr=document.createElement('tr');
  tr.dataset.i=i;
  if(c.state!=='linked') tr.className='is-skipped';
  tr.innerHTML=
    `<td class="cell-num">${c.num}</td>`+
    `<td class="cell-mono">${c.anchorId?c.anchorId:'<span class="cell-dash">&mdash;</span>'}</td>`+
    `<td class="cell-mono">${c.targetFile?c.targetFile:'<span class="cell-dash">&mdash;</span>'}</td>`+
    `<td>${statusPill(c)}</td>`;
  return tr;
}

function renderTable(onlyApplied){
  const tbody=document.getElementById('fn_fixBody');
  if(!tbody) return;
  const idx=fn_candidates.map((c,i)=>i)
      .filter(i=>onlyApplied?(fn_candidates[i].state==='linked'&&fn_candidates[i].targetFile):true);
  const shown=idx.slice(0,MAX_ROWS);
  tbody.innerHTML='';
  for(const i of shown) tbody.appendChild(buildRow(i));

  const note=document.getElementById('fn_tableNote');
  if(note){
    note.innerHTML=idx.length>MAX_ROWS
      ? `${(idx.length-MAX_ROWS).toLocaleString()} more entries not listed &mdash; all are applied in the file on the left.`
      : '';
    note.hidden=idx.length<=MAX_ROWS;
  }
  const sub=document.getElementById('fn_tableSub');
  if(sub) sub.textContent=`${idx.length.toLocaleString()} ${onlyApplied?'applied':'detected'}`;
  icons();
}

/* ==========================================================
   PREVIEW
   ========================================================== */
function buildPreviewHTML(){
  let out='',last=0;
  fn_candidates.forEach((c,i)=>{
    out+=fn_srcContent.slice(last,c.start);
    out+=`<span class="num-highlight ${c.state}"`+
         ` data-i="${i}"`+
         ` data-num="${escAttr(c.num)}"`+
         ` data-target="${escAttr(c.targetFile||'')}"`+
         ` data-state="${c.state}"`+
         ` role="button" tabindex="0">${c.num}</span>`;
    last=c.end;
  });
  out+=fn_srcContent.slice(last);
  return sanitizeDoc(out);
}
function sanitizeDoc(s){
  const b=/<body[^>]*>([\s\S]*?)<\/body\s*>/i.exec(s);
  let h=b?b[1]:s;
  h=h.replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi,'')
     .replace(/<(script|style|link|meta|base|img|input|form)\b[^>]*\/?>/gi,'')
     .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'')
     .replace(/\s(?:src|href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi,'');
  if(!h.trim()){
    const head=/<head\b[\s\S]*?<\/head\s*>/i.exec(s);
    h=head?s.slice(head.index+head[0].length):s;
  }
  return h;
}

/* ==========================================================
   RENDER — split layout without see-also
   ========================================================== */
function renderResults(){
  fn_mainBody.innerHTML=`
    <div class="split">

      <section class="panel">
        <div class="panel-head">
          <i data-lucide="eye"></i>
          <span class="panel-title">Preview</span>
        </div>

        <div class="apply-row">
          <span class="sel-count" id="fn_selCount"></span>
          <span class="hint">Click a footnote ref to include or skip it</span>
          <button class="btn-apply" id="fn_applyBtn">
            <i data-lucide="check-check"></i>Apply Selected
          </button>
        </div>

        <div class="panel-body">
          <div class="preview-doc" id="fn_previewContainer">${buildPreviewHTML()}</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <i data-lucide="list-checks"></i>
          <span class="panel-title">Footnote Links</span>
          <span class="panel-sub"><span id="fn_tableSub"></span></span>
        </div>
        <div class="panel-body">
          <table class="fix-table">
            <thead>
              <tr><th>Ref</th><th>Anchor ID</th><th>Target File</th><th>Status</th></tr>
            </thead>
            <tbody id="fn_fixBody"></tbody>
          </table>
          <div class="table-note" id="fn_tableNote" hidden></div>
        </div>
      </section>

    </div>`;

  renderTable(false);
  updateSelCount();
  icons();
}

/* ==========================================================
   APPLY
   ========================================================== */
function applySelected(){
  const {linked,forcedNoAnchor}=buildOutput();

  let out='',last=0;
  for(const c of fn_candidates){
    if(c.state!=='linked') continue;
    if(!c.targetFile) continue;
    out+=fn_srcContent.slice(last,c.start);
    out+=`<a epub:type="index-locator" href="${c.targetFile}#${c.anchorId}">${c.num}</a>`;
    last=c.end;
  }
  out+=fn_srcContent.slice(last);
  fn_fixedContent=out;

  fn_applied=true;
  fn_saveBtn.disabled=false;
  fn_copyBtn.disabled=false;
  renderTable(true);
  let msg=`Applied — ${linked.toLocaleString()} link${linked===1?'':'s'} in the output`;
  if(forcedNoAnchor) msg+=`, ${forcedNoAnchor} skipped (no anchor)`;
  toast(msg,'success');
}

/* ==========================================================
   DELEGATED EVENTS
   ========================================================== */
fn_mainBody.addEventListener('click',e=>{
  const span=e.target.closest('.num-highlight');
  if(span){cycleState(span);return;}
  if(e.target.closest('#fn_applyBtn')){applySelected();return;}
  const row=e.target.closest('#fn_fixBody tr');
  if(row&&row.dataset.i!==undefined){
    const span2=document.querySelector(`#fn_previewContainer .num-highlight[data-i="${row.dataset.i}"]`);
    if(span2){
      span2.scrollIntoView({behavior:'smooth',block:'center'});
      span2.classList.remove('flash');
      void span2.offsetWidth;
      span2.classList.add('flash');
    }
    return;
  }
});

fn_mainBody.addEventListener('keydown',e=>{
  const span=e.target.closest&&e.target.closest('.num-highlight');
  if(span&&(e.key==='Enter'||e.key===' ')){e.preventDefault();cycleState(span);}
});

/* ==========================================================
   RUN — Scan Footnotes
   ========================================================== */
fn_runBtn.addEventListener('click', async () => {
  fn_runBtn.disabled = true;
  fn_runBtnText.textContent = 'Scanning...';
  const spinIcon = fn_runBtn.querySelector('svg,i');
  if (spinIcon) spinIcon.classList.add('spin');
  showSkeletons(fn_summaryBar, fn_mainBody);
  showProgress('Reading notes file');
  fn_saveBtn.disabled = true;
  fn_copyBtn.disabled = true;
  fn_applied = false;
  fn_fixedContent = '';
  try {
    fn_notesAnchorMap = await buildNotesAnchorMap();
    setProgress(1, 1, 'Detecting footnote refs');
    fn_srcContent = await readFile(fn_fileHandle);
    fn_candidates = collectFootnoteCandidates(fn_srcContent);
    for (const c of fn_candidates) {
      c.state = c.targetFile ? 'linked' : 'noanchor';
    }
    hideProgress();
    fn_summaryBar.hidden = false;
    updateStats(true);
    renderResults();
    const linked = fn_candidates.filter(c => c.state === 'linked').length;
    const missing = fn_candidates.filter(c => c.state === 'noanchor').length;
    toast(
      `${fn_candidates.length} footnote ref(s) found — ${linked} ready to link` +
      (missing ? `, ${missing} anchor missing` : '') +
      '. Review, then Apply Selected.',
      'success', 4200
    );
  } catch (e) {
    hideProgress();
    console.error(e);
    toast('Error: ' + e.message, 'error');
    fn_summaryBar.hidden = true;
    fn_mainBody.innerHTML = `
      <div class="empty-state is-error">
        <span class="empty-icon"><i data-lucide="alert-triangle"></i></span>
        <h2>Scan failed</h2>
        <p>${esc(e.message)}</p>
      </div>`;
    icons();
  }
  const doneIcon = fn_runBtn.querySelector('svg,i');
  if (doneIcon) doneIcon.classList.remove('spin');
  fn_runBtnText.textContent = 'Scan Footnotes';
  checkReady();
});

/* ==========================================================
   SAVE / COPY
   ========================================================== */
fn_saveBtn.addEventListener('click', async () => {
  if (!fn_fileHandle || !fn_applied) { toast('Click "Apply Selected" first', 'error'); return; }
  try {
    const writable = await fn_fileHandle.createWritable();
    await writable.write(fn_fixedContent);
    await writable.close();
    toast(`Saved: ${fn_fileHandle.name}`, 'success');
  } catch (e) { toast('Save error: ' + e.message, 'error'); }
});

fn_copyBtn.addEventListener('click', () => {
  if (!fn_applied) { toast('Click "Apply Selected" first', 'error'); return; }
  navigator.clipboard.writeText(fn_fixedContent)
    .then(() => toast('Copied to clipboard', 'success'))
    .catch(e => toast('Copy failed: ' + e.message, 'error'));
});

}

initFootnote();
