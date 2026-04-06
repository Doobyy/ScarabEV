export const ADMIN_SCARAB_SCRIPT = String.raw`
function switchScarabSubtab(tab){
  const mode=(tab==='restore'||tab==='tokens')?'restore':(tab==='regex'?'regex':'list');
  const paneList=$('scarabPaneList'),paneRestore=$('scarabPaneRestore'),paneRegex=$('scarabPaneRegex');
  const tabList=$('scarabTabList'),tabRestore=$('scarabTabRestore'),tabRegex=$('scarabTabRegex');
  if(paneList)paneList.classList.toggle('active',mode==='list');
  if(paneRestore)paneRestore.classList.toggle('active',mode==='restore');
  if(paneRegex)paneRegex.classList.toggle('active',mode==='regex');
  if(tabList)tabList.classList.toggle('active',mode==='list');
  if(tabRestore)tabRestore.classList.toggle('active',mode==='restore');
  if(tabRegex)tabRegex.classList.toggle('active',mode==='regex');
}
function sortFiltered(arr){const mode=state.sortBy;const copy=arr.slice();copy.sort((a,b)=>{const an=(a.currentText?.name||'').toLowerCase();const bn=(b.currentText?.name||'').toLowerCase();if(mode==='name_asc')return an.localeCompare(bn)||String(a.id).localeCompare(String(b.id));if(mode==='name_desc')return bn.localeCompare(an)||String(a.id).localeCompare(String(b.id));if(mode==='created_desc')return String(b.createdAt||'').localeCompare(String(a.createdAt||''));if(mode==='created_asc')return String(a.createdAt||'').localeCompare(String(b.createdAt||''));if(mode==='status')return String(a.status).localeCompare(String(b.status))||an.localeCompare(bn);return an.localeCompare(bn);});return copy;}
function selectedTokenForScarab(s){const n=s.currentText?.name||'';return state.draftTokensByScarabId[s.id]||state.tokensByName[n]||'-';}
function computeConflictCount(){const active=state.scarabs.filter((s)=>s.status==='active');const map=new Map();for(const s of active){const token=selectedTokenForScarab(s);if(!token||token==='-')continue;map.set(token,(map.get(token)||0)+1);}let conflicts=0;for(const n of map.values()){if(n>1)conflicts+=1;}return conflicts;}
function updateStats(){const total=state.scarabs.length;const active=state.scarabs.filter((s)=>s.status==='active').length;const retired=state.scarabs.filter((s)=>s.status==='retired').length;const conflicts=computeConflictCount();$('metricTotal').textContent=String(total);$('metricActive').textContent=String(active);$('metricRetired').textContent=String(retired);$('metricConflicts').textContent=String(conflicts);}
function filterScarabs(){const q=($('q').value||'').trim().toLowerCase();const sf=$('sf').value;const base=state.scarabs.filter((s)=>{const n=(s.currentText?.name||'').toLowerCase();const pub=(state.tokensByName[s.currentText?.name||'']||'').toLowerCase();const dr=(state.draftTokensByScarabId[s.id]||'').toLowerCase();return (!q||n.includes(q)||pub.includes(q)||dr.includes(q))&&(sf==='all'||s.status===sf);});state.filtered=sortFiltered(base);renderRows();updateStats();}
function syncSelectAllCheckbox(){const all=state.filtered.map((s)=>s.id);$('selectAll').checked=all.length>0&&all.every((id)=>state.selectedIds.has(id));}
function updateBulkActionButtons(){const has=state.selectedIds.size>0;$('retireSelectedBtn').disabled=!has;$('deleteSelectedBtn').disabled=!has;}
function showBulkProgress(show){const box=$('bulkProgressStatus');if(!box)return;box.classList.toggle('hidden',!show);}
function updateBulkProgress(text,percent){const label=$('bulkProgressText');const bar=$('bulkProgressBar');if(label)label.textContent=text;if(bar&&typeof percent==='number')bar.style.width=String(Math.max(0,Math.min(100,percent)))+'%';}
function sleep(ms){return new Promise((resolve)=>setTimeout(resolve,ms));}
const IMPORT_PACE_MS = 180;
function parseRetryAfterMs(response){
const raw=response?.headers?.get('retry-after');
if(!raw)return null;
const seconds=Number(raw);
if(Number.isFinite(seconds)&&seconds>=0){return Math.round(seconds*1000);}
return null;
}
async function apiWithRetry(path,opt,metaLabel){
const maxAttempts=3;
let last=null;
for(let attempt=1;attempt<=maxAttempts;attempt+=1){
  const result=await api(path,opt);
  last=result;
  const code=result?.res?.status||0;
  const retriable=code===429||code>=500;
  if(!retriable){return result;}
  if(attempt===maxAttempts){return result;}
  const retryAfter=parseRetryAfterMs(result.res);
  const baseDelay=code===429?900:450;
  const delay=retryAfter??Math.min(5000,baseDelay*attempt);
  updateBulkProgress('Retrying '+metaLabel+' (attempt '+(attempt+1)+'/'+maxAttempts+') after '+Math.round(delay/1000)+'s...',null);
  await sleep(delay);
}
return last;
}
function toggleRowSelection(id,checked){if(checked)state.selectedIds.add(id);else state.selectedIds.delete(id);syncSelectAllCheckbox();updateBulkActionButtons();}
function renderRows(){const tb=$('rows');tb.innerHTML='';for(const s of state.filtered){const tr=document.createElement('tr');tr.className='row'+(state.selectedId===s.id?' sel':'');const n=s.currentText?.name||'';const pub=state.tokensByName[n]||'-';const dr=state.draftTokensByScarabId[s.id]||'-';tr.innerHTML='<td><input type="checkbox" data-id="'+s.id+'" '+(state.selectedIds.has(s.id)?'checked':'')+'/></td><td>'+n+'</td><td>'+badge(s.status)+'</td><td><span class="chip">'+pub+'</span></td><td><span class="chip">'+dr+'</span></td>';tr.onclick=(ev)=>{if(ev.target&&ev.target.tagName==='INPUT')return;openEditorById(s.id);};tb.appendChild(tr);}tb.querySelectorAll('input[type="checkbox"]').forEach((cb)=>{cb.onclick=(ev)=>ev.stopPropagation();cb.onchange=(ev)=>toggleRowSelection(cb.dataset.id,ev.target.checked);});syncSelectAllCheckbox();updateBulkActionButtons();status('listStatus','Showing '+state.filtered.length+' scarabs. Selected: '+state.selectedIds.size+'.','ok');}
function openModal(){ $('editorModalWrap').classList.add('open'); }
function closeModal(){ $('editorModalWrap').classList.remove('open'); }
function scarabByName(name){const n=(name||'').trim().toLowerCase();if(!n)return null;return state.scarabs.find((s)=>((s.currentText?.name||'').trim().toLowerCase()===n))||null;}
function fillEditorFromScarab(s){const t=s.currentText||{};$('name').value=t.name||'';$('desc').value=t.description||'';$('mods').value=(t.modifiers||[]).join('\n');$('flavor').value=t.flavorText||'';$('status').value=s.status||'active';$('league').value=s.leagueId||'';$('season').value=s.seasonId||'';$('meta').textContent='ID: '+s.id+' | text revision: '+s.currentTextVersion;$('tokenPreview').textContent=selectedTokenForScarab(s);}
function setEditorMode(){const mode=$('editorMode');const retire=$('retireBtn');const del=$('deleteBtn');if(state.creating||!state.selected){mode.textContent='Create new scarab';retire.disabled=true;del.disabled=true;$('saveBtn').textContent='Create Scarab';}else{mode.textContent='Edit: '+(state.selected.currentText?.name||state.selected.id);retire.disabled=false;del.disabled=false;$('saveBtn').textContent='Save Changes';}}
function openEditorCreate(){state.creating=true;state.selected=null;state.selectedId=null;$('name').value='';$('desc').value='';$('mods').value='';$('flavor').value='';$('status').value='active';$('league').value='';$('season').value='';$('meta').textContent='New scarab (not saved yet).';$('tokenPreview').textContent='-';setEditorMode();openModal();$('name').focus();}
function openEditorById(id){const s=state.scarabs.find((x)=>x.id===id)||null;if(!s)return;state.creating=false;state.selected=s;state.selectedId=id;fillEditorFromScarab(s);setEditorMode();renderRows();openModal();}
function editorPayload(){let season=$('season').value.trim()||null;if(!season&&currentScope().seasonId)season=currentScope().seasonId;return{status:$('status').value,name:$('name').value.trim(),description:$('desc').value.trim()||null,modifiers:modArr($('mods').value),flavorText:$('flavor').value.trim()||null,leagueId:$('league').value.trim()||null,seasonId:season};}
function parseAdvanced(raw){const text=String(raw||'').replace(/\u0000/g,'').trim();if(!text)return{ok:false,error:'No text.'};const lines=text.split(/\r\n|\n|\r/).map((l)=>l.trim());const non=lines.filter(Boolean);if(!non.length)return{ok:false,error:'No text.'};const sections=[];let sec=[];for(const line of lines){if(/^[-]{4,}$/.test(line)){if(sec.length)sections.push(sec);sec=[];continue;}if(line)sec.push(line);}if(sec.length)sections.push(sec);if(!sections.length)return{ok:false,error:'No text.'};const headerIdx=sections.findIndex((s)=>s.some((l)=>/^Item\s*Class\s*:/i.test(l)||/^Rarity\s*:/i.test(l)));const usageIdx=sections.findIndex((s)=>s.some((l)=>/Can be used in a personal Map Device/i.test(l)));const headerSection=headerIdx>=0?sections[headerIdx]:sections[0];const rarityInHeader=headerSection.findIndex((l)=>/^Rarity\s*:/i.test(l));let name=rarityInHeader>=0&&headerSection[rarityInHeader+1]?headerSection[rarityInHeader+1].trim():'';if(!name){const candidates=non.filter((l)=>!/^((Item\s*Class|Rarity|Stack\s*Size|Limit)\s*:|[-]{4,})/i.test(l));name=candidates[0]||'';}if(!name)return{ok:false,error:'Could not parse name.'};const normalize=(section)=>{const m=[];for(const line of section){if(!m.length){m.push(line);continue;}const prev=m[m.length-1];if(/[a-z]$/.test(prev)&&/^[A-Z]/.test(line))m[m.length-1]=prev+' '+line;else m.push(line);}return m;};const description=usageIdx>=0?normalize(sections[usageIdx]).join(' '):null;const flavorIdx=usageIdx>0?usageIdx-1:sections.findIndex((s)=>s.some((l)=>l.includes('...')));const flavor=flavorIdx>=0?normalize(sections[flavorIdx]).join(' '):null;const mods=[];const skip=/^(Item\s*Class:|Rarity:|Stack\s*Size:|Limit:)/i;for(const section of sections){for(const line of normalize(section)){if(!line||skip.test(line)||line===name||line===description||line===flavor)continue;if(/Can be used in a personal Map Device/i.test(line))continue;mods.push(line);}}return{ok:true,parsed:{name,description:description||null,flavorText:flavor||null,modifiers:[...new Set(mods)]}};}
function parseIntoForm(){const p=parseAdvanced($('paste').value);if(!p.ok){status('pasteStatus','Parse failed: '+p.error,'err');return;}$('name').value=p.parsed.name||'';$('desc').value=p.parsed.description||'';$('mods').value=(p.parsed.modifiers||[]).join('\n');$('flavor').value=p.parsed.flavorText||'';const match=scarabByName(p.parsed.name||'');if(match){state.creating=false;state.selected=match;state.selectedId=match.id;fillEditorFromScarab(match);$('name').value=p.parsed.name||'';$('desc').value=p.parsed.description||'';$('mods').value=(p.parsed.modifiers||[]).join('\n');$('flavor').value=p.parsed.flavorText||'';setEditorMode();status('pasteStatus','Parsed and matched existing scarab. Save will update it.','ok');}else{state.creating=true;state.selected=null;state.selectedId=null;setEditorMode();status('pasteStatus','Parsed with no name match. Save will create new scarab.','warn');}}
async function saveEditor(){const p=editorPayload();if(!p.name){status('editStatus','Name required.','err');return;}busy('saveBtn',true);try{if(state.creating||!state.selected){const r=await api('/admin/scarabs',{method:'POST',body:JSON.stringify(p)});if(r.res.status!==201||!r.json){status('editStatus','Create failed ('+r.res.status+').','err');return;}toast('Created');closeModal();}else{const r=await api('/admin/scarabs/'+encodeURIComponent(state.selected.id),{method:'PUT',body:JSON.stringify(p)});if(r.res.status!==200||!r.json){status('editStatus','Update failed ('+r.res.status+').','err');return;}toast('Saved');closeModal();}await loadAll();}finally{busy('saveBtn',false);}}
async function retireCurrent(){if(!state.selected){status('editStatus','Select a scarab first.','warn');return;}busy('retireBtn',true);try{const r=await api('/admin/scarabs/'+encodeURIComponent(state.selected.id)+'/retire',{method:'POST',body:JSON.stringify({retiredLeagueId:$('league').value.trim()||null,retiredSeasonId:$('season').value.trim()||null,retirementNote:'retired via admin ui'})});if(r.res.status!==200){status('editStatus','Retire failed ('+r.res.status+').','err');return;}toast('Retired');closeModal();await loadAll();}finally{busy('retireBtn',false);}}
async function deleteCurrent(){if(!state.selected){status('editStatus','Select a scarab first.','warn');return;}const name=state.selected.currentText?.name||state.selected.id;if(!confirm('Delete scarab "'+name+'"? This cannot be undone.'))return;busy('deleteBtn',true);try{const r=await api('/admin/scarabs/'+encodeURIComponent(state.selected.id),{method:'DELETE'});if(r.res.status!==200){status('editStatus','Delete failed ('+r.res.status+').','err');return;}toast('Deleted');closeModal();await loadAll();}finally{busy('deleteBtn',false);}}
async function bulkRetire(){const ids=[...state.selectedIds];if(!ids.length){toast('Select scarabs first');return;}if(!confirm('Retire '+ids.length+' selected scarab(s)?'))return;busy('retireSelectedBtn',true);showBulkProgress(true);updateBulkProgress('Retiring scarabs... 0 / '+ids.length,0);try{let ok=0,fail=0,processed=0;for(const id of ids){const s=state.scarabs.find((x)=>x.id===id);if(!s||s.status==='retired'){processed+=1;updateBulkProgress('Retiring scarabs... '+processed+' / '+ids.length,Math.round((processed/ids.length)*100));continue;}const r=await api('/admin/scarabs/'+encodeURIComponent(id)+'/retire',{method:'POST',body:JSON.stringify({retiredLeagueId:s.leagueId||null,retiredSeasonId:s.seasonId||null,retirementNote:'bulk retire'})});if(r.res.status===200)ok++;else fail++;processed+=1;updateBulkProgress('Retiring scarabs... '+processed+' / '+ids.length,Math.round((processed/ids.length)*100));}state.selectedIds.clear();await loadAll();const msg='Bulk retire complete. Success: '+ok+' | Failed: '+fail+'.';status('listStatus',msg,fail?'warn':'ok');updateBulkProgress(msg,100);}finally{busy('retireSelectedBtn',false);setTimeout(()=>showBulkProgress(false),2200);}}
async function bulkDelete(){const ids=[...state.selectedIds];if(!ids.length){toast('Select scarabs first');return;}if(!confirm('Delete '+ids.length+' selected scarab(s)? This cannot be undone.'))return;busy('deleteSelectedBtn',true);showBulkProgress(true);updateBulkProgress('Deleting scarabs... 0 / '+ids.length,0);try{let ok=0,fail=0,processed=0;for(const id of ids){const r=await api('/admin/scarabs/'+encodeURIComponent(id),{method:'DELETE'});if(r.res.status===200)ok++;else fail++;processed+=1;updateBulkProgress('Deleting scarabs... '+processed+' / '+ids.length,Math.round((processed/ids.length)*100));}state.selectedIds.clear();await loadAll();const msg='Bulk delete complete. Success: '+ok+' | Failed: '+fail+'.';status('listStatus',msg,fail?'warn':'ok');updateBulkProgress(msg,100);}finally{busy('deleteSelectedBtn',false);setTimeout(()=>showBulkProgress(false),2200);}}
function extractBulkRaws(text){let parsed;try{parsed=JSON.parse(text);}catch(e){return{ok:false,error:'Invalid JSON.'};}if(!Array.isArray(parsed))return{ok:false,error:'JSON must be an array.'};const raws=[];for(const item of parsed){if(typeof item==='string'){raws.push(item);continue;}if(item&&typeof item==='object'){if(typeof item.raw==='string')raws.push(item.raw);else if(typeof item.text==='string')raws.push(item.text);else if(typeof item.advancedCopy==='string')raws.push(item.advancedCopy);}}if(!raws.length)return{ok:false,error:'No raw advanced-copy items found.'};return{ok:true,raws};}
async function importFromJsonFile(file){
if(!file)return;
const text=await file.text();
const ex=extractBulkRaws(text);
if(!ex.ok){status('listStatus','Import failed: '+ex.error,'err');return;}
await importFromRawItems(ex.raws,'file');
}
async function importFromRawItems(raws,sourceLabel){
if(!Array.isArray(raws)||!raws.length){status('listStatus','Import failed: no scarab entries to import.','err');return;}
busy('importBtn',true);
showBulkProgress(true);
updateBulkProgress('Importing scarabs... 0 / '+raws.length,0);
try{
let created=0,updated=0,failed=0,processed=0;
const failures=[];
const byName=new Map();
for(const s of state.scarabs){const n=(s.currentText?.name||'').trim().toLowerCase();if(n)byName.set(n,s.id);}
for(const raw of raws){
  const p=parseAdvanced(raw);
  if(!p.ok){failed++;processed++;failures.push('[parse] '+p.error);updateBulkProgress('Importing scarabs... '+processed+' / '+raws.length,Math.round((processed/raws.length)*100));continue;}
  const name=(p.parsed.name||'').trim();
  if(!name){failed++;processed++;failures.push('[name] missing name');updateBulkProgress('Importing scarabs... '+processed+' / '+raws.length,Math.round((processed/raws.length)*100));continue;}
  const key=name.toLowerCase();
  const existingId=byName.get(key)||null;
  const sc=currentScope();
  const body={status:'active',name,description:p.parsed.description||null,modifiers:p.parsed.modifiers||[],flavorText:p.parsed.flavorText||null,leagueId:null,seasonId:sc.seasonId||null};
  let r;
  if(existingId){
    r=await apiWithRetry('/admin/scarabs/'+encodeURIComponent(existingId),{method:'PUT',body:JSON.stringify(body)},'update '+name);
    if(r.res.status===200)updated++;else{failed++;failures.push('[update '+name+'] HTTP '+r.res.status);}
  }else{
    r=await apiWithRetry('/admin/scarabs',{method:'POST',body:JSON.stringify(body)},'create '+name);
    if(r.res.status===201){created++;const newId=r.json?.scarab?.id;byName.set(key,newId||('created:'+key));}
    else{failed++;failures.push('[create '+name+'] HTTP '+r.res.status);}
  }
  processed++;
  updateBulkProgress('Importing scarabs... '+processed+' / '+raws.length,Math.round((processed/raws.length)*100));
  await sleep(IMPORT_PACE_MS);
}
await loadAll();
const summary='Import complete ('+sourceLabel+'). Created: '+created+' | Updated: '+updated+' | Failed: '+failed+'.';
if(failed){status('listStatus',summary+'\\n'+failures.slice(0,12).join('\\n')+(failures.length>12?'\\n...':''),
'warn');}
else{status('listStatus',summary,'ok');}
updateBulkProgress(summary,100);
}finally{
busy('importBtn',false);
setTimeout(()=>showBulkProgress(false),2200);
}
}
async function loadScarabs(){const sc=currentScope();const q=['status=draft,active,retired'];if(sc.seasonId)q.push('seasonId='+encodeURIComponent(sc.seasonId));const r=await api('/admin/scarabs?'+q.join('&'));if(r.res.status!==200||!r.json){status('listStatus','Load failed ('+r.res.status+').','err');return;}state.scarabsAutoLoaded=true;state.scarabs=r.json.items||[];const validIds=new Set(state.scarabs.map((s)=>s.id));state.selectedIds=new Set([...state.selectedIds].filter((id)=>validIds.has(id)));filterScarabs();const scopeTxt=sc.seasonId?('workspace "'+sc.seasonId+'"'):'all scarabs';status('listStatus','Loaded '+state.scarabs.length+' scarabs from '+scopeTxt+'.','ok');}
`;
