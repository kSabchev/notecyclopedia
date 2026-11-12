import { expect, test } from '@playwright/test'

test('math left as $…$ text is tidied into typeset math, and typing $…$ makes inline math', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Typesetter')
  await page.getByLabel('Email').fill(`math-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const { id: courseId } = (await (
    await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })
  ).json()) as {
    id: string
  }
  // As an older "Save to page" left it: raw dollar signs and word subscripts in italics.
  const { id } = (await (
    await page.request.post('/api/pages', {
      data: {
        courseId,
        title: 'Hohmann transfer',
        type: 'lecture',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'The transfer ellipse has $a_{tr}=\\frac{a_{par}+a_{tar}}{2}$, costing $5 and $10.',
                },
              ],
            },
          ],
        },
      },
    })
  ).json()) as { id: string }

  await page.goto(`/pages/${id}/edit`)
  await page.getByRole('button', { name: 'Tidy formulas' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Tidied 1 formula.' })).toBeVisible()
  // Typing $…$ makes inline math too.
  const editor = page.getByLabel('Page content')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Escape speed $v_{esc}$ ')
  await expect(editor.locator('[data-math-inline] .katex')).toHaveCount(2)
  await page.getByRole('button', { name: 'Save revision' }).click()
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toBeVisible()

  // The reading view typesets it; money stays text.
  const paragraph = page.locator('article p').filter({ hasText: 'The transfer ellipse has' })
  await expect(paragraph.locator('.katex')).toHaveCount(2)
  await expect(paragraph).toContainText('costing $5 and $10.')
  await expect(paragraph).not.toContainText('$a_')
  const saved = (await (await page.request.get(`/api/pages/${id}`)).json()) as {
    content: { content: { content: { type: string; attrs?: { latex: string } }[] }[] }
  }
  expect(
    saved.content.content[0]?.content.filter((n) => n.type === 'mathInline').map((n) => n.attrs?.latex),
  ).toEqual(['a_{\\text{tr}}=\\frac{a_{\\text{par}}+a_{\\text{tar}}}{2}', 'v_{\\text{esc}}'])
})
