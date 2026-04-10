const MARKET_WORKER_FALLBACK_URL='https://scarabev-market-worker.paperpandastacks.workers.dev';

function setManualRetryBusy(buttonEl,isBusy,label){
  const btn=(buttonEl&&typeof buttonEl==='object')?buttonEl:null;
  if(!btn)return;
  if(isBusy){
    btn.disabled=true;
    btn.dataset.prevText=btn.textContent||'';
    const lower=String(label||'').toLowerCase();
    btn.textContent=lower.includes('retry')?'Retrying...':'Refreshing...';
    return;
  }
  btn.disabled=false;
  if(btn.dataset.prevText){
    btn.textContent=btn.dataset.prevText;
    delete btn.dataset.prevText;
  }
}

async function fetchFailureLogsDirect(days){
  const safeDays=Math.max(1,Math.min(30,Number(days)||30));
  const res=await fetch(MARKET_WORKER_FALLBACK_URL+'?type=FailureLogs&days='+safeDays,{cache:'no-store'});
  const text=await res.text();
  let json=null;try{json=JSON.parse(text);}catch(e){}
  if(res.status!==200||!json||json.ok!==true||!Array.isArray(json.events)){
    throw new Error(formatApiFailure(res,json,text));
  }
  return {
    days:Math.max(1,Math.min(30,Number(json.days)||safeDays)),
    count:Math.max(0,Number(json.count)||json.events.length),
    events:json.events
  };
}

function failureEsc(v){
  if(typeof escHtml==='function')return escHtml(String(v==null?'':v));
  return String(v==null?'':v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function failureFmtTime(value){
  if(!value)return '-';
  try{return formatAdminTime(value);}catch(e){return String(value);} 
}

function renderFailureLogs(events){
  const rowsEl=$('failureRows');
  if(!rowsEl)return;
  const list=Array.isArray(events)?events:[];
  if(!list.length){
    rowsEl.innerHTML='<tr><td colspan="5" class="sub">No failure events in selected window.</td></tr>';
    return;
  }
  rowsEl.innerHTML=list.map((evt)=>{
    const at=failureFmtTime(evt&&evt.at?evt.at:null);
    const code=failureEsc((evt&&evt.code)||'unknown_error');
    const src=failureEsc((evt&&evt.source)||'market-worker');
    const msg=failureEsc((evt&&evt.message)||'');
    let ctx='{}';
    try{ctx=JSON.stringify((evt&&evt.context&&typeof evt.context==='object')?evt.context:{},null,0);}catch(e){ctx='{}';}
    return '<tr>'
      +'<td class="mono">'+failureEsc(at)+'</td>'
      +'<td class="mono">'+code+'</td>'
      +'<td class="mono">'+src+'</td>'
      +'<td>'+msg+'</td>'
      +'<td class="mono">'+failureEsc(ctx)+'</td>'
      +'</tr>';
  }).join('');
}

async function loadFailureLogs(opts){
  const quiet=!!(opts&&opts.quiet);
  busy('failureRefreshBtn',true);
  try{
    const days=Math.max(1,Math.min(30,Number(($('failureDays')&&$('failureDays').value)||30)||30));
    const r=await api('/admin/ops/failure-logs?days='+days);
    if(r.res.status!==200||!r.json||!r.json.ok){
      const canFallback=r.json&&String(r.json.error||'')==='failure_log_unavailable';
      if(canFallback){
        try{
          const direct=await fetchFailureLogsDirect(days);
          const events=Array.isArray(direct.events)?direct.events:[];
          state.failureLogs=events;
          renderFailureLogs(events);
          state.failureLogsAutoLoaded=true;
          const meta='Window '+direct.days+'d | Events '+events.length.toLocaleString()+' | source direct';
          const metaEl=$('failureMeta');
          if(metaEl)metaEl.textContent=meta;
          status('failureStatus','Failure logs loaded via direct worker fallback at '+formatAdminTime(new Date().toISOString())+'.',events.length?'warn':'ok');
          return true;
        }catch(fallbackError){
          status('failureStatus','Failed to load logs: '+formatThrownError(fallbackError),'err');
          return false;
        }
      }
      const detail=formatApiFailure(r.res,r.json,r.text);
      status('failureStatus','Failed to load logs: '+detail,'err');
      return false;
    }
    const events=Array.isArray(r.json.events)?r.json.events:[];
    state.failureLogs=events;
    renderFailureLogs(events);
    state.failureLogsAutoLoaded=true;
    const meta='Window '+days+'d | Events '+events.length.toLocaleString();
    const metaEl=$('failureMeta');
    if(metaEl)metaEl.textContent=meta;
    status('failureStatus','Failure logs refreshed at '+formatAdminTime(new Date().toISOString())+'.',events.length?'warn':'ok');
    return true;
  }catch(e){
    status('failureStatus','Failed to load logs: '+formatThrownError(e),'err');
    return false;
  }finally{
    busy('failureRefreshBtn',false);
  }
}

async function runManualRetryAction(action,label,buttonEl){
  const target=String(action||'').trim().toLowerCase();
  if(!target)return false;
  if(state.manualRetryBusy)return false;
  state.manualRetryBusy=true;
  setManualRetryBusy(buttonEl,true,label||target);
  status('healthStatus','Running '+(label||target)+'...','warn');
  toast((label||target)+' started');
  try{
    const r=await api('/admin/ops/retry',{
      method:'POST',
      body:JSON.stringify({action:target})
    });
    if(r.res.status!==200||!r.json||!r.json.ok){
      const canFallback=r.json&&String(r.json.error||'')==='manual_retry_unavailable';
      if(canFallback){
        const directRes=await fetch(MARKET_WORKER_FALLBACK_URL+'?type=ManualRetry&action='+encodeURIComponent(target),{cache:'no-store'});
        const directText=await directRes.text();
        let directJson=null;try{directJson=JSON.parse(directText);}catch(e){}
        if(directRes.status!==200||!directJson||directJson.ok!==true){
          status('healthStatus','Manual retry failed: '+formatApiFailure(directRes,directJson,directText),'err');
          toast((label||target)+' failed');
          return false;
        }
        const directTook=Math.max(0,Number(directJson.elapsedMs)||0);
        status('healthStatus',(label||target)+' completed in '+directTook+'ms (direct).','ok');
        toast((label||target)+' completed');
      }else{
        status('healthStatus','Manual retry failed: '+formatApiFailure(r.res,r.json,r.text),'err');
        toast((label||target)+' failed');
        return false;
      }
    }else{
      const took=Math.max(0,Number(r.json.elapsedMs)||0);
      status('healthStatus',(label||target)+' completed in '+took+'ms.','ok');
      toast((label||target)+' completed');
    }
    if(typeof loadHealthOverview==='function'){
      await loadHealthOverview({quiet:true});
    }
    if(state.activePanel==='failures'){
      await loadFailureLogs({quiet:true});
    }
    return true;
  }catch(e){
    status('healthStatus','Manual retry failed: '+formatThrownError(e),'err');
    toast((label||target)+' failed');
    return false;
  }finally{
    state.manualRetryBusy=false;
    setManualRetryBusy(buttonEl,false,label||target);
  }
}
