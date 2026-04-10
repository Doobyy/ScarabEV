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

function failureGuidance(code,context){
  const c=String(code||'').toLowerCase();
  const stage=String((context&&context.stage)||'').toLowerCase();
  if(c==='snapshot_weights_unavailable'){
    return {
      what:'Could not fetch weighted market inputs needed to compute EV.',
      next:'Check aggregate/weights upstream availability, then retry snapshot.'
    };
  }
  if(c==='snapshot_league_incomplete'){
    return {
      what:'Snapshot wrote only part of the required data for this league.',
      next:'System will retry automatically; use manual retry if it remains incomplete.'
    };
  }
  if(c==='snapshot_harmonic_unavailable'){
    return {
      what:'Harmonic EV could not be computed from the current data.',
      next:'Verify scarab market payload quality and retry.'
    };
  }
  if(c==='snapshot_weighted_unavailable'){
    return {
      what:'Weighted EV calculation failed for this attempt.',
      next:'Check weighted inputs and retry snapshot.'
    };
  }
  if(c==='snapshot_atlas_unavailable'){
    return {
      what:'Atlas EV metrics could not be calculated.',
      next:'Validate atlas inputs/config and retry snapshot.'
    };
  }
  if(c==='snapshot_no_scarab_lines'){
    return {
      what:'No scarab market lines were returned by upstream.',
      next:'Wait for upstream market data to recover, then retry.'
    };
  }
  if(c==='snapshot_retry_exhausted'){
    return {
      what:'Automatic retries reached the max attempts for today.',
      next:'Run a manual retry after upstream data is healthy.'
    };
  }
  if(c==='snapshot_retry_state_corrupt'){
    return {
      what:'Retry tracking state was invalid and was reset.',
      next:'Run a manual retry to rebuild a clean retry state.'
    };
  }
  if(c==='snapshot_retry_expired'){
    return {
      what:'Pending retry state was from a previous day and got expired.',
      next:'Expected after date rollover; today will create fresh snapshot state.'
    };
  }
  if(c==='manual_retry_failed'){
    return {
      what:'A manual retry action failed to complete.',
      next:'Inspect error context and rerun the specific retry action.'
    };
  }
  if(c==='snapshot_exception'){
    return {
      what:'Snapshot process hit an unexpected runtime error.',
      next:'Inspect error details in context and retry after fixing root cause.'
    };
  }
  if(stage==='fetch_weights'){
    return {
      what:'Weighted inputs fetch failed during the weights stage.',
      next:'Check aggregate endpoint health and network/service bindings.'
    };
  }
  return {
    what:'The pipeline encountered an error for this step.',
    next:'Use code + context to pinpoint root cause, then retry.'
  };
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
    const rawCtx=(evt&&evt.context&&typeof evt.context==='object')?evt.context:{};
    const guide=failureGuidance((evt&&evt.code)||'',rawCtx);
    const guideWhat=failureEsc(guide.what);
    const guideNext=failureEsc(guide.next);
    let ctx='{}';
    try{ctx=JSON.stringify(rawCtx,null,0);}catch(e){ctx='{}';}
    return '<tr>'
      +'<td class="mono">'+failureEsc(at)+'</td>'
      +'<td class="mono">'+code+'</td>'
      +'<td class="mono">'+src+'</td>'
      +'<td><div>'+msg+'</div><div class="sub">What happened: '+guideWhat+'</div><div class="sub">Next step: '+guideNext+'</div></td>'
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

async function clearFailureLogs(buttonEl){
  if(state.manualRetryBusy)return false;
  const confirmed=window.confirm('Clear failure logs for the last 30 days?');
  if(!confirmed)return false;
  state.manualRetryBusy=true;
  setManualRetryBusy(buttonEl,true,'Clear logs');
  status('failureStatus','Clearing failure logs...','warn');
  try{
    const r=await api('/admin/ops/retry',{
      method:'POST',
      body:JSON.stringify({action:'clear-failure-logs'})
    });
    if(r.res.status!==200||!r.json||!r.json.ok){
      status('failureStatus','Failed to clear logs: '+formatApiFailure(r.res,r.json,r.text),'err');
      return false;
    }
    state.failureLogs=[];
    renderFailureLogs([]);
    const metaEl=$('failureMeta');
    if(metaEl)metaEl.textContent='Window 30d | Events 0';
    status('failureStatus','Failure logs cleared.','ok');
    if(typeof loadHealthOverview==='function'){
      await loadHealthOverview({quiet:true});
    }
    return true;
  }catch(e){
    status('failureStatus','Failed to clear logs: '+formatThrownError(e),'err');
    return false;
  }finally{
    state.manualRetryBusy=false;
    setManualRetryBusy(buttonEl,false,'Clear logs');
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
      status('healthStatus','Manual retry failed: '+formatApiFailure(r.res,r.json,r.text),'err');
      toast((label||target)+' failed');
      return false;
    }
    const took=Math.max(0,Number(r.json.elapsedMs)||0);
    status('healthStatus',(label||target)+' completed in '+took+'ms.','ok');
    toast((label||target)+' completed');
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
