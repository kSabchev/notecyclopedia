export interface BuiltInConstant {
  key: string
  name: string
  symbol: string
  value: number
  unit: string
  description: string
  source: string
}

export const BUILT_IN_CONSTANTS: BuiltInConstant[] = [
  {
    key: 'C_LIGHT',
    name: 'Speed of light in vacuum',
    symbol: 'c',
    value: 299_792_458,
    unit: 'm/s',
    description: 'Exact SI-defined value.',
    source: 'SI defining constant',
  },
  {
    key: 'G0',
    name: 'Standard gravity',
    symbol: 'g₀',
    value: 9.80665,
    unit: 'm/s²',
    description: 'Conventional standard acceleration of free fall.',
    source: 'Standard value',
  },
  {
    key: 'G_NEWTON',
    name: 'Gravitational constant',
    symbol: 'G',
    value: 6.6743e-11,
    unit: 'm³/(kg·s²)',
    description: 'Rounded measured value; consult the cited data for precision and uncertainty.',
    source: 'CODATA 2022',
  },
  {
    key: 'H_PLANCK',
    name: 'Planck constant',
    symbol: 'h',
    value: 6.62607015e-34,
    unit: 'J·s',
    description: 'Exact SI-defined value.',
    source: 'SI defining constant',
  },
  {
    key: 'K_BOLTZMANN',
    name: 'Boltzmann constant',
    symbol: 'kB',
    value: 1.380649e-23,
    unit: 'J/K',
    description: 'Exact SI-defined value.',
    source: 'SI defining constant',
  },
  {
    key: 'N_AVOGADRO',
    name: 'Avogadro constant',
    symbol: 'NA',
    value: 6.02214076e23,
    unit: 'mol⁻¹',
    description: 'Exact SI-defined value.',
    source: 'SI defining constant',
  },
  {
    key: 'E_CHARGE',
    name: 'Elementary charge',
    symbol: 'e',
    value: 1.602176634e-19,
    unit: 'C',
    description: 'Exact SI-defined value.',
    source: 'SI defining constant',
  },
  {
    key: 'AU',
    name: 'Astronomical unit',
    symbol: 'au',
    value: 149_597_870_700,
    unit: 'm',
    description: 'Exact definition of the astronomical unit.',
    source: 'IAU definition',
  },
]
