function normalizeBulkToolsMap(raw){
  const out={};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
  for(const [k,v] of Object.entries(raw)){
    const key=String(k||'').trim().toLowerCase();
    const val=String(v||'').trim();
    if(!key||!val)continue;
    out[key]=val;
  }
  return out;
}

function renderBulkToolsScarabList(){
  const el=$('bulkToolsScarabList');
  if(!el)return;
  const rows=Array.isArray(state.scarabs)?state.scarabs:[];
  if(!rows.length){
    el.textContent='No scarab data loaded.';
    return;
  }
  const names=[...new Set(rows.map((r)=>String((r&&r.name)||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  el.innerHTML=names.map((name)=>'<div>'+escHtml(name)+'</div>').join('');
}

function renderBulkToolsMismatchList(rows){
  const el=$('bulkToolsMismatchList');
  if(!el)return;
  const list=Array.isArray(rows)?rows:[];
  if(!list.length){
    el.textContent='No mismatches logged.';
    return;
  }
  el.innerHTML=list.map((row)=>{
    const rawName=escHtml(String((row&&row.rawName)||'').trim());
    const source=escHtml(String((row&&row.source)||'unknown').trim()||'unknown');
    const qty=Number.isFinite(Number(row&&row.qty))?String(Math.max(0,Number(row.qty)||0)):'-';
    const ts=String((row&&row.timestamp)||'').trim();
    const at=ts?formatAdminTime(ts):'-';
    return '<div>['+escHtml(at)+'] ['+source+'] '+escHtml(qty)+'x '+rawName+'</div>';
  }).join('');
}

async function loadBulkToolsMap(opts){
  const quiet=!!(opts&&opts.quiet);
  busy('bulkToolsLoadBtn',true);
  try{
    const r=await api('/admin/ops/bulk-name-map');
    if(r.res.status!==200||!r.json||!r.json.ok){
      if(!quiet)status('bulkToolsStatus','Failed to load bulk name map: '+formatApiFailure(r.res,r.json,r.text),'err');
      return false;
    }
    const map=normalizeBulkToolsMap(r.json.map||{});
    const input=$('bulkToolsMapInput');
    if(input){
      input.value=Object.keys(map).length?JSON.stringify(map,null,2):'';
    }
    const updatedAt=r.json.updatedAt?String(r.json.updatedAt):null;
    const meta=$('bulkToolsMeta');
    if(meta){
      meta.textContent='Entries '+Object.keys(map).length.toLocaleString()+' | Updated '+(updatedAt?formatAdminTime(updatedAt):'-');
    }
    if(!quiet)status('bulkToolsStatus','Bulk name map loaded.','ok');
    return true;
  }finally{
    busy('bulkToolsLoadBtn',false);
  }
}

async function saveBulkToolsMap(){
  busy('bulkToolsSaveBtn',true);
  try{
    const input=$('bulkToolsMapInput');
    const text=String((input&&input.value)||'').trim();
    let parsed={};
    try{
      parsed=text?JSON.parse(text):{};
    }catch(e){
      status('bulkToolsStatus','Invalid JSON. Please fix formatting first.','err');
      return false;
    }
    const map=normalizeBulkToolsMap(parsed);
    const r=await api('/admin/ops/bulk-name-map',{
      method:'POST',
      body:JSON.stringify({map})
    });
    if(r.res.status!==200||!r.json||!r.json.ok){
      status('bulkToolsStatus','Failed to save bulk name map: '+formatApiFailure(r.res,r.json,r.text),'err');
      return false;
    }
    await loadBulkToolsMap({quiet:true});
    status('bulkToolsStatus','Bulk name map saved.','ok');
    toast('Bulk name map saved');
    return true;
  }finally{
    busy('bulkToolsSaveBtn',false);
  }
}

async function loadBulkToolsMismatchLog(opts){
  const quiet=!!(opts&&opts.quiet);
  busy('bulkToolsMismatchLoadBtn',true);
  try{
    const r=await api('/admin/ops/bulk-mismatch-log');
    if(r.res.status!==200||!r.json||!r.json.ok){
      if(!quiet)status('bulkToolsStatus','Failed to load mismatch log: '+formatApiFailure(r.res,r.json,r.text),'err');
      return false;
    }
    const rows=Array.isArray(r.json.rows)?r.json.rows:[];
    renderBulkToolsMismatchList(rows);
    if(!quiet)status('bulkToolsStatus','Mismatch log loaded ('+rows.length.toLocaleString()+').','ok');
    return true;
  }finally{
    busy('bulkToolsMismatchLoadBtn',false);
  }
}

async function clearBulkToolsMismatchLog(){
  busy('bulkToolsMismatchClearBtn',true);
  try{
    const r=await api('/admin/ops/bulk-mismatch-log',{method:'DELETE'});
    if(r.res.status!==200||!r.json||!r.json.ok){
      status('bulkToolsStatus','Failed to clear mismatch log: '+formatApiFailure(r.res,r.json,r.text),'err');
      return false;
    }
    renderBulkToolsMismatchList([]);
    status('bulkToolsStatus','Mismatch log cleared.','ok');
    toast('Mismatch log cleared');
    return true;
  }finally{
    busy('bulkToolsMismatchClearBtn',false);
  }
}
