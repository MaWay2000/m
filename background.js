
const API=(typeof browser!=='undefined')?browser:chrome;
const DEFAULTS={strictOrder:true,showTimeline:true,debugLogs:false,openTaskEnabled:true,openTaskDelaySec:1,openTaskSound:true,openTaskNewWindow:true,openTaskFocus:true,openTaskUseHistory:true,openTaskOnlyJustNow:true,createEnabled:true,createDelaySec:1,createSound:true,viewEnabled:true,viewDelaySec:1,viewSound:true,viewCloseEnabled:false,viewCloseDelaySec:2,mergeEnabled:false,mergeDelaySec:3,mergeSound:true,mergeCloseEnabled:false,mergeCloseDelaySec:2,confirmEnabled:false,confirmDelaySec:3,confirmSound:true,approvedMergeUrls:[],seenTaskIds:[],currentTaskId:null,currentFlow:'idle',taskHistory:{},taskFlows:{},dismissedTaskIds:[]};
const APPROVAL_TTL_MS=600000; const now=()=>Date.now();
const getAll=()=>new Promise(r=>{try{API.storage.local.get(DEFAULTS,r);}catch(e){r({...DEFAULTS});}});
const setObj=(o)=>new Promise(r=>API.storage.local.set(o,()=>r(true)));
API.runtime.onMessage.addListener((m,s,reply)=>{
  if(!m||!m.type) return;
  const ok=(x={})=>reply&&reply({ok:true, ...x});
  if(m.type==='GET_SETTINGS') return getAll().then(c=>ok({settings:c})), true;
  if(m.type==='RESET_FLOW') return setObj({approvedMergeUrls:[],currentTaskId:null,currentFlow:'idle',taskFlows:{},dismissedTaskIds:[]}).then(ok), true;
  if(m.type==='GET_SHARED_FLOW'){
    const {taskId,url}=m;
    return getAll().then(c=>{
      const flows=c.taskFlows||{};
      const dismissed=new Set(c.dismissedTaskIds||[]);
      let record=null;
      if(taskId && flows[taskId]) record=flows[taskId];
      if(!record && url){
        const entries=Object.values(flows);
        record=entries.find(r=>{
          const list=Array.isArray(r.urls)?r.urls:[];
          return list.some(u=>url.startsWith(u));
        })||null;
      }
      if(!record){
        if(taskId && dismissed.has(taskId)) return ok({taskId:null,flow:'idle',steps:{},dismissedTaskId:taskId});
        return ok({taskId:taskId||null,flow:'idle',steps:{}});
      }
      dismissed.delete(record.taskId);
      return ok({taskId:record.taskId||taskId||null,flow:record.flow||'idle',title:record.title||'',steps:record.steps||{}});
    }), true;
  }
  if(m.type==='SET_SHARED_FLOW'){
    const {taskId,flow,title,step,url}=m;
    if(!taskId) return ok({error:'missingTask'});
    return getAll().then(c=>{
      const flows={...(c.taskFlows||{})};
      const record={taskId,flow:flow||'idle',title:title||'',steps:{},urls:[],...(flows[taskId]||{})};
      record.flow=flow||record.flow||'idle';
      if(title) record.title=title;
      if(step) record.steps={...(record.steps||{}),[step]:true};
      if(url){
        const list=new Set(Array.isArray(record.urls)?record.urls:[]);
        list.add(url);
        record.urls=[...list];
      }
      record.updatedAt=now();
      flows[taskId]=record;
      const history={...(c.taskHistory||{})};
      const hist=history[taskId]||{title:record.title||'',steps:{},firstTs:now(),lastTs:now()};
      hist.title=hist.title||record.title||'';
      if(step) hist.steps={...(hist.steps||{}),[step]:true};
      hist.lastTs=now();
      history[taskId]=hist;
      const dismissed=new Set(c.dismissedTaskIds||[]);
      if(record.flow && record.flow!=='idle') dismissed.delete(taskId);
      return setObj({currentTaskId:taskId,currentFlow:record.flow,taskHistory:history,taskFlows:flows,dismissedTaskIds:[...dismissed]}).then(ok);
    }), true;
  }
  if(m.type==='GET_TASK_HISTORY') return getAll().then(c=>ok({history:c.taskHistory||{}})), true;
  if(m.type==='CLEAR_TASK_HISTORY') return setObj({taskHistory:{}}).then(ok), true;
  if(m.type==='GET_SEEN_TASKS') return getAll().then(c=>ok({seen:c.seenTaskIds||[]})), true;
  if(m.type==='ADD_SEEN_TASK'){const {id}=m; return getAll().then(c=>{const seen=new Set(c.seenTaskIds||[]); if(id) seen.add(id); return setObj({seenTaskIds:[...seen]}).then(ok);}), true;}
  if(m.type==='CLEAR_SEEN_TASKS') return setObj({seenTaskIds:[]}).then(ok), true;
  if(m.type==='ADD_APPROVED_URL'){const {url}=m; return getAll().then(c=>{const list=c.approvedMergeUrls||[];list.push({url,exp:now()+APPROVAL_TTL_MS}); return setObj({approvedMergeUrls:list}).then(ok);}), true;}
  if(m.type==='CHECK_APPROVED_URL'){const {url}=m; return getAll().then(c=>ok({ok:(c.approvedMergeUrls||[]).some(e=>url.startsWith(e.url)&&e.exp>now())})), true;}
  function chime(){try{const a=new (window.AudioContext||window.webkitAudioContext)(),t=a.currentTime;const b=(o,f,d,g=.15)=>{const x=a.createOscillator(),n=a.createGain();x.frequency.value=f;n.gain.value=g;x.connect(n).connect(a.destination);x.start(t+o);n.gain.exponentialRampToValueAtTime(.0001,t+o+d);x.stop(t+o+d+.05)};b(0,880,.18);b(.22,659.25,.22);b(.5,880,.18);b(.72,659.25,.22);}catch(e){}}
  function note(t,m){try{API.notifications.create({type:'basic',iconUrl:'icon48.png',title:t,message:m});}catch(e){}}
  if(m.type==='TASK_READY'){
    const {url,taskId,title}=m;
    return getAll().then(c=>{
      if(c.openTaskSound) chime();
      note('Auto PR','New task — opening…');
      const d=Math.max(1,Math.min(60,Number(c.openTaskDelaySec)||1))*1000;
      setTimeout(()=>{try{API.tabs.create({url,active:!!c.openTaskFocus});}catch(e){}},d);
      const flows={...(c.taskFlows||{})};
      const record={taskId,flow:'taskOpened',title:title||'',steps:{opened:true},urls:[url],updatedAt:now(),...(flows[taskId]||{})};
      record.flow='taskOpened';
      record.title=title||record.title||'';
      record.steps={...(record.steps||{}),opened:true};
      const list=new Set(Array.isArray(record.urls)?record.urls:[]);
      list.add(url);
      record.urls=[...list];
      record.updatedAt=now();
      flows[taskId]=record;
      const history={...(c.taskHistory||{})};
      history[taskId]={title:record.title||'',steps:{...(record.steps||{})},firstTs:history[taskId]?history[taskId].firstTs:now(),lastTs:now()};
      const dismissed=new Set(c.dismissedTaskIds||[]);
      dismissed.delete(taskId);
      return setObj({currentTaskId:taskId,currentFlow:'taskOpened',taskFlows:flows,taskHistory:history,dismissedTaskIds:[...dismissed]}).then(ok);
    }), true;
  }
  if(m.type==='VIEW_PR_READY'){
    const {url,taskId}=m;
    const tabId=s&&s.tab&&s.tab.id;
    return getAll().then(c=>{
      if(!c.viewEnabled) return ok({skipped:true});
      if(c.viewSound) chime();
      note('Auto PR','“View PR” — opening…');
      const d=Math.max(1,Math.min(60,Number(c.viewDelaySec)||1))*1000;
      setTimeout(()=>{const args={url}; if(s&&s.tab&&typeof s.tab.windowId==='number') args.windowId=s.tab.windowId; try{API.tabs.create(args);}catch(e){}},d);
      API.runtime.sendMessage({type:'ADD_APPROVED_URL',url});
      getAll().then(cc=>{
        const flows={...(cc.taskFlows||{})};
        const id=taskId||cc.currentTaskId;
        if(id){
          const record={taskId:id,steps:{},urls:[],...(flows[id]||{})};
          const list=new Set(Array.isArray(record.urls)?record.urls:[]);
          list.add(url);
          record.urls=[...list];
          flows[id]={...record};
          const history={...(cc.taskHistory||{})};
          const hist=history[id]||{title:record.title||'',steps:{},firstTs:now(),lastTs:now()};
          hist.steps={...(hist.steps||{}),viewed:true};
          hist.lastTs=now();
          history[id]=hist;
          record.flow='viewed';
          record.steps={...(record.steps||{}),viewed:true};
          record.updatedAt=now();
          const dismissed=new Set(cc.dismissedTaskIds||[]);
          dismissed.delete(id);
          setObj({taskFlows:flows,taskHistory:history,currentTaskId:id,currentFlow:'viewed',dismissedTaskIds:[...dismissed]});
        }
      });
      if(c.viewCloseEnabled && typeof tabId==='number'){
        const cd=d+Math.max(1,Math.min(60,Number(c.viewCloseDelaySec)||2))*1000;
        setTimeout(()=>{try{API.tabs.remove(tabId);}catch(e){}},cd);
      }
      ok();
    }), true;
  }
  if(m.type==='PR_READY'){return getAll().then(c=>{ if(c.createSound) chime(); note('Auto PR','“Create PR” — auto-clicking…'); ok();}), true;}
  if(m.type==='MERGE_PR_READY'){
    const {taskId,url}=m;
    const tabId=s&&s.tab&&s.tab.id;
    return getAll().then(c=>{
      if(!c.mergeEnabled) return ok({skipped:true});
      if(c.mergeSound) chime();
      note('Auto PR','“Merge pull request” — auto-clicking…');
      const d=Math.max(1,Math.min(60,Number(c.mergeDelaySec)||3))*1000;
      if(c.mergeCloseEnabled && typeof tabId==='number'){
        const cd=d+Math.max(1,Math.min(60,Number(c.mergeCloseDelaySec)||2))*1000;
        setTimeout(()=>{try{API.tabs.remove(tabId);}catch(e){}},cd);
      }
      reply&&reply({ok:true,delayMs:d});
      getAll().then(cc=>{
        const flows={...(cc.taskFlows||{})};
        const id=taskId||cc.currentTaskId;
        if(!id) return;
        const record={taskId:id,steps:{},urls:[],...(flows[id]||{})};
        if(url){
          const list=new Set(Array.isArray(record.urls)?record.urls:[]);
          list.add(url);
          record.urls=[...list];
        }
        record.flow='merged';
        record.steps={...(record.steps||{}),merged:true};
        record.updatedAt=now();
        flows[id]=record;
        const history={...(cc.taskHistory||{})};
        const hist=history[id]||{title:record.title||'',steps:{},firstTs:now(),lastTs:now()};
        hist.steps={...(hist.steps||{}),merged:true};
        hist.lastTs=now();
        history[id]=hist;
        const dismissed=new Set(cc.dismissedTaskIds||[]);
        dismissed.delete(id);
        setObj({taskFlows:flows,taskHistory:history,currentTaskId:id,currentFlow:'merged',dismissedTaskIds:[...dismissed]});
      });
    }), true;
  }
  if(m.type==='CONFIRM_MERGE_READY'){
    const {taskId,url}=m;
    return getAll().then(c=>{
      if(!c.confirmEnabled) return ok({skipped:true});
      if(c.confirmSound) chime();
      note('Auto PR','“Confirm merge” — auto-clicking…');
      const d=Math.max(1,Math.min(60,Number(c.confirmDelaySec)||3))*1000;
      reply&&reply({ok:true,delayMs:d});
      getAll().then(cc=>{
        const flows={...(cc.taskFlows||{})};
        const id=taskId||cc.currentTaskId;
        if(!id) return;
        const record={taskId:id,steps:{},urls:[],...(flows[id]||{})};
        if(url){
          const list=new Set(Array.isArray(record.urls)?record.urls:[]);
          list.add(url);
          record.urls=[...list];
        }
        record.flow='confirmed';
        record.steps={...(record.steps||{}),confirmed:true};
        record.updatedAt=now();
        flows[id]=record;
        const history={...(cc.taskHistory||{})};
        const hist=history[id]||{title:record.title||'',steps:{},firstTs:now(),lastTs:now()};
        hist.steps={...(hist.steps||{}),confirmed:true};
        hist.lastTs=now();
        history[id]=hist;
        const dismissed=new Set(cc.dismissedTaskIds||[]);
        dismissed.delete(id);
        setObj({taskFlows:flows,taskHistory:history,currentTaskId:id,currentFlow:'confirmed',dismissedTaskIds:[...dismissed]});
      });
    }), true;
  }
  if(m.type==='CLEAR_TASK_FLOW'){
    const {taskId}=m;
    if(!taskId) return ok({error:'missingTask'});
    return getAll().then(c=>{
      const flows={...(c.taskFlows||{})};
      delete flows[taskId];
      const dismissed=new Set(c.dismissedTaskIds||[]);
      dismissed.add(taskId);
      let {currentTaskId,currentFlow}=c;
      if(currentTaskId===taskId){
        currentTaskId=null;
        currentFlow='idle';
      }
      return setObj({taskFlows:flows,currentTaskId,currentFlow,dismissedTaskIds:[...dismissed]}).then(ok);
    }), true;
  }
});
