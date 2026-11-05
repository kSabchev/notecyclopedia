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
