export const ADMIN_OPS_SCRIPT = String.raw`
function fmtBytes(n){
  const v=Number(n)||0;
  const kb=1024,mb=kb*1024,gb=mb*1024;
  if(v>=gb)return (v/gb).toFixed(3)+' GB';
  if(v>=mb)return (v/mb).toFixed(2)+' MB';
  if(v>=kb)return (v/kb).toFixed(1)+' KB';
  return v+' B';
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
    tr.innerHTML=''
      +'<td class="mono ops-id" title="'+escHtml(String(x.id||''))+'">'+escHtml(String(x.id||''))+'</td>'
      +'<td class="mono">'+escHtml(formatAdminTime(x.createdAt))+'</td>'
      +'<td><div class="ops-path" title="'+escHtml(String(key))+'">'+escHtml(String(key))+'</div></td>'
      +'<td><div class="ops-actions"><button class="btn ghost mini" type="button" data-copy="'+escHtml(String(x.id||''))+'">Copy ID</button><button class="btn ghost mini" type="button" data-copy="'+escHtml(String(key))+'">Copy Path</button></div></td>';
    rows.appendChild(tr);
  }
  rows.querySelectorAll('button[data-copy]').forEach((btn)=>{btn.onclick=async()=>{try{await navigator.clipboard.writeText(btn.dataset.copy||'');toast('Copied');}catch(e){toast('Copy failed');}};});
}
async function opsListBackups(opts){const quiet=!!(opts&&opts.quiet);busy('opsListBtn',true);try{const r=await api('/admin/ops/backups?limit=10');if(r.res.status!==200||!r.json){if(!quiet)status('opsStatus','List backups failed ('+r.res.status+'). Owner role may be required.','err');return false;}const items=Array.isArray(r.json.items)?r.json.items:[];state.backupsAutoLoaded=true;renderOpsBackups(items);renderOpsStorageSummary(r.json.storageUsage||null);$('opsSummary').textContent='Backups: '+items.length+' latest snapshot(s).';if(!quiet)status('opsStatus','Backup list refreshed.','ok');return true;}finally{busy('opsListBtn',false);}}
async function opsRunBackup(){busy('opsRunBtn',true);try{const r=await api('/admin/ops/backups/run',{method:'POST',body:'{}'});if(r.res.status!==201||!r.json){status('opsStatus','Run backup failed ('+r.res.status+'). Owner role may be required.','err');return;}status('opsStatus','Backup created: '+r.json.backup.id,'ok');toast('Backup snapshot created');}finally{busy('opsRunBtn',false);}}
async function login(){busy('loginBtn',true);try{const r=await api('/admin/auth/login',{method:'POST',body:JSON.stringify({username:$('username').value.trim(),password:$('password').value})});if(r.res.status!==200||!r.json){status('authStatus','Login failed ('+r.res.status+').','err');return;}state.user=r.json.user;setAuthUi(true);status('authStatus','Login successful.','ok');toast('Signed in');await loadAll();await loadHealthOverview({quiet:true});}finally{busy('loginBtn',false);}}
async function logout(){await api('/admin/auth/logout',{method:'POST',body:'{}'});state.user=null;setAuthUi(false);status('authStatus','Signed out.','ok');toast('Signed out');}
`;
