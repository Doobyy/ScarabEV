import type {
  DraftTokenChange,
  DraftTokenCollisionGroup,
  DraftTokenEntry,
  DraftTokenExcludedRetired,
  DraftTokenGenerationReport,
  ScarabTokenInput
} from "../security/types.js";

interface Candidate {
  token: string;
  stability: number;
}

export class TokenGenerationFailure extends Error {
  readonly problematicScarabIds: string[];
  readonly partialEntries: DraftTokenEntry[];

  constructor(problematicScarabIds: string[], partialEntries: DraftTokenEntry[], message = "token_generation_failed") {
    super(message);
    this.name = "TokenGenerationFailure";
    this.problematicScarabIds = [...new Set(problematicScarabIds)].sort();
    this.partialEntries = partialEntries;
  }
}

const MIN_TOKEN_LENGTH = 2;
const MAX_TOKEN_LENGTH = 24;
const LOW_CONFIDENCE_THRESHOLD = 0.68;
const MAX_PREFIX_LENGTH = 6;
const MAX_INFIX_LENGTH = 4;
const MAX_SPACED_FALLBACK_CANDIDATES = 200;

function hasDigit(value: string): boolean {
  return /\d/.test(value);
}

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= MIN_TOKEN_LENGTH && !hasDigit(word));
}

function buildSearchHaystack(input: ScarabTokenInput): string {
  const fragments = [input.name, input.description ?? "", ...(input.modifiers ?? [])];
  if (input.flavorText) {
    fragments.push(input.flavorText);
  }
  return normalizeWords(fragments.join(" ")).join(" ");
}

function pushLiteralCandidates(words: string[], stability: number, target: Candidate[]): void {
  for (const word of words) {
    if (word.length >= MIN_TOKEN_LENGTH) {
      target.push({ token: word, stability });
    }

    const prefixMax = Math.min(word.length, MAX_PREFIX_LENGTH);
    for (let len = MIN_TOKEN_LENGTH; len <= prefixMax; len += 1) {
      target.push({ token: word.slice(0, len), stability: Math.max(0.35, stability - 0.1) });
    }

    for (let len = MIN_TOKEN_LENGTH; len <= Math.min(word.length, MAX_INFIX_LENGTH); len += 1) {
      for (let start = 1; start + len <= word.length - 1; start += 1) {
        target.push({ token: word.slice(start, start + len), stability: Math.max(0.3, stability - 0.22) });
      }
    }
  }
}

function collectCandidates(input: ScarabTokenInput): Candidate[] {
  const candidates: Candidate[] = [];

  const nameWords = normalizeWords(input.name);
  if (nameWords.length > 1) {
    candidates.push({ token: nameWords.join(" "), stability: 0.98 });
  }
  pushLiteralCandidates(nameWords, 1, candidates);
  for (let i = 0; i < nameWords.length - 1; i += 1) {
    candidates.push({ token: `${nameWords[i]} ${nameWords[i + 1]}`, stability: 0.92 });
  }
  for (let i = 0; i < nameWords.length - 2; i += 1) {
    candidates.push({ token: `${nameWords[i]} ${nameWords[i + 1]} ${nameWords[i + 2]}`, stability: 0.9 });
  }

  for (const modifier of input.modifiers) {
    const words = normalizeWords(modifier);
    if (words.length > 1) {
      candidates.push({ token: words.join(" "), stability: 0.78 });
    }
    pushLiteralCandidates(words, 0.82, candidates);
    for (let i = 0; i < words.length - 1; i += 1) {
      candidates.push({ token: `${words[i]} ${words[i + 1]}`, stability: 0.74 });
    }
  }

  if (input.flavorText) {
    const flavorWords = normalizeWords(input.flavorText);
    pushLiteralCandidates(flavorWords, 0.5, candidates);
  }

  if (candidates.length === 0) {
    candidates.push({
      token: normalizeWords(input.name).join(" ").slice(0, MAX_TOKEN_LENGTH) || input.scarabId.toLowerCase(),
      stability: 0.25
    });
  }

  const deduped: Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const token = candidate.token.trim();
    if (!token || token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
      continue;
    }
    if (hasDigit(token)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    deduped.push({ token, stability: candidate.stability });
  }
  return deduped;
}

function lengthScoreForToken(token: string): number {
  if (token.length <= 3) {
    return 1;
  }
  if (token.length <= 5) {
    return 0.92;
  }
  if (token.length <= 8) {
    return 0.8;
  }
  return 0.6;
}

function tokenizeByScarab(activeInputs: ScarabTokenInput[]): Candidate[][] {
  return activeInputs.map((input) => collectCandidates(input));
}

function collectSpacedFallbackCandidates(haystack: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (token: string, stability: number): void => {
    if (seen.has(token)) {
      return;
    }
    seen.add(token);
    out.push({ token, stability });
  };

  for (let i = 0; i + 2 < haystack.length && out.length < MAX_SPACED_FALLBACK_CANDIDATES; i += 1) {
    const a = haystack[i] ?? "";
    const b = haystack[i + 1] ?? "";
    const c = haystack[i + 2] ?? "";
    if (/[a-z]/.test(a) && b === " " && /[a-z]/.test(c)) {
      push(`${a} ${c}`, 0.18);
    }
  }

  for (let i = 0; i + 4 < haystack.length && out.length < MAX_SPACED_FALLBACK_CANDIDATES; i += 1) {
    const a = haystack[i] ?? "";
    const b = haystack[i + 1] ?? "";
    const c = haystack[i + 2] ?? "";
    const d = haystack[i + 3] ?? "";
    const e = haystack[i + 4] ?? "";
    if (/[a-z]/.test(a) && b === " " && /[a-z]/.test(c) && d === " " && /[a-z]/.test(e)) {
      push(`${a} ${c} ${e}`, 0.14);
    }
  }

  return out;
}

function buildUniqueOwnershipMap(candidatesByScarab: Candidate[][], haystacks: string[]): Map<string, number> {
  const allTokens = new Set<string>();
  for (const candidates of candidatesByScarab) {
    for (const candidate of candidates) {
      allTokens.add(candidate.token);
    }
  }

  const uniqueOwnerByToken = new Map<string, number>();
  for (const token of allTokens) {
    let owner = -1;
    let ambiguous = false;
    for (let index = 0; index < haystacks.length; index += 1) {
      if (!haystacks[index]?.includes(token)) {
        continue;
      }
      if (owner === -1) {
        owner = index;
      } else {
        ambiguous = true;
        break;
      }
    }
    if (!ambiguous && owner >= 0) {
      uniqueOwnerByToken.set(token, owner);
    }
  }
  return uniqueOwnerByToken;
}

export function buildInputFingerprint(activeInputs: ScarabTokenInput[]): string {
  return JSON.stringify(
    activeInputs.map((input) => ({
      id: input.scarabId,
      name: input.name,
      description: input.description,
      modifiers: input.modifiers,
      flavorText: input.flavorText
    }))
  );
}

export function generateDraftTokenEntries(activeInputs: ScarabTokenInput[]): DraftTokenEntry[] {
  const orderedInputs = [...activeInputs];
  const haystacks = orderedInputs.map((input) => buildSearchHaystack(input));
  const candidatesByScarab = tokenizeByScarab(orderedInputs);

  const selectEntries = (): { entries: DraftTokenEntry[]; unresolvedScarabIds: string[]; unresolvedIndexes: number[] } => {
    const uniqueOwnerByToken = buildUniqueOwnershipMap(candidatesByScarab, haystacks);
    const entries: DraftTokenEntry[] = [];
    const unresolvedScarabIds: string[] = [];
    const unresolvedIndexes: number[] = [];

    for (let index = 0; index < orderedInputs.length; index += 1) {
      const scarab = orderedInputs[index];
      const candidates = candidatesByScarab[index] ?? [];
      const unique = candidates.filter((candidate) => uniqueOwnerByToken.get(candidate.token) === index);

      unique.sort(
        (left, right) =>
          left.token.length - right.token.length ||
          right.stability - left.stability ||
          left.token.localeCompare(right.token)
      );

      const selected = unique[0];
      if (!selected) {
        unresolvedScarabIds.push(scarab.scarabId);
        unresolvedIndexes.push(index);
        continue;
      }

      const lengthScore = Number(lengthScoreForToken(selected.token).toFixed(6));
      const stabilityScore = Number((selected.stability ?? 0.5).toFixed(6));
      const totalScore = Number((0.55 * lengthScore + 0.45 * stabilityScore).toFixed(6));

      entries.push({
        scarabId: scarab.scarabId,
        token: selected.token,
        candidateToken: selected.token,
        uniquenessScore: 1,
        lengthScore,
        stabilityScore,
        totalScore,
        candidateCount: candidates.length
      });
    }

    return { entries, unresolvedScarabIds, unresolvedIndexes };
  };

  let selected = selectEntries();
  if (selected.unresolvedIndexes.length > 0) {
    for (const index of selected.unresolvedIndexes) {
      const fallback = collectSpacedFallbackCandidates(haystacks[index] ?? "");
      if (fallback.length > 0) {
        candidatesByScarab[index] = [...(candidatesByScarab[index] ?? []), ...fallback];
      }
    }
    selected = selectEntries();
  }

  if (selected.unresolvedScarabIds.length > 0) {
    throw new TokenGenerationFailure(selected.unresolvedScarabIds, selected.entries, "token_generation_unresolved_short_unique");
  }

  return selected.entries;
}

function buildCollisionGroups(entries: DraftTokenEntry[]): DraftTokenCollisionGroup[] {
  const byToken = new Map<string, string[]>();
  for (const entry of entries) {
    const list = byToken.get(entry.token) ?? [];
    list.push(entry.scarabId);
    byToken.set(entry.token, list);
  }

  return Array.from(byToken.entries())
    .filter(([, scarabIds]) => scarabIds.length > 1)
    .map(([token, scarabIds]) => ({
      token,
      scarabIds: [...scarabIds].sort()
    }))
    .sort((left, right) => left.token.localeCompare(right.token));
}

function buildLowConfidence(entries: DraftTokenEntry[]) {
  return entries
    .filter((entry) => entry.totalScore < LOW_CONFIDENCE_THRESHOLD)
    .map((entry) => ({
      scarabId: entry.scarabId,
      token: entry.token,
      totalScore: entry.totalScore
    }))
    .sort((left, right) => left.totalScore - right.totalScore || left.scarabId.localeCompare(right.scarabId));
}

function buildChangedTokens(entries: DraftTokenEntry[], previousByScarab: Map<string, string>): DraftTokenChange[] {
  const changed: DraftTokenChange[] = [];
  for (const entry of entries) {
    const previousToken = previousByScarab.get(entry.scarabId);
    if (!previousToken || previousToken === entry.token) {
      continue;
    }
    changed.push({
      scarabId: entry.scarabId,
      previousToken,
      nextToken: entry.token
    });
  }
  return changed.sort((left, right) => left.scarabId.localeCompare(right.scarabId));
}

export function buildDraftGenerationReport(
  entries: DraftTokenEntry[],
  previousByScarab: Map<string, string>,
  excludedRetiredScarabs: DraftTokenExcludedRetired[]
): DraftTokenGenerationReport {
  return {
    collisions: buildCollisionGroups(entries),
    lowConfidence: buildLowConfidence(entries),
    changedTokens: buildChangedTokens(entries, previousByScarab),
    excludedRetiredScarabs: [...excludedRetiredScarabs].sort((left, right) => left.name.localeCompare(right.name))
  };
}
