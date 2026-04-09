
const MARKET_WORKER_URL='https://scarabev-market-worker.paperpandastacks.workers.dev';
const MARKET_HEALTH_CACHE_MS=15000;
const MARKET_WORKER_HEALTHY_AGE_MS=75*60*1000;
const MARKET_WORKER_WARN_AGE_MS=6*60*60*1000;
const POE_PULL_HEALTHY_AGE_MS=10*60*1000;
const POE_PULL_WARN_AGE_MS=30*60*1000;
let marketHealthCacheAt=0;
let marketHealthCache=null;
let marketHealthInFlight=null;
let marketWorkerLastSuccessAt=null;
let poePullLastSuccessAt=null;

function healthBadge(level){
  const cls=level==='ok'?'ok':(level==='warn'?'warn':'danger');
  const label=level==='ok'?'Healthy':(level==='warn'?'Warning':'Issue');
  return '<span class="badge '+cls+'">'+label+'</span>';
}

function normalizeCheckLevel(level){
  if(level==='ok'||level==='warn'||level==='err')return level;
  return 'err';
}

function deriveHealthHints(id,card){
  const detail=String((card&&card.detail)||'');
  const hints=[];
  if(id==='healthWorker'){
    hints.push('Check performed: GET market worker CurrentLeague endpoint.');
    hints.push('Validation: worker response, league presence, cache age/state metadata.');
    if(/stale league cache/i.test(detail)){
      hints.push('League cache can appear stale when refresh cadence is hourly by design.');
      hints.push('If this persists unexpectedly, verify scheduled events and KV write quota headroom.');
    }
  }else if(id==='healthPoeNinja'){
    hints.push('Checks performed: worker Scarab and Currency pulls for current league.');
    hints.push('Validation: response status, cache state, scarab lines, and Divine Orb rate.');
    if(/failed|error|stale/i.test(detail)){
      hints.push('If intermittent: inspect worker logs for upstream fetch timeouts or CORS/client blockers.');
    }
  }else if(id==='healthCloudflare'){
    hints.push('Checks performed: Cloudflare GraphQL account analytics query.');
    hints.push('Validation: today usage for Workers requests and KV operation buckets.');
    hints.push('Limits shown are Free-tier defaults (Workers requests 100k/day, KV writes/lists/deletes 1k/day, KV reads 100k/day).');
  }else{
    hints.push('Check completed via admin health probe.');
    hints.push('Use refresh to rerun and compare latency/status changes.');
  }
  return hints;
}

function extractLastSuccessText(meta){
  const s=String(meta||'');
  const m=s.match(/Last success\s+([^|]+)/i);
  return m&&m[1]?m[1].trim():null;
}

function buildWorkerChecks(card){
  const detail=String((card&&card.detail)||'-');
  const meta=String((card&&card.meta)||'-');
  const t=card&&card.telemetry?card.telemetry:{};
  const lastSuccessText=t.lastSuccessAt?formatAdminTime(t.lastSuccessAt)+' ('+humanAge(msSince(t.lastSuccessAt))+')':'not reported';
  const lastProbeText=t.probedAt?formatAdminTime(t.probedAt):'not reported';
  const rows=[
    {level:normalizeCheckLevel(card&&card.level),label:'Overall result',detail},
    {level:'ok',label:'Task',detail:'Pull current league (`type=CurrentLeague`).'},
    {level:'ok',label:'Configured cadence',detail:'Hourly (minute 10).'},
    {level:'ok',label:'Last successful worker pull',detail:lastSuccessText},
    {level:'ok',label:'Last dashboard probe',detail:lastProbeText},
    {level:/stale/i.test(detail)?'warn':'ok',label:'Freshness window',detail:'Healthy <= 75m, warn <= 6h.'}
  ];
  if(meta&&meta!=='-')rows.push({level:'ok',label:'Telemetry',detail:meta});
  return rows;
}

function buildPoePullChecks(card){
  const detail=String((card&&card.detail)||'-');
  const meta=String((card&&card.meta)||'-');
  const t=card&&card.telemetry?card.telemetry:{};
  const lastScarabSuccess=t.lastScarabSuccessAt?formatAdminTime(t.lastScarabSuccessAt)+' ('+humanAge(msSince(t.lastScarabSuccessAt))+')':'not reported';
  const lastCurrencySuccess=t.lastCurrencySuccessAt?formatAdminTime(t.lastCurrencySuccessAt)+' ('+humanAge(msSince(t.lastCurrencySuccessAt))+')':'not reported';
  const lastProbeText=t.probedAt?formatAdminTime(t.probedAt):'not reported';
  const divineRatio=(typeof t.divineRatio==='number'&&Number.isFinite(t.divineRatio)&&t.divineRatio>0)?(t.divineRatio.toFixed(2)+' chaos'):'not reported';
  const rows=[
    {level:normalizeCheckLevel(card&&card.level),label:'Overall result',detail},
    {level:'ok',label:'Task',detail:'Pull scarab prices (`type=Scarab`).'},
    {level:'ok',label:'Configured cadence',detail:'Every 5 minutes.'},
    {level:'ok',label:'Last successful scarab pull',detail:lastScarabSuccess},
    {level:'ok',label:'Task',detail:'Pull currency prices + Divine:Chaos ratio (`type=Currency`).'},
    {level:'ok',label:'Configured cadence',detail:'Every 5 minutes.'},
    {level:'ok',label:'Last successful currency pull',detail:lastCurrencySuccess},
    {level:'ok',label:'Latest Divine:Chaos ratio',detail:divineRatio},
    {level:'ok',label:'Last dashboard probe',detail:lastProbeText},
    {level:/stale|failed|error/i.test(detail)?'warn':'ok',label:'Freshness window',detail:'Healthy <= 10m, warn <= 30m.'}
  ];
  if(meta&&meta!=='-')rows.push({level:'ok',label:'Telemetry',detail:meta});
  return rows;
}

function buildCloudflareUsageChecks(card){
  const detail=String((card&&card.detail)||'-');
  const usage=(card&&card.usage&&card.usage.metrics)?card.usage.metrics:null;
  const rows=[{level:normalizeCheckLevel(card&&card.level),label:'Overall result',detail}];
  if(!usage)return rows;
  const order=[
    ['workersRequests','Workers requests'],
    ['kvRead','KV reads'],
    ['kvWrite','KV writes'],
    ['kvDelete','KV deletes'],
    ['kvList','KV lists']
  ];
  order.forEach(([key,label])=>{
    const m=usage[key]||null;
    if(!m)return;
    const used=Number(m.used)||0;
    const limit=Number(m.limit)||0;
    const pct=Number(m.percent)||0;
    const remaining=Number(m.remaining)||0;
    const level=pct>=95?'err':(pct>=75?'warn':'ok');
    rows.push({
      level,
      label,
      detail:used.toLocaleString()+' / '+limit.toLocaleString()+' ('+pct.toFixed(1)+'%) | Remaining '+remaining.toLocaleString()
    });
  });
  return rows;
}

function enrichHealthCard(id,title,card){
  const level=normalizeCheckLevel(card&&card.level);
  let checks=Array.isArray(card&&card.checks)&&card.checks.length?card.checks:null;
  if(!checks){
    if(id==='healthWorker')checks=buildWorkerChecks(card);
    else if(id==='healthPoeNinja')checks=buildPoePullChecks(card);
    else if(id==='healthCloudflare')checks=buildCloudflareUsageChecks(card);
    else{
      checks=[];
      checks.push({level,label:'Overall result',detail:String((card&&card.detail)||'-')});
      if(card&&card.meta)checks.push({level:'ok',label:'Telemetry',detail:String(card.meta)});
    }
  }
  const debug=Array.isArray(card&&card.debug)&&card.debug.length?card.debug:deriveHealthHints(id,card);
  return {
    level,
    detail:String((card&&card.detail)||'-'),
    meta:String((card&&card.meta)||'-'),
    telemetry:card&&card.telemetry?card.telemetry:null,
    usage:card&&card.usage?card.usage:null,
    checks,
    debug
  };
}

function renderHealthChecks(checks){
  const rows=Array.isArray(checks)?checks:[];
  if(!rows.length)return '';
  return '<div class="health-checks">'
    +rows.map((c)=>{
      const lv=normalizeCheckLevel(c&&c.level);
      const icon=lv==='ok'?'&#10003;':(lv==='warn'?'!':'&times;');
      return '<div class="health-check health-check-'+lv+'">'
        +'<span class="health-check-icon">'+icon+'</span>'
        +'<span class="health-check-label">'+escHtml(String((c&&c.label)||'Check'))+'</span>'
        +'<span class="health-check-detail">'+escHtml(String((c&&c.detail)||''))+'</span>'
      +'</div>';
    }).join('')
  +'</div>';
}

function renderHealthDebug(debug){
  const lines=Array.isArray(debug)?debug.filter(Boolean):[];
  if(!lines.length)return '';
  return '<div class="health-debug">'
    +lines.map((line)=>'<div class="health-debug-line">'+escHtml(String(line))+'</div>').join('')
  +'</div>';
}

function toggleHealthCard(evt,id){
  if(evt&&typeof evt.stopPropagation==='function')evt.stopPropagation();
  const wrap=$('healthGrid');
  if(!wrap)return;
  const card=wrap.querySelector('#'+id);
  if(!card)return;
  const opened=card.classList.toggle('open');
  state.healthOpenCards=state.healthOpenCards||{};
  state.healthOpenCards[id]=!!opened;
}

function buildDefaultHealthLayout(defaultIds){
  const ids=Array.isArray(defaultIds)?defaultIds.slice():[];
  const col0=[],col1=[],col2=[];
  ids.forEach((id,i)=>{
    const bucket=i%3;
    if(bucket===0)col0.push(id);
    else if(bucket===1)col1.push(id);
    else col2.push(id);
  });
  return [col0,col1,col2];
}

function loadHealthCardLayout(defaultIds){
  const fallback=buildDefaultHealthLayout(defaultIds);
  try{
    const raw=localStorage.getItem(HEALTH_CARD_LAYOUT_KEY);
    if(!raw)return fallback;
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed)||parsed.length!==3)return fallback;
    const allowed={};
    (Array.isArray(defaultIds)?defaultIds:[]).forEach((id)=>{allowed[id]=true;});
    const seen={};
    const cols=[0,1,2].map((i)=>{
      const list=Array.isArray(parsed[i])?parsed[i]:[];
      return list
        .map((v)=>String(v||''))
        .filter((id)=>allowed[id]&&!seen[id]&&(seen[id]=true));
    });
    (Array.isArray(defaultIds)?defaultIds:[]).forEach((id)=>{
      if(!seen[id]){
        let minIndex=0;
        if(cols[1].length<cols[minIndex].length)minIndex=1;
        if(cols[2].length<cols[minIndex].length)minIndex=2;
        cols[minIndex].push(id);
      }
    });
    return cols;
  }catch(e){
    return fallback;
  }
}

function saveHealthCardLayout(layout){
  try{
    localStorage.setItem(HEALTH_CARD_LAYOUT_KEY,JSON.stringify(Array.isArray(layout)?layout:[[],[],[]]));
  }catch(e){}
}

function captureHealthLayoutFromDom(){
  const wrap=$('healthGrid');
  if(!wrap)return null;
  const cols=Array.from(wrap.querySelectorAll('.health-col')).slice(0,3);
  if(!cols.length)return null;
  return cols.map((col)=>Array.from(col.querySelectorAll('.health-card[data-health-id]')).map((el)=>String(el.getAttribute('data-health-id')||'')).filter(Boolean));
}

function clearHealthDragClasses(){
  const wrap=$('healthGrid');
  if(!wrap)return;
  wrap.querySelectorAll('.health-card').forEach((el)=>{
    el.classList.remove('dragging');
    el.classList.remove('drag-over');
  });
}

function clearHealthDragPlaceholder(){
  if(state.healthDragPlaceholder&&state.healthDragPlaceholder.parentNode){
    state.healthDragPlaceholder.parentNode.removeChild(state.healthDragPlaceholder);
  }
  state.healthDragPlaceholder=null;
}

function bindHealthDnD(){
  const wrap=$('healthGrid');
  if(!wrap||wrap.dataset.dndBound==='1')return;
  wrap.dataset.dndBound='1';

  wrap.addEventListener('dragstart',(ev)=>{
    const card=ev.target&&ev.target.closest?ev.target.closest('.health-card'):null;
    if(!card)return;
    const id=String(card.getAttribute('data-health-id')||'');
    if(!id)return;
    state.healthDragId=id;
    card.classList.add('dragging');
    const placeholder=document.createElement('div');
    placeholder.className='health-card drag-placeholder';
    placeholder.style.height=Math.max(48,card.offsetHeight)+'px';
    state.healthDragPlaceholder=placeholder;
    if(card.parentNode)card.parentNode.insertBefore(placeholder,card.nextSibling);
    if(ev.dataTransfer){
      ev.dataTransfer.effectAllowed='move';
      try{ev.dataTransfer.setData('text/plain',id);}catch(e){}
    }
  });

  wrap.addEventListener('dragover',(ev)=>{
    const dragged=state.healthDragId;
    if(!dragged)return;
    ev.preventDefault();
    const card=ev.target&&ev.target.closest?ev.target.closest('.health-card'):null;
    const col=ev.target&&ev.target.closest?ev.target.closest('.health-col'):null;
    const placeholder=state.healthDragPlaceholder;
    if(!placeholder)return;
    clearHealthDragClasses();
    if(card&&card!==placeholder){
      const id=String(card.getAttribute('data-health-id')||'');
      if(id&&id!==dragged){
        card.classList.add('drag-over');
        const rect=card.getBoundingClientRect();
        const before=ev.clientY<rect.top+(rect.height/2);
        if(before&&card.parentNode)card.parentNode.insertBefore(placeholder,card);
        else if(card.parentNode)card.parentNode.insertBefore(placeholder,card.nextSibling);
      }
    }else if(col&&placeholder.parentNode!==col){
      col.appendChild(placeholder);
    }
    const source=wrap.querySelector('.health-card[data-health-id="'+dragged+'"]');
    if(source)source.classList.add('dragging');
  });

  wrap.addEventListener('drop',(ev)=>{
    ev.preventDefault();
    const fromId=String(state.healthDragId||'');
    const placeholder=state.healthDragPlaceholder;
    if(fromId&&placeholder){
      const source=wrap.querySelector('.health-card[data-health-id="'+fromId+'"]');
      if(source&&placeholder.parentNode){
        placeholder.parentNode.insertBefore(source,placeholder);
      }
      const layout=captureHealthLayoutFromDom();
      if(layout){
        state.healthCardLayout=layout;
        saveHealthCardLayout(layout);
      }
      if(state.healthLastResults)renderHealthCards(state.healthLastResults);
    }
    state.healthDragId=null;
    clearHealthDragPlaceholder();
    clearHealthDragClasses();
  });

  wrap.addEventListener('dragend',()=>{
    state.healthDragId=null;
    clearHealthDragPlaceholder();
    clearHealthDragClasses();
  });
}

function healthCard(id,title,level,detail,meta,checks,debug){
  const hasMore=(Array.isArray(checks)&&checks.length)||(Array.isArray(debug)&&debug.length);
  const moreId=id+'-more';
  const isOpen=!!(state.healthOpenCards&&state.healthOpenCards[id]);
  return '<div class="health-card'+(isOpen?' open':'')+'" id="'+id+'" data-health-id="'+id+'" draggable="true">'
    +'<div class="health-head">'
      +'<div class="h">'+title+'</div>'
      +'<div class="health-head-right">'
        +healthBadge(level)
        +(hasMore?'<button class="health-expand-btn" type="button" onclick="toggleHealthCard(event,\''+id+'\')" aria-controls="'+moreId+'" aria-label="Toggle details">&#9656;</button>':'')
      +'</div>'
    +'</div>'
    +'<div class="health-detail">'+escHtml(detail||'-')+'</div>'
    +'<div class="sub mono">'+escHtml(meta||'-')+'</div>'
    +(hasMore?'<div class="health-more" id="'+moreId+'">'+renderHealthChecks(checks)+renderHealthDebug(debug)+'</div>':'')
  +'</div>';
}

function msSince(iso){
  const t=new Date(iso||'').getTime();
  if(!Number.isFinite(t))return null;
  return Date.now()-t;
}

function humanAge(ms){
  if(ms===null)return '-';
  const m=Math.floor(ms/60000);
  if(m<1)return 'just now';
  if(m<60)return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24)return h+'h ago';
  const d=Math.floor(h/24);
  return d+'d ago';
}

function classifyAge(ms,healthyMs,warnMs){
  if(ms===null)return 'err';
  if(ms<=healthyMs)return 'ok';
  if(ms<=warnMs)return 'warn';
  return 'err';
}
function classifyMarketWorkerAge(ms){
  return classifyAge(ms,MARKET_WORKER_HEALTHY_AGE_MS,MARKET_WORKER_WARN_AGE_MS);
}
function classifyPoePullAge(ms){
  return classifyAge(ms,POE_PULL_HEALTHY_AGE_MS,POE_PULL_WARN_AGE_MS);
}

function parseMetaAgeMs(meta){
  if(!meta||typeof meta!=='object')return null;
  const ageSec=Number(meta.ageSeconds);
  if(Number.isFinite(ageSec)&&ageSec>=0)return Math.round(ageSec*1000);
  const lastIso=meta.lastSuccessAt;
  if(lastIso){
    const ms=msSince(lastIso);
    if(ms!==null)return ms;
  }
  return null;
}

function parseMetaState(meta){
  const s=String(meta&&meta.dataState||'').toLowerCase();
  if(s==='live'||s==='stale'||s==='error')return s;
  return null;
}

async function checkHealthBackend(){
  const started=performance.now();
  const r=await api('/admin/healthz');
  const took=Math.round(performance.now()-started);
  if(r.res.status===200&&r.json?.ok){
    return {level:'ok',detail:'Admin API reachable and authenticated.',meta:'Latency '+took+'ms'};
  }
  if(r.res.status===401||r.res.status===403){
    return {level:'warn',detail:'Auth required or session expired for admin checks.',meta:'Status '+r.res.status+' | '+took+'ms'};
  }
  return {level:'err',detail:'Admin API health check failed.',meta:'Status '+r.res.status+' | '+took+'ms'};
}

async function checkHealthPublicTokens(){
  const started=performance.now();
  const r=await api('/public/token-set/latest');
  const took=Math.round(performance.now()-started);
  if(r.res.status===200&&r.json){
    const count=Number(r.json.itemCount)||0;
    const vid=String(r.json.versionId||'-');
    return {level:'ok',detail:'Public token endpoint is serving data.',meta:'Items '+count+' | Version '+vid+' | '+took+'ms'};
  }
  return {level:'err',detail:'Public token endpoint is not healthy.',meta:'Status '+r.res.status+' | '+took+'ms'};
}

async function checkHealthSessionApi(){
  const url=sessionApiWithKey('?limit=1');
  if(!url){
    return {level:'warn',detail:'Session API settings are not configured in this browser.',meta:'Open Session Manager > API Settings'};
  }
  const started=performance.now();
  try{
    const res=await fetch(url,{method:'GET'});
    const took=Math.round(performance.now()-started);
    if(res.ok){
      let data=null;try{data=await res.json();}catch(e){}
      const count=Array.isArray(data)?data.length:0;
      return {level:'ok',detail:'Session API reachable with current key.',meta:'Rows '+count+' | '+took+'ms'};
    }
    return {level:'warn',detail:'Session API returned non-OK response.',meta:'Status '+res.status+' | '+took+'ms'};
  }catch(e){
    return {level:'err',detail:'Session API request failed.',meta:String((e&&e.message)||e||'error')};
  }
}

async function checkHealthBackups(){
  const started=performance.now();
  const r=await api('/admin/ops/backups?limit=1');
  const took=Math.round(performance.now()-started);
  if(r.res.status!==200||!r.json){
    return {level:'warn',detail:'Backup health unavailable (owner-only or API blocked).',meta:'Status '+r.res.status+' | '+took+'ms'};
  }
  const usage=r.json.storageUsage||null;
  const usageTxt=usage?(' | R2 '+((Number(usage.totalBytes)||0)/(1024*1024*1024)).toFixed(3)+' GB'):'';
  const item=(Array.isArray(r.json.items)?r.json.items:[])[0]||null;
  if(!item){
    return {level:'warn',detail:'No backup snapshots found.',meta:'Consider running a backup'+usageTxt};
  }
  const age=humanAge(msSince(item.createdAt));
  const ok=String(item.status||'').toLowerCase()==='ok';
  return {
    level:ok?'ok':'warn',
    detail:ok?'Latest backup snapshot is healthy.':'Latest backup snapshot is not OK.',
    meta:'Last '+formatAdminTime(item.createdAt)+' ('+age+') | Status '+String(item.status||'-')+usageTxt+' | '+took+'ms'
  };
}

async function checkHealthTokenHistory(){
  const started=performance.now();
  const r=await api('/admin/token-sets?limit=1');
  const took=Math.round(performance.now()-started);
  if(r.res.status!==200||!r.json){
    return {level:'warn',detail:'Token history check unavailable.',meta:'Status '+r.res.status+' | '+took+'ms'};
  }
  const first=(Array.isArray(r.json.items)?r.json.items:[])[0]||null;
  if(!first){
    return {level:'warn',detail:'No token sets found yet.',meta:'Generate + publish to create baseline'};
  }
  const st=String(first.state||'-');
  const n=Array.isArray(first.entries)?first.entries.length:0;
  return {level:'ok',detail:'Token set history available.',meta:'Latest '+formatAdminTime(first.createdAt)+' | '+st+' | '+n+' items | '+took+'ms'};
}

async function checkHealthCloudflareUsage(){
  const started=performance.now();
  const r=await api('/admin/ops/cloudflare-usage');
  const took=Math.round(performance.now()-started);
  if(r.res.status!==200||!r.json||!r.json.usage){
    if(r.res.status===503){
      return {
        level:'warn',
        detail:'Cloudflare usage telemetry unavailable (token/account id missing or query failed).',
        meta:'Status '+r.res.status+' | '+took+'ms'
      };
    }
    return {
      level:'warn',
      detail:'Cloudflare usage check unavailable.',
      meta:'Status '+r.res.status+' | '+took+'ms'
    };
  }
  const usage=r.json.usage;
  const metrics=usage&&usage.metrics?usage.metrics:{};
  const kvWrite=metrics.kvWrite||{used:0,limit:1000,percent:0};
  const workers=metrics.workersRequests||{used:0,limit:100000,percent:0};
  const topPct=Math.max(Number(kvWrite.percent)||0,Number(workers.percent)||0);
  const level=topPct>=95?'err':(topPct>=75?'warn':'ok');
  return {
    level,
    detail:'Cloudflare free-tier usage today.',
    meta:'KV writes '+(Number(kvWrite.used)||0).toLocaleString()+'/'+(Number(kvWrite.limit)||0).toLocaleString()
      +' | Workers '+(Number(workers.used)||0).toLocaleString()+'/'+(Number(workers.limit)||0).toLocaleString()
      +' | '+took+'ms',
    usage
  };
}

async function checkHealthMarketWorker(){
  const bundle=await getMarketHealthBundle();
  return bundle.marketWorker;
}

async function checkHealthPoeNinjaPull(){
  const bundle=await getMarketHealthBundle();
  return bundle.poePull;
}

async function getMarketHealthBundle(){
  const now=Date.now();
  const probeIso=new Date(now).toISOString();
  if(marketHealthCache&&((now-marketHealthCacheAt)<MARKET_HEALTH_CACHE_MS)){
    return marketHealthCache;
  }
  if(marketHealthInFlight){
    return marketHealthInFlight;
  }
  marketHealthInFlight=(async()=>{
  const started=performance.now();
  try{
    const res=await fetch(MARKET_WORKER_URL+'?type=CurrentLeague',{cache:'no-store'});
    const took=Math.round(performance.now()-started);
    if(!res.ok){
      const ageMs=marketWorkerLastSuccessAt===null?null:(Date.now()-marketWorkerLastSuccessAt);
      const ageTxt=humanAge(ageMs);
      const ageLevel=classifyMarketWorkerAge(ageMs);
      return {
        marketWorker:{level:ageLevel,detail:'Market worker request failed; using last known health window.',meta:'Last success '+ageTxt+' | Status '+res.status+' | '+took+'ms',telemetry:{probedAt:probeIso,lastSuccessAt:null}},
        poePull:{level:'err',detail:'PoE.ninja pull validation failed.',meta:'Market worker league lookup failed ('+res.status+').'}
      };
    }
    let data=null;try{data=await res.json();}catch(e){}
    const leagueMeta=data&&data._meta?data._meta:null;
    const leagueAgeMs=parseMetaAgeMs(leagueMeta);
    const leagueState=parseMetaState(leagueMeta);
    if(leagueMeta&&leagueAgeMs!==null){
      marketWorkerLastSuccessAt=Date.now()-leagueAgeMs;
    }
    const league=String((data&&data.league)||'').trim();
    if(!league){
      const ageMs=marketWorkerLastSuccessAt===null?null:(Date.now()-marketWorkerLastSuccessAt);
      const ageTxt=humanAge(ageMs);
      const ageLevel=classifyMarketWorkerAge(ageMs);
      return {
        marketWorker:{level:ageLevel,detail:'Market worker responded but current league was missing.',meta:'Last success '+ageTxt+' | Status '+res.status+' | '+took+'ms',telemetry:{probedAt:probeIso,lastSuccessAt:(leagueMeta&&leagueMeta.lastSuccessAt)||null}},
        poePull:{level:'err',detail:'PoE.ninja pull validation failed.',meta:'Current league missing from market worker response.'}
      };
    }
    if(!leagueMeta||leagueAgeMs===null){
      marketWorkerLastSuccessAt=Date.now();
    }
    const marketWorkerBase=(()=>{
      if(leagueState==='stale'){
        const ageLevel=classifyMarketWorkerAge(leagueAgeMs);
        const ageTxt=humanAge(leagueAgeMs);
        return {
          level:ageLevel,
          detail:ageLevel==='ok'
            ?'League cache snapshot is within healthy age window (hourly cadence).'
            :'League cache snapshot is stale.',
          meta:'Last success '+ageTxt+' | League '+league+' | '+took+'ms',
          telemetry:{probedAt:probeIso,lastSuccessAt:(leagueMeta&&leagueMeta.lastSuccessAt)||null}
        };
      }
      return {
        level:'ok',
        detail:'League cache endpoint is healthy.',
        meta:'League '+league+' | '+took+'ms',
        telemetry:{probedAt:probeIso,lastSuccessAt:(leagueMeta&&leagueMeta.lastSuccessAt)||null}
      };
    })();

    const pullStarted=performance.now();
    const [scarabRes,currencyRes]=await Promise.all([
      fetch(MARKET_WORKER_URL+'?league='+encodeURIComponent(league)+'&type=Scarab',{cache:'no-store'}),
      fetch(MARKET_WORKER_URL+'?league='+encodeURIComponent(league)+'&type=Currency',{cache:'no-store'})
    ]);
    const pullTook=Math.round(performance.now()-pullStarted);

    if(!scarabRes.ok||!currencyRes.ok){
      const ageMs=poePullLastSuccessAt===null?null:(Date.now()-poePullLastSuccessAt);
      const ageTxt=humanAge(ageMs);
      const ageLevel=classifyPoePullAge(ageMs);
      return {
        marketWorker:marketWorkerBase,
        poePull:{
          level:ageLevel,
          detail:'Worker could not fetch fresh PoE.ninja data.',
          meta:'Last success '+ageTxt+' | Scarab '+scarabRes.status+' | Currency '+currencyRes.status+' | '+pullTook+'ms',
          telemetry:{probedAt:probeIso,lastScarabSuccessAt:null,lastCurrencySuccessAt:null,divineRatio:null}
        }
      };
    }

    let scarab=null,currency=null;
    try{scarab=await scarabRes.json();}catch(e){}
    try{currency=await currencyRes.json();}catch(e){}
    const scarabMeta=scarab&&scarab._meta?scarab._meta:null;
    const currencyMeta=currency&&currency._meta?currency._meta:null;
    const scarabState=parseMetaState(scarabMeta);
    const currencyState=parseMetaState(currencyMeta);
    const scarabAgeMs=parseMetaAgeMs(scarabMeta);
    const currencyAgeMs=parseMetaAgeMs(currencyMeta);
    const pullAgeMs=Math.max(scarabAgeMs||0,currencyAgeMs||0)||null;
    if(pullAgeMs!==null){
      poePullLastSuccessAt=Date.now()-pullAgeMs;
    }
    const pullState=(scarabState==='error'||currencyState==='error')?'error':((scarabState==='stale'||currencyState==='stale')?'stale':'live');

    if(leagueState==='error'){
      return {
        marketWorker:{level:'err',detail:'Market worker cache is in error state.',meta:'Last success '+humanAge(leagueAgeMs)+' | '+took+'ms'},
        poePull:{level:'err',detail:'PoE.ninja pull validation failed.',meta:'Market worker reported error state for league lookup.'}
      };
    }

    if(pullState==='error'){
      return {
        marketWorker:marketWorkerBase,
        poePull:{
          level:'err',
          detail:'Market worker reports market cache error.',
          meta:'Last success '+humanAge(pullAgeMs)+' | '+pullTook+'ms',
          telemetry:{
            probedAt:probeIso,
            lastScarabSuccessAt:(scarabMeta&&scarabMeta.lastSuccessAt)||null,
            lastCurrencySuccessAt:(currencyMeta&&currencyMeta.lastSuccessAt)||null,
            divineRatio:null
          }
        }
      };
    }
    if(pullState==='stale'){
      return {
        marketWorker:marketWorkerBase,
        poePull:{
          level:classifyPoePullAge(pullAgeMs),
          detail:'Serving stale market data cache.',
          meta:'Last success '+humanAge(pullAgeMs)+' | '+pullTook+'ms',
          telemetry:{
            probedAt:probeIso,
            lastScarabSuccessAt:(scarabMeta&&scarabMeta.lastSuccessAt)||null,
            lastCurrencySuccessAt:(currencyMeta&&currencyMeta.lastSuccessAt)||null,
            divineRatio:null
          }
        }
      };
    }

    const scarabLines=Array.isArray(scarab&&scarab.lines)?scarab.lines:[];
    const currencyLines=Array.isArray(currency&&currency.lines)?currency.lines:[];
    const currencyItems=Array.isArray(currency&&currency.items)?currency.items:[];
    const divineItem=currencyItems.find((x)=>String((x&&x.name)||'').toLowerCase()==='divine orb')||null;
    const divineLine=divineItem?currencyLines.find((x)=>String((x&&x.id)||'')===String(divineItem.id)):null;
    const divineValue=Number(divineLine&&(divineLine.primaryValue??divineLine.chaosEquivalent))||0;

    if(!scarabLines.length){
      const ageMs=poePullLastSuccessAt===null?null:(Date.now()-poePullLastSuccessAt);
      const ageTxt=humanAge(ageMs);
      const ageLevel=classifyPoePullAge(ageMs);
      return {
        marketWorker:marketWorkerBase,
        poePull:{
          level:ageLevel,
          detail:'No scarab lines returned from latest PoE.ninja pull.',
          meta:'Last success '+ageTxt+' | League '+league+' | '+pullTook+'ms',
          telemetry:{
            probedAt:probeIso,
            lastScarabSuccessAt:(scarabMeta&&scarabMeta.lastSuccessAt)||null,
            lastCurrencySuccessAt:(currencyMeta&&currencyMeta.lastSuccessAt)||null,
            divineRatio:null
          }
        }
      };
    }
    if(divineValue<=0){
      if(poePullLastSuccessAt===null)poePullLastSuccessAt=Date.now();
      const ageMs=Date.now()-poePullLastSuccessAt;
      return {
        marketWorker:marketWorkerBase,
        poePull:{
          level:'warn',
          detail:'Scarab data loaded, but Divine Orb rate missing/invalid.',
          meta:'Last success '+humanAge(ageMs)+' | League '+league+' | Scarabs '+scarabLines.length+' | '+pullTook+'ms',
          telemetry:{
            probedAt:probeIso,
            lastScarabSuccessAt:(scarabMeta&&scarabMeta.lastSuccessAt)||null,
            lastCurrencySuccessAt:(currencyMeta&&currencyMeta.lastSuccessAt)||null,
            divineRatio:null
          }
        }
      };
    }
    if(poePullLastSuccessAt===null)poePullLastSuccessAt=Date.now();
    const ageMs=Date.now()-poePullLastSuccessAt;
    return {
      marketWorker:marketWorkerBase,
      poePull:{
        level:'ok',
        detail:'PoE.ninja scarab + currency pulls are healthy.',
        meta:'Last success '+humanAge(ageMs)+' | League '+league+' | Scarabs '+scarabLines.length+' | Divine '+divineValue.toFixed(2)+'c | '+pullTook+'ms',
        telemetry:{
          probedAt:probeIso,
          lastScarabSuccessAt:(scarabMeta&&scarabMeta.lastSuccessAt)||null,
          lastCurrencySuccessAt:(currencyMeta&&currencyMeta.lastSuccessAt)||null,
          divineRatio:divineValue
        }
      }
    };
  }catch(e){
    const marketAgeMs=marketWorkerLastSuccessAt===null?null:(Date.now()-marketWorkerLastSuccessAt);
    const pullAgeMs=poePullLastSuccessAt===null?null:(Date.now()-poePullLastSuccessAt);
    return {
      marketWorker:{
        level:classifyMarketWorkerAge(marketAgeMs),
        detail:'Market worker request failed.',
        meta:'Last success '+humanAge(marketAgeMs)+' | '+String((e&&e.message)||e||'error'),
        telemetry:{probedAt:probeIso,lastSuccessAt:null}
      },
      poePull:{
        level:classifyPoePullAge(pullAgeMs),
        detail:'PoE.ninja pull validation failed.',
        meta:'Last success '+humanAge(pullAgeMs)+' | '+String((e&&e.message)||e||'error'),
        telemetry:{probedAt:probeIso,lastScarabSuccessAt:null,lastCurrencySuccessAt:null,divineRatio:null}
      }
    };
  }})()
    .then((bundle)=>{marketHealthCache=bundle;marketHealthCacheAt=Date.now();return bundle;})
    .finally(()=>{marketHealthInFlight=null;});
  return marketHealthInFlight;
}

function renderHealthCards(results){
  const wrap=$('healthGrid');
  if(!wrap)return;
  bindHealthDnD();
  state.healthOpenCards=state.healthOpenCards||{};
  wrap.querySelectorAll('.health-card.open').forEach((el)=>{
    const id=String(el.getAttribute('data-health-id')||el.id||'');
    if(id)state.healthOpenCards[id]=true;
  });
  const backend=enrichHealthCard('healthBackend','Admin API',results.backend||{});
  const publicTokens=enrichHealthCard('healthPublic','Public Token Endpoint',results.publicTokens||{});
  const marketWorker=enrichHealthCard('healthWorker','League Cache',results.marketWorker||{});
  const poePull=enrichHealthCard('healthPoeNinja','Market Price Cache',results.poePull||{});
  const sessionApi=enrichHealthCard('healthSessionApi','Session API',results.sessionApi||{});
  const backups=enrichHealthCard('healthBackups','Backup Snapshot',results.backups||{});
  const tokenHistory=enrichHealthCard('healthTokenSets','Token History',results.tokenHistory||{});
  const cloudflareUsage=enrichHealthCard('healthCloudflare','Cloudflare Usage',results.cloudflareUsage||{});
  const cardById={
    healthBackend:healthCard('healthBackend','Admin API',backend.level,backend.detail,backend.meta,backend.checks,backend.debug),
    healthPublic:healthCard('healthPublic','Public Token Endpoint',publicTokens.level,publicTokens.detail,publicTokens.meta,publicTokens.checks,publicTokens.debug),
    healthWorker:healthCard('healthWorker','League Cache',marketWorker.level,marketWorker.detail,marketWorker.meta,marketWorker.checks,marketWorker.debug),
    healthPoeNinja:healthCard('healthPoeNinja','Market Price Cache',poePull.level,poePull.detail,poePull.meta,poePull.checks,poePull.debug),
    healthSessionApi:healthCard('healthSessionApi','Session API',sessionApi.level,sessionApi.detail,sessionApi.meta,sessionApi.checks,sessionApi.debug),
    healthBackups:healthCard('healthBackups','Backup Snapshot',backups.level,backups.detail,backups.meta,backups.checks,backups.debug),
    healthTokenSets:healthCard('healthTokenSets','Token History',tokenHistory.level,tokenHistory.detail,tokenHistory.meta,tokenHistory.checks,tokenHistory.debug),
    healthCloudflare:healthCard('healthCloudflare','Cloudflare Usage',cloudflareUsage.level,cloudflareUsage.detail,cloudflareUsage.meta,cloudflareUsage.checks,cloudflareUsage.debug)
  };
  const defaultIds=Object.keys(cardById);
  if(!Array.isArray(state.healthCardLayout)||state.healthCardLayout.length!==3){
    state.healthCardLayout=loadHealthCardLayout(defaultIds);
  }
  const cols=(state.healthCardLayout||[[],[],[]]).map((ids)=>ids.map((id)=>cardById[id]).filter(Boolean));
  while(cols.length<3)cols.push([]);
  wrap.innerHTML=''
    +'<div class="health-col">'+cols[0].join('')+'</div>'
    +'<div class="health-col">'+cols[1].join('')+'</div>'
    +'<div class="health-col">'+cols[2].join('')+'</div>';
}

async function loadHealthOverview(opts){
  const quiet=!!(opts&&opts.quiet);
  busy('healthRefreshBtn',true);
  try{
    const [backend,publicTokens,marketWorker,poePull,sessionApi,backups,tokenHistory,cloudflareUsage]=await Promise.all([
      checkHealthBackend(),
      checkHealthPublicTokens(),
      checkHealthMarketWorker(),
      checkHealthPoeNinjaPull(),
      checkHealthSessionApi(),
      checkHealthBackups(),
      checkHealthTokenHistory(),
      checkHealthCloudflareUsage()
    ]);
    state.healthLastResults={backend,publicTokens,marketWorker,poePull,sessionApi,backups,tokenHistory,cloudflareUsage};
    renderHealthCards(state.healthLastResults);
    state.healthAutoLoaded=true;
    const now=formatAdminTime(new Date().toISOString());
    status('healthStatus','Health overview refreshed at '+now+'.','ok');
  }catch(e){
    status('healthStatus','Health refresh failed: '+String((e&&e.message)||e||'error'),'err');
  }finally{
    busy('healthRefreshBtn',false);
  }
}

