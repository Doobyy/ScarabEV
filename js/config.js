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
    groupTitle: 'GETTING STARTED'
  },
  {
    title: 'What does this tool do?',
    body: `<p>This helps identify profitable scarabs to vendor through the <strong>3-for-1 vendor recipe</strong>, estimate expected returns, analyze <strong>bulk listings</strong>, and optimize <strong>atlas scarab drop value</strong>.</p>
<p>It combines live market prices with community data so recommendations can adapt as league conditions change.</p>`
  },
  {
    title: 'What is the 3-for-1 scarab vendor recipe, and why can it be profitable?',
    body: `<p>Trading any three scarabs to a vendor returns one random scarab from the <strong>vendor recipe pool</strong>.</p>
<p>Most outcomes are common low-value returns, but occasional premium outcomes can be worth many times the cost of the inputs. When the average value returned by the pool rises above the cost of the scarabs being fed into the recipe, repeated trades become favorable over time.</p>
<p>This helps identify when those market conditions exist and which scarabs currently fall below the <strong>profitable threshold</strong>.</p>`
  },
  {
    title: 'What is the vendor threshold?',
    body: `<p>The <strong>threshold</strong> is the maximum chaos value per scarab worth feeding into the recipe.</p>
<p>Any scarab priced at or below the threshold is generally better used as vendor input. Any scarab above the threshold is usually more valuable sold directly.</p>
<p>The list updates automatically whenever prices or model recommendations change.</p>`
  },
  {
    title: 'Does a profitable threshold guarantee profit?',
    body: `<p>No.</p>
<p>Profitability is based on <strong>long-run averages</strong> over many trades, not guaranteed short sessions. Smaller samples can run above or below expectation depending on luck.</p>
<p>Over enough volume, results tend to move closer to projected averages.</p>`
  },
  {
    title: 'Which EV model should I use?',
    body: `<p>Both models are valid. The recommendation depends on data maturity.</p>
<p>Use <strong>harmonic_EV</strong> while current-league weighting data is still developing. It is more conservative and less sensitive to early sample noise.</p>
<p>Use <strong>weighted_EV</strong> once enough <strong>current-league data</strong> has been collected. At that point it becomes the more representative long-run estimate.</p>`
  },
  {
    groupTitle: 'MODELS & CALCULATIONS'
  },
  {
    title: 'What is harmonic_EV?',
    body: `<p><strong>harmonic_EV</strong> treats every scarab type as an equal possible output and uses the harmonic mean of market prices.</p>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">harmonic_EV = scarab_count / SUM(1 ÷ each_scarab_price)</code>
<p>Because cheap scarabs influence the result more than expensive outliers, harmonic_EV is naturally more conservative and stable.</p>
<p>This is the <strong>recommended model</strong> while <strong>current-league weighting data</strong> is still developing.</p>`
  },
  {
    title: 'What is weighted_EV?',
    body: `<p><strong>weighted_EV</strong> uses observed vendor output frequencies from submitted sessions, then applies current market prices on top.</p>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">weighted_EV = SUM(drop_weight × current_price) / 3</code>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">drop_weight = scarab_outputs_observed / total_outputs_observed</code>
<p>This estimates long-run expected value using real community data from the active league.</p>
<p>Once enough <strong>current-league data</strong> has been collected, weighted_EV becomes the <strong>recommended model</strong>.</p>`
  },
  {
    title: 'Why do harmonic_EV and weighted_EV sometimes disagree?',
    body: `<p>They measure value differently.</p>
<p><strong>harmonic_EV</strong> is more influenced by cheap/common scarabs and less influenced by rare expensive outliers. <strong>weighted_EV</strong> uses observed output frequencies and reflects long-run expected value more directly.</p>
<p>As prices, rarity distribution, and data maturity change, the gap between the two models can widen, narrow, or occasionally reverse.</p>`
  },
  {
    title: 'When does weighted_EV become the recommended model?',
    body: `<p><strong>weighted_EV</strong> becomes preferred once enough <strong>current-league data</strong> has been collected for output frequencies to stabilize.</p>
<p>Until then, harmonic_EV remains the safer default.</p>`
  },
  {
    title: 'What happens when a new league starts, and how does weight blending work?',
    body: `<p>At the start of a new league, <strong>current-league weight data</strong> is still sparse. Using only fresh observations immediately would make early recommendations too reactive, since small sample noise can distort scarab frequencies before enough data has been collected.</p>
<p>To smooth that transition, prior-league weights are blended with current-league weights using <strong>blend_factor</strong>. This provides stability early on, while still allowing the model to adapt as real current-league data builds.</p>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">blend_factor = current_league_data_share / 100</code>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">blended_weight = (blend_factor × current_league_weight) + ((1 - blend_factor) × prior_league_weight)</code>
<p>As current-league data share increases, the blend shifts progressively away from prior-league behavior and toward the new league’s actual observed output distribution.</p>
<p>Once enough current-league data has been collected, prior-league influence is fully phased out and recommendations rely entirely on current-league weights.</p>`
  },
  {
    title: 'How does the recycle-loop estimator work?',
    body: `<p>Low-value outputs are not treated as dead value. Outputs at or below the selected threshold are assumed to be <strong>re-vendored</strong> until only keeper outputs remain.</p>
<p>This better reflects real workflows where cheap returns are continuously recycled into future rolls instead of being treated as final outcomes immediately.</p>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">loop_rate = keep_value_share / (3 - vendor_probability)</code>
<p>That <strong>loop_rate</strong> model powers estimator return values and keeps estimates aligned with repeated vendoring behavior.</p>`
  },
  {
    groupTitle: 'TOOLS & FEATURES'
  },
  {
    title: 'How does the Profit Estimator work?',
    body: `<p>Import a Wealthy Exile CSV and the estimator calculates four live values using current market prices.</p>
<p><strong>Scarabs to Vendor</strong><br>How many scarabs currently fall at or below the selected threshold.</p>
<p><strong>Input Value</strong><br>What those scarabs are worth if sold directly right now.</p>
<p><strong>Estimated Return</strong><br>Expected keeper value returned through repeated vendoring.</p>
<p><strong>Estimated Profit</strong><br>Estimated return minus the direct market value of the inputs.</p>
<p>Together, these values give a practical view of whether vendoring a pile is worth doing at the current threshold.</p>`
  },
  {
    title: 'How does the Bulk Buy Analyzer work?',
    body: `<p>The <strong>Bulk Buy Analyzer</strong> compares TFT bulk listings against live market prices and the <strong>active threshold</strong>.</p>
<p>It estimates expected return, net value, profit margin, and a per-scarab breakdown. This makes it easier to judge whether a listing is attractive, fairly priced, or overpriced before committing to a purchase.</p>`
  },
  {
    title: 'What is the best way to import bulk listings?',
    body: `<p>Two supported methods:</p>
<p><strong>API image parsing</strong><br>Drop a screenshot and let Gemini extract the data automatically. Fast and convenient, but less reliable on dense listings.</p>
<p><strong>Manual CSV</strong><br>Paste Name,Qty data directly. Most reliable.</p>
<p>For best accuracy, paste the screenshot directly into <a href="https://gemini.google.com/app" target="_blank" style="color:var(--accent);font-weight:600;text-decoration:none">gemini.google.com</a> and ask it to convert the listing into Name,Qty CSV, then paste that result into the analyzer.</p>
<p>Always verify parsed results before purchasing.</p>`
  },
  {
    title: 'How does the Atlas Optimizer work?',
    body: `<p>Each scarab type has an observed <strong>drop_weight</strong> based on community data. Those weights are combined with live prices to estimate the average value of future scarab drops.</p>
<code style="display:block;margin:8px 0;padding:8px 12px;background:var(--bg-group);border-radius:4px;font-size:11px;color:var(--chaos)">map_drop_EV = SUM(drop_weight × current_price) / SUM(drop_weight)</code>
<p><strong>Block nodes</strong> remove weaker mechanics from the pool entirely.</p>
<p>Boost nodes double a mechanic’s pool weight before the pool is rebalanced.</p>
<p>Every toggle recalculates instantly so the value impact of each atlas decision can be seen immediately.</p>`
  },
  {
    title: 'How accurate are Atlas Optimizer values?',
    body: `<p>The optimizer uses real observed data, but rare scarabs naturally need more samples before their frequencies fully stabilize.</p>
<p>That means exact EV values improve over time as more sessions are submitted. Relative rankings are often useful earlier, while precision improves as the dataset matures.</p>
<p>Use it as directional guidance rather than a perfect fixed forecast.</p>`
  },
  {
    groupTitle: 'DATA & TRUST'
  },
  {
    title: 'How is community data protected from bad submissions?',
    body: `<p>Every submitted session passes <strong>automated integrity checks</strong> before it can influence shared weights or calibration.</p>
<p>Sessions that fail are still saved to local history, but they do not affect the shared dataset.</p>
<p>This keeps recommendations stable without requiring manual review for every submission.</p>`
  },
  {
    title: 'What kinds of sessions are accepted?',
    body: `<p>Accepted sessions generally show:</p>
<ul style="margin:8px 0 8px 18px;padding:0">
  <li>meaningful sample size</li>
  <li>real keeper outputs</li>
  <li>credible input and output relationships</li>
  <li>clean <strong>single pass</strong> behavior</li>
</ul>
<p>At a minimum, sessions need at least <strong>600 scarabs consumed</strong> before they can contribute to shared data.</p>
<p>This helps keep the weighting model grounded in sessions with enough volume to be useful.</p>`
  },
  {
    title: 'What gets excluded from the shared dataset?',
    body: `<p>Sessions are excluded when they are too small, show no keeper outputs, contain impossible input and output relationships, or do not show a meaningful before-and-after change.</p>
<p><strong>Recycled sessions</strong> are also excluded, since same-session re-vendoring distorts output frequencies and makes shared weight data less reliable.</p>
<p>These sessions can still be stored in personal history, but they do not contribute to the community model.</p>`
  },
  {
    title: 'Why are recycled sessions excluded?',
    body: `<p>The shared dataset is designed to measure what the vendor recipe returns on a clean <strong>single pass</strong>.</p>
<p>If outputs are immediately re-vendored in the same logged session, cheap commons disappear while expensive survivors remain visible. That artificially overstates premium scarab frequency and pushes weighted_EV higher than it should be.</p>
<p>Single-pass sessions preserve cleaner output data and produce more reliable long-run recommendations.</p>`
  },
  {
    title: 'How should clean community data be logged?',
    body: `<p>For personal tracking, the standard before-and-after workflow is fine.</p>
<p>For clean shared data, <strong>each vendor pass</strong> should be logged as its own session. Export before starting, vendor one pass only, place all returns in a dedicated tab, export again, and submit those two snapshots together.</p>
<p>If vendoring continues after that, the new snapshot becomes the starting point for the next session. Keeping each pass separate preserves cleaner weight data for everyone.</p>`
  },
  {
    title: 'Where do market prices come from?',
    body: `<p>Prices are pulled from poe.ninja and refreshed through the live market feed.</p>
<p>Divine orb rates are fetched separately for larger-value displays. Because poe.ninja updates in intervals rather than continuously, fast market moves can occasionally create short-lived gaps between displayed prices and live trade listings.</p>`
  },
  {
    title: 'Is any personal data stored?',
    body: `<p>Session history, price overrides, and settings are <strong>stored locally in the browser</strong>.</p>
<p>Only session submissions are sent as <strong>anonymous contribution data</strong>. The shared dataset stores aggregate counts, trade totals, and value totals only. There is no login, no account requirement, and no personal identity data attached to contributions.</p>`
  },
  {
    title: 'Can this eventually work without Wealthy Exile CSV exports?',
    body: `<p>Yes. The proper long-term solution would be <strong>official OAuth stash access</strong>.</p>
<p>That would allow direct stash reads before and after vendoring without manual exports, making session logging much faster and easier. Official access would require third-party approval from GGG.</p>`
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








