export const ADMIN_SESSION_INTEL_SCRIPT = String.raw`
function sessionFingerprintValue(s){
  const league=String((s&&s.league)||'').trim().toLowerCase();
  const regex=String((s&&s.regex)||'').trim();
  const consumed=Math.round(safeNum(s&&s.total_consumed));
  const trades=Math.round(safeNum(s&&s.total_trades));
  const input=Math.round(safeNum(s&&s.input_value));
  const output=Math.round(safeNum(s&&s.output_value));
  const scarabs=String((s&&s.scarabs_json)||'').trim();
  return [league,regex,consumed,trades,input,output,scarabs].join('|');
}

function analyzeSessionDuplicates(items){
  const groups=new Map();
  for(const s of items){
    const key=sessionFingerprintValue(s);
    const arr=groups.get(key)||[];
    arr.push(s);
    groups.set(key,arr);
  }
  const dupes=[];
  groups.forEach((arr,key)=>{
    if(arr.length<2)return;
    const sorted=arr.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    const ids=sorted.map((x)=>String(x.id||'-'));
    dupes.push({
      key,
      count:arr.length,
      league:String(sorted[0].league||'-'),
      regex:String(sorted[0].regex||'-'),
      input:Math.round(safeNum(sorted[0].input_value)),
      output:Math.round(safeNum(sorted[0].output_value)),
      trades:Math.round(safeNum(sorted[0].total_trades)),
      consumed:Math.round(safeNum(sorted[0].total_consumed)),
      latestAt:sorted[0].created_at,
      ids
    });
  });
  dupes.sort((a,b)=>b.count-a.count||new Date(b.latestAt||0)-new Date(a.latestAt||0));
  return dupes;
}

function buildMedian(values){
  if(!values.length)return 0;
  const arr=values.slice().sort((a,b)=>a-b);
  const mid=Math.floor(arr.length/2);
  return arr.length%2?arr[mid]:((arr[mid-1]+arr[mid])/2);
}

function analyzeSessionTrustSignals(items){
  const rates=items.map((s)=>safeNum(s.divine_rate)).filter((x)=>x>0);
  const medianRate=buildMedian(rates);
  const duplicateCountById=new Map();
  const dupes=analyzeSessionDuplicates(items);
  dupes.forEach((d)=>d.ids.forEach((id)=>duplicateCountById.set(String(id),d.count)));

  const out=[];
  for(const s of items){
    const id=String(s.id||'-');
    const input=safeNum(s.input_value);
    const output=safeNum(s.output_value);
    const profit=output-input;
    const trades=safeNum(s.total_trades);
    const consumed=safeNum(s.total_consumed);
    const rate=safeNum(s.divine_rate);
    const roi=input>0?((profit/input)*100):0;
    const reasons=[];
    let score=100;

    const dupeCount=safeNum(duplicateCountById.get(id)||0);
    if(dupeCount>1){
      reasons.push('Duplicate fingerprint ('+Math.round(dupeCount)+'x)');
      score-=35;
    }
    if(input<=0&&output>0){
      reasons.push('Output reported with zero input');
      score-=30;
    }
    if(trades<=0&&consumed>0){
      reasons.push('Consumed scarabs but zero trades');
      score-=20;
    }
    if(input>0&&Math.abs(roi)>=300){
      reasons.push('Extreme ROI ('+(roi>=0?'+':'')+roi.toFixed(1)+'%)');
      score-=18;
    }
    if(medianRate>0&&rate>0){
      const drift=Math.abs((rate-medianRate)/medianRate)*100;
      if(drift>=35){
        reasons.push('Divine rate drift ('+drift.toFixed(1)+'% vs median)');
        score-=14;
      }
    }
    if(consumed>0&&trades>0){
      const perTrade=consumed/trades;
      if(perTrade>=8){
        reasons.push('High consumed/trade ratio ('+perTrade.toFixed(2)+')');
        score-=10;
      }
    }

    if(reasons.length===0)continue;
    score=Math.max(0,Math.round(score));
    const severity=score<55?'high':(score<75?'medium':'low');
    out.push({
      id,
      createdAt:s.created_at,
      league:String(s.league||'-'),
      score,
      severity,
      reasons,
      roi,
      profitDiv:divFromChaos(profit,rate)
    });
  }
  out.sort((a,b)=>a.score-b.score||new Date(b.createdAt||0)-new Date(a.createdAt||0));
  return {items:out,medianRate};
}

function severityBadge(level){
  const cls=level==='high'?'danger':(level==='medium'?'warn':'');
  return '<span class="badge '+cls+'">'+escHtml(level.toUpperCase())+'</span>';
}

function renderSessionDuplicateRows(){
  const tb=$('sessDupesRows');
  if(!tb)return;
  tb.innerHTML='';
  const dupes=analyzeSessionDuplicates(state.sessions||[]);
  state.sessionDupes=dupes;
  if(!dupes.length){
    tb.innerHTML='<tr><td colspan="9" class="sub">No duplicate fingerprints found in loaded sessions.</td></tr>';
    return;
  }
  dupes.forEach((d)=>{
    const tr=document.createElement('tr');
    tr.className='row';
    tr.innerHTML=''
      +'<td>'+escHtml(String(d.count))+'</td>'
      +'<td class="mono">'+escHtml(formatAdminTime(d.latestAt))+'</td>'
      +'<td>'+escHtml(d.league)+'</td>'
      +'<td>'+escHtml(String(d.trades.toLocaleString()))+'</td>'
      +'<td>'+escHtml(String(d.consumed.toLocaleString()))+'</td>'
      +'<td>'+escHtml(fmtChaosRaw(d.input))+'</td>'
      +'<td>'+escHtml(fmtChaosRaw(d.output))+'</td>'
      +'<td class="mono" title="'+escHtml(d.regex)+'">'+escHtml(d.regex)+'</td>'
      +'<td class="mono" title="'+escHtml(d.ids.join(', '))+'">'+escHtml(d.ids.slice(0,2).join(', ')+(d.ids.length>2?' ...':''))+'</td>';
    tb.appendChild(tr);
  });
}

function renderSessionSignalRows(){
  const tb=$('sessSignalsRows');
  if(!tb)return;
  tb.innerHTML='';
  const report=analyzeSessionTrustSignals(state.sessions||[]);
  state.sessionSignals=report.items;
  if($('sessSignalsMeta')){
    $('sessSignalsMeta').textContent='Median divine rate: '+(report.medianRate>0?report.medianRate.toFixed(2)+' c/div':'-')+' | Flagged sessions: '+report.items.length.toLocaleString();
  }
  if(!report.items.length){
    tb.innerHTML='<tr><td colspan="7" class="sub">No trust signals were flagged in loaded sessions.</td></tr>';
    return;
  }
  report.items.forEach((x)=>{
    const tr=document.createElement('tr');
    tr.className='row';
    tr.innerHTML=''
      +'<td class="mono">'+escHtml(x.id)+'</td>'
      +'<td class="mono">'+escHtml(formatAdminTime(x.createdAt))+'</td>'
      +'<td>'+escHtml(x.league)+'</td>'
      +'<td>'+severityBadge(x.severity)+'</td>'
      +'<td style="font-weight:700;color:'+signColor(x.score-70)+'">'+escHtml(String(x.score))+'</td>'
      +'<td style="color:'+signColor(x.roi)+'">'+escHtml((x.roi>=0?'+':'')+x.roi.toFixed(1)+'%')+'</td>'
      +'<td>'+escHtml(x.reasons.join(' | '))+'</td>';
    tb.appendChild(tr);
  });
}

function refreshSessionIntel(opts){
  const quiet=!!(opts&&opts.quiet);
  renderSessionDuplicateRows();
  renderSessionSignalRows();
  if(!quiet){
    status('sessDupesStatus','Resubmission Guard scanned '+(state.sessions||[]).length+' session(s).','ok');
    status('sessSignalsStatus','Integrity Checker refreshed from loaded session data.','ok');
  }
}
`;
