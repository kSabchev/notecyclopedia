import { z } from 'zod'
import { CENTRAL_BODIES } from './orbit'

/**
 * Schemas for orbit widgets, kept apart from the calculator schema (which checks formulas with math.js), so that
 * pages with only orbit diagrams do not load the calculator engine.
 */

const angle = z.number().finite().min(0).max(360)
/** Elliptical orbits only; e is capped below 1 so the orbit stays closed and drawable. */
export const MAX_ECCENTRICITY = 0.99
export const orbitalElementsSchema = z.object({
  a: z.number().finite().positive(),
  e: z.number().finite().min(0).max(MAX_ECCENTRICITY),
  i: z.number().finite().min(0).max(180),
  raan: angle,
  argp: angle,
  nu: angle,
})

export const orbitWidgetSchema = z.object({
  kind: z.literal('orbit'),
  body: z.enum(CENTRAL_BODIES.map((b) => b.key) as [string, ...string[]]),
  elements: orbitalElementsSchema,
  // Editor nodes store unset attributes as null.
  view: z.object({ yaw: z.number().finite(), pitch: z.number().finite().min(-90).max(90) }).nullish(),
})
