import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');

const requiredIds = [
  'n-tableBody',
  'leagueSelect',
  'ninjaStatus',
  'tab-ninja',
  'tab-logger',
  'themeToggle'
];

const missing = requiredIds.filter((id) => !html.includes(`id="${id}"`));
if (missing.length) {
  console.error('Missing required frontend IDs:', missing.join(', '));
  process.exit(1);
}

const requiredScripts = [
  'js/app.js',
  'js/config.js',
  'js/market.js',
  'js/regexEngine.js',
  'js/scarabEngine.js',
  'js/state.js',
  'js/tokenSource.js',
  'js/hashRouting.js',
  'js/globalExpose.js'
];

for (const path of requiredScripts) {
  const text = readFileSync(path, 'utf8');
  if (!text || !text.trim()) {
    console.error(`Script is empty: ${path}`);
    process.exit(1);
  }
}

console.log('Frontend smoke checks passed.');
