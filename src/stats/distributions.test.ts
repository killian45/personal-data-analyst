import { describe, expect, it } from 'vitest'

import { logGamma, regularizedIncompleteBeta, studentTTwoSidedP } from './distributions'

describe('logGamma', () => {
  it('matches known values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 12)
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12) // Γ(5) = 4! = 24
    expect(logGamma(0.5)).toBeCloseTo(0.5723649429247004, 12) // ln √π
  })

  it('refuses non-positive arguments', () => {
    expect(() => logGamma(0)).toThrow()
  })
})

describe('regularizedIncompleteBeta', () => {
  it('matches closed forms (hand-calculated)', () => {
    // I_0.5(2,3) = 1 − [0.5⁴ + 4·0.5·0.5³] = 0.6875.
    expect(regularizedIncompleteBeta(0.5, 2, 3)).toBeCloseTo(0.6875, 12)
    // I_x(1,1) = x; I_0.5(a,a) = 0.5 by symmetry.
    expect(regularizedIncompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 12)
    expect(regularizedIncompleteBeta(0.5, 7.5, 7.5)).toBeCloseTo(0.5, 12)
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0)
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1)
  })

  it('refuses invalid arguments', () => {
    expect(() => regularizedIncompleteBeta(1.2, 1, 1)).toThrow()
    expect(() => regularizedIncompleteBeta(0.5, 0, 1)).toThrow()
  })
})

describe('studentTTwoSidedP', () => {
  it('matches closed forms and an independent numerical integration', () => {
    expect(studentTTwoSidedP(1, 1)).toBeCloseTo(0.5, 12) // Cauchy: P(|T| > 1) = 1/2
    expect(studentTTwoSidedP(2, 2)).toBeCloseTo(1 - 2 / Math.sqrt(6), 12) // df 2 closed form
    expect(studentTTwoSidedP(0, 9)).toBeCloseTo(1, 12)
    expect(studentTTwoSidedP(-2, 2)).toBeCloseTo(studentTTwoSidedP(2, 2), 12)
    // Simpson integration of the t density (Python, 2 million steps): 0.0021696, 0.0828970.
    expect(studentTTwoSidedP(4.241455288892834, 9)).toBeCloseTo(0.0021696, 6)
    expect(studentTTwoSidedP(2, 7.5)).toBeCloseTo(0.082897, 5) // fractional df (effective days)
    // Large df → normal: P(|Z| > 1.96) ≈ 0.05.
    expect(studentTTwoSidedP(1.959963984540054, 1e7)).toBeCloseTo(0.05, 5)
    expect(studentTTwoSidedP(Infinity, 5)).toBe(0)
  })
})
