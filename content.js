
const API=(typeof browser!=='undefined')?browser:chrome;
const DEFAULTS={strictOrder:true,showTimeline:true,debugLogs:false,openTaskEnabled:true,openTaskDelaySec:1,openTaskSound:true,openTaskNewWindow:true,openTaskFocus:true,openTaskUseHistory:true,openTaskOnlyJustNow:true,createEnabled:true,createDelaySec:1,createSound:true,viewEnabled:true,viewDelaySec:1,viewSound:true,viewCloseEnabled:false,viewCloseDelaySec:2,mergeEnabled:false,mergeDelaySec:3,mergeSound:true,mergeCloseEnabled:false,mergeCloseDelaySec:2,confirmEnabled:false,confirmDelaySec:3,confirmSound:true};
const getSettings=()=>new Promise(r=>{try{API.storage.local.get(DEFAULTS,r);}catch(e){r({...DEFAULTS});}});
const sendMessage=(type,p={})=>new Promise(res=>{try{API.runtime.sendMessage({type,...p},res);}catch(e){res({ok:false,error:String(e)});}});
const TEXTS={CREATE:/create\s*pr/i,VIEW:/view\s*pr/i,MERGE:/merge\s*pull\s*request/i,CONFIRM:/confirm\s*merge/i};
const visible=(el)=>{if(!el) return false; const b=el.getBoundingClientRect(), st=getComputedStyle(el); return b.width>0&&b.height>0&&st.visibility!=='hidden'&&st.display!=='none'&&st.opacity!=='0';};
const qsAll=(s,r=document)=>Array.from(r.querySelectorAll(s));
const findFirst=(re)=>qsAll('a,button,summary').find(el=>visible(el)&&re.test((el.innerText||el.textContent||'').trim()));
const parseTaskId=(href)=>{try{const m=(href||'').match(/\/codex\/tasks\/(task_[\w-]+)/i);return m?m[1]:null;}catch(e){return null;}};

let timelineEl=null;
let timelineTaskId=null;
let timelineAnchorEl=null;
let timelineListenersAttached=false;
let timelineUpdateFrame=null;
let timelineDismissedId=null;

const TASK_ROW_SELECTOR='li,[role="listitem"],[data-testid*="task"],article,section,div';

function ensureTimelineElement(){
  if(timelineEl&&document.body.contains(timelineEl)) return timelineEl;
  if(timelineEl&&timelineEl.parentNode) timelineEl.parentNode.removeChild(timelineEl);
  timelineEl=document.createElement('div');
  timelineEl.id='auto-pr-timeline';
  timelineEl.style.cssText='position:fixed;z-index:2147483647;background:#111;color:#fff;padding:6px 8px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.25);font:12px/1.2 system-ui,sans-serif;display:flex;gap:6px;align-items:center;opacity:.94;pointer-events:none;transition:transform .18s ease,opacity .18s ease;cursor:default;';
  const contentWrap=document.createElement('div');
  contentWrap.dataset.role='auto-pr-timeline-content';
  contentWrap.style.cssText='display:flex;gap:6px;align-items:center;pointer-events:auto;';
  timelineEl.appendChild(contentWrap);
  const taskLabel=document.createElement('span');
  taskLabel.dataset.role='auto-pr-task-label';
  taskLabel.style.cssText='font-weight:600;color:#c5f442;margin-right:4px;display:none;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;';
  contentWrap.appendChild(taskLabel);
  const label=document.createElement('span');
  label.textContent='Timeline:';
  label.style.cssText='margin-right:6px;pointer-events:none;';
  contentWrap.appendChild(label);
  const steps=['taskOpened','created','viewed','merged','confirmed'];
  const names={taskOpened:'Task open', created:'Create PR', viewed:'View PR', merged:'Merge PR', confirmed:'Confirm merge'};
  steps.forEach(k=>{
    const pill=document.createElement('span');
    pill.textContent=names[k];
    pill.dataset.step=k;
    pill.style.cssText='padding:5px 8px;border:1px solid #666;border-radius:6px;background:#222;white-space:nowrap;pointer-events:none;';
    contentWrap.appendChild(pill);
  });
  const cancelBtn=document.createElement('button');
  cancelBtn.type='button';
  cancelBtn.textContent='Cancel';
  cancelBtn.title='Stop tracking this task';
  cancelBtn.dataset.role='auto-pr-cancel';
  cancelBtn.style.cssText='margin-left:4px;padding:4px 10px;border-radius:6px;border:1px solid #aa3a3a;background:#2a1111;color:#fbd5d5;font-size:11px;font-weight:600;cursor:pointer;pointer-events:auto;transition:background .2s ease,border-color .2s ease;';
  cancelBtn.addEventListener('mouseenter',()=>{cancelBtn.style.background='#3b1616';cancelBtn.style.borderColor='#c74c4c';});
  cancelBtn.addEventListener('mouseleave',()=>{cancelBtn.style.background='#2a1111';cancelBtn.style.borderColor='#aa3a3a';});
  cancelBtn.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();handleTimelineCancel();});
  contentWrap.appendChild(cancelBtn);
  document.body.appendChild(timelineEl);
  if(!timelineListenersAttached){
    window.addEventListener('scroll',scheduleTimelineUpdate,{passive:true});
    window.addEventListener('resize',scheduleTimelineUpdate,{passive:true});
    timelineListenersAttached=true;
  }
  return timelineEl;
}

function clearTimeline(){
  if(timelineEl&&timelineEl.parentNode) timelineEl.parentNode.removeChild(timelineEl);
  timelineEl=null;
  timelineTaskId=null;
  timelineAnchorEl=null;
}

async function handleTimelineCancel(){
  const currentId=timelineTaskId||(timelineEl&&timelineEl.dataset?timelineEl.dataset.taskId:null)||guessTaskIdFromLocation();
  if(currentId){
    timelineDismissedId=currentId;
    await sendMessage('CLEAR_TASK_FLOW',{taskId:currentId});
  }
  clearTimeline();
}

function findTaskRow(taskId){
  if(!taskId) return null;
  const anchors=qsAll(`a[href*="/codex/tasks/${taskId}"]`).filter(visible);
  for(const a of anchors){
    const row=a.closest(TASK_ROW_SELECTOR);
    if(row) return row;
  }
  if(location.pathname.includes(taskId)){
    const main=document.querySelector('main, [role="main"]');
    if(main) return main;
  }
  return null;
}

function extractTaskTitle(row){
  if(!row) return '';
  const headings=qsAll('h1,h2,h3,strong',row);
  for(const h of headings){
    const text=(h.innerText||h.textContent||'').trim();
    if(text) return text.replace(/\s+/g,' ');
  }
  const anchor=row.querySelector('a[href*="/codex/tasks/"]');
  if(anchor){
    const text=(anchor.innerText||anchor.textContent||'').trim();
    if(text) return text.replace(/\s+/g,' ');
  }
  const text=(row.innerText||row.textContent||'').trim();
  return text?text.replace(/\s+/g,' ').slice(0,160):'';
}

function updateTimelineTaskLabel(row,taskId){
  if(!timelineEl) return;
  const label=timelineEl.querySelector('[data-role="auto-pr-task-label"]');
  if(!label) return;
  if(row){
    const title=extractTaskTitle(row);
    if(title){
      label.textContent=title;
      label.style.display='inline';
      return;
    }
  }
  if(taskId){
    label.textContent=`Task ${taskId}`;
    label.style.display='inline';
  }else{
    label.textContent='';
    label.style.display='none';
  }
}

function applyTimelineFallback(){
  if(!timelineEl) return;
  timelineEl.style.top='';
  timelineEl.style.right='';
  timelineEl.style.bottom='12px';
  timelineEl.style.left='12px';
  timelineEl.style.opacity='0.94';
}

function setTimelineAnchor(row){
  if(!timelineEl) return;
  const same=row&&timelineAnchorEl&&row.isSameNode(timelineAnchorEl);
  if(same) return;
  timelineAnchorEl=row&&document.documentElement.contains(row)?row:null;
  if(timelineAnchorEl){
    timelineEl.style.bottom='';
    timelineEl.style.left='';
    timelineEl.style.right='';
    timelineEl.style.position='fixed';
    updateTimelineTaskLabel(timelineAnchorEl,timelineTaskId);
    scheduleTimelineUpdate();
  }else{
    updateTimelineTaskLabel(null,timelineTaskId);
    applyTimelineFallback();
  }
}

function scheduleTimelineUpdate(){
  if(!timelineEl) return;
  if(timelineUpdateFrame) return;
  timelineUpdateFrame=requestAnimationFrame(()=>{
    timelineUpdateFrame=null;
    positionTimeline();
  });
}

function positionTimeline(){
  if(!timelineEl) return;
  if(timelineAnchorEl&&!document.documentElement.contains(timelineAnchorEl)){
    timelineAnchorEl=null;
  }
  if(!timelineAnchorEl && timelineTaskId){
    setTimelineAnchor(findTaskRow(timelineTaskId));
  }
  if(!timelineAnchorEl){
    applyTimelineFallback();
    return;
  }
  const rect=timelineAnchorEl.getBoundingClientRect();
  const width=timelineEl.offsetWidth;
  const height=timelineEl.offsetHeight;
  let left=rect.right+16;
  if(left+width>window.innerWidth-12){
    left=Math.max(12,rect.left-width-16);
    if(left+width>window.innerWidth-12) left=window.innerWidth-width-12;
  }
  let top=rect.top;
  if(top<12) top=12;
  if(top+height>window.innerHeight-12) top=Math.max(12,window.innerHeight-height-12);
  timelineEl.style.left=`${Math.round(left)}px`;
  timelineEl.style.top=`${Math.round(top)}px`;
  const outOfView=rect.bottom<0||rect.top>window.innerHeight;
  timelineEl.style.opacity=outOfView?'0.45':'0.94';
}

function mountTimeline(shared,settings){
  const flow=shared&&shared.flow?shared.flow:'idle';
  const taskId=shared&&shared.taskId?shared.taskId:null;
  const effectiveTaskId=taskId||guessTaskIdFromLocation();
  if(shared&&shared.dismissedTaskId) timelineDismissedId=shared.dismissedTaskId;
  if(flow&&flow!=='idle'&&effectiveTaskId&&timelineDismissedId===effectiveTaskId) timelineDismissedId=null;
  if(effectiveTaskId&&timelineDismissedId===effectiveTaskId&&(flow==='idle'||!flow)){
    clearTimeline();
    return;
  }
  const maybeSettings=settings?Promise.resolve(settings):getSettings();
  maybeSettings.then(s=>{
    if(!s.showTimeline){
      clearTimeline();
      return;
    }
    const el=ensureTimelineElement();
    el.dataset.taskId=(taskId||effectiveTaskId||'');
    const stateId=taskId||effectiveTaskId||null;
    if(stateId!==timelineTaskId){
      timelineTaskId=stateId;
      timelineAnchorEl=null;
    }
    setTimelineAnchor(findTaskRow(stateId));
    highlightTimeline(stateId,flow);
  });
}

function highlightTimeline(taskId,flow){
  if(!timelineEl) return;
  if(taskId!==timelineTaskId){
    timelineTaskId=taskId||null;
    setTimelineAnchor(findTaskRow(taskId));
  }
  const effectiveTaskId=taskId||guessTaskIdFromLocation();
  if(flow&&flow!=='idle'&&effectiveTaskId&&timelineDismissedId===effectiveTaskId) timelineDismissedId=null;
  if(effectiveTaskId&&timelineDismissedId===effectiveTaskId&&(flow==='idle'||!flow)){
    clearTimeline();
    return;
  }
  const active=flow||'idle';
  timelineEl.querySelectorAll('span[data-step]').forEach(p=>{
    if(p.dataset.step===active){
      p.style.background='#c5f442';
      p.style.color='#000';
      p.style.borderColor='#9bbd2b';
    }else{
      p.style.background='#222';
      p.style.color='#fff';
      p.style.borderColor='#666';
    }
  });
  if(active==='idle'){
    timelineEl.style.opacity='0.6';
  }else if(!timelineAnchorEl){
    timelineEl.style.opacity='0.94';
  }
  scheduleTimelineUpdate();
}

function guessTaskIdFromLocation(){
  if(location.hostname.includes('chatgpt.com')) return parseTaskId(location.href);
  return null;
}

const getSharedFlow=async(overrides={})=>{
  const payload={...overrides};
  if(!payload.taskId) payload.taskId=guessTaskIdFromLocation();
  if(!payload.taskId) payload.url=payload.url||location.href;
  const r=await sendMessage('GET_SHARED_FLOW',payload);
  return r&&r.ok? r : {taskId:payload.taskId||null, flow:'idle'};
};

const setSharedFlow=async(flow,extra={})=>{
  const payload={flow,...extra};
  if(!payload.taskId) payload.taskId=extra.taskId||guessTaskIdFromLocation();
  if(!payload.taskId){
    const shared=await getSharedFlow({url:location.href});
    if(shared&&shared.taskId) payload.taskId=shared.taskId;
  }
  if(!payload.taskId) return;
  payload.url=payload.url||location.href;
  return sendMessage('SET_SHARED_FLOW',payload);
};

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
  const onHome=isCodexHome();
  const shared=await getSharedFlow();
  if(onHome){
    mountTimeline(shared,s);
    highlightTimeline(shared.taskId,shared.flow);
  }
  if(!s.openTaskEnabled || !onHome) return;
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
  mountTimeline({taskId:id,flow:'taskOpened'},s);
  highlightTimeline(id,'taskOpened');
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
}

async function autoClickCreatePR(){
  const s=await getSettings(); if(!s.createEnabled) return;
  if(!/\/codex\/tasks\//.test(location.pathname)) return;
  const shared=await getSharedFlow();
  const taskId=shared.taskId||guessTaskIdFromLocation();
  if(!taskId) return;
  if(taskId && !shared.taskId) shared.taskId=taskId;
  mountTimeline(shared,s);
  highlightTimeline(taskId,shared.flow);
  if(s.strictOrder && shared.flow!=='taskOpened') return;
  const el=findFirst(TEXTS.CREATE); if(!el || el.dataset._autoPrClicked==='1') return;
  await sendMessage('PR_READY',{taskId}); el.dataset._autoPrClicked='1';
  const d=Math.max(1,Math.min(60,Number(s.createDelaySec)||1))*1000;
  setTimeout(()=>{ try{ el.click(); } catch(e){ try{ el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); }catch(_){} } }, d);
  await setSharedFlow('created',{step:'created',taskId});
  highlightTimeline(taskId,'created');
}

async function handleViewPROpen(){
  const s=await getSettings(); if(!s.viewEnabled) return;
  if(!/\/codex\/tasks\//.test(location.pathname)) return;
  const shared=await getSharedFlow();
  const taskId=shared.taskId||guessTaskIdFromLocation();
  if(!taskId) return;
  if(taskId && !shared.taskId) shared.taskId=taskId;
  mountTimeline(shared,s);
  highlightTimeline(taskId,shared.flow);
  if(s.strictOrder && shared.flow!=='created') return;
  const c=qsAll('a,button,summary').filter(el=>visible(el)&&TEXTS.VIEW.test((el.innerText||el.textContent||'').trim()));
  const link=c.find(el=>el.tagName==='A'&&el.href);
  const btn=c.find(el=>el.tagName!=='A');
  let url=null; if(link&&link.href) url=link.href; else if(btn){const a=btn.closest('a'); if(a&&a.href) url=a.href;}
  if(!url) return;
  const key='_autoPrViewHandled';
  if((link&&link.dataset[key]==='1')||(btn&&btn.dataset[key]==='1')) return;
  if(link) link.dataset[key]='1'; if(btn) btn.dataset[key]='1';
  await sendMessage('VIEW_PR_READY',{url,taskId});
  await setSharedFlow('viewed',{step:'viewed',taskId,url});
  highlightTimeline(taskId,'viewed');
}

async function autoClickMergePR(){
  const s=await getSettings(); if(!s.mergeEnabled) return;
  if(!location.hostname.includes('github.com')) return;
  const shared=await getSharedFlow();
  const taskId=shared.taskId||guessTaskIdFromLocation();
  if(!taskId) return;
  if(taskId && !shared.taskId) shared.taskId=taskId;
  mountTimeline(shared,s);
  highlightTimeline(taskId,shared.flow);
  if(s.strictOrder){ const ok=await sendMessage('CHECK_APPROVED_URL',{url:location.href}); if(!ok||!ok.ok) return; if(shared.flow!=='viewed') return; }
  const el=findFirst(TEXTS.MERGE); if(!el || el.dataset._autoMergeClicked==='1') return;
  const resp=await sendMessage('MERGE_PR_READY',{taskId,url:location.href}); if(resp&&resp.skipped) return;
  el.dataset._autoMergeClicked='1';
  const d=resp&&typeof resp.delayMs==='number'?resp.delayMs:Math.max(1,Math.min(60,Number(s.mergeDelaySec)||3))*1000;
  setTimeout(()=>{ try{ el.click(); } catch(e){ try{ el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); }catch(_){} } }, d);
  await setSharedFlow('merged',{step:'merged',taskId,url:location.href});
  highlightTimeline(taskId,'merged');
}

async function autoClickConfirmMerge(){
  const s=await getSettings(); if(!s.confirmEnabled) return;
  if(!location.hostname.includes('github.com')) return;
  const shared=await getSharedFlow();
  const taskId=shared.taskId||guessTaskIdFromLocation();
  if(!taskId) return;
  if(taskId && !shared.taskId) shared.taskId=taskId;
  mountTimeline(shared,s);
  highlightTimeline(taskId,shared.flow);
  if(s.strictOrder && shared.flow!=='merged') return;
  const el=findFirst(TEXTS.CONFIRM); if(!el || el.dataset._autoConfirmMergeClicked==='1') return;
  const resp=await sendMessage('CONFIRM_MERGE_READY',{taskId,url:location.href}); if(resp&&resp.skipped) return;
  el.dataset._autoConfirmMergeClicked='1';
  const d=resp&&typeof resp.delayMs==='number'?resp.delayMs:Math.max(1,Math.min(60,Number(s.confirmDelaySec)||3))*1000;
  setTimeout(()=>{ try{ el.click(); } catch(e){ try{ el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); }catch(_){} } }, d);
  await setSharedFlow('confirmed',{step:'confirmed',taskId,url:location.href});
  highlightTimeline(taskId,'confirmed');
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
