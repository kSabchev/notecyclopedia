/**
 * A number for display: `precision` decimals, trailing zeros dropped; very large or very small numbers in
 * exponent form. Kept apart from the calculator so that formatting does not load math.js.
 */
export function formatValue(n: number, precision = 3): string {
  if (n !== 0 && (Math.abs(n) >= 1e6 || Math.abs(n) < 1e-3)) return n.toExponential(precision)
  return Number(n.toFixed(precision)).toString()
}

/** A number with a fixed number of decimals and no exponent, e.g. small rates such as 0.0004 deg/day. */
export function formatFixed(n: number, decimals: number): string {
  const s = n.toFixed(decimals)
  // "-0.0000" reads as a sign error; show zero.
  return Number(s) === 0 ? (0).toFixed(decimals) : s
}

/**
 * What is wrong with a value that failed a zod schema, as one line: "path: message; …", the first `max` issues.
 * Takes the error's shape rather than zod's type, so formatting does not load zod.
 */
export function issuesText(
  error: { issues: { path: (string | number)[]; message: string }[] },
  max = 5,
): string {
  return error.issues
    .slice(0, max)
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
}

/** A name made safe for a downloaded file: letters and digits joined by "-", at most `max` characters. */
export function fileSlug(name: string, fallback: string, max = 60): string {
  return (
    name
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || fallback
  )
}
