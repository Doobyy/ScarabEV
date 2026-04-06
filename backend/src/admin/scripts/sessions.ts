export const ADMIN_SESSIONS_SCRIPT = String.raw`
function safeNum(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function signColor(v){const n=safeNum(v);if(n>0)return 'var(--ok)';if(n<0)return 'var(--danger)';return 'var(--muted)';}
function fmtChaosRaw(v){const n=safeNum(v);return Math.round(n).toLocaleString()+'c';}
function fmtRoiPct(input,output){const i=safeNum(input),o=safeNum(output);if(i<=0)return '-';const pct=((o-i)/i)*100;return (pct>=0?'+':'')+pct.toFixed(1)+'%';}
function divFromChaos(chaos,divineRate){const rate=safeNum(divineRate);if(rate<=0)return null;return safeNum(chaos)/rate;}
function fmtDivSignedFromChaos(chaos,divineRate){const d=divFromChaos(chaos,divineRate);if(d===null)return '-';return (d>=0?'+':'')+d.toFixed(2)+' div';}
function escHtml(v){return String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]||m));}
function parseScarabRows(s){try{const rows=JSON.parse(String(s||'[]'));return Array.isArray(rows)?rows:[];}catch(e){return[];}}
function openSessionCfgModal(){$('sessCfgModalWrap').classList.add('open');}
function closeSessionCfgModal(){$('sessCfgModalWrap').classList.remove('open');}
function switchSessionSubtab(tab){
  const mode=(tab==='backups'||tab==='dupes'||tab==='signals')?tab:'sessions';
  const paneSessions=$('sessPaneSessions'),paneBackups=$('sessPaneBackups'),paneDupes=$('sessPaneDupes'),paneSignals=$('sessPaneSignals');
  const tabSessions=$('sessTabSessions'),tabBackups=$('sessTabBackups'),tabDupes=$('sessTabDupes'),tabSignals=$('sessTabSignals');
  if(paneSessions)paneSessions.classList.toggle('active',mode==='sessions');
  if(paneBackups)paneBackups.classList.toggle('active',mode==='backups');
  if(paneDupes)paneDupes.classList.toggle('active',mode==='dupes');
  if(paneSignals)paneSignals.classList.toggle('active',mode==='signals');
  if(tabSessions)tabSessions.classList.toggle('active',mode==='sessions');
  if(tabBackups)tabBackups.classList.toggle('active',mode==='backups');
  if(tabDupes)tabDupes.classList.toggle('active',mode==='dupes');
  if(tabSignals)tabSignals.classList.toggle('active',mode==='signals');
}
function syncSessionPager(total){
  const size=Math.max(1,Number(state.sessionPageSize)||25);
  const pages=Math.max(1,Math.ceil(total/size));
  state.sessionPage=Math.min(Math.max(1,Number(state.sessionPage)||1),pages);
  const start=total?((state.sessionPage-1)*size)+1:0;
  const end=Math.min(total,state.sessionPage*size);
  if($('sessPagerSummary'))$('sessPagerSummary').textContent='Showing '+start+'-'+end+' of '+total.toLocaleString();
  if($('sessPagePrev'))$('sessPagePrev').disabled=state.sessionPage<=1;
  if($('sessPageNext'))$('sessPageNext').disabled=state.sessionPage>=pages;
  return {size,pages,start,end};
}

function loadSessionCfg(){
  try{
    const raw=localStorage.getItem(SESS_CFG_KEY);
    if(!raw)return;
    const parsed=JSON.parse(raw);
    if(parsed&&typeof parsed==='object'){
      state.sessionApiUrl=typeof parsed.apiUrl==='string'?parsed.apiUrl.trim():'';
      state.sessionAdminKey=typeof parsed.adminKey==='string'?parsed.adminKey.trim():'';
    }
  }catch(e){}
}
function saveSessionCfg(){
  state.sessionApiUrl=($('sessApiUrl').value||'').trim();
  state.sessionAdminKey=($('sessAdminKey').value||'').trim();
  try{localStorage.setItem(SESS_CFG_KEY,JSON.stringify({apiUrl:state.sessionApiUrl,adminKey:state.sessionAdminKey}));}catch(e){}
  status('sessStatus','Session manager config saved.','ok');
  closeSessionCfgModal();
}
function hydrateSessionCfgInputs(){
  if($('sessApiUrl'))$('sessApiUrl').value=state.sessionApiUrl||'https://scarabev-api.paperpandastacks.workers.dev/admin/sessions';
  if($('sessAdminKey'))$('sessAdminKey').value=state.sessionAdminKey||'';
}
function sessionApiWithKey(pathSuffix){
  const base=($('sessApiUrl').value||state.sessionApiUrl||'').trim().replace(/\/+$/,'');
  const key=($('sessAdminKey').value||state.sessionAdminKey||'').trim();
  if(!base||!key)return null;
  const sep=pathSuffix.includes('?')?'&':'?';
  return base+pathSuffix+sep+'key='+encodeURIComponent(key);
}
function updateSessionStats(items){
  const total=items.length;
  let consumed=0,trades=0,totalProfitDiv=0,hasDivCount=0;
  for(const s of items){
    const input=safeNum(s.input_value),output=safeNum(s.output_value),profit=output-input;
    consumed+=safeNum(s.total_consumed);
    trades+=safeNum(s.total_trades);
    const d=divFromChaos(profit,s.divine_rate);
    if(d!==null){
      // Sum the same rounded values users see in each row so KPI and table stay aligned.
      totalProfitDiv+=Number(d.toFixed(2));
      hasDivCount+=1;
    }
  }
  $('sessMetricCount').textContent=String(total.toLocaleString());
  $('sessMetricConsumed').textContent=String(Math.round(consumed).toLocaleString());
  $('sessMetricTrades').textContent=String(Math.round(trades).toLocaleString());
  $('sessMetricProfit').textContent=hasDivCount?((totalProfitDiv>=0?'+':'')+totalProfitDiv.toFixed(2)+' div'):'-';
  $('sessMetricProfit').style.color=signColor(totalProfitDiv);
}

function buildSessionDetailHtml(s){
  const input=safeNum(s.input_value),output=safeNum(s.output_value),profit=output-input,rate=safeNum(s.divine_rate);
  const roi=fmtRoiPct(input,output);
  const scarabs=parseScarabRows(s.scarabs_json);
  const vendor=scarabs.filter((x)=>x&&x.was_vendor).sort((a,b)=>safeNum(b.consumed)-safeNum(a.consumed));
  const keeper=scarabs.filter((x)=>x&&!x.was_vendor&&safeNum(x.received)>0).sort((a,b)=>safeNum(b.received)-safeNum(a.received));
  const legacy=scarabs.length>0&&scarabs[0]&&scarabs[0].consumed===undefined;
  const legacyRows=scarabs.filter((x)=>x&&safeNum(x.received)>0).sort((a,b)=>safeNum(b.received)-safeNum(a.received));

  const rowHtml=(name,a,b,c,cColor)=>'<div class="session-scarab-row"><span title="'+escHtml(name)+'">'+escHtml(name)+'</span><span style="text-align:right">'+escHtml(String(a))+'</span><span style="text-align:right">'+escHtml(String(b))+'</span><span style="text-align:right;color:'+escHtml(cColor||'var(--muted)')+';font-weight:700">'+escHtml(String(c))+'</span></div>';
  const vendorBody=vendor.length?vendor.map((r)=>{const net=Math.round(safeNum(r.received)-safeNum(r.consumed));return rowHtml(r.name||'-',Math.round(safeNum(r.consumed)),Math.round(safeNum(r.received)),(net>=0?'+':'')+String(net),signColor(net));}).join(''):'<div class="sub">No vendor rows.</div>';
  const keeperBody=keeper.length?keeper.map((r)=>{const cea=safeNum(r.ninja_price);return rowHtml(r.name||'-','-',Math.round(safeNum(r.received)),cea>0?cea.toFixed(2)+'c':'-',cea>0?signColor(cea):'var(--muted)');}).join(''):'<div class="sub">No keeper rows.</div>';
  const legacyBody=legacyRows.length?legacyRows.map((r)=>rowHtml(r.name||'-','-',Math.round(safeNum(r.received)),'-','var(--muted)')).join(''):'<div class="sub">No scarab rows.</div>';

  return '<div class="session-detail">'
    +'<div class="session-detail-grid">'
      +'<div class="session-detail-card"><div class="lbl">Input</div><div class="val">'+fmtChaosRaw(input)+'</div></div>'
      +'<div class="session-detail-card"><div class="lbl">Output</div><div class="val">'+fmtChaosRaw(output)+'</div></div>'
      +'<div class="session-detail-card"><div class="lbl">Profit</div><div class="val" style="color:'+signColor(profit)+'">'+fmtDivSignedFromChaos(profit,rate)+'</div></div>'
      +'<div class="session-detail-card"><div class="lbl">ROI</div><div class="val" style="color:'+signColor(profit)+'">'+escHtml(roi)+'</div></div>'
    +'</div>'
    +'<div class="session-meta">'
      +'<div><b>Session ID:</b> <span class="mono">'+escHtml(String(s.id||'-'))+'</span></div>'
      +'<div><b>Date:</b> '+escHtml(formatAdminTime(s.created_at))+'</div>'
      +'<div><b>League:</b> '+escHtml(String(s.league||'-'))+'</div>'
      +'<div><b>Regex:</b> <span class="mono">'+escHtml(String(s.regex||'-'))+'</span></div>'
      +'<div><b>Consumed:</b> '+escHtml(String(Math.round(safeNum(s.total_consumed)).toLocaleString()))+'</div>'
      +'<div><b>Trades:</b> '+escHtml(String(Math.round(safeNum(s.total_trades)).toLocaleString()))+'</div>'
      +'<div><b>Divine Rate:</b> '+escHtml(rate>0?rate.toFixed(2)+' c/div':'-')+'</div>'
      +'<div><b>Rows:</b> '+escHtml(String(scarabs.length))+'</div>'
    +'</div>'
    +(legacy
      ?'<div class="session-scarab-box"><div class="session-scarab-head">Scarab Outputs (Legacy)</div>'
        +'<div class="session-scarab-row" style="font-weight:700;color:var(--heading)"><span>Name</span><span style="text-align:right">In</span><span style="text-align:right">Out</span><span style="text-align:right">C/EA</span></div>'
        +legacyBody
      +'</div>'
      :'<div class="session-scarab-split">'
        +'<div class="session-scarab-box"><div class="session-scarab-head">Vendor Scarabs</div>'
          +'<div class="session-scarab-row" style="font-weight:700;color:var(--heading)"><span>Name</span><span style="text-align:right">In</span><span style="text-align:right">Out</span><span style="text-align:right">Net</span></div>'
          +vendorBody
        +'</div>'
        +'<div class="session-scarab-box"><div class="session-scarab-head">Keeper Outputs</div>'
          +'<div class="session-scarab-row" style="font-weight:700;color:var(--heading)"><span>Name</span><span style="text-align:right">In</span><span style="text-align:right">Out</span><span style="text-align:right">C/EA</span></div>'
          +keeperBody
        +'</div>'
      +'</div>')
    +'</div>';
}

function toggleSessionDetail(id){
  const key=String(id||'');
  if(state.sessionExpandedIds.has(key))state.sessionExpandedIds.delete(key);
  else state.sessionExpandedIds.add(key);
  renderSessionRows();
}

function renderSessionRows(){
  const tb=$('sessRows');
  tb.innerHTML='';
  const total=state.sessions.length;
  const pager=syncSessionPager(total);
  const startIdx=(state.sessionPage-1)*pager.size;
  const pageRows=state.sessions.slice(startIdx,startIdx+pager.size);
  for(const s of pageRows){
    const id=String(s.id||'');
    const isOpen=state.sessionExpandedIds.has(id);
    const profit=safeNum(s.output_value)-safeNum(s.input_value);
    const main=document.createElement('tr');
    main.className='row session-main'+(isOpen?' open':'');
    main.innerHTML=''
      +'<td class="mono"><span class="session-main-id"><span class="session-chev'+(isOpen?' open':'')+'">▶</span>'+escHtml(id)+'</span></td>'
      +'<td class="mono">'+escHtml(formatAdminTime(s.created_at))+'</td>'
      +'<td>'+escHtml(String(s.league||'-'))+'</td>'
      +'<td>'+Math.round(safeNum(s.total_consumed)).toLocaleString()+'</td>'
      +'<td>'+Math.round(safeNum(s.total_trades)).toLocaleString()+'</td>'
      +'<td>'+fmtChaosRaw(s.input_value)+'</td>'
      +'<td>'+fmtChaosRaw(s.output_value)+'</td>'
      +'<td style="font-weight:700;color:'+signColor(profit)+'">'+fmtDivSignedFromChaos(profit,s.divine_rate)+'</td>'
      +'<td><button class="btn danger mini" data-sess-id="'+escHtml(id)+'" type="button">Delete</button></td>';
    main.onclick=(ev)=>{if(ev.target&&ev.target.tagName==='BUTTON')return;toggleSessionDetail(id);};
    tb.appendChild(main);

    const detail=document.createElement('tr');
    detail.className='session-detail-row'+(isOpen?'':' hidden');
    detail.innerHTML='<td colspan="9">'+buildSessionDetailHtml(s)+'</td>';
    tb.appendChild(detail);
  }
  tb.querySelectorAll('button[data-sess-id]').forEach((btn)=>{btn.onclick=(ev)=>{ev.stopPropagation();deleteSessionRow(btn.dataset.sessId,btn);};});
}

async function loadSessionsManager(opts){
  const quiet=!!(opts&&opts.quiet);
  const url=sessionApiWithKey('?limit=500');
  if(!url){if(!quiet)status('sessStatus','Set session API URL and admin key first.','warn');return false;}
  busy('sessLoadBtn',true);
  try{
    const r=await fetch(url,{method:'GET'});
    const txt=await r.text();
    if(!r.ok){if(!quiet)status('sessStatus','Load sessions failed ('+r.status+'). '+txt.slice(0,180),'err');return false;}
    let data=null;try{data=JSON.parse(txt);}catch(e){}
    if(!Array.isArray(data)){if(!quiet)status('sessStatus','Unexpected session payload format.','err');return false;}
    state.sessions=data;
    state.sessionPage=1;
    if($('sessPageSize'))$('sessPageSize').value=String(state.sessionPageSize||25);
    state.sessionExpandedIds=new Set();
    state.sessionsAutoLoaded=true;
    updateSessionStats(state.sessions);
    renderSessionRows();
    if(!quiet)status('sessStatus','Loaded '+state.sessions.length+' session(s). Click a row to expand details.','ok');
    return true;
  }catch(e){
    if(!quiet)status('sessStatus','Session fetch error: '+(e&&e.message?e.message:String(e)),'err');
    return false;
  }finally{
    busy('sessLoadBtn',false);
  }
}

async function recomputeAggregate(){
  const base=($('sessApiUrl').value||state.sessionApiUrl||'').trim().replace(/\/admin\/sessions\/?$/,'');
  if(!base){status('sessStatus','Set session API URL first.','warn');return;}
  busy('sessRecomputeBtn',true);
  try{
    const r=await fetch(base+'/api/aggregate?recompute=1');
    if(!r.ok){status('sessStatus','Recompute failed ('+r.status+').','err');return;}
    status('sessStatus','Aggregate recompute triggered.','ok');
  }catch(e){
    status('sessStatus','Recompute error: '+(e&&e.message?e.message:String(e)),'err');
  }finally{
    busy('sessRecomputeBtn',false);
  }
}

async function deleteSessionRow(id,btn){
  if(!id){toast('Missing session id');return;}
  if(!confirm('Delete session '+id+' from aggregated data?'))return;
  const base=($('sessApiUrl').value||state.sessionApiUrl||'').trim().replace(/\/+$/,'');
  const key=($('sessAdminKey').value||state.sessionAdminKey||'').trim();
  if(!base||!key){status('sessStatus','Missing API URL or admin key.','warn');return;}
  btn.disabled=true;const prev=btn.textContent;btn.textContent='Working...';
  try{
    const r=await fetch(base+'/'+encodeURIComponent(id)+'?key='+encodeURIComponent(key),{method:'DELETE'});
    if(!r.ok){status('sessStatus','Delete failed ('+r.status+').','err');return;}
    state.sessions=state.sessions.filter((x)=>String(x.id)!==String(id));
    state.sessionExpandedIds.delete(String(id));
    updateSessionStats(state.sessions);
    renderSessionRows();
    if(typeof refreshSessionIntel==='function')refreshSessionIntel({quiet:true});
    await recomputeAggregate();
    toast('Session deleted');
  }catch(e){
    status('sessStatus','Delete error: '+(e&&e.message?e.message:String(e)),'err');
  }finally{
    btn.disabled=false;btn.textContent=prev;
  }
}
`;
