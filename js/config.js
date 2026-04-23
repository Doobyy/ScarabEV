// Static frontend configuration and constant datasets.
// Owns immutable values: lists, maps, ordering, and endpoints.
// Serves as a single source of truth shared across frontend modules.
// Prevents duplication of large static data in runtime files.
// Does not hold mutable state or execute app flow logic.


export const CDN = 'https://web.poecdn.com/image/Art/2DItems/Currency/Scarabs/';

export const SCARAB_LIST = [
  // CARTOGRAPHY
  { name:"Cartography Scarab of Escalation", group:"Cartography", icon:"LesserScarabMaps.webp" },
  { name:"Cartography Scarab of Risk", group:"Cartography", icon:"NormalScarabMaps.webp" },
  { name:"Cartography Scarab of Corruption", group:"Cartography", icon:"GreaterScarabMaps.webp" },
  { name:"Cartography Scarab of the Multitude", group:"Cartography", icon:"AltNormalScarabMaps.webp" },
  // DIVINATION
  { name:"Divination Scarab of The Cloister", group:"Divination", icon:"LesserScarabDivination.webp" },
  { name:"Divination Scarab of Plenty", group:"Divination", icon:"NormalScarabDivination.webp" },
  { name:"Divination Scarab of Pilfering", group:"Divination", icon:"GreaterScarabDivination.webp" },
  // BESTIARY
  { name:"Bestiary Scarab", group:"Bestiary", icon:"LesserScarabBeasts.webp" },
  { name:"Bestiary Scarab of the Herd", group:"Bestiary", icon:"NormalScarabBeasts.webp" },
  { name:"Bestiary Scarab of Duplicating", group:"Bestiary", icon:"GreaterScarabBeasts.webp" },
  // BETRAYAL
  { name:"Betrayal Scarab", group:"Betrayal", icon:"LesserScarabBetrayal.webp" },
  { name:"Betrayal Scarab of the Allflame", group:"Betrayal", icon:"NormalScarabBetrayal.webp" },
  { name:"Betrayal Scarab of Reinforcements", group:"Betrayal", icon:"GreaterScarabBetrayal.webp" },
  { name:"Betrayal Scarab of Unbreaking", group:"Betrayal", icon:"Tier4ScarabBetrayal.webp", isNew:true },
  // INCURSION
  { name:"Incursion Scarab", group:"Incursion", icon:"LesserScarabIncursion.webp" },
  { name:"Incursion Scarab of Invasion", group:"Incursion", icon:"NormalScarabIncursion.webp" },
  { name:"Incursion Scarab of Champions", group:"Incursion", icon:"GreaterScarabIncursion.webp" },
  { name:"Incursion Scarab of Timelines", group:"Incursion", icon:"Tier4ScarabIncursion.webp" },
  // SULPHITE
  { name:"Sulphite Scarab", group:"Sulphite", icon:"LesserScarabSulphite.webp" },
  { name:"Sulphite Scarab of Fumes", group:"Sulphite", icon:"GreaterScarabSulphite.webp" },
  // AMBUSH
  { name:"Ambush Scarab", group:"Ambush", icon:"LesserScarabStrongboxes.webp" },
  { name:"Ambush Scarab of Hidden Compartments", group:"Ambush", icon:"NormalScarabStrongboxes.webp" },
  { name:"Ambush Scarab of Potency", group:"Ambush", icon:"GreaterScarabStrongboxes.webp" },
  { name:"Ambush Scarab of Discernment", group:"Ambush", icon:"AltTier4ScarabStrongboxes.webp" },
  { name:"Ambush Scarab of Containment", group:"Ambush", icon:"Tier4ScarabStrongboxes.webp" },
  // ANARCHY
  { name:"Anarchy Scarab", group:"Anarchy", icon:"LesserScarabAnarchy.webp" },
  { name:"Anarchy Scarab of Gigantification", group:"Anarchy", icon:"NormalScarabAnarchy.webp" },
  { name:"Anarchy Scarab of Partnership", group:"Anarchy", icon:"GreaterScarabAnarchy.webp" },
  { name:"Anarchy Scarab of the Exceptional", group:"Anarchy", icon:"GreaterScarabAnarchy.webp", isNew:true },
  // BEYOND
  { name:"Beyond Scarab", group:"Beyond", icon:"LesserScarabBeyond.webp" },
  { name:"Beyond Scarab of Haemophilia", group:"Beyond", icon:"NormalScarabBeyond.webp" },
  { name:"Beyond Scarab of Resurgence", group:"Beyond", icon:"AltGreaterScarabBeyond.webp" },
  { name:"Beyond Scarab of the Invasion", group:"Beyond", icon:"Tier4ScarabBeyond.webp" },
  // DOMINATION
  { name:"Domination Scarab", group:"Domination", icon:"LesserScarabDomination.webp" },
  { name:"Domination Scarab of Apparitions", group:"Domination", icon:"NormalScarabDomination.webp" },
  { name:"Domination Scarab of Evolution", group:"Domination", icon:"GreaterScarabDomination.webp" },
  { name:"Domination Scarab of Terrors", group:"Domination", icon:"Tier4ScarabDomination.webp" },
  // ESSENCE
  { name:"Essence Scarab", group:"Essence", icon:"LesserScarabEssence.webp" },
  { name:"Essence Scarab of Ascent", group:"Essence", icon:"NormalScarabEssence.webp" },
  { name:"Essence Scarab of Stability", group:"Essence", icon:"GreaterScarabEssence.webp" },
  { name:"Essence Scarab of Calcification", group:"Essence", icon:"Tier4ScarabEssence.webp" },
  { name:"Essence Scarab of Adaptation", group:"Essence", icon:"AltTier4ScarabEssence.webp" },
  // TORMENT
  { name:"Torment Scarab", group:"Torment", icon:"LesserScarabTorment.webp" },
  { name:"Torment Scarab of Peculiarity", group:"Torment", icon:"NormalScarabTorment.webp" },
  { name:"Torment Scarab of Possession", group:"Torment", icon:"Tier4ScarabTorment.webp" },
  // INFLUENCING
  { name:"Influencing Scarab of the Shaper", group:"Influencing", icon:"LesserScarabShaper.webp" },
  { name:"Influencing Scarab of the Elder", group:"Influencing", icon:"LesserScarabElder.webp" },
  { name:"Influencing Scarab of Hordes", group:"Influencing", icon:"GreaterScarabElder.webp" },
  { name:"Influencing Scarab of Interference", group:"Influencing", icon:"Tier4ScarabShaper.webp" },
  // TITANIC
  { name:"Titanic Scarab", group:"Titanic", icon:"LesserScarabUnique.webp" },
  { name:"Titanic Scarab of Treasures", group:"Titanic", icon:"NormalScarabUnique.webp" },
  { name:"Titanic Scarab of Legend", group:"Titanic", icon:"GreaterScarabUnique.webp" },
  // ABYSS
  { name:"Abyss Scarab", group:"Abyss", icon:"LesserScarabAbyss.webp" },
  { name:"Abyss Scarab of Multitudes", group:"Abyss", icon:"NormalScarabAbyss.webp" },
  { name:"Abyss Scarab of Edifice", group:"Abyss", icon:"GreaterScarabAbyss.webp" },
  { name:"Abyss Scarab of Profound Depth", group:"Abyss", icon:"AltTier4ScarabAbyss.webp" },
  { name:"Abyss Scarab of Descending", group:"Abyss", icon:"AltNormalScarabAbyss.webp" },
  // BLIGHT
  { name:"Blight Scarab", group:"Blight", icon:"LesserScarabBlight.webp" },
  { name:"Blight Scarab of the Blightheart", group:"Blight", icon:"GreaterScarabBlight.webp" },
  { name:"Blight Scarab of Blooming", group:"Blight", icon:"Tier4ScarabBlight.webp" },
  { name:"Blight Scarab of Invigoration", group:"Blight", icon:"AltTier4ScarabBlight.webp" },
  // BREACH
  { name:"Breach Scarab of the Hive", group:"Breach", icon:"LesserScarabBreach.webp" },
  { name:"Breach Scarab of Instability", group:"Breach", icon:"NormalScarabBreach.webp" },
  { name:"Breach Scarab of the Marshal", group:"Breach", icon:"AltGreaterScarabBreach.webp" },
  { name:"Breach Scarab of the Incensed Swarm", group:"Breach", icon:"GreaterScarabBreach.webp" },
  { name:"Breach Scarab of Resonant Cascade", group:"Breach", icon:"AltTier4ScarabBreach.webp" },
  // DELIRIUM
  { name:"Delirium Scarab", group:"Delirium", icon:"LesserScarabDelirium.webp" },
  { name:"Delirium Scarab of Mania", group:"Delirium", icon:"NormalScarabDelirium.webp" },
  { name:"Delirium Scarab of Paranoia", group:"Delirium", icon:"GreaterScarabDelirium.webp" },
  { name:"Delirium Scarab of Neuroses", group:"Delirium", icon:"AltGreaterScarabDelirium.webp" },
  { name:"Delirium Scarab of Delusions", group:"Delirium", icon:"Tier4ScarabDelirium.webp" },
  // EXPEDITION
  { name:"Expedition Scarab", group:"Expedition", icon:"LesserScarabExpedition.webp" },
  { name:"Expedition Scarab of Runefinding", group:"Expedition", icon:"NormalScarabExpedition.webp" },
  { name:"Expedition Scarab of Verisium Powder", group:"Expedition", icon:"GreaterScarabExpedition.webp" },
  { name:"Expedition Scarab of Archaeology", group:"Expedition", icon:"Tier4ScarabExpedition.webp" },
  { name:"Expedition Scarab of Infusion", group:"Expedition", icon:"AltGreaterScarabExpedition.webp", isNew:true },
  // HARVEST
  { name:"Harvest Scarab", group:"Harvest", icon:"LesserScarabHarvest.webp" },
  { name:"Harvest Scarab of Doubling", group:"Harvest", icon:"GreaterScarabHarvest.webp" },
  { name:"Harvest Scarab of Cornucopia", group:"Harvest", icon:"Tier4ScarabHarvest.webp" },
  // KALGUURAN
  { name:"Kalguuran Scarab", group:"Kalguuran", icon:"LesserScarabSettlers.webp" },
  { name:"Kalguuran Scarab of Guarded Riches", group:"Kalguuran", icon:"NormalScarabSettlers.webp" },
  { name:"Kalguuran Scarab of Refinement", group:"Kalguuran", icon:"GreaterScarabSettlers.webp" },
  { name:"Kalguuran Scarab of Enriching", group:"Kalguuran", icon:"GreaterScarabSettlers.webp", isNew:true },
  // LEGION
  { name:"Legion Scarab", group:"Legion", icon:"LesserScarabLegion.webp" },
  { name:"Legion Scarab of Officers", group:"Legion", icon:"NormalScarabLegion.webp" },
  { name:"Legion Scarab of Treasures", group:"Legion", icon:"AltNormalScarabLegion.webp" },
  { name:"Legion Scarab of Eternal Conflict", group:"Legion", icon:"Tier4ScarabLegion.webp" },
  // RITUAL
  { name:"Ritual Scarab of Selectiveness", group:"Ritual", icon:"LesserScarabRitual.webp" },
  { name:"Ritual Scarab of Wisps", group:"Ritual", icon:"NormalScarabRitual.webp" },
  { name:"Ritual Scarab of Abundance", group:"Ritual", icon:"GreaterScarabRitual.webp" },
  { name:"Ritual Scarab of Corpses", group:"Ritual", icon:"NormalScarabRitual.webp", isNew:true },
  // ULTIMATUM
  { name:"Ultimatum Scarab", group:"Ultimatum", icon:"LesserScarabUltimatum.webp" },
  { name:"Ultimatum Scarab of Bribing", group:"Ultimatum", icon:"NormalScarabUltimatum.webp" },
  { name:"Ultimatum Scarab of Dueling", group:"Ultimatum", icon:"GreaterScarabUltimatum.webp" },
  { name:"Ultimatum Scarab of Catalysing", group:"Ultimatum", icon:"Tier4ScarabUltimatum.webp" },
  { name:"Ultimatum Scarab of Inscription", group:"Ultimatum", icon:"AltTier4ScarabUltimatum.webp" },
  // MISC
  { name:"Scarab of Monstrous Lineage", group:"Misc", icon:"LesserScarabMisc.webp" },
  { name:"Scarab of Adversaries", group:"Misc", icon:"AltLesserScarabMisc.webp" },
  { name:"Scarab of Divinity", group:"Misc", icon:"NormalScarabMisc.webp" },
  { name:"Scarab of the Sinistral", group:"Misc", icon:"GreaterScarabMisc.webp" },
  { name:"Scarab of Stability", group:"Misc", icon:"Tier4ScarabMisc.webp" },
  { name:"Scarab of Wisps", group:"Misc", icon:"GreaterScarabMisc1.webp" },
  { name:"Scarab of Radiant Storms", group:"Misc", icon:"Tier4ScarabMisc2.webp" },
  { name:"Scarab of the Dextral", group:"Misc", icon:"AltLesserScarabMisc.webp", isNew:true },
  // HORNED
  { name:"Horned Scarab of Bloodlines", group:"Horned", icon:"SuperScarab1.webp" },
  { name:"Horned Scarab of Nemeses", group:"Horned", icon:"SuperScarab2.webp" },
  { name:"Horned Scarab of Preservation", group:"Horned", icon:"SuperScarab3.webp" },
  { name:"Horned Scarab of Awakening", group:"Horned", icon:"SuperScarab1.webp" },
  { name:"Horned Scarab of Glittering", group:"Horned", icon:"SuperScarab2.webp" },
  { name:"Horned Scarab of Pandemonium", group:"Horned", icon:"SuperScarab3.webp" },
  { name:"Horned Scarab of Tradition", group:"Horned", icon:"SuperScarab1.webp" },
];

export const ALPHA_ORDER = [
  "Abyss","Ambush","Anarchy","Bestiary","Betrayal","Beyond","Blight","Breach",
  "Cartography","Delirium","Divination","Domination","Essence","Expedition",
  "Harvest","Horned","Incursion","Influencing","Kalguuran","Legion",
  "Misc","Ritual","Sulphite","Titanic","Torment","Ultimatum"
];

export const INGAME_ORDER = [
  "Cartography","Divination","Bestiary","Betrayal","Incursion","Sulphite",
  "Ambush","Anarchy","Beyond","Domination","Essence","Torment",
  "Influencing","Titanic","Abyss","Blight","Breach","Delirium",
  "Expedition","Harvest","Kalguuran","Legion","Ritual","Ultimatum",
  "Misc","Horned"
];
export const POOL_API_URL = 'https://scarabev-api.paperpandastacks.workers.dev';

export const FAQ_SECTIONS = [
  {
    title: 'What is the scarab vendor recipe?',
    body: `Trade <strong>any 3 scarabs</strong> to any vendor NPC and receive <strong>1 random scarab</strong> from the vendor recipe pool. Most returns are cheap commons, but occasionally you get something worth 50–500× your inputs. Over enough trades, outputs can exceed input cost when market conditions make the recipe favorable.`
  },
  {
    title: 'Why vendor instead of just selling?',
    body: `<strong>Liquidity</strong> — low-value scarabs tend to move slowly on the market. Listing hundreds of them and waiting days for buyers is impractical. The vendor recipe converts that unsellable bulk into fewer, higher-value scarabs that actually sell. <strong>Profitability</strong> — when your vendor targets cost less than what the vendor returns on average, every trade is mathematically in your favor. When scarabs are priced below your active threshold, vendoring is usually more profitable than direct selling. ScarabEV shows exactly which scarabs fall below that line.`
  },
    {
    title: 'What is vendor threshold, how is it calculated, and which model should I use?',
    body: `The <code>vendor_threshold</code> is the highest price per scarab that still makes the 3:1 vendor recipe worth doing.<br>
Scarabs at or below that price are usually better to vendor, while scarabs above it are usually better traded through Faustus.<br><br>
The core calculation is:<br>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">vendor_threshold = expected_value / 3</code>
The difference between Harmonic and Weighted is how <code>expected_value</code> is estimated:<br><br>
<strong>Harmonic EV:</strong> best while current-league weight data is still being established. It does not depend on unstable early weight estimates, so it gives a safer threshold during this phase.<br>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">harmonic_ev = scarab_count / SUM(1 / each_scarab_price)<br>vendor_threshold = harmonic_ev / 3</code>
<strong>Weighted EV:</strong> best once current-league weights look stable and solved to an acceptable level of accuracy. At that point, it is the more accurate model for threshold recommendations.<br>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">weighted_ev = SUM(observed_weight * current_price) / 3<br>vendor_threshold = weighted_ev / 3</code><br>
In short, both models use the same threshold framework, but they are meant for different data conditions: Harmonic EV is the safer default while weights are still stabilizing, and Weighted EV is the more accurate default once weight data is stable enough to trust.`
  },
    {
    title: 'How does the Vendor Profit Estimator work?',
    body: `Import your Wealthy Exile CSV and the estimator computes four numbers using current market prices:<br><br>
<strong>Scarabs to Vendor</strong> - how many of your scarabs fall below the current threshold.<br>
<strong>Input Value</strong> - their current market value if you sold them all (<code>SUM(quantity * current_price)</code>).<br>
<strong>Est. Return</strong> - expected keeper value back from vendoring, using a recycle-loop model at your selected threshold.<br>
<strong>Est. Profit</strong> - return minus input value.<br><br>
Estimator return uses the calibrated loop rate. At your threshold, outputs at or below threshold are treated as re-vendored, and outputs above threshold are treated as keepers. This is solved as:<br>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">loop_rate = keeper_value_share / (3 - vendor_chance)</code>
This keeps estimates aligned with real workflows where you keep vendoring until only keepers remain.<br><br>
<em>Note: a negative est. profit does not always mean a practical loss. Those scarabs may be slow or unrealistic to liquidate individually, and vendoring can still be the cleaner conversion path.</em>`
  },
  {
    title: 'How is community data aggregated and validated?',
    body: `Every submitted session passes automated quality checks before contributing to the shared database. Sessions that fail are saved to your local history but <strong>never affect community weights or calibration</strong>.<br><br>
<strong>What gets accepted:</strong> sessions with ≥500 scarabs consumed, meaningful keeper outputs, and a healthy mix of cheap vendor-target scarabs in the return pool.<br><br>
<strong>What gets excluded:</strong><br>
• <em>Low sample</em> — fewer than 500 scarabs consumed<br>
• <em>Zero keeper outputs</em> — nothing came back worth keeping<br>
• <em>Recycled session</em> — recycled runs are excluded using multiple integrity checks (including vendor-target ratio, output-count tolerance, and output/trade coverage) because re-vendoring returns in the same session inflates expensive scarab frequency in weight data.<br>
• <em>Outputs exceed inputs</em> — physically impossible in a single pass<br>
• <em>No movement / no meaningful change</em> — before/after snapshots show no valid session delta, so submission is blocked<br><br>
The recycling checks matter most. A clean single-pass session usually returns a mix of cheap commons and occasional keepers — cheap commons dominate the vendor pool. If almost nothing vendor-target came back, the session was likely recycled and the data is unusable for weight calibration.`
  },
  {
    title: 'How do I log a session?',
    body: `<strong>Standard tracking</strong> (personal profit, no data contribution requirements):<br>
Export Wealthy Exile before your session → vendor your marked scarabs → export after → upload both CSVs on the Session Logger tab with your regex → submit.<br><br>
<div class="notice notice-amber"><strong>For clean community data:</strong> use a dedicated returns stash tab. Vendor once, place all returns there, then export and log before re-vendoring anything. Each single pass = one session submission. This keeps the weight data accurate for everyone. For full step-by-step instructions, see the <a href="#logger" onclick="switchTab('logger'); ensureLoggerHowToExpanded(); return false;" style="color:var(--accent);font-weight:600;text-decoration:none">Session Logger How-to</a>.</div>`
  },
    {
    title: 'How does the Bulk Buy Analyzer work, and how do I get the most accurate results?',
    body: `The Bulk Buy Analyzer evaluates TFT bulk listings against current market prices and your current EV threshold - showing expected return, net value, and a per-scarab breakdown.<br><br>
<strong>Two ways to get listing data in:</strong><br>
- <strong>API image parsing</strong> - drop a screenshot and let Gemini parse it automatically (requires a free API key from aistudio.google.com). Convenient but less accurate, especially on dense or cluttered listings.<br>
- <strong>Manual CSV</strong> - paste <code>Name,Qty</code> directly and click Analyze CSV only. Most reliable.<br><br>
<div class="notice notice-amber"><strong>Best method for accuracy:</strong> paste your listing screenshot directly into <a href="https://gemini.google.com/app" target="_blank" style="color:var(--accent);font-weight:600;text-decoration:none">gemini.google.com</a> and ask it to extract the data as <code>Name,Qty</code> CSV. In practice, the full Gemini web interface often handles complex listings better than the API and does not need an API key. Copy the output, paste it into the CSV box here, and use <strong>Analyze CSV only</strong>.</div><br>
Regardless of method, always cross-reference the parsed data against the original listing before committing to a purchase.`
  },
    {
    title: 'Where do prices come from?',
    body: `Prices come from <strong>poe.ninja</strong>. The app pulls current market data on load/refresh. The divine orb rate is fetched separately and used to display larger values in divines. Because poe.ninja updates in intervals rather than continuously, fast market moves can create temporary price discrepancies between live trade and displayed values, especially during high volatility.`
  },
  {
    title: 'Is my data private?',
    body: `Session history, price overrides, and settings are stored in your <strong>browser's localStorage only</strong>. Only session submissions are sent as contribution data. The community database stores only anonymous aggregate data: scarab output counts, total trades, and input/output values. No account, no login, no way to identify individual contributors.`
  },
  {
    title: 'Why do I have to manually export CSVs? Can\'t this be automated?',
    body: `Yes — and it's the most common piece of feedback. Right now the tool relies on <strong>Wealthy Exile CSV exports</strong> for inventory snapshots because that's the only reliable way to read your stash contents without GGG's direct involvement.<br><br>
The proper solution is <strong>OAuth access via GGG's official API</strong>. With OAuth, the tool could read your stash tabs directly — no Wealthy Exile, no manual exports, no before/after snapshots. Session logging would be as simple as clicking a button before and after vendoring. Everything tedious about the current workflow goes away.<br><br>
GGG does offer OAuth access to third-party developers, but it requires a formal application and approval process.<br><br>
<strong>If you'd like to see this happen</strong> — leave a comment on the Reddit post. If there's enough interest I'll put in the OAuth application.`
  },
  {
    title: 'What is the Atlas Optimizer and how does it calculate EV?',
    body: `The Atlas Optimizer helps you find the best atlas passive configuration for maximizing the value of scarab drops in your maps.<br><br>
<strong>How it works:</strong> every scarab type has an observed drop weight — how often it appears relative to others, derived from community vendor sessions. The map drop EV is the weighted average price across all active scarabs in the pool:<br>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">map_drop_EV = SUM(observed_weight * current_price) / SUM(observed_weight)</code>
<strong>Block nodes</strong> remove a mechanic's scarabs from the pool entirely — their weight drops to zero and the remaining weights are renormalised. This raises the EV if the blocked group is below-average value, because every drop that would have been a cheap common now rolls against a higher-value pool instead.<br><br>
<strong>Boost nodes</strong> apply a ×2 weight multiplier to a group before renormalising — doubling that mechanic's share of the drop pool. This pays off most when the boosted group's average scarab price is well above the current pool EV.<br><br>
The <strong>Delta</strong> column shows exactly how much each toggle moves the EV — positive means it helps, negative means it hurts. The <strong>Suggested</strong> badge marks the single toggle with the highest positive delta given your current configuration.<br><br>
<div class="notice notice-amber"><strong>Weight data variance:</strong> The drop weights come from vendor session outputs submitted by the community. With a smaller dataset, rare expensive scarabs can appear more or less frequently than their true long-run rate — which shifts the EV figures. Relative rankings are often directionally useful, while exact values tighten as more sessions accumulate. Treat this as directional guidance, not a precision instrument.</div>`
  },
];

export const CHAR_LIMIT = 250;

export const POE_RE_TOKENS = {
  // ABYSS
  "Abyss Scarab":                           "uls",
  "Abyss Scarab of Edifice":                "gha",
  "Abyss Scarab of Multitudes":             "cea",
  "Abyss Scarab of Profound Depth":         "g,",
  "Abyss Scarab of Descending":             "desc",
  // AMBUSH
  "Ambush Scarab":                          "u'",
  "Ambush Scarab of Containment":           "urk",
  "Ambush Scarab of Discernment":           "kee",
  "Ambush Scarab of Hidden Compartments":   "bv",
  "Ambush Scarab of Potency":               "loc",
  // ANARCHY
  "Anarchy Scarab":                         "it'",
  "Anarchy Scarab of Gigantification":      "wt",
  "Anarchy Scarab of Partnership":          "tn",
  "Anarchy Scarab of the Exceptional":      "xce",
  // BESTIARY
  "Bestiary Scarab":                        "stm",
  "Bestiary Scarab of Duplicating":         "at'",
  "Bestiary Scarab of the Herd":            "ram",
  // BETRAYAL
  "Betrayal Scarab":                        "pay",
  "Betrayal Scarab of Reinforcements":      "mov",
  "Betrayal Scarab of the Allflame":        "fear",
  "Betrayal Scarab of Unbreaking":          "nb",
  // BEYOND
  "Beyond Scarab":                          "wal",
  "Beyond Scarab of Haemophilia":           "beg",
  "Beyond Scarab of Resurgence":            "ung",
  "Beyond Scarab of the Invasion":          "lmo",
  // BLIGHT
  "Blight Scarab":                          "ndr",
  "Blight Scarab of Blooming":              "t-",
  "Blight Scarab of Invigoration":          "pol",
  "Blight Scarab of the Blightheart":       "yc",
  // BREACH
  "Breach Scarab of Resonant Cascade":      "lr",
  "Breach Scarab of Instability":           "arp",
  "Breach Scarab of the Hive":              "gd",
  "Breach Scarab of the Marshal":           "nw",
  "Breach Scarab of the Incensed Swarm":    "h'",
  // CARTOGRAPHY
  "Cartography Scarab of Escalation":       "thr",
  "Cartography Scarab of Risk":             "efl",
  "Cartography Scarab of the Multitude":    "izo",
  "Cartography Scarab of Corruption":       "tw",
  // DELIRIUM
  "Delirium Scarab":                        "uo",
  "Delirium Scarab of Delusions":           "lk",
  "Delirium Scarab of Mania":               "y'",
  "Delirium Scarab of Neuroses":            "eu",
  "Delirium Scarab of Paranoia":            "noi",
  // DIVINATION
  "Divination Scarab of Pilfering":         "sei",
  "Divination Scarab of Plenty":            "usa",
  "Divination Scarab of The Cloister":      "loi",
  // DOMINATION
  "Domination Scarab":                      "sim",
  "Domination Scarab of Apparitions":       "adn",
  "Domination Scarab of Evolution":         "rif",
  "Domination Scarab of Terrors":           "tev",
  // ESSENCE
  "Essence Scarab":                         "saf",
  "Essence Scarab of Adaptation":           "tti",
  "Essence Scarab of Ascent":               "cet",
  "Essence Scarab of Calcification":        "lc",
  "Essence Scarab of Stability":            "ool",
  // EXPEDITION
  "Expedition Scarab":                      "cro",
  "Expedition Scarab of Archaeology":       "sd",
  "Expedition Scarab of Runefinding":       "urn",
  "Expedition Scarab of Verisium Powder":   "f V",
  "Expedition Scarab of Infusion":          "nfu",
  // HARVEST
  "Harvest Scarab":                         "val",
  "Harvest Scarab of Cornucopia":           "rnu",
  "Harvest Scarab of Doubling":             "aso",
  // HORNED
  "Horned Scarab of Awakening":             "nyt",
  "Horned Scarab of Bloodlines":            "urv",
  "Horned Scarab of Glittering":            "%,",
  "Horned Scarab of Nemeses":               "tig",
  "Horned Scarab of Pandemonium":           "pun",
  "Horned Scarab of Preservation":          "rva",
  "Horned Scarab of Tradition":             "ges",
  // INCURSION
  "Incursion Scarab":                       "aa",
  "Incursion Scarab of Champions":          "tz",
  "Incursion Scarab of Invasion":           "ed,",
  "Incursion Scarab of Timelines":          "h,",
  // INFLUENCING
  "Influencing Scarab of Interference":     "nq",
  "Influencing Scarab of Hordes":           "idea",
  "Influencing Scarab of the Elder":        "voi",
  "Influencing Scarab of the Shaper":       "awai",
  // KALGUURAN
  "Kalguuran Scarab":                       "vei",
  "Kalguuran Scarab of Guarded Riches":     "gg",
  "Kalguuran Scarab of Refinement":         "ne,",
  "Kalguuran Scarab of Enriching":          "nri",
  // LEGION
  "Legion Scarab":                          "arr",
  "Legion Scarab of Treasures":             "hoa",
  "Legion Scarab of Eternal Conflict":      "rni",
  "Legion Scarab of Officers":              "gea",
  // RITUAL
  "Ritual Scarab of Abundance":             "abu",
  "Ritual Scarab of Selectiveness":         "pic",
  "Ritual Scarab of Wisps":                 "rus",
  "Ritual Scarab of Corpses":               "pup",
  // MISC
  "Scarab of Adversaries":                  "dv",
  "Scarab of the Sinistral":                "sini",
  "Scarab of the Dextral":                  "xt",
  "Scarab of Divinity":                     "-T",
  "Scarab of Monstrous Lineage":            "eag",
  "Scarab of Radiant Storms":               "cac",
  "Scarab of Stability":                    "g!",
  "Scarab of Wisps":                        "y 2",
  // SULPHITE
  "Sulphite Scarab":                        "ko",
  "Sulphite Scarab of Fumes":               "k,",
  // TITANIC
  "Titanic Scarab":                         "nam",
  "Titanic Scarab of Legend":               "ccu",
  "Titanic Scarab of Treasures":            "gree",
  // TORMENT
  "Torment Scarab":                         "rim",
  "Torment Scarab of Peculiarity":          "e!",
  "Torment Scarab of Possession":           "e ne",
  // ULTIMATUM
  "Ultimatum Scarab":                       "req",
  "Ultimatum Scarab of Bribing":            "dg",
  "Ultimatum Scarab of Catalysing":         "egr",
  "Ultimatum Scarab of Dueling":            "cto",
  "Ultimatum Scarab of Inscription":        "nsc",
};

const FRONTEND_HOST = (typeof globalThis !== 'undefined' && globalThis.location && globalThis.location.hostname)
  ? String(globalThis.location.hostname).toLowerCase()
  : '';
const IS_STAGING_FRONTEND = /(^localhost$)|(^127\.0\.0\.1$)|staging|dev/.test(FRONTEND_HOST);
export const BACKEND_TOKEN_SET_URL = IS_STAGING_FRONTEND
  ? 'https://scarabev-backend-staging.paperpandastacks.workers.dev/public/token-set/latest'
  : 'https://scarabev-backend-production.paperpandastacks.workers.dev/public/token-set/latest';
export const BACKEND_SCARAB_METADATA_URL = IS_STAGING_FRONTEND
  ? 'https://scarabev-backend-staging.paperpandastacks.workers.dev/public/scarabs/metadata'
  : 'https://scarabev-backend-production.paperpandastacks.workers.dev/public/scarabs/metadata';
export const BACKEND_ADMIN_UI_URL = IS_STAGING_FRONTEND
  ? 'https://scarabev-backend-staging.paperpandastacks.workers.dev/admin/ui'
  : 'https://scarabev-backend-production.paperpandastacks.workers.dev/admin/ui';

export const WORKER_URL = 'https://scarabev-market-worker.paperpandastacks.workers.dev';

export const ATLAS_BLOCKABLE = ['Breach','Legion','Expedition','Harvest','Abyss','Delirium','Kalguuran','Ritual','Blight','Ultimatum'];
export const ATLAS_BOOSTABLE = ['Essence','Beyond','Torment','Titanic','Cartography','Divination','Ambush','Anarchy','Domination'];
export const ATLAS_SAVE_KEY = 'scarabev-atlas-config';








