/**
 * A Postgres `to_tsquery('simple', …)` string matching any term of a natural-language question.
 * `websearch_to_tsquery` requires every word, and the 'simple' config keeps stop words, so a
 * question like "what is the vis-viva equation" would only match chunks containing "what", "is"
 * and "the". OR-ing the terms and ranking by `ts_rank` puts chunks matching more terms first.
 * Returns null when the text has no searchable terms.
 */
export function anyTermQuery(text: string, maxTerms = 32): string | null {
  const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, maxTerms)
  // Terms contain only letters and digits, so quoting them cannot inject tsquery operators.
  return terms.length ? terms.map((t) => `'${t}'`).join(' | ') : null
}
