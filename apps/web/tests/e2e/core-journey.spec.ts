import { expect, test } from '@playwright/test'

test('sign in, create/edit/read an article, attach a source, and persist theme', async ({ page }) => {
  const email = `browser-${crypto.randomUUID()}@example.test`
  const password = 'browser-test-password'

  await page.goto('/login')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()

  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Browser test user')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  await page.getByRole('button', { name: 'New course' }).click()
  await page.getByLabel('Course name').fill('Browser test course')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Browser test course' })).toBeVisible()

  await page.getByRole('link', { name: 'Calculators' }).click()
  await page.getByRole('tab', { name: 'Constants' }).click()
  await page.getByRole('button', { name: 'Add constant' }).click()
  await page.getByRole('textbox', { name: 'Variable key', exact: true }).fill('SOUND_SPEED')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Speed of sound')
  await page.getByRole('textbox', { name: 'Symbol', exact: true }).fill('c_s')
  await page.getByRole('spinbutton', { name: 'Value', exact: true }).fill('343')
  await page.getByRole('textbox', { name: 'Unit', exact: true }).fill('m/s')
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Approximate value in dry air.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Speed of sound', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Calculators' }).click()
  await page.getByRole('button', { name: 'New calculator' }).click()
  await page.getByLabel('Visible to').selectOption({ label: 'Browser test course' })
  await page.getByLabel('Name', { exact: true }).fill('Sound speed calculator')
  await page.getByLabel('Add a constant to this calculator').selectOption('SOUND_SPEED')
  await page.getByRole('button', { name: 'Add to calculator' }).click()
  await expect(page.getByText('Speed of sound', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sound speed calculator' })).toBeVisible()

  await page.getByRole('link', { name: 'New page' }).click()
  await page.locator('#page-title').fill('Browser journey article')
  await page.locator('.ProseMirror').fill('Initial article content.')
  await page.locator('#lecture-number').fill('7')
  await page.getByRole('button', { name: 'Save revision' }).click()
  await expect(page.getByRole('heading', { name: 'Browser journey article' })).toBeVisible()
  await expect(page.getByText('Lecture 7')).toBeVisible()

  await page.getByRole('link', { name: 'Edit' }).click()
  await page.locator('#page-title').fill('Edited browser article')
  await page.locator('.ProseMirror').fill('Updated article content.')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'browser-source.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A source attached in the browser test.'),
  })
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await page.getByRole('button', { name: 'Save revision' }).click()

  await expect(page.getByRole('heading', { name: 'Edited browser article' })).toBeVisible()
  await expect(page.getByText('Updated article content.')).toBeVisible()
  await page.getByRole('tab', { name: 'Source files' }).click()
  await expect(page.getByRole('button', { name: 'browser-source.txt' })).toBeVisible({ timeout: 15_000 })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Wiki' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Wiki' })).toBeVisible()

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
