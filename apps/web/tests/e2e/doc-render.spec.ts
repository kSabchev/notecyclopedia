import { expect, test } from '@playwright/test'

const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })

test('a page is read without loading the editor, and every kind of block is shown', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Render reader')
  await page.getByLabel('Email').fill(`render-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Mechanics' } })).json()) as {
      id: string
    }
  ).id
  const create = async (title: string, content: unknown[]) =>
    (
      (await (
        await page.request.post('/api/pages', {
          data: { courseId, title, type: 'lecture', content: { type: 'doc', content } },
        })
      ).json()) as { id: string }
    ).id
  const target = await create('Energy', [p(text('Energy is conserved.'))])
  const pageId = await create('Everything', [
    { type: 'heading', attrs: { level: 2 }, content: [text('Kinematics')] },
    p(
      text('Speed is '),
      text('bold', [{ type: 'bold' }]),
      text(', '),
      text('slanted', [{ type: 'italic' }]),
      text(' and '),
      text('v = s/t', [{ type: 'code' }]),
      text('.'),
      { type: 'hardBreak' },
      text('See '),
      text('energy', [{ type: 'link', attrs: { href: `/pages/${target}` } }]),
      text(' or '),
      text('the web', [{ type: 'link', attrs: { href: 'https://example.com/', target: '_blank' } }]),
      text('.'),
    ),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(text('First point'))] },
        {
          type: 'listItem',
          content: [
            p(text('Second point')),
            {
              type: 'orderedList',
              attrs: { start: 3 },
              content: [{ type: 'listItem', content: [p(text('Nested three'))] }],
            },
          ],
        },
      ],
    },
    { type: 'blockquote', content: [p(text('A quoted line.'))] },
    { type: 'codeBlock', attrs: { language: 'python' }, content: [text('v = s / t\nprint(v)')] },
    { type: 'horizontalRule' },
    { type: 'formula', attrs: { latex: 'v = \\frac{s}{t}', label: '1.1', description: 'Average speed' } },
    { type: 'callout', content: [p(text('Units must match.'))] },
    { type: 'image', attrs: { fileId: crypto.randomUUID(), caption: 'A missing figure' } },
    {
      type: 'widget',
      attrs: {
        kind: 'calculator',
        spec: {
          version: 1,
          name: 'Average speed',
          inputs: [
            { key: 's', label: 'Distance', default: 100 },
            { key: 't', label: 'Time', default: 20 },
          ],
          outputs: [{ key: 'v', label: 'Speed', expr: 's / t' }],
        },
      },
    },
    { type: 'heading', attrs: { level: 3 }, content: [text('Summary')] },
    p(text('Two   spaces stay.')),
  ])

  // Hovering a link loads its route early (the router preloads on intent): keep the pointer off the page.
  await page.mouse.move(0, 0)
  // The home page (whose daily question card uses Markdown) must finish loading before requests are recorded.
  await page.waitForLoadState('networkidle')
  const requested: string[] = []
  page.on('request', (r) => requested.push(r.url()))
  await page.goto(`/pages/${pageId}`)
  const doc = page.locator('.prose-nc')

  await expect(doc.getByRole('heading', { level: 2, name: 'Kinematics' })).toHaveAttribute('id', /.+/)
  await expect(doc.getByRole('heading', { level: 3, name: 'Summary' })).toBeVisible()
  await expect(doc.locator('strong')).toHaveText('bold')
  await expect(doc.locator('em')).toHaveText('slanted')
  await expect(doc.locator('p code')).toHaveText('v = s/t')
  await expect(doc.locator('p br')).toHaveCount(1)
  await expect(doc.getByRole('link', { name: 'the web' })).toHaveAttribute('target', '_blank')
  await expect(doc.locator('ul > li')).toHaveCount(2)
  await expect(doc.locator('ol')).toHaveAttribute('start', '3')
  await expect(doc.locator('ol li')).toHaveText('Nested three')
  await expect(doc.locator('blockquote')).toHaveText('A quoted line.')
  await expect(doc.locator('pre code')).toHaveText('v = s / t\nprint(v)')
  await expect(doc.locator('pre code')).toHaveClass(/language-python/)
  await expect(doc.locator('hr')).toHaveCount(1)
  const formula = doc.locator('[data-formula-node]')
  await expect(formula).toHaveAttribute('data-latex', 'v = \\frac{s}{t}')
  await expect(formula).toHaveAttribute('id', /.+/)
  await expect(formula.getByText('(1.1)')).toBeVisible()
  await expect(formula.getByText('Average speed')).toBeVisible()
  await expect(formula.locator('.katex')).toBeVisible()
  await expect(doc.locator('aside[data-type="callout"]')).toContainText('Units must match.')
  await expect(doc.getByText('A missing figure')).toBeVisible()
  await expect(doc.getByLabel('Distance')).toHaveValue('100')
  await expect(doc.getByText('5', { exact: true })).toBeVisible()
  await expect(doc.getByText('Two   spaces stay.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('doc-render.png'), fullPage: true })

  // Reading does not load the editor (TipTap / ProseMirror) or the Markdown renderer.
  expect(requested.filter((u) => /tiptap|prosemirror|react-markdown/i.test(u))).toEqual([])

  // Links to pages open inside the app.
  await doc.getByRole('link', { name: 'energy' }).click()
  await expect(page).toHaveURL(`/pages/${target}`)
  await expect(page.getByText('Energy is conserved.')).toBeVisible()

  // The editor still loads when it is needed.
  await page.goto(`/pages/${pageId}/edit`)
  await expect(page.getByLabel('Page content').getByText('Units must match.')).toBeVisible()
  expect(requested.some((u) => /tiptap/i.test(u))).toBe(true)
})
