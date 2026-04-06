import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadLegacyData() {
  const repoRoot = path.resolve(process.cwd(), "..");
  const configPath = path.join(repoRoot, "js", "config.js");
  const moduleUrl = pathToFileURL(configPath).href;
  const configModule = await import(moduleUrl);

  const scarabList = Array.isArray(configModule.SCARAB_LIST) ? configModule.SCARAB_LIST : [];
  const legacyTokens = configModule.POE_RE_TOKENS && typeof configModule.POE_RE_TOKENS === "object"
    ? configModule.POE_RE_TOKENS
    : {};

  return {
    scarabList,
    legacyTokens,
    generatedAt: new Date().toISOString()
  };
}
