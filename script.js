/* ==========================================================
   ICONS — re-render lucide after any dynamic DOM insert
   ========================================================== */
function icons(){
  if(window.lucide&&window.lucide.createIcons) window.lucide.createIcons();
}
icons();

/* ==========================================================
   TOASTS
   ========================================================== */
const toastStack=document.getElementById('toastStack');
function toast(msg,type='success',ms=3200){
  const el=document.createElement('div');
  el.className='toast '+type;
  el.setAttribute('role',type==='error'?'alert':'status');
  el.innerHTML=`<span class="t-icon"><i data-lucide="${type==='error'?'alert-triangle':'check-circle-2'}"></i></span>
                <span class="t-msg"></span>`;
  el.querySelector('.t-msg').textContent=msg;
  toastStack.appendChild(el);
  icons();
  const kill=()=>{
    if(el.dataset.dying) return;
    el.dataset.dying='1';
    el.classList.add('out');
    el.addEventListener('animationend',()=>el.remove(),{once:true});
    setTimeout(()=>el.remove(),500);
  };
  const t=setTimeout(kill,ms);
  el.addEventListener('click',()=>{clearTimeout(t);kill();});
}

/* ==========================================================
   THEME (persisted in localStorage)
   ========================================================== */
const html=document.documentElement,
      themeBtn=document.getElementById('themeToggle'),
      themeLabel=document.getElementById('themeLabel');

function applyTheme(dark){
  html.setAttribute('data-theme',dark?'dark':'light');
  themeLabel.textContent=dark?'Light mode':'Dark mode';
  // lucide swaps <i> for <svg>, so replace the node with a fresh <i> each time
  const old=document.getElementById('themeIcon');
  const fresh=document.createElement('i');
  fresh.id='themeIcon';
  fresh.setAttribute('data-lucide',dark?'sun':'moon');
  old.replaceWith(fresh);
  icons();
}
applyTheme(localStorage.getItem('theme')==='dark');

themeBtn.addEventListener('click',()=>{
  const dark=html.getAttribute('data-theme')!=='dark';
  applyTheme(dark);
  localStorage.setItem('theme',dark?'dark':'light');
});

document.getElementById('romanToggle').addEventListener('change', e => {
  romanMode = e.target.checked;
});

/* ==========================================================
   STATE
   ========================================================== */
let dirHandle=null,fileHandle=null,fileHandles={},fixedContent='';

/* review state.
   Each candidate carries state: 'linked' | 'skipped' | 'noanchor'
   - linked   -> will become <a href="target#id">num</a>
   - skipped  -> stays a plain number
   - noanchor -> no matching pagebreak anchor exists; stays plain */
let srcContent='';
let candidates=[];
let anchorOnly=true;
let manualAnchorMap={}; // id -> fname for manually assigned anchors
let rangeMin=null,rangeMax=null;
let applied=false;
let romanMode=false;
const ROMAN_LIST = new Set([
  'i','ii','iii','iv','v','vi','vii','viii','ix','x',
  'xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx',
  'xxi','xxii','xxiii','xxiv','xxv','xxx','xl','l',
  'I','II','III','IV','V','VI','VII','VIII','IX','X',
  'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX',
  'XXI','XXII','XXIII','XXIV','XXV','XXX','XL','L'
]);
const runBtn=document.getElementById('runBtn'),
      runBtnText=document.getElementById('runBtnText'),
      mainBody=document.getElementById('mainBody'),
      summaryBar=document.getElementById('summaryBar'),
      saveBtn=document.getElementById('saveBtn'),
      copyBtn=document.getElementById('copyBtn');

function checkReady(){runBtn.disabled=!(dirHandle&&fileHandle);}

/* ==========================================================
   TOOLTIP — one element, a direct child of <body> so that no
   overflow:hidden ancestor can ever clip it.
   ========================================================== */
const tip=(()=>{
  let t=document.getElementById('tip');
  if(!t){t=document.createElement('div');t.id='tip';t.setAttribute('role','tooltip');}
  t.className='tip';
  t.hidden=true;
  document.body.appendChild(t);        // re-parent to body no matter where it was authored
  return t;
})();

function showTooltip(span){
  const c=candidates[Number(span.dataset.i)];
  if(!c) return;
  const target=span.dataset.target, id=span.dataset.id, num=span.dataset.num;
  tip.innerHTML=
    `<div class="tip-row"><span class="tip-key">Number</span><span class="tip-val">${num}</span></div>`+
    (target
      ? `<div class="tip-row"><span class="tip-key">Becomes</span><span class="tip-val tip-code">${esc(`<a href="${target}#${id}">${num}</a>`)}</span></div>`+
        `<div class="tip-row"><span class="tip-key">File</span><span class="tip-val tip-code">${esc(target)}</span></div>`+
        `<div class="tip-row"><span class="tip-key">Anchor</span><span class="tip-val tip-code">#${esc(id)}</span></div>`
      : `<div class="tip-row"><span class="tip-key">Anchor</span><span class="tip-val tip-warn">No matching anchor found</span></div>`)+
    `<div class="tip-hint">${
      c.state==='linked' ? 'Will be linked — click to skip'
      : c.state==='noanchor' ? 'No anchor — click to force-select'
      : 'Skipped — click to include'}</div>`;
  tip.hidden=false;
}
function positionTooltip(e){
  const pad=12, w=tip.offsetWidth, h=tip.offsetHeight;
  let x=e.clientX+pad, y=e.clientY+pad;
  if(x+w>window.innerWidth-8)  x=e.clientX-w-pad;   // flip left near the right edge
  if(y+h>window.innerHeight-8) y=e.clientY-h-pad;   // flip up near the bottom edge
  tip.style.left=Math.max(8,x)+'px';
  tip.style.top =Math.max(8,y)+'px';
}
function hideTooltip(){tip.hidden=true;}

/* ==========================================================
   PROGRESS
   ========================================================== */
const progWrap=document.getElementById('progressWrap'),
      progFill=document.getElementById('progressFill'),
      progText=document.getElementById('progressText'),
      progPct =document.getElementById('progressPct');

function showProgress(label){
  progWrap.hidden=false;
  progText.textContent=label;
  progFill.style.width='0%';
  progPct.textContent='0%';
}
function setProgress(done,total,label){
  const p=total?Math.round(done/total*100):0;
  progFill.style.width=p+'%';
  progPct.textContent=p+'%';
  if(label) progText.textContent=label;
}
function hideProgress(){progWrap.hidden=true;}

/* ==========================================================
   SKELETON
   ========================================================== */
function showSkeletons(){
  summaryBar.hidden=true;
  mainBody.innerHTML=`
    <div class="split">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">Loading file</span></div>
        <div class="sk-pad"><div class="skeleton sk-block"></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title">Loading fixes</span></div>
        <div class="sk-pad">
          <div class="skeleton sk-line w85"></div>
          <div class="skeleton sk-line w70"></div>
          <div class="skeleton sk-line w85"></div>
          <div class="skeleton sk-line w45"></div>
          <div class="skeleton sk-line w70"></div>
          <div class="skeleton sk-line w85"></div>
        </div>
      </div>
    </div>`;
}

/* ==========================================================
   COUNT-UP
   ========================================================== */
function countUp(el,target,ms=650){
  target=Number(target)||0;
  if(target===0){el.textContent='0';return;}
  const t0=performance.now();
  function frame(t){
    const k=Math.min(1,(t-t0)/ms), eased=1-Math.pow(1-k,3);
    el.textContent=Math.round(target*eased).toLocaleString();
    if(k<1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ==========================================================
   STEP 1 — folder picker
   ========================================================== */
document.getElementById('pickFolder').addEventListener('click',async()=>{
  try{
    dirHandle=await window.showDirectoryPicker({
      mode:'readwrite',
      id:'epub-folder',      // browser remembers this picker's last location
      startIn:'documents'
    });
    fileHandles={};
    let count=0;
    for await(const [name,handle] of dirHandle.entries()){
      if(handle.kind==='file'&&(name.endsWith('.xhtml')||name.endsWith('.html'))){
        fileHandles[name]=handle; count++;
      }
    }
    document.getElementById('folderBtnText').textContent=dirHandle.name;
    document.getElementById('pickFolder').classList.add('selected');
    document.getElementById('step1').classList.add('done');
    const st=document.getElementById('folderStatus');
    st.textContent=`${count} xhtml file${count===1?'':'s'} found`;
    st.className='step-status ok';
    document.getElementById('pickFile').disabled=false;
    checkReady();
  }catch(e){if(e.name!=='AbortError')toast('Error: '+e.message,'error');}
});

/* ==========================================================
   STEP 2 — index file picker
   ========================================================== */
document.getElementById('pickFile').addEventListener('click',async()=>{
  try{
    [fileHandle]=await window.showOpenFilePicker({
      id:'index-file',
      startIn:dirHandle||'documents',   // open inside the chosen EPUB folder
      types:[{description:'XHTML/HTML',accept:{'text/html':['.xhtml','.html']}}],
      multiple:false
    });
    document.getElementById('fileBtnText').textContent=fileHandle.name;
    document.getElementById('pickFile').classList.add('selected');
    document.getElementById('step2').classList.add('done');
    const st=document.getElementById('fileStatus');
    st.textContent='Ready to scan';
    st.className='step-status ok';
    checkReady();
  }catch(e){if(e.name!=='AbortError')toast('Error: '+e.message,'error');}
});

/* ==========================================================
   FILE / ESCAPING HELPERS
   ========================================================== */
async function readFile(h){return await(await h.getFile()).text();}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
  .replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* Build anchor map: "pagebreak_54" -> "chapter1.xhtml" */
async function buildAnchorMap(onProgress){
  const map={};
  const entries=Object.entries(fileHandles);
  let done=0;
  for(const [fname,handle] of entries){
    const content=await readFile(handle);
    const re=/<span\s+id="(page_[\w]+)"[^>]*\/?>/g;
    let m;
    while((m=re.exec(content))!==null) map[m[1].toLowerCase()]=fname;
    done++;
    if(onProgress) onProgress(done,entries.length,fname);
    await new Promise(r=>requestAnimationFrame(r)); // let the progress bar paint
  }
  return map;
}

/* Extract unique numbers from inside a <p> tag's text content (ignores existing links) */
function extractNumbers(pContent){
  const stripped=pContent.replace(/<a\s+href="[^"]*"[^>]*>(\d+)<\/a>/g,'$1');
  const nums=new Set();
  const re=/\b(\d+)\b/g; let m;
  while((m=re.exec(stripped))!==null) nums.add(m[1]);
  return [...nums];
}

/* ==========================================================
   DETECTION — the original auto-fix regexes, but this records
   offsets instead of committing the replacement immediately.
   ========================================================== */
const P_RE   =/(<li\b[^>]*>)([\s\S]*?)(<\/li>)/g;
const NUM_RE =/(?<!href="[^"]*#page_\d*)(?<!id="page_\d*)(?<!")\b(\d+)\b(?![^<]*<\/a>)/g;

function collectCandidates(content, anchorMap){
  const out=[];
  P_RE.lastIndex=0;
  let pm;
  while((pm=P_RE.exec(content))!==null){
    const inner=pm[2];
    if(!/\b\d+\b/.test(inner)&&!(romanMode&&/\b[IVXLCDMivxlcdm]+\b/i.test(inner))) continue;
    const innerStart=pm.index+pm[1].length;

    // mask existing <a>...</a> so already-linked numbers are skipped
    const masked2=inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, m=>' '.repeat(m.length));
    // detect ranges like "63-5", "63–5", "63—5"
    const RANGE_RE=/\b(\d+)\s*[-–—]\s*(\d+)\b/g;
    const rangePositions=[];
    let rr;
    RANGE_RE.lastIndex=0;
    while((rr=RANGE_RE.exec(masked2))!==null){
      const startNum=rr[1], endShort=rr[2];
      const fullEnd=endShort.length<startNum.length
        ? startNum.slice(0,startNum.length-endShort.length)+endShort
        : endShort;
      const sepStart=rr.index+startNum.length;
      const sepEnd=rr.index+rr[0].length-endShort.length;
      // push start number
      out.push({
        start:innerStart+rr.index,
        end:innerStart+rr.index+startNum.length,
        num:startNum, id:'page_'+startNum,
        targetFile:anchorMap['page_'+startNum]||null,
        state:'skipped'
      });
      // push end number (display short, link full)
      out.push({
        start:innerStart+sepEnd,
        end:innerStart+rr.index+rr[0].length,
        num:endShort, id:'page_'+fullEnd,
        targetFile:anchorMap['page_'+fullEnd]||null,
        state:'skipped'
      });
      rangePositions.push([rr.index, rr.index+rr[0].length]);
    }

    let nm;
    NUM_RE.lastIndex=0;
    while((nm=NUM_RE.exec(masked2))!==null){
      // skip if this position is inside a detected range
      const pos=nm.index;
      if(rangePositions.some(([s,e])=>pos>=s&&pos<e)) continue;
      const num=nm[1];
      const id='page_'+num;
      out.push({
        start:innerStart+nm.index,
        end:innerStart+nm.index+num.length,
        num, id,
        targetFile:anchorMap[id]||null,
        state:'skipped'
      });
    }
    if(romanMode){
      // Build a masked copy of inner where tag content and entities are replaced
      // with spaces — same length so offsets stay valid.
      const masked = inner
        .replace(/<[^>]*>/g,    m => ' '.repeat(m.length))  // blank out tags
        .replace(/&[^;]+;/g,    m => ' '.repeat(m.length)); // blank out entities

      const ROM_SCAN=/(?<![A-Za-z])([A-Za-z]+)(?![A-Za-z])/g;
      let rm;
      ROM_SCAN.lastIndex=0;
      while((rm=ROM_SCAN.exec(masked))!==null){
        const num=rm[1];
        if(!ROMAN_LIST.has(num)) continue;
        // skip if this token sits inside an existing <a href> tag
        const before=inner.slice(0,rm.index);
        const afterMatch=inner.slice(rm.index+num.length);
        const insideAnchor=(/(<a\b[^>]*>)[^<]*$/.test(before))&&(/<\/a>/.test(afterMatch));
        if(insideAnchor) continue;
        const numLower=num.toLowerCase();
        const id='page_'+numLower;
        out.push({
          start: innerStart+rm.index,
          end:   innerStart+rm.index+num.length,
          num,
          id,
          targetFile: anchorMap[id]||null,
          state: 'skipped'
        });
      }
    }
  }
  out.sort((a,b)=>a.start-b.start);
  return out;
}

/* ==========================================================
   AUTO-SAFETY RULES
   ========================================================== */
function inRange(num){
  if(ROMAN_LIST.has(num)) return true; // solo Roman numerals always in range
  const n=Number(num);
  if(rangeMin!==null&&n<rangeMin) return false;
  if(rangeMax!==null&&n>rangeMax) return false;
  return true;
}
function defaultState(c){
  if(!c.targetFile)   return 'noanchor';  // red
  if(!inRange(c.num)) return 'skipped';   // outside the page range
  return 'linked';
}
function applyAutoRules(){
  for(const c of candidates) c.state=defaultState(c);
}

/* ==========================================================
   COMMIT — output built from state==='linked' only. Everything
   outside a linked number is copied verbatim, so the file is
   byte-identical except for the intended links.
   ========================================================== */
function buildOutput(){
  let out='',last=0,linked=0,forcedNoAnchor=0;
  for(const c of candidates){
      if(c.state!=='linked' && c.state!=='manual') continue;
    if(!c.targetFile){forcedNoAnchor++;continue;}  // cannot link without an anchor
    out+=srcContent.slice(last,c.start);
    out+=`<a epub:type="index-locator" href="${c.targetFile}#${c.id}">${c.num}</a>`;
    last=c.end;
    linked++;
  }
  out+=srcContent.slice(last);
  return {text:out,linked,forcedNoAnchor};
}

/* ==========================================================
   SYNTAX HIGHLIGHTING (code view)
   ========================================================== */
function hlAttrs(raw){
  return esc(raw).replace(
    /([\w:.\-]+)(\s*=\s*)("[^"]*"|'[^']*')/g,
    (m,name,eq,val)=>`<span class="t-attr">${name}</span><span class="t-punct">${eq}</span><span class="t-str">${val}</span>`
  );
}
function hlTag(tag){
  const m=/^(<\/?)([A-Za-z][\w:.\-]*)([\s\S]*?)(\/?>)$/.exec(tag);
  if(!m) return `<span class="t-punct">${esc(tag)}</span>`;
  return `<span class="t-punct">${esc(m[1])}</span>`+
         `<span class="t-tag">${esc(m[2])}</span>`+
         hlAttrs(m[3])+
         `<span class="t-punct">${esc(m[4])}</span>`;
}
function syntaxHighlight(raw){
  const re=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z][^>]*>/g;
  let out='',last=0,m;
  while((m=re.exec(raw))!==null){
    out+=esc(raw.slice(last,m.index));
    const t=m[0];
    if(t.startsWith('<!--'))                        out+=`<span class="t-com">${esc(t)}</span>`;
    else if(t.startsWith('<!')||t.startsWith('<?')) out+=`<span class="t-meta">${esc(t)}</span>`;
    else                                            out+=hlTag(t);
    last=m.index+t.length;
  }
  return out+esc(raw.slice(last));
}
function highlightCode(content, links){
  const uniq=[...new Set(links)];
  const store=[];
  let work=content;
  for(const tag of uniq){
    if(!work.includes(tag)) continue;
    const i=store.push(tag)-1;
    work=work.split(tag).join(' '+i+'');
  }
  let out=syntaxHighlight(work);
  out=out.replace(/ (\d+)/g,(m,i)=>`<span class="hi">${syntaxHighlight(store[+i])}</span>`);
  return out;
}
function gutterFor(content){
  const n=content.split('\n').length;
  let s='';
  for(let i=1;i<=n;i++) s+=i+(i<n?'\n':'');
  return s;
}

/* ==========================================================
   PREVIEW — the original document with every candidate wrapped
   in a live span. Surrounding file text is left untouched;
   only the number spans are real HTML.
   ========================================================== */
function buildPreviewHTML(){
  let out='',last=0;
  candidates.forEach((c,i)=>{
    out+=srcContent.slice(last,c.start);
    out+=`<span class="num-highlight ${c.state}"`+
         ` data-i="${i}"`+
         ` data-num="${escAttr(c.num)}"`+
         ` data-id="${escAttr(c.id)}"`+
         ` data-target="${escAttr(c.targetFile||'')}"`+
         ` data-state="${c.state}"`+
         ` role="button" tabindex="0">${c.num}</span>`;
    last=c.end;
  });
  out+=srcContent.slice(last);
  return sanitizeDoc(out);
}

/* The index file is the user's own, but it still gets injected into this page —
   strip anything executable or layout-hijacking before rendering. */
function sanitizeDoc(s){
  const b=/<body[^>]*>([\s\S]*?)<\/body\s*>/i.exec(s);
  let h=b?b[1]:s;
  // strip executable blocks
  h=h.replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi,'')
  // strip void elements that don't belong in body
     .replace(/<(script|style|link|meta|base|img|input|form)\b[^>]*\/?>/gi,'')
  // strip event handlers
     .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'')
  // strip javascript: hrefs
     .replace(/\s(?:src|href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi,'');
  // if result is empty (body tag not found or stripped everything), return original stripped of head
  if(!h.trim()){
    const head=/<head\b[\s\S]*?<\/head\s*>/i.exec(s);
    h=head?s.slice(head.index+head[0].length):s;
  }
  return h;
}

/* pagebreak anchors are markers only, never clickable — converting them
   to spans up front avoids invalid nested <a> when one sits inside an
   outer <a href> (which auto-closes the outer link mid-sentence). */
function pagebreakAnchorsToSpans(html){
  return html.replace(/<a\s+id="(pagebreak_[^"]+)"\s*\/?>(<\/a>)?/gi,'<span id="$1"></span>');
}
function pagebreakSpansToAnchors(html){
  return html.replace(/<span\s+id="(pagebreak_[^"]+)">\s*<\/span>/gi,'<a id="$1"/>');
}

/* ==========================================================
   COUNTS / SYNC
   ========================================================== */
function counts(){
  let sel=0,noAnchor=0;
  for(const c of candidates){
    if(c.state==='linked'&&c.targetFile) sel++;
    if(!c.targetFile) noAnchor++;
  }
  return {sel,noAnchor,total:candidates.length};
}
function updateStats(animate){
  const {sel,noAnchor,total}=counts();
  const set=(id,v)=>{
    const el=document.getElementById(id);
    if(!el) return;
    if(animate) countUp(el,v); else el.textContent=v.toLocaleString();
  };
  set('cTotal',total);
  set('cFixed',sel);
  set('cNotFound',noAnchor);
  set('cFiles',Object.keys(fileHandles).length);
}
function updateSelCount(){
  const {sel,total}=counts();
  const el=document.getElementById('selCount');
  if(el) el.innerHTML=`<b>${sel.toLocaleString()}</b> of ${total.toLocaleString()} numbers selected`;
}

/* ==========================================================
   ROMAN NUMERAL SELECTION LINKING (Enter key)
   ========================================================== */
document.addEventListener('keydown', e => {
  if(e.key !== 'Enter') return;
  if(!romanMode) return;

  const preview = document.getElementById('previewContainer');
  if(!preview) return;

  const sel = window.getSelection();
  if(!sel || sel.isCollapsed || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  if(!preview.contains(range.commonAncestorContainer)) return;

  let count = 0;
  preview.querySelectorAll('.num-highlight').forEach(span => {
    const i = Number(span.dataset.i);
    const c = candidates[i];
    if(!c) return;
    if(!ROMAN_LIST.has(c.num) && !ROMAN_LIST.has(c.num.toLowerCase())) return;
    if(!c.targetFile) return;

    // check if span overlaps the selection using Range comparison
    const spanRange = document.createRange();
    spanRange.selectNode(span);
    const selRange = sel.getRangeAt(0);
    const afterEnd   = selRange.compareBoundaryPoints(Range.START_TO_END, spanRange) < 0;
    const beforeStart= selRange.compareBoundaryPoints(Range.END_TO_START, spanRange) > 0;
    if(afterEnd || beforeStart) return;

    c.state = 'linked';
    paintSpan(i);
    count++;
  });

  if(!count){ toast('No Roman numerals with anchors found in selection', 'error'); return; }

  updateSelCount();
  updateStats(false);
  toast(`${count} Roman numeral${count===1?'':'s'} linked`, 'success');
  sel.removeAllRanges();
  e.preventDefault();
});

/* write one candidate's state onto its span + its table row */
function paintSpan(i){
  const c=candidates[i];
  const span=document.querySelector(`.num-highlight[data-i="${i}"]`);
  if(span){
    span.dataset.state=c.state;
    span.classList.remove('linked','skipped','noanchor','manual');
    span.classList.add(c.state);
    if(c.state==='manual') span.classList.add('manual');
  }
  const row=document.querySelector(`#fixBody tr[data-i="${i}"]`);
  if(row) row.replaceWith(buildRow(i));
  icons();
}
function paintAll(){
  candidates.forEach((c,i)=>{
    const span=document.querySelector(`.num-highlight[data-i="${i}"]`);
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

/* ==========================================================
   TOGGLE
   ========================================================== */
function cycleState(span){
  const i=Number(span.dataset.i);
  const c=candidates[i];
  if(!c) return;
  if(c.state==='manual'){
    // already manually linked — show change/delete popup
    showManualEditPopup(i);
    return;
  }
  if(!c.targetFile){
    // no anchor — show file picker
    showManualAnchorPopup(i);
    return;
  }
  // normal toggle
  c.state = c.state==='linked' ? 'skipped' : 'linked';
  paintSpan(i);
  updateSelCount();
  updateStats(false);
}

function showManualAnchorPopup(candIndex){
  const c=candidates[candIndex];
  const files=Object.keys(fileHandles).sort();
  if(!files.length){ toast('No folder loaded','error'); return; }

  const overlay=document.createElement('div');
  overlay.className='manual-anchor-overlay';
  overlay.innerHTML=`
    <div class="manual-anchor-popup">
      <div class="manual-anchor-head">
        <span>Link <code>${c.id}</code> to file:</span>
        <button class="manual-anchor-close" aria-label="Cancel">✕</button>
      </div>
      <div class="manual-anchor-list">
        ${files.map(f=>`<button class="manual-anchor-item" data-file="${f}">${f}</button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('.manual-anchor-close').addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.remove(); });

  overlay.querySelectorAll('.manual-anchor-item').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const fname=btn.dataset.file;
      overlay.remove();
      c.targetFile=fname;
      c.state='manual';
      manualAnchorMap[c.id]=fname;
      paintSpan(candIndex);
      updateSelCount();
      updateStats(false);
      toast(`${c.id} linked to ${fname}`,'success');
    });
  });
}

function showManualEditPopup(candIndex){
  const c=candidates[candIndex];

  const overlay=document.createElement('div');
  overlay.className='manual-anchor-overlay';
  overlay.innerHTML=`
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

  overlay.querySelector('.manual-anchor-close').addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.remove(); });

  overlay.querySelector('.manual-action-change').addEventListener('click',()=>{
    overlay.remove();
    showManualAnchorPopup(candIndex);
  });

  overlay.querySelector('.manual-action-delete').addEventListener('click',()=>{
    overlay.remove();
    c.targetFile=null;
    c.state='noanchor';
    delete manualAnchorMap[c.id];
    paintSpan(candIndex);
    updateSelCount();
    updateStats(false);
    toast(`${c.id} unlinked`,'success');
  });
}

/* ==========================================================
   RIGHT COLUMN — fixes table
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
  if(c.state==='manual')
    return `<span class="pill pill-manual"><i data-lucide="plus-circle"></i>Manual</span>`;
  return `<span class="pill pill-skip"><i data-lucide="minus"></i>Skipped</span>`;
}

function buildRow(i){
  const c=candidates[i];
  const tr=document.createElement('tr');
  tr.dataset.i=i;
  if(c.state!=='linked' && c.state!=='manual') tr.className='is-skipped';
  tr.innerHTML=
    `<td class="cell-num">${c.num}</td>`+
    `<td class="cell-mono">${c.id}</td>`+
    `<td class="cell-mono">${c.targetFile?c.targetFile:'<span class="cell-dash">&mdash;</span>'}</td>`+
    `<td>${statusPill(c)}</td>`;
  return tr;
}

function renderTable(onlyApplied){
  const tbody=document.getElementById('fixBody');
  if(!tbody) return;
  const idx=candidates.map((c,i)=>i)
      .filter(i=>onlyApplied?((candidates[i].state==='linked'||candidates[i].state==='manual')&&candidates[i].targetFile):true);
  const shown=idx.slice(0,MAX_ROWS);
  tbody.innerHTML='';
  for(const i of shown) tbody.appendChild(buildRow(i));

  const note=document.getElementById('tableNote');
  if(note){
    note.innerHTML=idx.length>MAX_ROWS
      ? `${(idx.length-MAX_ROWS).toLocaleString()} more entries not listed &mdash; all are applied in the file on the left.`
      : '';
    note.hidden=idx.length<=MAX_ROWS;
  }
  const sub=document.getElementById('tableSub');
  if(sub) sub.textContent=`${idx.length.toLocaleString()} ${onlyApplied?'applied':'detected'}`;
  icons();
}

/* ==========================================================
   RENDER — two-column split view.
   Only innerHTML changes; no listeners are attached here.
   ========================================================== */
function renderResults(){
  mainBody.innerHTML=`
    <div class="split">

      <section class="panel">
        <div class="panel-head">
          <i data-lucide="eye"></i>
          <span class="panel-title">Preview &amp; Edit</span>
          <div class="seg" id="viewSeg"></div>
        </div>

        <div class="review-bar">
          <label class="switch">
            <input type="checkbox" id="anchorOnly" ${anchorOnly?'checked':''}/>
            <span class="track"></span>
            <span>Only link numbers with a matching anchor</span>
          </label>
          <div class="range-filter">
            <span>Range</span>
            <input type="number" id="rangeMin" placeholder="min" min="0"
                   value="${rangeMin===null?'':rangeMin}"/>
            <span>&ndash;</span>
            <input type="number" id="rangeMax" placeholder="max" min="0"
                   value="${rangeMax===null?'':rangeMax}"/>
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
   NUMBER SEARCH — jump to a candidate span in the preview.
   Exact data-num matches win; partial matches are the fallback.
   ========================================================== */
let searchMatches=[], searchPos=0;

function resetSearch(){
  searchMatches=[]; searchPos=0;
  const input=document.getElementById('numSearchInput');
  if(input) input.value='';
  paintSearchUI();
}

function paintSearchUI(){
  const clear=document.getElementById('numSearchClear'),
        nav  =document.getElementById('numSearchNav'),
        count=document.getElementById('numSearchCount'),
        empty=document.getElementById('numSearchEmpty'),
        input=document.getElementById('numSearchInput');
  if(!input) return;
  const q=input.value.trim();
  if(clear) clear.hidden=q==='';
  if(nav)   nav.hidden=searchMatches.length<2;
  if(count) count.textContent=searchMatches.length
    ? `${searchPos+1} of ${searchMatches.length}` : '';
  if(empty) empty.hidden=!(q!==''&&searchMatches.length===0);
}

function runSearch(){
  const input=document.getElementById('numSearchInput');
  if(!input) return;
  const q=input.value.trim();
  searchMatches=[]; searchPos=0;
  if(q!==''){
    const exact=[], partial=[];
    candidates.forEach((c,i)=>{
      if(c.num===q) exact.push(i);
      else if(c.num.includes(q)) partial.push(i);
    });
    searchMatches=exact.length?exact:partial;
  }
  paintSearchUI();
  if(searchMatches.length) focusNumber(searchMatches[0]);
}

function stepSearch(delta){
  if(!searchMatches.length) return;
  const n=searchMatches.length;
  searchPos=(searchPos+delta+n)%n;
  paintSearchUI();
  focusNumber(searchMatches[searchPos]);
}

/* ==========================================================
   ACTIONS
   ========================================================== */
function focusNumber(i){
  const span=document.querySelector(`.num-highlight[data-i="${i}"]`);
  if(!span) return;
  span.scrollIntoView({behavior:'smooth',block:'center'});
  span.classList.remove('flash');
  void span.offsetWidth;              // restart the animation
  span.classList.add('flash');
}

function readRange(){
  const a=document.getElementById('rangeMin'), b=document.getElementById('rangeMax');
  if(!a||!b) return;
  rangeMin=a.value.trim()===''?null:Number(a.value.trim());
  rangeMax=b.value.trim()===''?null:Number(b.value.trim());
  applyAutoRules();
  paintAll();
  const {sel,total}=counts();
  toast(`Range applied — ${sel.toLocaleString()} of ${total.toLocaleString()} selected`,'success');
}

function toggleAnchorOnly(on){
  anchorOnly=on;
  if(on){
    let n=0;
    for(const c of candidates)
      if(!c.targetFile&&c.state==='linked'){c.state='noanchor';n++;}
    paintAll();
    toast(n?`${n} anchorless number(s) skipped`:'Anchor-only filter on','success');
  }else{
    toast('Anchor-only filter off — anchorless numbers can be force-selected','success');
  }
}

function applySelected(){
  const {text,linked,forcedNoAnchor}=buildOutput();
  fixedContent=text;
  applied=true;
  saveBtn.disabled=false;
  copyBtn.disabled=false;
  renderTable(true);
  let msg=`Applied — ${linked.toLocaleString()} link${linked===1?'':'s'} in the output`;
  if(forcedNoAnchor) msg+=`, ${forcedNoAnchor} skipped (no anchor)`;
  toast(msg,'success');
}

/* ==========================================================
   DELEGATED EVENTS — attached ONCE, at load, to #mainBody.
   #mainBody lives in index.html and is never replaced; only
   its innerHTML changes. Nothing below re-binds on re-render.
   ========================================================== */
mainBody.addEventListener('click',e=>{
  const span=e.target.closest('.num-highlight');
  if(span){cycleState(span);return;}

  if(e.target.closest('#applyBtn')){applySelected();return;}

  if(e.target.closest('#numSearchPrev')){stepSearch(-1);return;}
  if(e.target.closest('#numSearchNext')){stepSearch(1);return;}
  if(e.target.closest('#numSearchClear')){
    resetSearch();
    const input=document.getElementById('numSearchInput');
    if(input) input.focus();
    return;
  }

  const row=e.target.closest('#fixBody tr');
  if(row&&row.dataset.i!==undefined){focusNumber(row.dataset.i);return;}
});

mainBody.addEventListener('keydown',e=>{
  if(e.target.id==='numSearchInput'){
    if(e.key==='Enter'){e.preventDefault();stepSearch(e.shiftKey?-1:1);}
    else if(e.key==='Escape'){e.preventDefault();resetSearch();}
    return;
  }
  const span=e.target.closest&&e.target.closest('.num-highlight');
  if(span&&(e.key==='Enter'||e.key===' ')){e.preventDefault();cycleState(span);}
});

mainBody.addEventListener('input',e=>{
  if(e.target.id==='numSearchInput') runSearch();
});

mainBody.addEventListener('mouseover',e=>{
  const span=e.target.closest('.num-highlight');
  if(span){showTooltip(span);positionTooltip(e);}
});
mainBody.addEventListener('mousemove',e=>{
  const span=e.target.closest('.num-highlight');
  if(span){ if(tip.hidden) showTooltip(span); positionTooltip(e); }
  else if(!tip.hidden) hideTooltip();
});
mainBody.addEventListener('mouseout',e=>{
  if(e.target.closest('.num-highlight')) hideTooltip();
});
mainBody.addEventListener('focusin',e=>{
  const span=e.target.closest&&e.target.closest('.num-highlight');
  if(span){
    showTooltip(span);
    const r=span.getBoundingClientRect();
    positionTooltip({clientX:r.left,clientY:r.bottom});
  }
});
mainBody.addEventListener('focusout',e=>{
  if(e.target.closest&&e.target.closest('.num-highlight')) hideTooltip();
});
mainBody.addEventListener('scroll',()=>{ if(!tip.hidden) hideTooltip(); },true);

mainBody.addEventListener('change',e=>{
  if(e.target.id==='anchorOnly'){toggleAnchorOnly(e.target.checked);return;}
  if(e.target.id==='rangeMin'||e.target.id==='rangeMax'){readRange();return;}
});

/* ==========================================================
   RUN — scan, then hand over to review
   ========================================================== */
runBtn.addEventListener('click',async()=>{
  runBtn.disabled=true;
  runBtnText.textContent='Scanning...';
  const spinIcon=runBtn.querySelector('svg,i');
  if(spinIcon) spinIcon.classList.add('spin');
  showSkeletons();
  showProgress('Mapping anchors');
  saveBtn.disabled=true;
  copyBtn.disabled=true;
  applied=false;
  fixedContent='';
  hideTooltip();
  try{
    const anchorMap=await buildAnchorMap((done,total,fname)=>{
      setProgress(done,total,`${done}/${total} · ${fname}`);
    });
    setProgress(1,1,'Detecting numbers');
    srcContent=await readFile(fileHandle);
    candidates=collectCandidates(srcContent,anchorMap);
    applyAutoRules();
    hideProgress();

    summaryBar.hidden=false;
    updateStats(true);
    renderResults();

    const {sel,noAnchor,total}=counts();
    toast(`${total.toLocaleString()} number(s) found — ${sel.toLocaleString()} ready to link`+
          (noAnchor?`, ${noAnchor.toLocaleString()} without an anchor`:'')+
          '. Review, then Apply Selected.','success',4200);

  }catch(e){
    hideProgress();
    console.error(e);
    toast('Error: '+e.message,'error');
    summaryBar.hidden=true;
    mainBody.innerHTML=`
      <div class="empty-state is-error">
        <span class="empty-icon"><i data-lucide="alert-triangle"></i></span>
        <h2>Scan failed</h2>
        <p>${esc(e.message)}</p>
      </div>`;
    icons();
  }
  const doneIcon=runBtn.querySelector('svg,i');
  if(doneIcon) doneIcon.classList.remove('spin');
  runBtnText.textContent='Scan & Fix';
  checkReady();
});

/* ==========================================================
   SAVE / COPY — only ever write the applied output
   ========================================================== */
saveBtn.addEventListener('click',async()=>{
  if(!fileHandle||!applied){toast('Click "Apply Selected" first','error');return;}
  try{
    const writable=await fileHandle.createWritable();
    await writable.write(fixedContent);
    await writable.close();
    toast(`Saved: ${fileHandle.name}`,'success');
  }catch(e){toast('Save error: '+e.message,'error');}
});

copyBtn.addEventListener('click',()=>{
  if(!applied){toast('Click "Apply Selected" first','error');return;}
  navigator.clipboard.writeText(fixedContent)
    .then(()=>toast('Copied to clipboard','success'))
    .catch(e=>toast('Copy failed: '+e.message,'error'));
});

/* ==========================================================
   TAB SWITCHER
   ========================================================== */
const tabPane1=document.getElementById('tabPane1');

function setTab(){
  tabPane1.hidden=false;
}
setTab();
