import { type Page, expect, test } from '@playwright/test'

async function signUp(page: Page, name: string) {
  const email = `share-${crypto.randomUUID()}@example.test`
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  return email
}

// No AI is involved anywhere here: plans come from a file, and are shared as copies.
test('a plan is imported, paused, exported, and shared with a course member who accepts a copy', async ({
  page,
  browser,
}) => {
  // The classmate signs up in a browser of their own.
  const classmateContext = await browser.newContext()
  const classmate = await classmateContext.newPage()
  const classmateEmail = await signUp(classmate, 'Classmate')

  await signUp(page, 'Planner')
  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  const kepler = (
    (await (
      await page.request.post('/api/pages', { data: { courseId, title: 'Kepler orbits', type: 'lecture' } })
    ).json()) as { id: string }
  ).id
  await page.request.post(`/api/courses/${courseId}/members`, {
    data: { email: classmateEmail, role: 'viewer' },
  })

  // Import a plan file: the task about "Kepler Orbits" is linked to the course's page of that title.
  const file = {
    format: 'notecyclopedia-exam-plan',
    version: 1,
    title: 'Astro final',
    examDate: '2099-06-01',
    studyWeekdays: [1, 2, 3, 4, 5],
    days: [
      {
        date: '2099-05-29',
        items: [
          { focus: 'Read the lecture', done: true, page: { id: 'elsewhere', title: 'Kepler  Orbits' } },
          { focus: 'Read the missing one', done: false, page: { id: 'gone', title: 'Lambert problem' } },
        ],
      },
    ],
  }
  await page.goto('/study')
  await page.getByText('Import a plan').click()
  // The file box is enabled once the courses are loaded.
  await expect(page.getByLabel('Into course')).toHaveValue(courseId)
  await expect(page.getByLabel('Plan file (.json)')).toBeEnabled()
  await page.getByLabel('Plan file (.json)').setInputFiles({
    name: 'astro.plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  })
  await expect(page.getByText('Imported “Astro final”.')).toBeVisible()
  await expect(page.getByText('1 could not be matched')).toBeVisible()
  await page
    .getByRole('status')
    .getByRole('link', { name: /Open plan/ })
    .click()
  await expect(page.getByRole('textbox', { name: 'Plan title' })).toHaveValue('Astro final')
  await expect(page.getByRole('link', { name: 'Kepler orbits' })).toHaveAttribute('href', `/pages/${kepler}`)
  await expect(page.getByText('Lambert problem (page not found)')).toBeVisible()
  // Progress was not kept (that is a choice on import).
  await expect(page.getByRole('checkbox', { name: 'Read the lecture' })).not.toBeChecked()

  // Pause, then resume.
  await page.getByRole('button', { name: 'Pause plan' }).click()
  await expect(page.getByText('Paused: kept as it is')).toBeVisible()
  await page.getByRole('link', { name: 'All plans' }).click()
  await page.getByText('Paused plan (1)').click()
  await expect(page.getByRole('link', { name: /Astro final/ })).toContainText('Paused')
  await page.getByRole('link', { name: /Astro final/ }).click()
  await page.getByRole('button', { name: 'Resume plan' }).click()
  await expect(page.getByText('Paused: kept as it is')).toHaveCount(0)

  // Export: a file that imports again.
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export' }).click()
  const exported = await download
  expect(exported.suggestedFilename()).toBe('Astro-final.plan.json')
  const saved = JSON.parse(
    await (await exported.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()),
  )
  expect(saved).toEqual(
    expect.objectContaining({
      format: 'notecyclopedia-exam-plan',
      title: 'Astro final',
      courseName: 'Astrodynamics',
    }),
  )

  // Share a copy with the classmate.
  await page.getByText('Share a copy').click()
  await page.getByLabel('Course member').selectOption({ label: `Classmate (${classmateEmail})` })
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('Sent to Classmate.')).toBeVisible()

  // The classmate accepts it: their own copy, linked to the course page, with nothing ticked off.
  await classmate.goto('/study')
  const shared = classmate.getByRole('region', { name: 'Shared with you' })
  await expect(shared).toContainText('Planner sent you “Astro final”: exam on 2099-06-01, 2 tasks.')
  await shared.getByRole('button', { name: 'Accept' }).click()
  await expect(classmate.getByRole('textbox', { name: 'Plan title' })).toHaveValue('Astro final')
  await expect(classmate.getByRole('link', { name: 'Kepler orbits' })).toHaveAttribute(
    'href',
    `/pages/${kepler}`,
  )
  await classmate.getByRole('link', { name: 'All plans' }).click()
  await expect(classmate.getByRole('region', { name: 'Shared with you' })).toHaveCount(0)
  await expect(classmate.getByRole('link', { name: /Astro final/ })).toBeVisible()
  await classmateContext.close()
})
