import { describe, expect, it } from 'vitest'
import { notesLanguage } from './language'

describe('notesLanguage', () => {
  it('tells Bulgarian from English notes, formulas included', () => {
    expect(notesLanguage('A GPS satellite is on a near-circular orbit with eccentricity e = 0.00821.')).toBe(
      'English',
    )
    expect(
      notesLanguage(
        'Спътникът е на почти кръгова орбита, $T = 2pisqrt{a^3/mu}$, DeltaOmega = -\frac{3}{2} J_2',
      ),
    ).toBe('Bulgarian')
  })

  it('uses the interface language when there is too little text to tell', () => {
    expect(notesLanguage('Step 1: a = 26 560 km, T = 11.97 h', 'bg')).toBe('Bulgarian')
    expect(notesLanguage('', 'en')).toBe('English')
  })
})
