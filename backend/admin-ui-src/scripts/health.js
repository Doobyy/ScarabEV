
const MARKET_WORKER_URL='https://scarabev-market-worker.paperpandastacks.workers.dev';
const MARKET_HEALTH_CACHE_MS=15000;
const MARKET_HEALTHY_AGE_MS=120000;
const MARKET_WARN_AGE_MS=900000;
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

function healthCard(id,title,level,detail,meta){
  return '<div class="health-card" id="'+id+'">'
    +'<div class="health-head"><div class="h">'+title+'</div>'+healthBadge(level)+'</div>'
    +'<div class="health-detail">'+escHtml(detail||'-')+'</div>'
    +'<div class="sub mono">'+escHtml(meta||'-')+'</div>'
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

function classifyMarketAge(ms){
  if(ms===null)return 'err';
  if(ms<=MARKET_HEALTHY_AGE_MS)return 'ok';
  if(ms<=MARKET_WARN_AGE_MS)return 'warn';
  return 'err';
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
      const ageLevel=classifyMarketAge(ageMs);
      return {
        marketWorker:{level:ageLevel,detail:'Market worker request failed; using last known health window.',meta:'Last success '+ageTxt+' | Status '+res.status+' | '+took+'ms'},
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
      const ageLevel=classifyMarketAge(ageMs);
      return {
        marketWorker:{level:ageLevel,detail:'Market worker responded but current league was missing.',meta:'Last success '+ageTxt+' | Status '+res.status+' | '+took+'ms'},
        poePull:{level:'err',detail:'PoE.ninja pull validation failed.',meta:'Current league missing from market worker response.'}
      };
    }
    if(!leagueMeta||leagueAgeMs===null){
      marketWorkerLastSuccessAt=Date.now();
    }
    const pullStarted=performance.now();
    const [scarabRes,currencyRes]=await Promise.all([
      fetch(MARKET_WORKER_URL+'?league='+encodeURIComponent(league)+'&type=Scarab',{cache:'no-store'}),
      fetch(MARKET_WORKER_URL+'?league='+encodeURIComponent(league)+'&type=Currency',{cache:'no-store'})
    ]);
    const pullTook=Math.round(performance.now()-pullStarted);

    if(!scarabRes.ok||!currencyRes.ok){
      const ageMs=poePullLastSuccessAt===null?null:(Date.now()-poePullLastSuccessAt);
      const ageTxt=humanAge(ageMs);
      const ageLevel=classifyMarketAge(ageMs);
      return {
        marketWorker:{level:'ok',detail:'Market worker reachable and returning current league.',meta:'League '+league+' | '+took+'ms'},
        poePull:{level:ageLevel,detail:'Worker could not fetch fresh PoE.ninja data.',meta:'Last success '+ageTxt+' | Scarab '+scarabRes.status+' | Currency '+currencyRes.status+' | '+pullTook+'ms'}
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
    if(leagueState==='stale'){
      return {
        marketWorker:{level:classifyMarketAge(leagueAgeMs),detail:'Market worker serving stale league cache.',meta:'Last success '+humanAge(leagueAgeMs)+' | League '+league+' | '+took+'ms'},
        poePull:{level:'warn',detail:'Market worker is stale; freshness should recover after refresh.',meta:'League '+league}
      };
    }

    if(pullState==='error'){
      return {
        marketWorker:{level:'ok',detail:'Market worker reachable and returning current league.',meta:'League '+league+' | '+took+'ms'},
        poePull:{level:'err',detail:'Market worker reports market cache error.',meta:'Last success '+humanAge(pullAgeMs)+' | '+pullTook+'ms'}
      };
    }
    if(pullState==='stale'){
      return {
        marketWorker:{level:'ok',detail:'Market worker reachable and returning current league.',meta:'League '+league+' | '+took+'ms'},
        poePull:{level:classifyMarketAge(pullAgeMs),detail:'Serving stale market data cache.',meta:'Last success '+humanAge(pullAgeMs)+' | '+pullTook+'ms'}
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
      const ageLevel=classifyMarketAge(ageMs);
      return {
        marketWorker:{level:'ok',detail:'Market worker reachable and returning current league.',meta:'League '+league+' | '+took+'ms'},
        poePull:{level:ageLevel,detail:'No scarab lines returned from latest PoE.ninja pull.',meta:'Last success '+ageTxt+' | League '+league+' | '+pullTook+'ms'}
      };
    }
    if(divineValue<=0){
      if(poePullLastSuccessAt===null)poePullLastSuccessAt=Date.now();
      const ageMs=Date.now()-poePullLastSuccessAt;
      return {
        marketWorker:{level:'ok',detail:'Market worker reachable and returning current league.',meta:'League '+league+' | '+took+'ms'},
        poePull:{level:'warn',detail:'Scarab data loaded, but Divine Orb rate missing/invalid.',meta:'Last success '+humanAge(ageMs)+' | League '+league+' | Scarabs '+scarabLines.length+' | '+pullTook+'ms'}
      };
    }
    if(poePullLastSuccessAt===null)poePullLastSuccessAt=Date.now();
    const ageMs=Date.now()-poePullLastSuccessAt;
    return {
      marketWorker:{level:'ok',detail:'Market worker reachable and returning current league.',meta:'League '+league+' | '+took+'ms'},
      poePull:{level:'ok',detail:'PoE.ninja scarab + currency pulls are healthy.',meta:'Last success '+humanAge(ageMs)+' | League '+league+' | Scarabs '+scarabLines.length+' | Divine '+divineValue.toFixed(2)+'c | '+pullTook+'ms'}
    };
  }catch(e){
    const marketAgeMs=marketWorkerLastSuccessAt===null?null:(Date.now()-marketWorkerLastSuccessAt);
    const pullAgeMs=poePullLastSuccessAt===null?null:(Date.now()-poePullLastSuccessAt);
    return {
      marketWorker:{level:classifyMarketAge(marketAgeMs),detail:'Market worker request failed.',meta:'Last success '+humanAge(marketAgeMs)+' | '+String((e&&e.message)||e||'error')},
      poePull:{level:classifyMarketAge(pullAgeMs),detail:'PoE.ninja pull validation failed.',meta:'Last success '+humanAge(pullAgeMs)+' | '+String((e&&e.message)||e||'error')}
    };
  }})()
    .then((bundle)=>{marketHealthCache=bundle;marketHealthCacheAt=Date.now();return bundle;})
    .finally(()=>{marketHealthInFlight=null;});
  return marketHealthInFlight;
}

function renderHealthCards(results){
  const wrap=$('healthGrid');
  if(!wrap)return;
  wrap.innerHTML=''
    +healthCard('healthBackend','Admin API',results.backend.level,results.backend.detail,results.backend.meta)
    +healthCard('healthPublic','Public Token Endpoint',results.publicTokens.level,results.publicTokens.detail,results.publicTokens.meta)
    +healthCard('healthWorker','Market Worker',results.marketWorker.level,results.marketWorker.detail,results.marketWorker.meta)
    +healthCard('healthPoeNinja','PoE.ninja Price Pull',results.poePull.level,results.poePull.detail,results.poePull.meta)
    +healthCard('healthSessionApi','Session API',results.sessionApi.level,results.sessionApi.detail,results.sessionApi.meta)
    +healthCard('healthBackups','Backup Snapshot',results.backups.level,results.backups.detail,results.backups.meta)
    +healthCard('healthTokenSets','Token History',results.tokenHistory.level,results.tokenHistory.detail,results.tokenHistory.meta);
}

async function loadHealthOverview(opts){
  const quiet=!!(opts&&opts.quiet);
  busy('healthRefreshBtn',true);
  try{
    const [backend,publicTokens,marketWorker,poePull,sessionApi,backups,tokenHistory]=await Promise.all([
      checkHealthBackend(),
      checkHealthPublicTokens(),
      checkHealthMarketWorker(),
      checkHealthPoeNinjaPull(),
      checkHealthSessionApi(),
      checkHealthBackups(),
      checkHealthTokenHistory()
    ]);
    renderHealthCards({backend,publicTokens,marketWorker,poePull,sessionApi,backups,tokenHistory});
    state.healthAutoLoaded=true;
    const now=formatAdminTime(new Date().toISOString());
    status('healthStatus','Health overview refreshed at '+now+'.','ok');
  }catch(e){
    status('healthStatus','Health refresh failed: '+String((e&&e.message)||e||'error'),'err');
  }finally{
    busy('healthRefreshBtn',false);
  }
}
