import { expect, test } from '@playwright/test'

test('uploads can be searched, filtered and paged; the backup page says when the last backup was', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Archivist')
  await page.getByLabel('Email').fill(`archive-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const course = async (name: string) =>
    ((await (await page.request.post('/api/courses', { data: { name } })).json()) as { id: string }).id
  const astro = await course('Astrodynamics')
  const mission = await course('Mission design')
  const upload = (courseId: string, name: string) =>
    page.request.post('/api/files', {
      multipart: {
        courseId,
        files: { name, mimeType: 'text/plain', buffer: Buffer.from(`Notes: ${name}`) },
      },
    })
  // More than one page of uploads (50 a page).
  for (let i = 1; i <= 50; i++) await upload(astro, `week-${String(i).padStart(2, '0')}.txt`)
  await upload(mission, 'launch-windows.txt')

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Uploads', exact: true })
    .click()
  const rows = page.getByRole('row')
  await expect(rows).toHaveCount(50)
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(rows).toHaveCount(51)
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0)

  await page.getByLabel('Search uploads').fill('LAUNCH')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('launch-windows.txt')
  await page.getByLabel('Show course').selectOption({ label: 'Astrodynamics' })
  await expect(page.getByText('No uploads match.')).toBeVisible()
  await page.getByLabel('Search uploads').fill('week-07')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('week-07.txt')

  // Backup: never made, then made just now.
  await page.goto('/backup')
  await expect(page.getByText('You have not downloaded a backup yet.')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download backup' }).click()
  await (await download).path()
  await expect(page.getByText(/^Last backup: /)).toBeVisible()
})
