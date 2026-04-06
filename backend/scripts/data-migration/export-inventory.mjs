import fs from "node:fs/promises";
import path from "node:path";
import { loadLegacyData } from "./loadLegacyData.mjs";

async function run() {
  const data = await loadLegacyData();
  const scarabNames = data.scarabList.map((entry) => entry.name);
  const tokenNames = Object.keys(data.legacyTokens);
  const missingTokenNames = scarabNames.filter((name) => !(name in data.legacyTokens));
  const extraTokenNames = tokenNames.filter((name) => !scarabNames.includes(name));

  const report = {
    generatedAt: data.generatedAt,
    source: "js/config.js",
    scarabCount: scarabNames.length,
    legacyTokenCount: tokenNames.length,
    missingTokenCount: missingTokenNames.length,
    extraTokenCount: extraTokenNames.length,
    missingTokenNames,
    extraTokenNames,
    sample: {
      firstScarab: scarabNames[0] ?? null,
      firstTokenEntry: tokenNames.length > 0
        ? { name: tokenNames[0], token: data.legacyTokens[tokenNames[0]] }
        : null
    }
  };

  const outDir = path.resolve(process.cwd(), ".local", "block7");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "legacy-inventory-report.json");
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ ok: true, outPath, report }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
