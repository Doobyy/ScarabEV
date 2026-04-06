import type { PoeRegexViolation } from "../security/types.js";

export const POE_REGEX_PROFILE_NAME = "poe_regex_profile_v1";

export interface PoeRegexConstruct {
  id: string;
  syntax: string;
  description: string;
}

// Confirmed working in poe-vendor-string generated outputs.
// Source: https://github.com/veiset/poe-vendor-string
export const POE_REGEX_CONFIRMED_CONSTRUCTS: PoeRegexConstruct[] = [
  { id: "alternation", syntax: "a|b", description: "Alternation / OR branch." },
  { id: "grouping", syntax: "(...)", description: "Capturing group for grouping and repetition." },
  { id: "char_class", syntax: "[abc] / [a-z]", description: "Character class and ranges." },
  { id: "wildcard", syntax: ".", description: "Single-character wildcard." },
  { id: "quantifier_fixed", syntax: "{n}", description: "Exact-count quantifier." },
  { id: "quantifier_star", syntax: "*", description: "Zero-or-more quantifier." },
  { id: "quantifier_plus", syntax: "+", description: "One-or-more quantifier." },
  { id: "quantifier_optional", syntax: "?", description: "Optional quantifier." },
  { id: "escape_digit", syntax: "\\d", description: "Digit class." },
  { id: "escape_word", syntax: "\\w", description: "Word class." },
  { id: "escape_non_word", syntax: "\\W", description: "Non-word class." },
  { id: "escape_non_space", syntax: "\\S", description: "Non-space class." },
  { id: "lookahead_positive", syntax: "(?=...)", description: "Positive lookahead assertion." }
];

const DISALLOWED_QUOTE_PATTERN = /"/;
const DISALLOWED_CONTROL_PATTERN = /[\x00-\x1F\x7F]/;
const ALLOWED_ESCAPE_PATTERN = /\\(?:d|w|W|S|[\\|()[\]{}.+*?\-:^$])/g;
const ANY_ESCAPE_PATTERN = /\\./g;

export function normalizePublishToken(token: string): string {
  return token.trim().replace(/\s+/g, " ");
}

function hasUnsupportedLookaround(token: string): boolean {
  return token.includes("(?<=") || token.includes("(?<!") || token.includes("(?!");
}

function hasUnsupportedEscapes(token: string): boolean {
  const escapes = token.match(ANY_ESCAPE_PATTERN) ?? [];
  if (escapes.length === 0) {
    return false;
  }
  const allowed = token.match(ALLOWED_ESCAPE_PATTERN) ?? [];
  return escapes.length !== allowed.length;
}

export function getPoeRegexProfileConstructs(): PoeRegexConstruct[] {
  return POE_REGEX_CONFIRMED_CONSTRUCTS.map((construct) => ({ ...construct }));
}

export function validateTokenAgainstPoeRegexProfile(token: string): PoeRegexViolation | null {
  if (!token.trim()) {
    return {
      token,
      reason: "empty_token"
    };
  }

  if (token.length > 48) {
    return {
      token,
      reason: "token_too_long"
    };
  }

  if (DISALLOWED_CONTROL_PATTERN.test(token)) {
    return {
      token,
      reason: "contains_control_character"
    };
  }

  if (DISALLOWED_QUOTE_PATTERN.test(token)) {
    return {
      token,
      reason: "contains_disallowed_quote"
    };
  }

  if (hasUnsupportedLookaround(token)) {
    return {
      token,
      reason: "contains_unsupported_lookaround"
    };
  }

  if (hasUnsupportedEscapes(token)) {
    return {
      token,
      reason: "contains_unsupported_escape_sequence"
    };
  }

  return null;
}
