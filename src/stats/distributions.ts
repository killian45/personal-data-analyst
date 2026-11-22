/**
 * Probability helpers for the correlation tests (Phase 6). Pure functions.
 *
 * - logGamma: Lanczos approximation (g = 7, 9 coefficients), accurate to
 *   about 15 significant digits for positive arguments.
 * - regularizedIncompleteBeta I_x(a, b): continued fraction evaluated with
 *   the modified Lentz method (as in Numerical Recipes, "betacf"), using
 *   the symmetry I_x(a, b) = 1 − I_{1−x}(b, a) for fast convergence.
 * - studentTTwoSidedP: P(|T| ≥ |t|) for Student's t with df > 0 degrees of
 *   freedom (df may be fractional, e.g. an effective sample size − 2):
 *   p = I_{df/(df+t²)}(df/2, 1/2).
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
]

export function logGamma(x: number): number {
  if (!(x > 0)) throw new Error('logGamma needs a positive argument.')
  if (x < 0.5) {
    // Reflection: Γ(x)Γ(1−x) = π / sin(πx).
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  }
  const z = x - 1
  let sum = LANCZOS[0]
  for (let i = 1; i < LANCZOS.length; i += 1) sum += LANCZOS[i] / (z + i)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum)
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITERATIONS = 300
  const EPSILON = 1e-15
  const TINY = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < EPSILON) return h
  }
  throw new Error('The incomplete beta function did not converge.')
}

/** Regularized incomplete beta function I_x(a, b), for a, b > 0 and 0 ≤ x ≤ 1. */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) throw new Error('a and b must be positive.')
  if (!(x >= 0 && x <= 1)) throw new Error('x must be between 0 and 1.')
  if (x === 0) return 0
  if (x === 1) return 1
  const logFront = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  const front = Math.exp(logFront)
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b
}

/** Two-sided p-value of Student's t statistic with df degrees of freedom. */
export function studentTTwoSidedP(t: number, df: number): number {
  if (!(df > 0)) throw new Error('Degrees of freedom must be positive.')
  if (!Number.isFinite(t)) return 0
  return regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5)
}
