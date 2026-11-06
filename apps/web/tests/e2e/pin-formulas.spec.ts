import { expect, test } from '@playwright/test'

test('formulas are pinned per person from the list or the lecture, and removed from home after a confirmation', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Pinner')
  await page.getByLabel('Email').fill(`pin-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  const pageId = (
    (await (
      await page.request.post('/api/pages', {
        data: {
          courseId,
          title: 'Vis-viva',
          type: 'lecture',
          content: {
            type: 'doc',
            content: [
              { type: 'formula', attrs: { latex: 'v^2 = \\mu (2/r - 1/a)', description: 'Orbital speed' } },
            ],
          },
        },
      })
    ).json()) as { id: string; revision: number }
  ).id

  // Pin it from the formula list.
  await page.getByRole('link', { name: 'Formulas' }).click()
  await page.getByRole('button', { name: 'Pin to home' }).click()
  await expect(page.getByRole('button', { name: 'Unpin from home' })).toHaveAttribute('aria-pressed', 'true')

  // It is on your home page; the page itself is unchanged (pins are personal, not a revision).
  await page.getByRole('link', { name: 'Home' }).click()
  const pinned = page.getByRole('region', { name: 'Pinned formulas' })
  await expect(pinned.getByText('Orbital speed')).toBeVisible()
  const saved = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as { revision: number }
  expect(saved.revision).toBe(1)

  // In the lecture, the star sits in front of the formula; clicking it does not open the formula's card.
  await page.goto(`/pages/${pageId}`)
  const formula = page.locator('[data-formula-node]')
  const star = formula.getByRole('button', { name: 'Unpin from home' })
  await expect(star).toHaveText('★')
  await star.click()
  await expect(formula.getByRole('button', { name: 'Pin to home' })).toHaveText('☆')
  await expect(page.getByRole('complementary', { name: 'Help with this page' })).toHaveCount(0)
  await formula.getByRole('button', { name: 'Pin to home' }).click()
  await expect(formula.getByRole('button', { name: 'Unpin from home' })).toBeVisible()

  // Removing it from the home page asks first; cancelling keeps it.
  await page.getByRole('link', { name: 'Home' }).click()
  const remove = pinned.getByRole('button', { name: 'Remove Orbital speed from pinned formulas' })
  page.once('dialog', (dialog) => dialog.dismiss())
  await remove.click()
  await expect(pinned.getByText('Orbital speed')).toBeVisible()
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('Remove “Orbital speed” from your pinned formulas?')
    return dialog.accept()
  })
  await remove.click()
  await expect(pinned.getByText('Orbital speed')).toHaveCount(0)
})
