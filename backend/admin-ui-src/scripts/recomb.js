
function toInt(v,fallback){
  const n=Number(String(v??'').trim());
  if(!Number.isFinite(n))return fallback;
  return Math.trunc(n);
}

function clampInt(v,min,max){
  const n=toInt(v,min);
  return Math.max(min,Math.min(max,n));
}

function pct(v){
  const n=Number(v)||0;
  return (n*100).toFixed(2)+'%';
}

function choose(n,k){
  if(k<0||n<0||k>n)return 0;
  if(k===0||k===n)return 1;
  let kk=k;
  if(kk>n-kk)kk=n-kk;
  let out=1;
  for(let i=1;i<=kk;i+=1){
    out=(out*(n-kk+i))/i;
  }
  return out;
}

function chancePickAtLeastOneDesired(poolSize,desiredCount,picks){
  const m=Math.max(0,Math.trunc(poolSize||0));
  const d=Math.max(0,Math.min(m,Math.trunc(desiredCount||0)));
  const n=Math.max(0,Math.min(m,Math.trunc(picks||0)));
  if(m===0||d===0||n===0)return 0;
  if(d>=m)return 1;
  const nonDesired=m-d;
  if(nonDesired<n)return 1;
  const miss=choose(nonDesired,n)/choose(m,n);
  return Math.max(0,Math.min(1,1-miss));
}

function normalizeDist(dist){
  const src=dist||{};
  const out={0:0,1:0,2:0,3:0};
  let total=0;
  [0,1,2,3].forEach((k)=>{
    const v=Math.max(0,Number(src[k])||0);
    out[k]=v;
    total+=v;
  });
  if(total<=0){
    out[0]=1;
    return out;
  }
  [0,1,2,3].forEach((k)=>{out[k]=out[k]/total;});
  return out;
}

function baseAffixCountDist(poolSize){
  const n=Math.max(0,Math.min(6,Math.trunc(poolSize||0)));
  if(n<=0)return normalizeDist({0:1});
  if(n===1)return normalizeDist({0:0.41,1:0.59});
  if(n===2)return normalizeDist({1:2/3,2:1/3});
  if(n===3)return normalizeDist({1:0.40,2:0.50,3:0.10});
  if(n===4)return normalizeDist({1:0.10,2:0.60,3:0.30});
  if(n===5)return normalizeDist({2:0.43,3:0.57});
  return normalizeDist({2:0.30,3:0.70});
}

function estimateAffixDist(poolSize,mode){
  const base=baseAffixCountDist(poolSize);
  if(mode!=='legacy')return base;
  const extra=Math.max(0,Math.min(1,(Number($('recombLegacyBoost').value)||0)/100));
  if(extra<=0)return base;
  const boost=Math.min(extra,base[2]+base[1]);
  const from2=Math.min(boost,base[2]);
  const rem=boost-from2;
  const from1=Math.min(rem,base[1]);
  return normalizeDist({
    0:base[0],
    1:base[1]-from1,
    2:base[2]-from2+from1,
    3:base[3]+from2
  });
}

function expectedAffixCount(dist){
  return (dist[1]||0)+2*(dist[2]||0)+3*(dist[3]||0);
}

function renderDist(containerId,label,dist){
  const rows=[0,1,2,3].map((n)=>'<tr><td>'+label+' '+n+'</td><td>'+pct(dist[n]||0)+'</td></tr>').join('');
  $(containerId).innerHTML='<table><thead><tr><th>Outcome</th><th>Chance</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function buildRecombSheetRows(){
  const host=$('recombSheetRows');
  if(!host||host.dataset.ready==='1')return;
  const rows=[];
  for(let i=1;i<=6;i+=1){
    rows.push(
      '<tr>'
      +'<td><input id="recombLFrac_'+i+'" type="checkbox"/></td>'
      +'<td><input id="recombLSel_'+i+'" type="checkbox"/></td>'
      +'<td><input id="recombLTier_'+i+'" type="number" min="1" max="10" value="1"/></td>'
      +'<td><input id="recombLMod_'+i+'" placeholder="Left affix '+i+'"/></td>'
      +'<td><select id="recombType_'+i+'"><option value="prefix">P</option><option value="suffix">S</option></select></td>'
      +'<td><input id="recombRMod_'+i+'" placeholder="Right affix '+i+'"/></td>'
      +'<td><input id="recombRTier_'+i+'" type="number" min="1" max="10" value="1"/></td>'
      +'<td><input id="recombRSel_'+i+'" type="checkbox"/></td>'
      +'<td><input id="recombRFrac_'+i+'" type="checkbox"/></td>'
      +'</tr>'
    );
  }
  host.innerHTML='<table class="recomb-sheet"><thead><tr>'
    +'<th>L Frac</th><th>L Sel</th><th>L Tier</th><th>Left Item Affix</th><th>Type</th><th>Right Item Affix</th><th>R Tier</th><th>R Sel</th><th>R Frac</th>'
    +'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
  host.dataset.ready='1';
}

function collectSheetCounts(){
  const mode=String($('recombMode').value||'simple');
  const counts={
    left:{prefix:0,suffix:0},
    right:{prefix:0,suffix:0},
    selectedLeft:{prefix:0,suffix:0},
    selectedRight:{prefix:0,suffix:0},
    fracturedLeft:{prefix:0,suffix:0},
    fracturedRight:{prefix:0,suffix:0}
  };
  for(let i=1;i<=6;i+=1){
    const t=(($('recombType_'+i).value||'prefix')==='suffix')?'suffix':'prefix';
    const lMod=String(($('recombLMod_'+i).value||'')).trim();
    const rMod=String(($('recombRMod_'+i).value||'')).trim();
    if(lMod){
      counts.left[t]+=1;
      if($('recombLSel_'+i).checked)counts.selectedLeft[t]+=1;
      if($('recombLFrac_'+i).checked)counts.fracturedLeft[t]+=1;
    }
    if(rMod){
      counts.right[t]+=1;
      if($('recombRSel_'+i).checked)counts.selectedRight[t]+=1;
      if($('recombRFrac_'+i).checked)counts.fracturedRight[t]+=1;
    }
  }
  if(mode!=='weighted'){
    counts.selectedLeft.prefix=counts.left.prefix;
    counts.selectedLeft.suffix=counts.left.suffix;
    counts.selectedRight.prefix=counts.right.prefix;
    counts.selectedRight.suffix=counts.right.suffix;
  }
  return counts;
}

function collectSheetAffixes(){
  const out={left:{prefix:[],suffix:[]},right:{prefix:[],suffix:[]}};
  for(let i=1;i<=6;i+=1){
    const kind=(($('recombType_'+i).value||'prefix')==='suffix')?'suffix':'prefix';
    const lMod=String(($('recombLMod_'+i).value||'')).trim();
    const rMod=String(($('recombRMod_'+i).value||'')).trim();
    const lTier=clampInt($('recombLTier_'+i).value,1,10);
    const rTier=clampInt($('recombRTier_'+i).value,1,10);
    if(lMod){
      out.left[kind].push({
        mod:lMod,tier:lTier,selected:$('recombLSel_'+i).checked,fractured:$('recombLFrac_'+i).checked,side:'left'
      });
    }
    if(rMod){
      out.right[kind].push({
        mod:rMod,tier:rTier,selected:$('recombRSel_'+i).checked,fractured:$('recombRFrac_'+i).checked,side:'right'
      });
    }
  }
  return out;
}

function weightedPickIndex(items,mode){
  if(!items.length)return -1;
  const weights=items.map((it)=>{
    if(mode!=='weighted')return 1;
    if(it&&it.selected&&it.fractured)return 5;
    if(it&&it.selected)return 3;
    if(it&&it.fractured)return 2;
    return 1;
  });
  const total=weights.reduce((a,b)=>a+b,0);
  if(total<=0)return pickIndex(items.length);
  let r=Math.random()*total;
  for(let i=0;i<weights.length;i+=1){
    r-=weights[i];
    if(r<=0)return i;
  }
  return items.length-1;
}

function sampleAffixes(pool,count,mode){
  const src=(Array.isArray(pool)?pool:[]).slice();
  const c=Math.max(0,Math.min(src.length,Math.trunc(count||0)));
  const picked=[];
  for(let i=0;i<c;i+=1){
    const idx=weightedPickIndex(src,mode);
    if(idx<0||idx>=src.length)break;
    picked.push(src.splice(idx,1)[0]);
  }
  return picked;
}

function renderItemCard(containerId,title,base,prefixes,suffixes,note){
  const p=(Array.isArray(prefixes)?prefixes:[]).map((x)=>'<div class="recomb-line"><span class="recomb-k">P</span><span>'+x+'</span></div>').join('');
  const s=(Array.isArray(suffixes)?suffixes:[]).map((x)=>'<div class="recomb-line"><span class="recomb-k">S</span><span>'+x+'</span></div>').join('');
  const empty=(!p&&!s)?'<div class="sub">No affixes</div>':'';
  $(containerId).innerHTML='<div class="h">'+title+'</div>'
    +'<div class="sub recomb-base">'+(base||'Base not set')+'</div>'
    +'<div class="recomb-lines">'+p+s+empty+'</div>'
    +(note?('<div class="sub">'+note+'</div>'):'');
}

function renderVisuals(engineMode,recombMode){
  const leftBase=String(($('recombLeftBase').value||'')).trim();
  const rightBase=String(($('recombRightBase').value||'')).trim();
  const all=collectSheetAffixes();
  const basePick=bernoulli(0.5)?'left':'right';
  const resultBase=basePick==='left'?(leftBase||'Left Base'):(rightBase||'Right Base');
  const prefixPool=[...all.left.prefix,...all.right.prefix];
  const suffixPool=[...all.left.suffix,...all.right.suffix];
  const pCount=sampleAffixCount(prefixPool.length,engineMode);
  const sCount=sampleAffixCount(suffixPool.length,engineMode);
  const pPicked=sampleAffixes(prefixPool,pCount,recombMode);
  const sPicked=sampleAffixes(suffixPool,sCount,recombMode);

  const fmt=(a)=>String(a.mod||'')
    +(a.tier?(' (T'+a.tier+')'):'')
    +(a.selected?' [sel]':'')
    +(a.fractured?' [frac]':'');
  const lP=all.left.prefix.map(fmt), lS=all.left.suffix.map(fmt);
  const rP=all.right.prefix.map(fmt), rS=all.right.suffix.map(fmt);
  const mP=pPicked.map(fmt), mS=sPicked.map(fmt);
  renderItemCard('recombVisualLeft','LEFT ITEM',leftBase,lP,lS,'');
  renderItemCard('recombVisualRight','RIGHT ITEM',rightBase,rP,rS,'');
  renderItemCard('recombVisualMid','RECOMBINED',resultBase,mP,mS,'Base pick: '+(basePick==='left'?'Left':'Right')+' (50/50)');
}

function runRecombBench(){
  buildRecombSheetRows();
  const engine=($('recombEngine').value||'new').trim();
  const mode=($('recombMode').value||'simple').trim();
  const c=collectSheetCounts();
  const prefixPool=Math.min(6,c.left.prefix+c.right.prefix);
  const suffixPool=Math.min(6,c.left.suffix+c.right.suffix);
  const pd=estimateAffixDist(prefixPool,engine);
  const sd=estimateAffixDist(suffixPool,engine);

  const leftKeepP=[0,1,2,3].reduce((acc,n)=>acc+(pd[n]||0)*chancePickAtLeastOneDesired(prefixPool,Math.min(prefixPool,c.selectedLeft.prefix),n),0);
  const leftKeepS=[0,1,2,3].reduce((acc,n)=>acc+(sd[n]||0)*chancePickAtLeastOneDesired(suffixPool,Math.min(suffixPool,c.selectedLeft.suffix),n),0);
  const rightKeepP=[0,1,2,3].reduce((acc,n)=>acc+(pd[n]||0)*chancePickAtLeastOneDesired(prefixPool,Math.min(prefixPool,c.selectedRight.prefix),n),0);
  const rightKeepS=[0,1,2,3].reduce((acc,n)=>acc+(sd[n]||0)*chancePickAtLeastOneDesired(suffixPool,Math.min(suffixPool,c.selectedRight.suffix),n),0);

  const leftResult=leftKeepP*leftKeepS;
  const rightResult=rightKeepP*rightKeepS;
  const combined=0.5*leftResult+0.5*rightResult;
  const lucky=combined+combined*(1-combined);

  renderDist('recombPrefixDist','Prefixes',pd);
  renderDist('recombSuffixDist','Suffixes',sd);
  const html=[
    '<div class="metric"><span>Left Outcome</span><b>'+pct(leftResult)+'</b></div>',
    '<div class="metric"><span>Right Outcome</span><b>'+pct(rightResult)+'</b></div>',
    '<div class="metric"><span>Result (50/50 Base Pick)</span><b>'+pct(combined)+'</b></div>',
    '<div class="metric"><span>Lucky Result</span><b>'+pct(lucky)+'</b></div>',
    '<div class="metric"><span>Expected Prefixes</span><b>'+expectedAffixCount(pd).toFixed(3)+'</b></div>',
    '<div class="metric"><span>Expected Suffixes</span><b>'+expectedAffixCount(sd).toFixed(3)+'</b></div>',
    '<div class="metric"><span>Expected Total</span><b>'+(expectedAffixCount(pd)+expectedAffixCount(sd)).toFixed(3)+'</b></div>'
  ].join('');
  $('recombMetrics').innerHTML=html;
  const assumption=engine==='legacy'
    ?'Legacy mode adds an approximate count boost to 3-mod outcomes (configurable).'
    :'New mode uses 3.25/3.26-style pool-size outcome table.';
  const fractureWarn=(c.fracturedLeft.prefix+c.fracturedLeft.suffix+c.fracturedRight.prefix+c.fracturedRight.suffix)>0
    ?' | Fracture flags are tracked for planning, but edge-case invalidation is approximate.'
    :'';
  renderVisuals(engine,mode);
  status(
    'recombStatus',
    'Computed from left/right affix grid. Mode='+mode
      +' | Pools P='+prefixPool+', S='+suffixPool
      +' | '+assumption+fractureWarn+' | Middle item is a sampled single recombination preview.',
    'ok'
  );
}

function bernoulli(p){
  return Math.random()<Math.max(0,Math.min(1,Number(p)||0));
}

function pickIndex(len){
  if(len<=0)return -1;
  return Math.floor(Math.random()*len);
}

function sampleAffixCount(poolSize,mode){
  const dist=estimateAffixDist(poolSize,mode);
  const r=Math.random();
  let acc=0;
  for(const n of [0,1,2,3]){
    acc+=dist[n]||0;
    if(r<=acc)return n;
  }
  return 0;
}

function initSidePool(naturalCount,exclusiveCount,desiredNatural){
  const pool=[];
  const n=Math.max(0,Math.trunc(naturalCount||0));
  const e=Math.max(0,Math.trunc(exclusiveCount||0));
  const d=Math.max(0,Math.min(n,Math.trunc(desiredNatural||0)));
  for(let i=0;i<d;i+=1)pool.push({type:'natural',desired:true});
  for(let i=d;i<n;i+=1)pool.push({type:'natural',desired:false});
  for(let i=0;i<e;i+=1)pool.push({type:'exclusive',desired:false});
  return pool;
}

function removeExclusiveFromPool(pool){
  let i=pool.length-1;
  while(i>=0){
    if(pool[i]&&pool[i].type==='exclusive')pool.splice(i,1);
    i-=1;
  }
}

function fillSide(state,side,pickCount){
  const key=side==='prefix'?'prefixPool':'suffixPool';
  const pool=state[key];
  const picks=Math.max(0,Math.trunc(pickCount||0));
  let desiredHit=0;
  let selectedCount=0;
  for(let i=0;i<picks;i+=1){
    if(!pool.length)break;
    const idx=pickIndex(pool.length);
    const chosen=pool.splice(idx,1)[0];
    if(!chosen)continue;
    selectedCount+=1;
    if(chosen.desired)desiredHit+=1;
    if(chosen.type==='exclusive'&&!state.exclusiveChosen){
      state.exclusiveChosen=true;
      removeExclusiveFromPool(state.prefixPool);
      removeExclusiveFromPool(state.suffixPool);
    }
  }
  return {desiredHit,selectedCount};
}

function addBucket(map,p,s){
  const key=String(Math.max(0,Math.trunc(p)))+'p/'+String(Math.max(0,Math.trunc(s)))+'s';
  map[key]=(map[key]||0)+1;
}

function renderBucketTable(containerId,title,buckets,total){
  const entries=Object.keys(buckets||{})
    .map((k)=>({k,v:Number(buckets[k])||0}))
    .sort((a,b)=>b.v-a.v||a.k.localeCompare(b.k));
  if(!entries.length){
    $(containerId).innerHTML='<div class="sub">No outcomes recorded.</div>';
    return;
  }
  const rows=entries
    .map((e)=>'<tr><td>'+e.k+'</td><td>'+e.v.toLocaleString()+'</td><td>'+pct((Number(total)>0?e.v/total:0))+'</td></tr>')
    .join('');
  $(containerId).innerHTML='<div class="sub"><b>'+title+'</b></div>'
    +'<table><thead><tr><th>Bucket</th><th>Count</th><th>Chance</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function runRecombMonteCarlo(){
  const trials=clampInt($('recombMcTrials').value,100,200000);
  const mode=($('recombMcMode').value||'new').trim();
  const orderMode=String($('recombMcOrder').value||'50').trim();
  const pNatural=clampInt($('recombMcPrefixNatural').value,0,6);
  const pExclusive=clampInt($('recombMcPrefixExclusive').value,0,6);
  const sNatural=clampInt($('recombMcSuffixNatural').value,0,6);
  const sExclusive=clampInt($('recombMcSuffixExclusive').value,0,6);
  const pDesired=clampInt($('recombMcDesiredPrefixNatural').value,0,pNatural);
  const sDesired=clampInt($('recombMcDesiredSuffixNatural').value,0,sNatural);

  let hitPrefix=0;
  let hitSuffix=0;
  let hitBoth=0;
  let anyExclusive=0;
  let totalPrefixKept=0;
  let totalSuffixKept=0;
  const rolledBuckets={};
  const selectedBuckets={};

  for(let t=0;t<trials;t+=1){
    const stateRun={
      prefixPool:initSidePool(pNatural,pExclusive,pDesired),
      suffixPool:initSidePool(sNatural,sExclusive,sDesired),
      exclusiveChosen:false
    };
    const prefixTarget=sampleAffixCount(stateRun.prefixPool.length,mode);
    const suffixTarget=sampleAffixCount(stateRun.suffixPool.length,mode);
    const prefixFirst=orderMode==='prefix'?true:(orderMode==='suffix'?false:bernoulli(0.5));
    let pHit=0;
    let sHit=0;
    let pKept=0;
    let sKept=0;
    if(prefixFirst){
      const pr=fillSide(stateRun,'prefix',prefixTarget);
      pHit+=pr.desiredHit;
      pKept+=pr.selectedCount;
      const sr=fillSide(stateRun,'suffix',suffixTarget);
      sHit+=sr.desiredHit;
      sKept+=sr.selectedCount;
    }else{
      const sr=fillSide(stateRun,'suffix',suffixTarget);
      sHit+=sr.desiredHit;
      sKept+=sr.selectedCount;
      const pr=fillSide(stateRun,'prefix',prefixTarget);
      pHit+=pr.desiredHit;
      pKept+=pr.selectedCount;
    }
    totalPrefixKept+=pKept;
    totalSuffixKept+=sKept;
    addBucket(rolledBuckets,prefixTarget,suffixTarget);
    addBucket(selectedBuckets,pKept,sKept);
    if(stateRun.exclusiveChosen)anyExclusive+=1;
    if(pHit>0)hitPrefix+=1;
    if(sHit>0)hitSuffix+=1;
    if(pHit>0&&sHit>0)hitBoth+=1;
  }

  const t=Math.max(1,trials);
  const rows=[
    ['Trials',String(t)],
    ['Hit >=1 desired prefix natural',pct(hitPrefix/t)],
    ['Hit >=1 desired suffix natural',pct(hitSuffix/t)],
    ['Hit desired on both sides',pct(hitBoth/t)],
    ['Any exclusive selected',pct(anyExclusive/t)],
    ['Avg kept prefixes', (totalPrefixKept/t).toFixed(3)],
    ['Avg kept suffixes', (totalSuffixKept/t).toFixed(3)]
  ];
  $('recombMcResults').innerHTML='<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>'
    +rows.map((r)=>'<tr><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>').join('')
    +'</tbody></table>';
  renderBucketTable('recombMcBucketsRolled','Rolled Affix Count Buckets',rolledBuckets,t);
  renderBucketTable('recombMcBucketsSelected','Final Selected Affix Buckets',selectedBuckets,t);
  status(
    'recombMcStatus',
    'Monte Carlo complete. Order='+(orderMode==='50'?'50/50':orderMode)+' | Mode='+mode
      +' | Pools P(N/E)='+pNatural+'/'+pExclusive+', S(N/E)='+sNatural+'/'+sExclusive
      +' | Desired P/S='+pDesired+'/'+sDesired,
    'ok'
  );
}
