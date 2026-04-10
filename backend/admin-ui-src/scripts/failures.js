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
