// Regex token engine for scarab filtering.
// Owns regex build/parse logic and reverse token mapping.
// Works from injected token configuration data.
// Keeps regex behavior reusable and UI-agnostic.
// Does not touch DOM, clipboard, or rendering code.

let POE_RE_TOKENS;

export function configureRegexEngine(deps) {
  POE_RE_TOKENS = deps.POE_RE_TOKENS;
}

export function buildRegex(vendorNames) {
  const tokens = [];
  const uncovered = [];

  for (const name of vendorNames) {
    const tok = POE_RE_TOKENS[name];
    if (tok) {
      tokens.push(tok);
    } else {
      uncovered.push(name);
    }
  }

  if (!tokens.length) return { regex: null, tokens: [], collateral: [], overLimit: false, part1: null, part2: null, uncovered };

  const inner = tokens.join("|");
  const regex = `"${inner}"`;
  const overLimit = inner.length > 248;

  let part1 = null;
  let part2 = null;
  if (overLimit) {
    const mid = Math.ceil(tokens.length / 2);
    part1 = `"${tokens.slice(0, mid).join("|")}"`;
    part2 = `"${tokens.slice(mid).join("|")}"`;
  }

  return { regex, tokens, collateral: [], overLimit, part1, part2, uncovered };
}

// Build reverse token map: token -> scarab name
export function buildReverseTokenMap() {
  const map = {};
  for (const [name, token] of Object.entries(POE_RE_TOKENS)) {
    map[token.toLowerCase()] = name;
  }
  return map;
}

export function parseRegexToScarabs(regexStr) {
  // Strip surrounding quotes if present
  let cleaned = regexStr.trim().replace(/^["']|["']$/g, '');
  
  // Check if it's an inverted regex (starts with ! after removing quotes)
  const is_inverted = cleaned.startsWith('!');
  if (is_inverted) {
    cleaned = cleaned.substring(1); // Remove the ! prefix
  }
  
  const tokens = cleaned.split('|').map(t => t.trim().toLowerCase()).filter(Boolean);
  const reverseMap = buildReverseTokenMap();
  const matched = [];
  const unmatched = [];
  
  for (const tok of tokens) {
    if (reverseMap[tok]) {
      matched.push(reverseMap[tok]);
    } else {
      unmatched.push(tok);
    }
  }
  
  return { matched, unmatched, is_inverted: is_inverted };
}
