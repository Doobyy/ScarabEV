export function buildAdminMarkup(): string {
  return String.raw`
<header id="topBar" class="top"><div><div class="title">ScarabEV Admin Plane</div><div id="panelTitle" class="sub">Scarab Manager | Staging-first control plane</div></div><div class="toolbar"><button id="themeBtn" class="btn ghost" type="button">Theme: Dark</button><button id="signoutBtn" class="btn ghost" type="button">Sign Out</button><span id="sessionTxt" class="sub mono">Signed out</span></div></header>
<section id="login"><div class="login-shell"><div class="card login-card"><div class="login-brand"><div class="login-brand-title">ScarabEV</div><div class="login-brand-sub">Admin Dashboard</div></div><div class="grid2"><input id="username" placeholder="Username"/><input id="password" type="password" placeholder="Password"/></div><div class="toolbar"><button id="loginBtn" class="btn" type="button">Login</button></div><div id="authStatus" class="status hidden"></div></div></div></section>
<section id="app" class="shell hidden">
  <aside class="sidebar"><div class="h">Navigation</div><button id="navHealth" class="navbtn active" type="button" data-panel="health">Health</button><button id="navScarab" class="navbtn" type="button" data-panel="scarab">Scarab Manager</button><button id="navSessions" class="navbtn" type="button" data-panel="sessions">Session Manager</button><button id="navRegex" class="navbtn" type="button" data-panel="regex">Regex Lab</button></aside>
  <main class="content">
    <section id="panel-scarab" class="panel">
      <div class="mgr-filetabs"><button id="scarabTabList" class="mgr-tab active" type="button">Scarab List</button><button id="scarabTabRestore" class="mgr-tab" type="button">Restore</button><button id="scarabTabRegex" class="mgr-tab" type="button">Regex Test</button></div>
      <div class="card mgr-frame">
        <section id="scarabPaneList" class="scarab-pane active">
          <div class="kpi"><div class="metric"><span>Total</span><b id="metricTotal">0</b></div><div class="metric"><span>Active</span><b id="metricActive">0</b></div><div class="metric"><span>Retired</span><b id="metricRetired">0</b></div><div class="metric"><span>Regex Conflicts</span><b id="metricConflicts">0</b></div></div>
          <div class="toolbar"><button id="addBtn" class="btn" type="button">Add Scarab</button><button id="captureToolBtn" class="btn ghost" type="button">Capture Tool</button><button id="importBtn" class="btn ghost" type="button">Upload JSON Import</button><input id="importFile" type="file" accept="application/json,.json" class="hidden" /><button id="retireSelectedBtn" class="btn warn" type="button">Retire Selected</button><button id="deleteSelectedBtn" class="btn danger" type="button">Delete Selected</button><button id="genActiveBtn" class="btn ghost" type="button">Generate Draft</button><button id="publishActiveBtn" class="btn ghost" type="button">Publish Draft</button><button id="refreshBtn" class="btn ghost" type="button">Refresh</button></div><div id="bulkProgressStatus" class="status hidden"><div id="bulkProgressText">Working...</div><div class="progress"><div id="bulkProgressBar" class="progress-bar" style="width:0%"></div></div></div><div class="grid3 scarab-filters"><input id="q" placeholder="Search name / token..."/><select id="sf"><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="retired">Retired</option></select><select id="sortBy"><option value="name_asc">Sort: Name (A-Z)</option><option value="name_desc">Sort: Name (Z-A)</option><option value="created_desc">Sort: Newest first</option><option value="created_asc">Sort: Oldest first</option><option value="status">Sort: Status</option></select></div><div class="list scarab-list"><table><thead><tr><th style="width:40px"><input id="selectAll" type="checkbox"/></th><th>Name</th><th>Status</th><th>Published Token</th><th>Draft Token</th></tr></thead><tbody id="rows"></tbody></table></div><div id="listStatus" class="status">Loading...</div>
        </section>
        <section id="scarabPaneRestore" class="scarab-pane">
          <div class="sub">Recovery tools for when a publish goes wrong. Roll back to a known-good token set.</div><div class="toolbar"><button id="tokRefreshBtn" class="btn ghost" type="button">Refresh Sets</button></div><div class="sub">Published: <span id="pubVer" class="mono">-</span> | Items: <span id="pubCount" class="mono">-</span></div><div class="grid2"><input id="rbId" placeholder="token set id for rollback or delete"/><div class="toolbar"><button id="rbBtn" class="btn warn" type="button">Rollback</button><button id="deleteSetBtn" class="btn danger" type="button">Delete Set</button></div></div><div class="list token-set-list"><table><thead><tr><th>ID</th><th>State</th><th>Created</th><th>Items</th></tr></thead><tbody id="setRows"></tbody></table></div><div id="tokStatus" class="status">Ready.</div>
        </section>
        <section id="scarabPaneRegex" class="scarab-pane">
          <div class="sub">Quick in-game validation helper. Builds two regex strings from the latest draft set.</div>
          <div class="toolbar"><button id="buildRegexBtn" class="btn ghost" type="button">Build 2 Regex (250 max)</button></div>
          <div class="grid2"><textarea id="regex1" rows="3" placeholder="Regex 1"></textarea><textarea id="regex2" rows="3" placeholder="Regex 2"></textarea></div>
          <div id="regexStatus" class="status">Build regex from latest draft.</div>
        </section>
      </div>
    </section>
    <section id="panel-sessions" class="panel">
      <div class="sess-filetabs"><button id="sessTabSessions" class="sess-tab active" type="button">Session Manager</button><button id="sessTabBackups" class="sess-tab" type="button">Session Backups</button><button id="sessTabDupes" class="sess-tab" type="button">Resubmission Guard</button><button id="sessTabSignals" class="sess-tab" type="button">Integrity Checker</button></div>
      <div class="card sess-frame">
        <section id="sessPaneSessions" class="sess-pane active">
          <div class="toolbar session-head"><div class="sub">Front-facing session log manager for aggregated community data. Review sessions and delete bad entries.</div><button id="sessOpenCfgBtn" class="btn ghost mini subtle" type="button">API Settings</button></div>
          <div class="toolbar sess-rows-top"><span class="sub">Rows</span><select id="sessPageSize"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option></select></div>
          <div class="toolbar">
            <button id="sessLoadBtn" class="btn" type="button">Refresh Sessions</button>
            <button id="sessRecomputeBtn" class="btn warn" type="button">Recompute Aggregate</button>
          </div>
          <div class="kpi">
            <div class="metric"><span>Sessions</span><b id="sessMetricCount">0</b></div>
            <div class="metric"><span>Scarabs Consumed</span><b id="sessMetricConsumed">0</b></div>
            <div class="metric"><span>Total Trades</span><b id="sessMetricTrades">0</b></div>
            <div class="metric"><span>Total Profit (div)</span><b id="sessMetricProfit">0</b></div>
          </div>
          <div class="list session-list">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Date</th><th>League</th><th>Consumed</th><th>Trades</th><th>Input</th><th>Output</th><th>Profit (div)</th><th>Action</th>
                </tr>
              </thead>
              <tbody id="sessRows"></tbody>
            </table>
          </div>
          <div class="toolbar pager pager-discreet"><span id="sessPagerSummary" class="sub mono">Showing 0-0 of 0</span><div class="pager-right"><button id="sessPagePrev" class="btn ghost mini subtle" type="button">Prev</button><button id="sessPageNext" class="btn ghost mini subtle" type="button">Next</button></div></div>
          <div id="sessStatus" class="status">Configure API URL + admin key, then load sessions.</div>
        </section>
        <section id="sessPaneBackups" class="sess-pane">
          <div class="sub">Backup snapshots are shown in local time.</div>
          <div class="toolbar"><button id="opsListBtn" class="btn ghost" type="button">Refresh Backups</button><button id="opsRunBtn" class="btn" type="button">Run Backup</button></div>
          <div class="list ops-list"><table><thead><tr><th style="width:290px">Snapshot ID</th><th style="width:140px">Created</th><th>Object Path</th><th style="width:120px">Actions</th></tr></thead><tbody id="opsRows"></tbody></table></div>
          <div id="opsSummary" class="sub">Use this tab when you need backup tools.</div>
          <div id="opsStorageSummary" class="sub mono">R2 usage: -</div>
          <div id="opsStatus" class="status">Use this section to run or inspect backup snapshots in staging.</div>
        </section>
        <section id="sessPaneDupes" class="sess-pane">
          <div class="sub">Detect likely re-submissions by grouping sessions with identical fingerprints (league, regex, inputs/outputs, scarab payload).</div>
          <div class="toolbar"><button id="sessDupesRefreshBtn" class="btn ghost" type="button">Refresh Guard Scan</button></div>
          <div class="list ops-list"><table><thead><tr><th style="width:70px">Count</th><th style="width:140px">Latest</th><th style="width:100px">League</th><th style="width:80px">Trades</th><th style="width:90px">Consumed</th><th style="width:90px">Input</th><th style="width:90px">Output</th><th style="width:120px">Regex</th><th>Session IDs</th></tr></thead><tbody id="sessDupesRows"></tbody></table></div>
          <div id="sessDupesStatus" class="status">Load sessions first, then run guard scan.</div>
        </section>
        <section id="sessPaneSignals" class="sess-pane">
          <div class="sub">Risk scoring for suspicious but technically valid sessions (duplicates, extreme ROI, rate drift, structural inconsistencies).</div>
          <div class="toolbar"><button id="sessSignalsRefreshBtn" class="btn ghost" type="button">Refresh Integrity Check</button></div>
          <div id="sessSignalsMeta" class="sub">Median divine rate: - | Flagged sessions: 0</div>
          <div class="list ops-list"><table><thead><tr><th style="width:150px">Session ID</th><th style="width:140px">Date</th><th style="width:100px">League</th><th style="width:90px">Severity</th><th style="width:80px">Score</th><th style="width:90px">ROI</th><th>Signals</th></tr></thead><tbody id="sessSignalsRows"></tbody></table></div>
          <div id="sessSignalsStatus" class="status">Load sessions first, then run integrity check.</div>
        </section>
      </div>
    </section>
    <section id="panel-regex" class="panel">
      <div class="card regex-card">
        <div class="h">Regex Lab</div>
        <div class="sub">Build one regex at a time. Use <b>Basic</b> for easier inputs, or <b>Raw</b> if you want to write regex yourself.</div>
        <div class="syntax-guide">
          <div class="syntax-block">
            <div class="sub"><b>Basic mode quick guide</b></div>
            <div class="sub mono">"literal text" -> match these exact words</div>
            <div class="sub mono">[10-50] or [10..50] -> match any number from 10 to 50</div>
            <div class="sub mono">{10,25,60} -> match one of these exact numbers</div>
          </div>
          <div class="syntax-block">
            <div class="sub"><b>How Basic mode reads your input</b></div>
            <div class="sub mono">Regular text is treated as plain text (safe, auto-escaped).</div>
            <div class="sub mono">If a quote/bracket/brace is not closed, build fails and tells you why.</div>
            <div class="sub mono">Very large numeric ranges are blocked to avoid huge regex output.</div>
          </div>
          <div class="syntax-block">
            <div class="sub"><b>Space behavior</b></div>
            <div class="sub mono">If regex operators are present and box is checked, spaces become \s+ (one or more spaces/tabs/newlines).</div>
            <div class="sub mono">If no operators are present, repeated spaces are cleaned to one space.</div>
          </div>
          <div class="syntax-block">
            <div class="sub"><b>Raw mode</b></div>
            <div class="sub mono">Your input is used exactly as typed (no auto-fixes, no DSL parsing).</div>
          </div>
        </div>
        <div class="regex-controls"><select id="rbMode"><option value="basic">Basic (recommended)</option><option value="raw">Raw regex</option></select><label class="check"><input id="rbWs" type="checkbox" checked/>When operators exist, normalize spaces as \\s+</label></div>
        <textarea id="rbInput" rows="4" placeholder="Type literal text or syntax, e.g. players are 60% delirious"></textarea>
        <div class="toolbar"><button id="rbBuildBtn" class="btn" type="button">Build Regex</button><button id="rbCopyBtn" class="btn ghost" type="button">Copy</button></div>
        <textarea id="rbOut" rows="5" placeholder="Generated regex"></textarea>
        <div id="rbStatus" class="status">Ready. Enter a query and build.</div>
      </div>
      <div class="card regex-card">
        <div class="h">Confirmed PoE Operators</div>
        <div class="sub">These operators are confirmed working in PoE. Read each row as: pattern shape, what it matches, and what it does not match.</div>
        <div class="syntax-ops">
          <div class="syntax-op syntax-head"><span class="mono">Syntax</span><span>Pattern Shape</span><span>Matches</span><span>Does Not Match</span></div>
          <div class="syntax-op"><span class="mono">a|b</span><span>Either left side or right side.</span><span><span class="mono">chaos|fire</span><span class="op-outcome"> -> "chaos"</span></span><span><span class="mono">chaos|fire</span><span class="op-outcome"> -> "cold"</span></span></div>
          <div class="syntax-op"><span class="mono">(...)</span><span>Keep words grouped as one unit.</span><span><span class="mono">(scarab|map) drop</span><span class="op-outcome"> -> "map drop"</span></span><span><span class="mono">(scarab|map) drop</span><span class="op-outcome"> -> "map loot"</span></span></div>
          <div class="syntax-op"><span class="mono">[abc] / [a-z]</span><span>One character from set/range.</span><span><span class="mono">tier [1-9]</span><span class="op-outcome"> -> "tier 7"</span></span><span><span class="mono">tier [1-9]</span><span class="op-outcome"> -> "tier 10"</span></span></div>
          <div class="syntax-op"><span class="mono">.</span><span>Any single character in that spot.</span><span><span class="mono">t..n</span><span class="op-outcome"> -> "toon"</span></span><span><span class="mono">t..n</span><span class="op-outcome"> -> "tin"</span></span></div>
          <div class="syntax-op"><span class="mono">{n}</span><span>Exact repeat count.</span><span><span class="mono">a{3}</span><span class="op-outcome"> -> "aaa"</span></span><span><span class="mono">a{3}</span><span class="op-outcome"> -> "aa"</span></span></div>
          <div class="syntax-op"><span class="mono">*</span><span>Zero or more repeats.</span><span><span class="mono">ab*</span><span class="op-outcome"> -> "a", "ab", "abbb"</span></span><span><span class="mono">ab*</span><span class="op-outcome"> -> "b"</span></span></div>
          <div class="syntax-op"><span class="mono">+</span><span>One or more repeats.</span><span><span class="mono">ha+</span><span class="op-outcome"> -> "ha", "haaa"</span></span><span><span class="mono">ha+</span><span class="op-outcome"> -> "h"</span></span></div>
          <div class="syntax-op"><span class="mono">?</span><span>Optional once (0 or 1).</span><span><span class="mono">maps?</span><span class="op-outcome"> -> "map", "maps"</span></span><span><span class="mono">maps?</span><span class="op-outcome"> -> "mapss"</span></span></div>
          <div class="syntax-op"><span class="mono">\d</span><span>One digit (0-9).</span><span><span class="mono">tier \d</span><span class="op-outcome"> -> "tier 3"</span></span><span><span class="mono">tier \d</span><span class="op-outcome"> -> "tier A"</span></span></div>
          <div class="syntax-op"><span class="mono">\w</span><span>One word char (letter/number/_).</span><span><span class="mono">\w+</span><span class="op-outcome"> -> "map_2"</span></span><span><span class="mono">\w+</span><span class="op-outcome"> -> "!!!"</span></span></div>
          <div class="syntax-op"><span class="mono">\W</span><span>One non-word char (space/punctuation).</span><span><span class="mono">scarab\W</span><span class="op-outcome"> -> "scarab "</span></span><span><span class="mono">scarab\W</span><span class="op-outcome"> -> "scarabx"</span></span></div>
          <div class="syntax-op"><span class="mono">\S</span><span>One non-space char.</span><span><span class="mono">\S+</span><span class="op-outcome"> -> "hello"</span></span><span><span class="mono">\S+</span><span class="op-outcome"> -> "   "</span></span></div>
          <div class="syntax-op"><span class="mono">(?=...)</span><span>Next text must exist, but is not consumed.</span><span><span class="mono">scarab(?= of)</span><span class="op-outcome"> -> "scarab of"</span></span><span><span class="mono">scarab(?= of)</span><span class="op-outcome"> -> "scarab in"</span></span></div>
        </div>
      </div>
    </section>
    <section id="panel-health" class="panel active">
      <div class="card">
        <div class="h">Health Overview</div>
        <div class="sub">Quick signal checks across admin API, token pipeline, session API integration, and backups.</div>
        <div class="toolbar"><button id="healthRefreshBtn" class="btn ghost" type="button">Refresh Health</button></div>
        <div id="healthGrid" class="health-grid"></div>
        <div id="healthStatus" class="status">Health checks run automatically on sign-in.</div>
      </div>
    </section>
  </main>
</section>
<section id="sessCfgModalWrap" class="modal-wrap"><div class="modal" style="width:min(760px,95vw)"><div class="modal-head"><div><div class="h">Session API Settings</div><div class="sub">Set once, then use Session Manager without extra clutter.</div></div><button id="sessCfgCloseBtn" class="btn ghost" type="button">Close</button></div><div class="grid2"><input id="sessApiUrl" placeholder="Session API base URL (e.g. https://scarabev-api.../admin/sessions)" /><input id="sessAdminKey" placeholder="Admin key" /></div><div class="toolbar"><button id="sessSaveCfgBtn" class="btn" type="button">Save Key</button></div><div class="status warn">Lost your admin key? If this is a new browser/computer, generate or rotate a new <span class="mono">ADMIN_KEY</span> in Cloudflare Worker settings for the session API service, then paste the new key here and save. Cloudflare secrets are usually not viewable after they are set.</div></div></section>
<section id="editorModalWrap" class="modal-wrap"><div class="modal"><div class="modal-head"><div><div class="h">Scarab Editor</div><div id="editorMode" class="sub">Create new scarab</div></div><button id="editorCloseBtn" class="btn ghost" type="button">Close</button></div><div class="grid2"><div class="card"><div class="h">Parse From Advanced Text</div><textarea id="paste" rows="10" placeholder="Paste PoE Advanced Item copy here..."></textarea><div class="toolbar"><button id="parseBtn" class="btn" type="button">Parse Into Form</button><button id="clearPasteBtn" class="btn ghost" type="button">Clear</button></div><div id="pasteStatus" class="status">Paste then parse.</div></div><div class="card"><div class="h">Scarab Fields</div><input id="name" placeholder="Scarab name"/><textarea id="desc" rows="3" placeholder="Tooltip / description"></textarea><textarea id="mods" rows="4" placeholder="Modifiers (one per line)"></textarea><textarea id="flavor" rows="3" placeholder="Flavor text"></textarea><select id="status"><option value="active">active</option><option value="draft">draft</option><option value="retired">retired</option></select><input id="league" placeholder="leagueId (optional)"/><input id="season" placeholder="seasonId (optional, auto from workspace if blank)"/><div class="sub">Token: <span id="tokenPreview" class="chip">-</span></div><div id="meta" class="sub mono">No scarab selected.</div><div class="toolbar"><button id="saveBtn" class="btn" type="button">Save</button><button id="retireBtn" class="btn warn" type="button">Retire</button><button id="deleteBtn" class="btn danger" type="button">Delete</button></div><div id="editStatus" class="status">Ready.</div></div></div></div></section>
<section id="captureModalWrap" class="modal-wrap"><div class="modal"><div class="modal-head"><div><div class="h">Capture Helper</div><div class="sub">Web version of the old Python capture flow.</div></div><button id="captureCloseBtn" class="btn ghost" type="button">Close</button></div><div class="toolbar"><button id="captureFromClipboardBtn" class="btn" type="button">Capture Clipboard</button><button id="captureImportBtn" class="btn warn" type="button">Import Queue</button><button id="captureExportBtn" class="btn ghost" type="button">Export JSON</button><button id="captureClearBtn" class="btn danger" type="button">Reset Queue</button></div><div class="sub">Flow: hover item in game -> Ctrl+Alt+C -> return here -> Capture Clipboard.</div><div class="list capture-list"><table><thead><tr><th style="width:64px">#</th><th>Name</th><th>Captured (UTC)</th></tr></thead><tbody id="captureRows"></tbody></table></div><div id="captureStatus" class="status">Queue is empty.</div></div></section>
<div id="toast" class="toast"></div>
`;
}
