
function fmtBytes(n){
  const v=Number(n)||0;
  const kb=1024,mb=kb*1024,gb=mb*1024;
  if(v>=gb)return (v/gb).toFixed(3)+' GB';
  if(v>=mb)return (v/mb).toFixed(2)+' MB';
  if(v>=kb)return (v/kb).toFixed(1)+' KB';
  return v+' B';
}
function fmtBackupBytes(n){
  const v=Number(n);
  if(!Number.isFinite(v)||v<0)return '-';
  return fmtBytes(v);
}

function renderOpsStorageSummary(storage){
  const el=$('opsStorageSummary');
  if(!el)return;
  if(!storage){
    el.textContent='R2 usage: unavailable (bucket not configured)';
    return;
  }
  const bytes=Number(storage.totalBytes)||0;
  const objects=Number(storage.objectCount)||0;
  const cap=10*1024*1024*1024; // 10GB free-tier reference
  const pct=((bytes/cap)*100);
  const approx=storage.truncated?' (partial scan)':'';
  el.textContent='R2 usage: '+fmtBytes(bytes)+' | Objects: '+objects.toLocaleString()+' | '+pct.toFixed(2)+'% of 10GB'+approx;
}

function renderOpsBackups(items){
  const rows=$('opsRows'); if(!rows)return;
  rows.innerHTML='';
  for(const x of items){
    const tr=document.createElement('tr');
    const key=x.externalKey||'local-only';
    const runType=String(x.triggerType||'-');
    const statusText=String(x.status||'-');
    const quality=(statusText==='ok')?'clean':'failed';
    const sizeTxt=fmtBackupBytes(x.bytes);
    tr.innerHTML=''
      +'<td class="mono ops-id" title="'+escHtml(String(x.id||''))+'">'+escHtml(String(x.id||''))+'</td>'
      +'<td class="mono">'+escHtml(formatAdminTime(x.createdAt))+'</td>'
      +'<td class="mono">'+escHtml(runType+' | '+quality+' | '+statusText)+'</td>'
      +'<td class="mono">'+escHtml(sizeTxt)+'</td>'
      +'<td><div class="ops-path" title="'+escHtml(String(key))+'">'+escHtml(String(key))+'</div></td>'
      +'<td><div class="ops-actions"><button class="btn ghost mini" type="button" data-copy="'+escHtml(String(x.id||''))+'">Copy ID</button><button class="btn ghost mini" type="button" data-copy="'+escHtml(String(key))+'">Copy Path</button></div></td>';
    rows.appendChild(tr);
  }
  rows.querySelectorAll('button[data-copy]').forEach((btn)=>{btn.onclick=async()=>{try{await navigator.clipboard.writeText(btn.dataset.copy||'');toast('Copied');}catch(e){toast('Copy failed');}};});
}
async function opsListBackups(opts){const quiet=!!(opts&&opts.quiet);const showBusy=!quiet;if(showBusy)busy('opsListBtn',true);try{const r=await api('/admin/ops/backups?limit=10');if(r.res.status!==200||!r.json){if(!quiet)status('opsStatus','List backups failed ('+r.res.status+'). Owner role may be required.','err');return null;}const items=Array.isArray(r.json.items)?r.json.items:[];state.backupsAutoLoaded=true;renderOpsBackups(items);renderOpsStorageSummary(r.json.storageUsage||null);$('opsSummary').textContent='Backups: '+items.length+' latest snapshot(s), with per-run status and size.';if(!quiet)status('opsStatus','Backup list refreshed.','ok');return items;}finally{if(showBusy)busy('opsListBtn',false);}}
function collectBackupIds(items){
  const ids=new Set();
  if(Array.isArray(items)){
    for(const x of items){
      const id=String((x&&x.id)||'').trim();
      if(id)ids.add(id);
    }
  }
  return ids;
}
function findConfirmedBackup(items,beforeIds,expectedId){
  if(!Array.isArray(items)||!items.length)return null;
  const target=String(expectedId||'').trim();
  if(target){
    return items.find((x)=>String((x&&x.id)||'').trim()===target)||null;
  }
  for(const x of items){
    const id=String((x&&x.id)||'').trim();
    if(id&&!beforeIds.has(id))return x;
  }
  return null;
}
async function waitForBackupConfirmation(beforeIds,expectedId,timeoutMs){
  const startedAt=Date.now();
  const maxMs=Math.max(10000,Number(timeoutMs)||90000);
  let attempts=0;
  while((Date.now()-startedAt)<maxMs){
    attempts+=1;
    const secs=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
    status('opsStatus','Verifying backup completion... check '+attempts+' ('+secs+'s)','warn');
    const items=await opsListBackups({quiet:true});
    const confirmed=findConfirmedBackup(items,beforeIds,expectedId);
    if(confirmed){
      return confirmed;
    }
    await new Promise((resolve)=>setTimeout(resolve,2000));
  }
  return null;
}
async function opsRunBackup(){
  busy('opsRunBtn',true);
  const runBtn=$('opsRunBtn');
  const prevBtnText=runBtn?String(runBtn.textContent||'Run Backup'):'Run Backup';
  const beforeItems=await opsListBackups({quiet:true});
  const beforeIds=collectBackupIds(beforeItems);
  let expectedId='';
  let responseDetail='';
  status('opsStatus','Submitting backup request...','warn');
  if(runBtn)runBtn.textContent='Submitting...';
  try{
    const r=await api('/admin/ops/backups/run',{method:'POST',body:'{}',timeoutMs:12000});
    if(r.res.status===201&&r.json&&r.json.backup&&r.json.backup.id){
      expectedId=String(r.json.backup.id||'').trim();
    }else if(r.res.status===0){
      responseDetail='request timeout/network';
    }else{
      const detail=(r.json&&r.json.error)?String(r.json.error):String((r.text&&String(r.text).trim())||('http_'+r.res.status));
      responseDetail='request '+r.res.status+' ('+detail+')';
    }
    if(runBtn)runBtn.textContent='Verifying...';
    const confirmed=await waitForBackupConfirmation(beforeIds,expectedId,90000);
    if(confirmed){
      const statusText=String(confirmed.status||'-');
      const base='Backup completed on server: '+String(confirmed.id||'-')+' | '+statusText+' | '+fmtBackupBytes(confirmed.bytes)+'.';
      if(statusText==='ok'){
        status('opsStatus',base,'ok');
        toast('Backup completed');
      }else{
        status('opsStatus',base+' Check run status/details before proceeding.','err');
        toast('Backup completed with issues');
      }
      return;
    }
    if(responseDetail){
      status('opsStatus','Could not confirm new backup within 90s ('+responseDetail+'). Refresh and verify latest row.','warn');
      return;
    }
    status('opsStatus','Backup request accepted but confirmation timed out at 90s. Refresh and verify latest row.','warn');
  }finally{
    if(runBtn)runBtn.textContent=prevBtnText;
    busy('opsRunBtn',false);
  }
}
function syncStagingRefreshVisibility(){
  const wrap=$('stagingRefreshWrap');
  if(!wrap)return;
  wrap.classList.toggle('hidden',String(state.appEnv||'').toLowerCase()!=='staging');
}
async function runStagingRefreshFromProduction(){
  const envName=String(state.appEnv||'').toLowerCase();
  if(envName!=='staging'){
    status('stagingRefreshStatus','This action is available only in staging.','err');
    return;
  }
  const confirmPhrase='REFRESH STAGING FROM PRODUCTION';
  const promptMsg='Type "'+confirmPhrase+'" to confirm.\n\nThis replaces staging data with a copy of production data. Production is not modified.';
  const typed=window.prompt(promptMsg,'');
  if(String(typed||'').trim()!==confirmPhrase){
    status('stagingRefreshStatus','Cancelled. Confirmation phrase did not match.','warn');
    return;
  }
  busy('stagingRefreshBtn',true);
  status('stagingRefreshStatus','started','warn');
  try{
    status('stagingRefreshStatus','copying D1','warn');
    status('opsStatus','copying D1','warn');
    status('stagingRefreshStatus','copying KV','warn');
    status('opsStatus','copying KV','warn');
    const r=await api('/admin/ops/staging-refresh-from-production',{
      method:'POST',
      body:JSON.stringify({confirmText:confirmPhrase}),
      timeoutMs:240000
    });
    if(r.res.status!==200||!r.json||r.json.ok!==true||!r.json.refresh){
      const detail=formatApiFailure(r.res,r.json,r.text);
      status('stagingRefreshStatus','failure: '+detail,'err');
      status('opsStatus','Staging refresh failed: '+detail,'err');
      return;
    }
    const refresh=r.json.refresh||{};
    const d1=refresh.d1||{};
    const kv=refresh.kv||{};
    const summary='success | D1 rows '+String(Number(d1.copiedRows)||0)+' | KV copied '+String(Number(kv.copiedKeys)||0)+' | KV deleted '+String(Number(kv.deletedKeys)||0);
    status('stagingRefreshStatus',summary,'ok');
    status('opsStatus','Staging refresh completed. '+summary,'ok');
    await opsListBackups({quiet:true});
    if(typeof loadHealthOverview==='function')await loadHealthOverview({quiet:true});
  }catch(err){
    const detail=formatThrownError(err);
    status('stagingRefreshStatus','failure: '+detail,'err');
    status('opsStatus','Staging refresh failed: '+detail,'err');
  }finally{
    busy('stagingRefreshBtn',false);
  }
}
async function login(){busy('loginBtn',true);try{const r=await api('/admin/auth/login',{method:'POST',body:JSON.stringify({username:$('username').value.trim(),password:$('password').value})});if(r.res.status!==200||!r.json){status('authStatus','Login failed ('+r.res.status+').','err');return;}state.user=r.json.user;setAuthUi(true);status('authStatus','Login successful.','ok');toast('Signed in');await loadAll();await loadHealthOverview({quiet:true});}finally{busy('loginBtn',false);}}
async function logout(){await api('/admin/auth/logout',{method:'POST',body:'{}'});state.user=null;setAuthUi(false);status('authStatus','Signed out.','ok');toast('Signed out');}
