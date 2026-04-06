export const ADMIN_UI_CSS = String.raw`
:root{--bg:#0c1320;--panel:#121d2f;--card:#1a2740;--surface:#223351;--line:#3a5780;--line-soft:#2e4567;--text:#edf3ff;--muted:#9db3d1;--accent:#1f9c90;--ok:#3fcb7a;--warn:#d79a42;--danger:#ef5a52;--shadow:0 10px 24px rgba(2,8,18,.35);--input-bg:#e5ebf4;--input-text:#16263c;--input-line:#b9c5d8;--heading:#8fb8ff;--outcome-muted:#74839c}
[data-theme="light"]{--bg:#f2f6fb;--panel:#e9f0f8;--card:#fff;--surface:#f7fbff;--line:#c9d8ea;--line-soft:#dde7f3;--text:#0f1f30;--muted:#566c88;--accent:#0e8679;--ok:#1d8f53;--warn:#b96817;--danger:#d43f37;--shadow:0 6px 16px rgba(12,24,46,.08);--input-bg:#f4f8fd;--input-text:#10243b;--input-line:#cfd9e8;--heading:#2563d8;--outcome-muted:#8c96a8}
*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:radial-gradient(circle at 8% 12%,rgba(31,156,144,.15),transparent 32%),var(--bg);color:var(--text)}
.top{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--panel);border-bottom:1px solid var(--line)}
.title{font-weight:700;color:var(--heading)}.sub{font-size:12px;color:var(--muted)}.sub b{color:var(--heading)}.mono,.chip{font-family:Consolas,ui-monospace,monospace}
.btn{border:1px solid transparent;border-radius:7px;padding:6px 10px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}.btn:disabled{opacity:.45;cursor:default;filter:saturate(.45);pointer-events:none}.btn.ghost{background:var(--surface);border-color:var(--line);color:var(--text)}.btn.warn{background:var(--warn)}.btn.danger{background:var(--danger)}
.btn:disabled,.btn:disabled:hover{background:var(--surface);border-color:var(--line);color:var(--muted);box-shadow:none;outline:none;filter:saturate(.45)}
.btn.mini{padding:3px 7px;border-radius:6px;font-size:11px;line-height:1.2}
.btn.subtle{opacity:.84}
.btn.subtle:hover{opacity:1}
.session-head{justify-content:space-between;align-items:center}
.sess-filetabs{display:flex;gap:6px;align-items:end;padding:0 6px;position:relative;z-index:2;margin-bottom:-1px}
.sess-tab{border:1px solid var(--line);border-bottom:none;border-radius:7px 7px 0 0;padding:6px 12px;background:color-mix(in srgb,var(--surface) 85%,var(--card));color:var(--muted);font-weight:700;font-size:12px;cursor:pointer}
.sess-tab:hover{color:var(--text)}
.sess-tab.active{background:var(--card);color:var(--heading);border-color:var(--accent)}
.sess-frame{border-top-left-radius:0;padding-top:10px}
.sess-pane{display:none;gap:8px;align-content:start}
.sess-pane.active{display:grid}
.mgr-filetabs{display:flex;gap:6px;align-items:end;padding:0 6px;position:relative;z-index:2;margin-bottom:-1px}
.mgr-tab{border:1px solid var(--line);border-bottom:none;border-radius:7px 7px 0 0;padding:6px 12px;background:color-mix(in srgb,var(--surface) 85%,var(--card));color:var(--muted);font-weight:700;font-size:12px;cursor:pointer}
.mgr-tab:hover{color:var(--text)}
.mgr-tab.active{background:var(--card);color:var(--heading);border-color:var(--accent)}
.mgr-frame{border-top-left-radius:0;padding-top:10px}
.scarab-pane{display:none;gap:8px;align-content:start}
.scarab-pane.active{display:grid}
.shell{display:grid;grid-template-columns:230px 1fr;min-height:calc(100vh - 57px)}
.sidebar{background:var(--panel);border-right:1px solid var(--line);padding:12px;display:grid;align-content:start;gap:8px;position:sticky;top:57px;height:calc(100vh - 57px)}.navbtn{width:100%;text-align:left;padding:8px 10px;border-radius:7px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer;font-weight:600}.navbtn.active,.navbtn:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 18%,var(--card))}
.content{padding:12px;display:grid;gap:12px;align-content:start}.panel{display:none;gap:12px;align-content:start}.panel.active{display:grid}.card{border:1px solid var(--line);background:var(--card);border-radius:9px;padding:10px;display:grid;gap:8px;box-shadow:var(--shadow)}
#panel-sessions,#panel-scarab{gap:0}
.h{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--heading);font-weight:700}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pager{justify-content:space-between}
.pager select{width:56px;padding:2px 4px;border-radius:5px;height:24px;font-size:11px}
.pager-discreet{margin-top:4px;opacity:.9}
.pager-discreet .sub{font-size:11px}
.pager-right{display:flex;gap:6px;align-items:center}
.sess-rows-top{justify-content:flex-end;margin-top:-2px}
.sess-rows-top .sub{font-size:11px}
.sess-rows-top select{width:56px;padding:2px 4px;border-radius:5px;height:24px;font-size:11px}
.scarab-filters input,.scarab-filters select{height:28px;padding:3px 8px;border-radius:5px;font-size:12px}
input,textarea,select{width:100%;border:1px solid var(--input-line);background:var(--input-bg);color:var(--input-text);border-radius:7px;padding:6px;font:inherit}textarea{resize:vertical}
input::placeholder,textarea::placeholder{color:color-mix(in srgb,var(--input-text) 55%,#6f7d93)}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent)}
.status{border:1px solid var(--line);background:var(--surface);border-radius:7px;padding:8px;font-size:12px;white-space:pre-wrap;min-height:36px}.status.ok{border-color:var(--ok)} .status.warn{border-color:var(--warn)} .status.err{border-color:var(--danger)}
.list{height:420px;min-height:420px;max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:7px;background:var(--surface)}.scarab-list{height:auto;min-height:0;max-height:none;overflow:visible}.token-set-list{height:auto;min-height:0;max-height:none;overflow:visible}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px;border-bottom:1px solid var(--line-soft);text-align:left;vertical-align:middle}th{position:sticky;top:0;background:var(--card);color:var(--heading);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.session-list{height:auto;min-height:0;max-height:none;overflow:auto}
tr.row{cursor:pointer} tr.row:nth-child(even){background:color-mix(in srgb,var(--surface) 80%,var(--card))} tr.row:hover{background:color-mix(in srgb,var(--accent) 16%,var(--surface))} tr.row.sel{background:color-mix(in srgb,var(--accent) 28%,var(--surface))}
.badge{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:2px 7px;display:inline-block}.badge.active{border-color:var(--ok);color:var(--ok)} .badge.retired{border-color:var(--danger);color:var(--danger)} .badge.draft{border-color:var(--warn);color:var(--warn)}
.badge.ok{border-color:var(--ok);color:var(--ok)}
.badge.warn{border-color:var(--warn);color:var(--warn)}
.badge.danger{border-color:var(--danger);color:var(--danger)}
.chip{font-size:11px;border:1px solid var(--line);border-radius:8px;padding:2px 6px;display:inline-block;background:var(--surface)}
.kpi{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.metric{border:1px solid var(--line);background:var(--surface);border-radius:7px;padding:7px 9px}.metric b{display:block;font-size:18px;color:var(--heading)}.metric span{font-size:11px;color:var(--muted);text-transform:uppercase}
.hidden{display:none!important}.check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)} .check input{width:auto}
#login{position:relative;overflow:hidden;min-height:100vh;display:grid;place-items:center;padding:18px;background:radial-gradient(1040px 520px at 56% -10%,rgba(133,197,238,.18) 0%,rgba(95,149,214,.11) 34%,transparent 84%),radial-gradient(860px 420px at 14% 94%,rgba(39,98,194,.13) 0%,rgba(31,68,144,.08) 48%,transparent 84%),radial-gradient(900px 430px at 96% 84%,rgba(43,154,166,.08) 0%,rgba(31,91,141,.05) 44%,transparent 88%),linear-gradient(170deg,#071120,#0a172d 47%,#091223)}
#login::before{content:"";position:absolute;right:-120px;top:-120px;width:520px;height:520px;border-radius:50%;pointer-events:none;filter:blur(16px);background:radial-gradient(circle at 36% 34%,rgba(162,206,236,.44) 0%,rgba(118,170,224,.30) 19%,rgba(82,124,196,.14) 44%,rgba(58,88,155,.05) 62%,transparent 90%),radial-gradient(circle at 58% 62%,rgba(104,160,208,.08) 0%,transparent 76%);opacity:.48}
#login::after{content:"";position:absolute;left:-150px;bottom:-170px;width:620px;height:620px;border-radius:50%;pointer-events:none;filter:blur(12px);background:radial-gradient(circle at 55% 50%,rgba(38,162,152,.14) 0%,rgba(31,86,165,.09) 46%,transparent 86%);opacity:.58}
.login-shell{position:relative;z-index:1;width:min(460px,94vw);display:grid}
.login-brand{display:grid;gap:4px;text-align:center;padding:0}
.login-brand-title{font-size:27px;line-height:1.05;font-weight:800;color:var(--heading)}
.login-brand-sub{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);font-weight:700}
.login-card{border-radius:24px;padding:26px 20px 18px;gap:12px;backdrop-filter:blur(7px);background:linear-gradient(165deg,rgba(21,35,58,.915),rgba(17,30,50,.865));border-color:rgba(104,146,212,.46);box-shadow:0 30px 64px rgba(2,8,18,.62),0 10px 20px rgba(2,8,18,.42)}
#login .grid2{grid-template-columns:1fr}
#login input{text-align:center}
#login input::placeholder{text-align:center}
#login .toolbar{display:block}
#login #loginBtn{width:100%;min-width:0}
#login #authStatus{min-height:0}
.toast{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:8px;display:none;font-size:12px}
.modal-wrap{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(1,6,14,.68);z-index:60}.modal-wrap.open{display:flex}.modal{width:min(920px,96vw);max-height:92vh;overflow:auto;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:12px;display:grid;gap:10px;box-shadow:var(--shadow)}.modal-head{display:flex;justify-content:space-between;align-items:center}
.regex-card{max-width:980px}
.syntax-guide{border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:8px 10px;display:grid;gap:4px;line-height:1.3}
.syntax-guide .sub{line-height:1.3}
.syntax-guide .sub b{margin:0}
.syntax-guide .sub.mono{padding-left:8px}
.syntax-block{display:grid;gap:2px}
.syntax-block + .syntax-block{margin-top:4px;padding-top:0}
.syntax-ops{display:grid;gap:0;border:1px solid var(--line-soft);border-radius:8px;overflow:hidden}
.syntax-op{display:grid;grid-template-columns:140px 1fr 240px 240px;gap:8px;font-size:12px;color:var(--muted);line-height:1.3}
.syntax-op.syntax-head{color:var(--heading);font-weight:700;background:color-mix(in srgb,var(--surface) 80%,var(--card));padding:6px 8px;border-bottom:1px solid var(--line-soft)}
.syntax-ops .syntax-op:not(.syntax-head){padding:6px 8px;border-bottom:1px solid var(--line-soft);transition:background .15s ease}
.syntax-ops .syntax-op:not(.syntax-head):last-child{border-bottom:none}
.syntax-ops .syntax-op:not(.syntax-head):hover{background:color-mix(in srgb,var(--accent) 14%,var(--surface))}
.syntax-op:not(.syntax-head) span:nth-child(3),
.syntax-op:not(.syntax-head) span:nth-child(4){
  color:color-mix(in srgb,var(--muted) 68%,var(--text));
}
.op-outcome{color:var(--outcome-muted);}
.regex-controls{display:grid;grid-template-columns:260px 1fr;gap:8px;align-items:center}
#rbInput{min-height:110px;max-height:110px;resize:none}
#rbOut{min-height:160px;max-height:160px;resize:none}
.capture-list{height:340px}
.progress{margin-top:6px;height:10px;border:1px solid var(--line);background:var(--surface);border-radius:999px;overflow:hidden}
.progress-bar{height:100%;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 65%,#fff));transition:width .2s ease}
.ops-list{height:auto;min-height:0;max-height:none;overflow:visible}
.ops-id{font-size:11px;white-space:nowrap}
.ops-path{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ops-actions{display:flex;gap:6px}
.ops-list td .mono{word-break:break-all;overflow-wrap:anywhere}
.session-list .row.session-main{cursor:pointer}
.session-list .row.session-main:hover{background:color-mix(in srgb,var(--accent) 12%,var(--surface))}
.session-list .row.session-main.open{background:color-mix(in srgb,var(--accent) 22%,var(--surface));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 45%,var(--line))}
.session-main-id{display:flex;align-items:center;gap:6px}
.session-chev{display:inline-block;width:10px;color:var(--muted);font-size:10px;transition:transform .12s ease}
.session-chev.open{transform:rotate(90deg)}
.session-detail-row td{padding:0;border-bottom:1px solid var(--line-soft)}
.session-detail{background:color-mix(in srgb,var(--surface) 58%,var(--card));padding:10px;display:grid;gap:10px;border-top:1px solid color-mix(in srgb,var(--accent) 45%,var(--line))}
.session-detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.session-detail-card{border:1px solid var(--line-soft);border-radius:8px;background:var(--card);padding:8px}
.session-detail-card .lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.session-detail-card .val{font-size:16px;font-weight:700;margin-top:2px}
.session-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;font-size:11px;color:var(--muted)}
.session-meta b{color:var(--heading);font-weight:700}
.session-meta .mono{color:var(--text);word-break:break-all;overflow-wrap:anywhere}
.session-scarab-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.session-scarab-box{border:1px solid var(--line-soft);border-radius:8px;background:var(--card);padding:8px}
.session-scarab-head{font-size:10px;color:var(--heading);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.session-scarab-row{display:grid;grid-template-columns:1fr 56px 56px 56px;gap:6px;font-size:11px;padding:3px 0;border-bottom:1px solid var(--line-soft)}
.session-scarab-row:last-child{border-bottom:none}
.session-list table{table-layout:auto}
.session-list th:nth-child(1),.session-list td:nth-child(1){min-width:210px}
.session-list th:nth-child(2),.session-list td:nth-child(2){min-width:128px}
.session-list th:last-child,.session-list td:last-child{width:90px}
.session-list td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-list th,.session-list td{padding:6px}
.session-list .session-detail-row td{white-space:normal;overflow:visible}
.session-main-id .mono,.session-main-id{min-width:0;overflow:hidden;text-overflow:ellipsis}
.health-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.health-card{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:8px;display:grid;gap:6px}
.health-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.health-detail{font-size:12px;color:var(--text)}
@media(max-width:1000px){.shell{grid-template-columns:1fr}.sidebar{grid-auto-flow:column;overflow:auto}.grid2,.grid3,.kpi,.regex-controls,.syntax-op,.session-detail-grid,.session-meta,.session-scarab-split,.health-grid{grid-template-columns:1fr}.list,.scarab-list,.token-set-list{height:320px;min-height:320px;max-height:320px}}
`;
