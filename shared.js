'use strict';

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
function toast(msg,type='success',ms=3200){
  const toastStack=document.getElementById('toastStack');
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
function applyTheme(dark){
  const html=document.documentElement;
  const themeLabel=document.getElementById('themeLabel');
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

function initSharedTheme(){
  applyTheme(localStorage.getItem('theme')==='dark');
  const themeBtn=document.getElementById('themeToggle');
  themeBtn.addEventListener('click',()=>{
    const dark=document.documentElement.getAttribute('data-theme')!=='dark';
    applyTheme(dark);
    localStorage.setItem('theme',dark?'dark':'light');
  });
}
initSharedTheme();

/* ==========================================================
   FILE / ESCAPING HELPERS
   ========================================================== */
async function readFile(h){return await(await h.getFile()).text();}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
  .replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ==========================================================
   PROGRESS
   ========================================================== */
function showProgress(label){
  const progWrap=document.getElementById('progressWrap'),
        progText=document.getElementById('progressText'),
        progFill=document.getElementById('progressFill'),
        progPct =document.getElementById('progressPct');
  progWrap.hidden=false;
  progText.textContent=label;
  progFill.style.width='0%';
  progPct.textContent='0%';
}
function setProgress(done,total,label){
  const progFill=document.getElementById('progressFill'),
        progText=document.getElementById('progressText'),
        progPct =document.getElementById('progressPct');
  const p=total?Math.round(done/total*100):0;
  progFill.style.width=p+'%';
  progPct.textContent=p+'%';
  if(label) progText.textContent=label;
}
function hideProgress(){
  document.getElementById('progressWrap').hidden=true;
}

/* ==========================================================
   SKELETON
   ========================================================== */
function showSkeletons(summaryBar, mainBody){
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
   MISC
   ========================================================== */
function truncate(str,n){
  return str.length>n ? str.slice(0,n)+'…' : str;
}

const ROMAN_LIST = new Set([
  'i','ii','iii','iv','v','vi','vii','viii','ix','x',
  'xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx',
  'xxi','xxii','xxiii','xxiv','xxv','xxx','xl','l',
  'I','II','III','IV','V','VI','VII','VIII','IX','X',
  'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX',
  'XXI','XXII','XXIII','XXIV','XXV','XXX','XL','L'
]);

/* ==========================================================
   TAB SWITCHER — shared between pagebreak.js and footnote.js
   ========================================================== */
function initTabSwitcher(){
  const tabBtn1=document.getElementById('tabBtn1'),
        tabBtn2=document.getElementById('tabBtn2'),
        tabPane1=document.getElementById('tabPane1'),
        tabPane2=document.getElementById('tabPane2'),
        pbSidebar=document.getElementById('pbSidebar'),
        fnSidebar=document.getElementById('fnSidebar');
  if(!tabBtn1||!tabBtn2) return;

  function setTab(n){
    tabBtn1.classList.toggle('active',n===1);
    tabBtn2.classList.toggle('active',n===2);
    tabPane1.hidden=n!==1;
    tabPane2.hidden=n!==2;
    pbSidebar.hidden=n!==1;
    fnSidebar.hidden=n!==2;
  }
  tabBtn1.addEventListener('click',()=>setTab(1));
  tabBtn2.addEventListener('click',()=>setTab(2));
  setTab(1);
}
initTabSwitcher();
