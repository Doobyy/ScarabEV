export const ADMIN_BASE_SCRIPT = String.raw`
const THEME_KEY='scarabev-admin-theme';
const MAIN_THEME_KEY='poepool-theme';
const WS_PROFILES_KEY='scarabev-admin-workspace-profiles-v2';
const WS_ACTIVE_KEY='scarabev-admin-workspace-active-v2';
const WS_SELECTED_KEY='scarabev-admin-workspace-selected-v2';
const SESS_CFG_KEY='scarabev-admin-session-manager-v1';

const state={
  user:null,scarabs:[],filtered:[],selected:null,selectedId:null,creating:false,
  tokensByName:{},draftTokensByScarabId:{},latestDraftEntries:[],sets:[],selectedIds:new Set(),
  sortBy:'name_asc',activePanel:'scarab',workspaceProfiles:[],activeWorkspaceId:null,selectedWorkspaceId:null,
  captureQueue:[],sessionApiUrl:'',sessionAdminKey:'',sessions:[],sessionExpandedIds:new Set(),sessionPageSize:25,sessionPage:1,sessionsAutoLoaded:false,backupsAutoLoaded:false,scarabsAutoLoaded:false,tokensAutoLoaded:false,healthAutoLoaded:false,
  sessionDupes:[],sessionSignals:[]
};

const $=(id)=>document.getElementById(id);
const status=(id,msg,t)=>{const n=$(id);if(!n)return;n.className='status'+(t?(' '+t):'');n.textContent=msg;};
const toast=(m)=>{const t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(window.__tt);window.__tt=setTimeout(()=>t.style.display='none',2200);};
const busy=(id,b)=>{const x=$(id);if(!x)return;x.disabled=!!b;if(b){x.dataset.prev=x.textContent;x.textContent='Working...';}else if(x.dataset.prev){x.textContent=x.dataset.prev;}};

function formatAdminTime(value){
  if(!value)return '-';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return String(value);
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Los_Angeles',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  }).formatToParts(d);
  const pick=(type)=>parts.find((p)=>p.type===type)?.value||'00';
  return pick('year')+'-'+pick('month')+'-'+pick('day')+' '+pick('hour')+':'+pick('minute');
}

function applyTheme(t){document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');$('themeBtn').textContent=t==='light'?'Theme: Light':'Theme: Dark';}
function initTheme(){let t='dark';try{const own=localStorage.getItem(THEME_KEY),shared=localStorage.getItem(MAIN_THEME_KEY);if(own==='light'||own==='dark')t=own;else if(shared==='light'||shared==='dark')t=shared;}catch(e){}applyTheme(t);}
function toggleTheme(){const dark=document.documentElement.getAttribute('data-theme')!=='light';const n=dark?'light':'dark';try{localStorage.setItem(THEME_KEY,n);localStorage.setItem(MAIN_THEME_KEY,n);}catch(e){}applyTheme(n);}

function switchPanel(name){
  state.activePanel=name;
  const labels={scarab:'Scarab Manager',sessions:'Session Manager',health:'Health',regex:'Regex Lab'};
  ['scarab','sessions','health','regex'].forEach((n)=>{const p=$('panel-'+n);if(p)p.classList.toggle('active',n===name);});
  document.querySelectorAll('.navbtn').forEach((b)=>b.classList.toggle('active',b.dataset.panel===name));
  $('panelTitle').textContent=(labels[name]||'Dashboard')+' | Staging-first control plane';
}

function setAuthUi(ok){$('login').classList.toggle('hidden',ok);$('app').classList.toggle('hidden',!ok);$('topBar').classList.toggle('hidden',!ok);$('sessionTxt').textContent=ok?('Signed in: '+state.user.username):'Signed out';}
function csrf(){const p=document.cookie.split(';').map((v)=>v.trim()).find((v)=>v.startsWith('scarabev_csrf='));return p?decodeURIComponent(p.slice(14)):'';}
async function api(path,opt={}){const m=opt.method||'GET';const h=opt.headers||{};if(opt.body&&!h['content-type'])h['content-type']='application/json';if(m!=='GET'&&m!=='HEAD')h['x-csrf-token']=csrf();const r=await fetch(path,{method:m,headers:h,body:opt.body,credentials:'include'});const txt=await r.text();let j=null;try{j=JSON.parse(txt);}catch(e){}return{res:r,json:j,text:txt};}

function badge(s){const c=s==='active'?'active':(s==='retired'?'retired':'draft');return '<span class="badge '+c+'">'+s+'</span>';}
function escRegex(s){return String(s).replace(/[.*+?^{}()|[\\]\\$]/g,'\\$&');}
function modArr(v){return v.split(/\\r?\\n|,/).map((x)=>x.trim()).filter(Boolean);}
`;
