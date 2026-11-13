import { BUILT_IN_CONSTANTS, type DocJSON, PAGE_TYPES, calculatorSpecSchema } from '@nc/shared'
import { z } from 'zod'

/** The backup archive format: a manifest (validated here) and the uploaded files. */

export const FORMAT = 'notecyclopedia-backup'
export const VERSION = 1
export const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024 * 1024
export const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024
export const MAX_FILE_SIZE = 100 * 1024 * 1024
export const MAX_MANIFEST_SIZE = 100 * 1024 * 1024

export const docSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()
  .transform((doc) => doc as DocJSON)
export const lectureNumberSchema = z.number().int().positive().max(2_147_483_647)

export const timestampSchema = z
  .string()
  .datetime()
  .transform((value) => new Date(value))
const backupObjectSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  createdAt: timestampSchema,
  courses: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        description: z.string().max(2000).nullable(),
        createdAt: timestampSchema,
      }),
    )
    .max(1000),
  pages: z
    .array(
      z.object({
        id: z.string().uuid(),
        courseId: z.string().uuid(),
        title: z.string().min(1).max(200),
        type: z.enum(PAGE_TYPES),
        lectureNumber: lectureNumberSchema.nullable().optional().default(null),
        tags: z.array(z.string().min(1).max(40)).max(20),
        content: docSchema,
        aiVisible: z.boolean(),
        revision: z.number().int().positive(),
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
        revisions: z
          .array(
            z.object({
              revision: z.number().int().positive(),
              title: z.string().min(1).max(200),
              content: docSchema,
              message: z.string().nullable(),
              createdAt: timestampSchema,
            }),
          )
          .min(1)
          .max(10_000),
      }),
    )
    .max(20_000),
  calculators: z
    .array(
      z.object({
        id: z.string().uuid(),
        courseId: z.string().uuid().nullable(),
        name: z.string().min(1).max(200),
        spec: calculatorSpecSchema,
        origin: z.enum(['manual', 'ai']),
        sourcePageId: z.string().uuid().nullable(),
        /** Older backups have none. */
        lectureNumber: lectureNumberSchema.nullable().optional().default(null),
        archivedAt: timestampSchema.nullable().optional().default(null),
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
      }),
    )
    .max(5000),
  constants: z
    .array(
      z.object({
        id: z.string().uuid(),
        courseId: z.string().uuid(),
        key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
        name: z.string().min(1).max(120),
        symbol: z.string().min(1).max(32),
        value: z.number().finite(),
        unit: z.string().min(1).max(40),
        description: z.string().max(500).nullable(),
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
      }),
    )
    .max(20_000)
    .default([]),
  files: z
    .array(
      z.object({
        id: z.string().uuid(),
        courseId: z.string().uuid(),
        pageId: z.string().uuid().nullable(),
        name: z.string().min(1).max(255),
        mime: z.string().min(1).max(255),
        size: z.number().int().nonnegative().max(MAX_FILE_SIZE),
        /** The lecture this upload is the original of; older backups have none. */
        lectureNumber: lectureNumberSchema.nullable().optional().default(null),
        entryPath: z.string().regex(/^files\/[0-9a-f-]{36}$/i),
        createdAt: timestampSchema,
      }),
    )
    .max(20_000),
})
export const backupSchema = backupObjectSchema.superRefine((backup, ctx) => {
  const courseIds = new Set(backup.courses.map((course) => course.id))
  const originals = new Set<string>()
  backup.files.forEach((file, index) => {
    if (file.lectureNumber === null) return
    const key = `${file.courseId}:${file.lectureNumber}`
    if (originals.has(key))
      ctx.addIssue({
        code: 'custom',
        message: 'Two files are the original of the same lecture',
        path: ['files', index, 'lectureNumber'],
      })
    originals.add(key)
  })
  const keysByCourse = new Set<string>()
  const builtInKeys = new Set(BUILT_IN_CONSTANTS.map((constant) => constant.key))
  backup.constants.forEach((constant, index) => {
    if (!courseIds.has(constant.courseId))
      ctx.addIssue({
        code: 'custom',
        message: 'Constant references a course not included in the backup',
        path: ['constants', index, 'courseId'],
      })
    const scopedKey = `${constant.courseId}:${constant.key}`
    if (keysByCourse.has(scopedKey))
      ctx.addIssue({
        code: 'custom',
        message: 'Duplicate constant key in a course',
        path: ['constants', index, 'key'],
      })
    keysByCourse.add(scopedKey)
    if (builtInKeys.has(constant.key))
      ctx.addIssue({
        code: 'custom',
        message: 'Constant key is reserved for a built-in constant',
        path: ['constants', index, 'key'],
      })
  })
})

export type BackupData = z.infer<typeof backupSchema>

export const allowedExtension = /\.(pdf|docx?|pptx?|xlsx?|odt|odp|ods|rtf|txt|md|csv|png|jpe?g|gif|webp)$/i
