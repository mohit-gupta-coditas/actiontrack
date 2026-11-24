const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'and', 'or', 'of', 'for', 'with', 'on', 'in', 'at',
  'will', 'should', 'must', 'please', 'pls', 'our', 'their', 'his', 'her', 'its', 'it',
]);

/**
 * Order-insensitive key: lowercase, no punctuation, no stopwords, unique sorted words.
 * "Send the revised quote" and "send revised quote." both become "quote revised send".
 */
export function normalize(task: string): string {
  const words = task.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w));
  return [...new Set(words)].sort().join(' ');
}

/** Word overlap of two normalized keys: |A ∩ B| / |A ∪ B|. */
export function jaccard(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

export const NEAR_DUP_THRESHOLD = 0.6;
