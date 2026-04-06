export const ADMIN_CAPTURE_SCRIPT = String.raw`
const CAPTURE_STORE_KEY='scarabev-admin-capture-queue-v1';

function escHtml(v){return String(v||'').replace(/[&<>"']/g,(ch)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]||ch));}
function nowUtcIso(){return new Date().toISOString();}
function isScarabAdvancedCopy(text){const t=String(text||'').trim();return t.includes('Item Class: Map Fragments')&&t.includes('Scarab');}
function readCaptureQueue(){try{const raw=localStorage.getItem(CAPTURE_STORE_KEY);if(!raw)return[];const parsed=JSON.parse(raw);if(!Array.isArray(parsed))return[];return parsed.filter((x)=>x&&typeof x.raw==='string').map((x)=>({raw:String(x.raw),capturedAt:typeof x.capturedAt==='string'?x.capturedAt:nowUtcIso()}));}catch(e){return[];}}
function writeCaptureQueue(items){try{localStorage.setItem(CAPTURE_STORE_KEY,JSON.stringify(items));}catch(e){}}
function captureQueue(){if(!Array.isArray(state.captureQueue))state.captureQueue=[];return state.captureQueue;}
function updateCaptureStatus(msg,t){status('captureStatus',msg,t);}
function renderCaptureRows(){
  const rows=$('captureRows');
  if(!rows)return;
  const items=captureQueue();
  if(!items.length){
    rows.innerHTML='';
    updateCaptureStatus('Queue is empty.','warn');
    return;
  }
  rows.innerHTML=items.map((item,idx)=>{
    const parsed=parseAdvanced(item.raw);
    const name=parsed.ok?(parsed.parsed.name||'(unnamed)'):'(unparsed)';
    return '<tr><td>'+(idx+1)+'</td><td>'+escHtml(name)+'</td><td>'+escHtml(item.capturedAt||'-')+'</td></tr>';
  }).join('');
  updateCaptureStatus('Queued '+items.length+' scarab capture(s).','ok');
}
function openCaptureModal(){$('captureModalWrap').classList.add('open');renderCaptureRows();}
function closeCaptureModal(){$('captureModalWrap').classList.remove('open');}
async function captureFromClipboard(){
  if(!navigator.clipboard||typeof navigator.clipboard.readText!=='function'){
    updateCaptureStatus('Clipboard read is unavailable in this browser context.','err');
    return;
  }
  busy('captureFromClipboardBtn',true);
  try{
    const text=await navigator.clipboard.readText();
    const raw=String(text||'').trim();
    if(!raw){updateCaptureStatus('Clipboard was empty. Copy a scarab first.','warn');return;}
    if(!isScarabAdvancedCopy(raw)){updateCaptureStatus('Clipboard text is not a scarab advanced copy.','err');return;}
    const items=captureQueue();
    items.push({raw,capturedAt:nowUtcIso()});
    writeCaptureQueue(items);
    renderCaptureRows();
    toast('Captured scarab #'+items.length);
  }catch(e){
    updateCaptureStatus('Clipboard read failed. Allow clipboard permission and try again.','err');
  }finally{
    busy('captureFromClipboardBtn',false);
  }
}
function exportCaptureQueue(){
  const items=captureQueue();
  if(!items.length){updateCaptureStatus('Queue is empty. Nothing to export.','warn');return;}
  const blob=new Blob([JSON.stringify(items,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const stamp=nowUtcIso().replace(/[:]/g,'-').replace(/\..+$/,'');
  a.href=url;
  a.download='scarab-captures-'+stamp+'.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  updateCaptureStatus('Exported '+items.length+' capture(s) to JSON.','ok');
}
async function importCaptureQueue(){
  const items=captureQueue();
  if(!items.length){updateCaptureStatus('Queue is empty. Capture items first.','warn');return;}
  busy('captureImportBtn',true);
  try{
    const raws=items.map((x)=>x.raw);
    await importFromRawItems(raws,'capture queue');
    updateCaptureStatus('Import submitted for '+raws.length+' queued capture(s).','ok');
    closeCaptureModal();
  }finally{
    busy('captureImportBtn',false);
  }
}
function clearCaptureQueue(){
  const items=captureQueue();
  if(!items.length){updateCaptureStatus('Queue already empty.','warn');return;}
  if(!confirm('Reset capture queue? This only clears local browser queue.'))return;
  state.captureQueue=[];
  writeCaptureQueue([]);
  renderCaptureRows();
}
function initCaptureQueue(){state.captureQueue=readCaptureQueue();renderCaptureRows();}
`;
