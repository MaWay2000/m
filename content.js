
const API=(typeof browser!=='undefined')?browser:chrome;
const DEFAULTS={strictOrder:true,showTimeline:true,debugLogs:false,openTaskEnabled:true,openTaskDelaySec:1,openTaskSound:true,openTaskNewWindow:true,openTaskFocus:true,openTaskUseHistory:true,openTaskOnlyJustNow:true,createEnabled:true,createDelaySec:1,createSound:true,viewEnabled:true,viewDelaySec:1,viewSound:true,viewCloseEnabled:false,viewCloseDelaySec:2,mergeEnabled:false,mergeDelaySec:3,mergeSound:true,mergeCloseEnabled:false,mergeCloseDelaySec:2,confirmEnabled:false,confirmDelaySec:3,confirmSound:true};
const getSettings=()=>new Promise(r=>{try{API.storage.local.get(DEFAULTS,r);}catch(e){r({...DEFAULTS});}});
const sendMessage=(type,p={})=>new Promise(res=>{try{API.runtime.sendMessage({type,...p},res);}catch(e){res({ok:false,error:String(e)});}});
const TEXTS={CREATE:/create\s*pr/i,VIEW:/view\s*pr/i,MERGE:/merge\s*pull\s*request/i,CONFIRM:/confirm\s*merge/i};
const visible=(el)=>{if(!el) return false; const b=el.getBoundingClientRect(), st=getComputedStyle(el); return b.width>0&&b.height>0&&st.visibility!=='hidden'&&st.display!=='none'&&st.opacity!=='0';};
const qsAll=(s,r=document)=>Array.from(r.querySelectorAll(s));
const findFirst=(re)=>qsAll('a,button,summary').find(el=>visible(el)&&re.test((el.innerText||el.textContent||'').trim()));
const parseTaskId=(href)=>{try{const m=(href||'').match(/\/codex\/tasks\/(task_[\w-]+)/i);return m?m[1]:null;}catch(e){return null;}};

let tlMounted=false;
function mountTimeline(current){
  if(tlMounted) return;
  getSettings().then(s=>{
    if(!s.showTimeline) return;
    const w=document.createElement('div');
    w.id='auto-pr-timeline';
    w.style.cssText='position:fixed;z-index:2147483647;bottom:12px;left:12px;background:#111;color:#fff;padding:6px 8px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.25);font:12px/1.2 system-ui,sans-serif;display:flex;gap:6px;align-items:center;opacity:.92';
    const label=document.createElement('span'); label.textContent='Time line:'; label.style.marginRight='6px'; w.appendChild(label);
    const steps=['taskOpened','created','viewed','merged','confirmed'];
    const names={taskOpened:'task open', created:'Create PR', viewed:'View PR', merged:'Merge PR', confirmed:'Confirm merge'};
    steps.forEach(k=>{const pill=document.createElement('span'); pill.textContent=names[k]; pill.dataset.step=k; pill.style.cssText='padding:5px 8px;border:1px solid #666;border-radius:6px;background:#222'; w.appendChild(pill);});
    document.body.appendChild(w); tlMounted=true; highlightTimeline(current||'idle');
  });
}
function highlightTimeline(flow){
  const el=document.getElementById('auto-pr-timeline'); if(!el) return;
  el.querySelectorAll('span[data-step]').forEach(p=>{
    if(p.dataset.step===flow){ p.style.background='#c5f442'; p.style.color='#000'; p.style.borderColor='#9bbd2b'; }
    else { p.style.background='#222'; p.style.color='#fff'; p.style.borderColor='#666'; }
  });
}

const getSharedFlow=async()=>{const r=await sendMessage('GET_SHARED_FLOW'); return r&&r.ok? r : {taskId:null, flow:'idle'};};
const setSharedFlow=(flow,extra={})=>sendMessage('SET_SHARED_FLOW',{flow,...extra});

const isCodexHome=()=>location.hostname.includes('chatgpt.com') && location.pathname.startsWith('/codex') && !/\/codex\/tasks\//.test(location.pathname);

function findJustNowAnchorRobust(){
  const anchors=qsAll('a[href*="/codex/tasks/"]');
  for(const a of anchors){
    const row=a.closest('li,[role="listitem"],[data-testid*="task"],article,section,div');
    if(!row) continue;
    const text=(row.innerText||row.textContent||'').trim();
    if(/just\s*now/i.test(text)) return a;
  }
  const labels=qsAll('*').filter(el=>visible(el)&&/just\s*now/i.test((el.innerText||'').trim()));
  for(const lab of labels){
    const row=lab.closest('li,[role="listitem"],[data-testid*="task"],article,section,div');
    if(!row) continue;
    const link=row.querySelector('a[href*="/codex/tasks/"]');
    if(link && visible(link)) return link;
  }
  return null;
}

let pollTimer=null, pollStopAt=0;
function startPoll(){
  if(pollTimer) return;
  pollStopAt=Date.now()+40000;
  pollTimer=setInterval(()=>{
    if(Date.now()>pollStopAt){ clearInterval(pollTimer); pollTimer=null; return; }
    scanOnce(true);
  }, 1200);
}

async function autoOpenTask(){
  const s=await getSettings();
  if(!s.openTaskEnabled || !isCodexHome()) return;
  const shared=await getSharedFlow();
  if(s.strictOrder && shared.flow!=='idle') return;
  const target = s.openTaskOnlyJustNow ? findJustNowAnchorRobust()
                                       : (qsAll('a[href*="/codex/tasks/"]').find(visible) || null);
  if(!target){ startPoll(); return; }
  const href=target.href||target.getAttribute('href'); const id=parseTaskId(href);
  if(s.openTaskUseHistory && id){
    const seen=await sendMessage('GET_SEEN_TASKS');
    const set=new Set((seen&&seen.seen)||[]);
    if(set.has(id)) return;
    await sendMessage('ADD_SEEN_TASK',{id});
  }
  await sendMessage('TASK_READY',{url:href, taskId:id, title:(target.textContent||'').trim()});
  await setSharedFlow('taskOpened',{taskId:id, step:'opened'});
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
}

async function autoClickCreatePR(){
  const s=await getSettings(); if(!s.createEnabled) return;
  if(!/\/codex\/tasks\//.test(location.pathname)) return;
  const shared=await getSharedFlow(); mountTimeline(shared.flow); highlightTimeline(shared.flow);
  if(s.strictOrder && shared.flow!=='taskOpened') return;
  const el=findFirst(TEXTS.CREATE); if(!el || el.dataset._autoPrClicked==='1') return;
  await sendMessage('PR_READY'); el.dataset._autoPrClicked='1';
  const d=Math.max(1,Math.min(60,Number(s.createDelaySec)||1))*1000;
  setTimeout(()=>{ try{ el.click(); } catch(e){ try{ el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); }catch(_){} } }, d);
  await setSharedFlow('created',{step:'created'}); highlightTimeline('created');
}

async function handleViewPROpen(){
  const s=await getSettings(); if(!s.viewEnabled) return;
  if(!/\/codex\/tasks\//.test(location.pathname)) return;
  const shared=await getSharedFlow(); mountTimeline(shared.flow); highlightTimeline(shared.flow);
  if(s.strictOrder && shared.flow!=='created') return;
  const c=qsAll('a,button,summary').filter(el=>visible(el)&&TEXTS.VIEW.test((el.innerText||el.textContent||'').trim()));
  const link=c.find(el=>el.tagName==='A'&&el.href);
  const btn=c.find(el=>el.tagName!=='A');
  let url=null; if(link&&link.href) url=link.href; else if(btn){const a=btn.closest('a'); if(a&&a.href) url=a.href;}
  if(!url) return;
  const key='_autoPrViewHandled';
  if((link&&link.dataset[key]==='1')||(btn&&btn.dataset[key]==='1')) return;
  if(link) link.dataset[key]='1'; if(btn) btn.dataset[key]='1';
  await sendMessage('VIEW_PR_READY',{url}); await setSharedFlow('viewed',{step:'viewed'}); highlightTimeline('viewed');
}

async function autoClickMergePR(){
  const s=await getSettings(); if(!s.mergeEnabled) return;
  if(!location.hostname.includes('github.com')) return;
  const shared=await getSharedFlow(); mountTimeline(shared.flow); highlightTimeline(shared.flow);
  if(s.strictOrder){ const ok=await sendMessage('CHECK_APPROVED_URL',{url:location.href}); if(!ok||!ok.ok) return; if(shared.flow!=='viewed') return; }
  const el=findFirst(TEXTS.MERGE); if(!el || el.dataset._autoMergeClicked==='1') return;
  const resp=await sendMessage('MERGE_PR_READY'); if(resp&&resp.skipped) return;
  el.dataset._autoMergeClicked='1';
  const d=resp&&typeof resp.delayMs==='number'?resp.delayMs:Math.max(1,Math.min(60,Number(s.mergeDelaySec)||3))*1000;
  setTimeout(()=>{ try{ el.click(); } catch(e){ try{ el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); }catch(_){} } }, d);
  await setSharedFlow('merged',{step:'merged'}); highlightTimeline('merged');
}

async function autoClickConfirmMerge(){
  const s=await getSettings(); if(!s.confirmEnabled) return;
  if(!location.hostname.includes('github.com')) return;
  const shared=await getSharedFlow(); mountTimeline(shared.flow); highlightTimeline(shared.flow);
  if(s.strictOrder && shared.flow!=='merged') return;
  const el=findFirst(TEXTS.CONFIRM); if(!el || el.dataset._autoConfirmMergeClicked==='1') return;
  const resp=await sendMessage('CONFIRM_MERGE_READY'); if(resp&&resp.skipped) return;
  el.dataset._autoConfirmMergeClicked='1';
  const d=resp&&typeof resp.delayMs==='number'?resp.delayMs:Math.max(1,Math.min(60,Number(s.confirmDelaySec)||3))*1000;
  setTimeout(()=>{ try{ el.click(); } catch(e){ try{ el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); }catch(_){} } }, d);
  await setSharedFlow('confirmed',{step:'confirmed'}); highlightTimeline('confirmed');
}

function scanOnce(fromPoll=false){ autoOpenTask(); if(!fromPoll){ autoClickCreatePR(); handleViewPROpen(); autoClickMergePR(); autoClickConfirmMerge(); } }
function scan(){ scanOnce(false); }
const obs=new MutationObserver(()=>scan()); obs.observe(document.documentElement||document.body,{childList:true,subtree:true});
(function(){const p=history.pushState, r=history.replaceState;
  history.pushState=function(){const k=p.apply(this,arguments); setTimeout(scan,150); return k;};
  history.replaceState=function(){const k=r.apply(this,arguments); setTimeout(scan,150); return k;};
  window.addEventListener('popstate',()=>setTimeout(scan,150),{passive:true});
})();
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',scan,{once:true,passive:true}); } else { scan(); }
