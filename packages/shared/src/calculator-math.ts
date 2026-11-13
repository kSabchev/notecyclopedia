import { all, create } from 'mathjs'

/**
 * The restricted math.js instance every calculator module uses: no import, createUnit, or evaluating and parsing
 * inside expressions. Internal to the package (not exported from index.ts).
 */
export const math = create(all as NonNullable<typeof all>)
export const limitedEvaluate = math.evaluate
export const limitedParse = math.parse
math.import(
  {
    import: () => {
      throw new Error('import is disabled')
    },
    createUnit: () => {
      throw new Error('createUnit is disabled')
    },
    evaluate: () => {
      throw new Error('evaluate is disabled')
    },
    parse: () => {
      throw new Error('parse is disabled')
    },
    simplify: () => {
      throw new Error('simplify is disabled')
    },
    derivative: () => {
      throw new Error('derivative is disabled')
    },
  },
  { override: true },
)
