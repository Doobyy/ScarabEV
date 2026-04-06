import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const scriptsDir = join(process.cwd(), "src", "admin", "scripts");
const files = readdirSync(scriptsDir).filter((name) => name.endsWith(".ts"));
if (!files.length) {
  console.error("No admin script TS files found.");
  process.exit(1);
}

const tempRoot = mkdtempSync(join(tmpdir(), "scarabev-admin-inline-"));

try {
  for (const file of files) {
    const fullPath = join(scriptsDir, file);
    const source = readFileSync(fullPath, "utf8");
    const match = source.match(/String\.raw`([\s\S]*)`;\s*$/m);
    if (!match) {
      console.error(`Missing String.raw script payload: ${file}`);
      process.exit(1);
    }
    const jsPayload = match[1];
    const outFile = join(tempRoot, file.replace(/\.ts$/, ".js"));
    writeFileSync(outFile, jsPayload, "utf8");
    const checked = spawnSync(process.execPath, ["--check", outFile], { stdio: "inherit" });
    if (checked.status !== 0) {
      console.error(`Inline admin script syntax check failed: ${file}`);
      process.exit(checked.status ?? 1);
    }
  }

  console.log(`Admin inline script checks passed (${files.length} file(s)).`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

