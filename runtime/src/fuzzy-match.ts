/**
 * Token overlap + Levenshtein fuzzy scoring.
 * Returns 0-1 relevance score. No external dependencies.
 */

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

export function fuzzyScore(query: string, content: string): number {
  if (!query || !content) return 0;

  const qTokens = tokenize(query);
  const cTokens = tokenize(content);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  // Threshold below which a fuzzy match is treated as no-match,
  // to prevent false positives from distantly-similar words.
  const SIMILARITY_THRESHOLD = 0.6;

  let totalBestScore = 0;
  for (const qt of qTokens) {
    let bestMatch = 0;
    for (const ct of cTokens) {
      const maxLen = Math.max(qt.length, ct.length);
      if (maxLen === 0) continue;
      const dist = levenshtein(qt, ct);
      const similarity = 1 - dist / maxLen;
      // Only count matches that are meaningfully similar
      if (similarity >= SIMILARITY_THRESHOLD) {
        bestMatch = Math.max(bestMatch, similarity);
      }
    }
    totalBestScore += bestMatch;
  }

  // Token overlap score: average best-match per query token
  const tokenOverlapScore = totalBestScore / qTokens.length;

  // Coverage penalty: if query covers very few tokens relative to content,
  // reduce the score proportionally. This prevents a single-word exact match
  // from scoring 1.0 against a long multi-word content string.
  const coverageRatio = Math.min(qTokens.length / cTokens.length, 1.0);
  const score = tokenOverlapScore * (0.5 + 0.5 * coverageRatio);

  return Math.round(score * 1000) / 1000;
}
