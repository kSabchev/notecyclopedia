import { expect, test } from '@playwright/test'

test('a topic hub references a lecture section, which shows it, and terms are searchable', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('References user')
  await page.getByLabel('Email').fill(`refs-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  // A long lecture, so following the reference has to scroll to the section.
  const filler = Array.from({ length: 30 }, (_, i) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `Background paragraph ${i + 1}.` }],
  }))
  const lecture = (await (
    await page.request.post('/api/pages', {
      data: {
        courseId,
        title: 'Orbital manoeuvres',
        type: 'lecture',
        lectureNumber: 4,
        content: {
          type: 'doc',
          content: [
            ...filler,
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Bi-elliptic transfer' }],
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Three burns, cheaper for large ratios.' }],
            },
          ],
        },
      },
    })
  ).json()) as { id: string; content: { content: { attrs?: { id?: string } }[] } }
  const headingId = lecture.content.content[30]?.attrs?.id
  expect(headingId).toBeTruthy()
  const hub = (await (
    await page.request.post('/api/pages', {
      data: {
        courseId,
        title: 'Transfers',
        type: 'theory',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Compare: ' }] }],
        },
      },
    })
  ).json()) as { id: string }

  // Insert a reference to the lecture's section from the editor.
  await page.goto(`/pages/${hub.id}/edit`)
  await page.getByLabel('Page content').click()
  await page.keyboard.press('End')
  await page.getByRole('button', { name: 'Reference', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Insert a reference' })
  await picker.getByLabel('Search pages and terms…').fill('bi-elliptic')
  await picker.getByRole('button', { name: /term\s*Bi-elliptic transfer/i }).click()
  await expect(picker).toHaveCount(0)
  await page.getByRole('button', { name: 'Save revision' }).click()
  await expect(page).toHaveURL(`/pages/${hub.id}`)

  // Following it lands on the section of the lecture.
  await page.getByRole('link', { name: 'Bi-elliptic transfer' }).click()
  await expect(page).toHaveURL(`/pages/${lecture.id}#${headingId}`)
  await expect(page.getByRole('heading', { name: 'Bi-elliptic transfer' })).toBeInViewport()

  // The lecture shows what references it, and to which section.
  const referencedBy = page.getByRole('region', { name: 'Referenced by' })
  await expect(referencedBy.getByRole('link', { name: 'Transfers' })).toBeVisible()
  await expect(referencedBy.getByText('Theory (topic hub) · to “Bi-elliptic transfer”')).toBeVisible()

  // Search finds the term and opens its section.
  await page.goto(`/pages/${hub.id}`)
  await page.getByRole('button', { name: /Search everything/ }).click()
  await page.getByLabel('Search everything').fill('bi-elliptic')
  await page.getByRole('link', { name: /term\s*Bi-elliptic transfer/i }).click()
  await expect(page).toHaveURL(`/pages/${lecture.id}#${headingId}`)
})

// Claude is not called in tests: the draft is answered here; the editor, saving and references are real.
test('a theory page is drafted as a topic hub whose links reach the lecture', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Topic hub user')
  await page.getByLabel('Email').fill(`hub-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  const lecture = (await (
    await page.request.post('/api/pages', {
      data: {
        courseId,
        title: 'Orbital manoeuvres',
        type: 'lecture',
        lectureNumber: 4,
        content: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hohmann transfer' }] },
          ],
        },
      },
    })
  ).json()) as { id: string; content: { content: { attrs?: { id?: string } }[] } }
  const headingId = lecture.content.content[0]?.attrs?.id as string

  let asked: { courseId: string; topic: string } | undefined
  await page.route('**/api/ai/topic-hub', async (route) => {
    asked = route.request().postDataJSON()
    await route.fulfill({
      json: {
        targets: 1,
        usage: null,
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Transfers change orbits with burns.' }] },
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Where it is covered' }],
            },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: 'Hohmann transfer',
                          marks: [{ type: 'link', attrs: { href: `/pages/${lecture.id}#${headingId}` } }],
                        },
                        { type: 'text', text: ' (Orbital manoeuvres) — two burns' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    })
  })

  await page.goto(`/pages/new?courseId=${courseId}`)
  await page.getByLabel('Page type').selectOption('theory')
  await page.getByPlaceholder('Page title').fill('Orbital transfers')
  await page.getByRole('button', { name: 'Draft topic hub with AI' }).click()
  await expect(page.getByText('Drafted with 1 matching section or page to link to.')).toBeVisible()
  expect(asked).toEqual({ courseId, topic: 'Orbital transfers' })
  // The draft is editable before it is saved.
  await page.getByLabel('Page content').getByText('Transfers change orbits with burns.').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Edited.')
  await page.getByRole('button', { name: 'Save revision' }).click()
  await expect(page.getByText('Transfers change orbits with burns. Edited.')).toBeVisible()

  await page.getByRole('link', { name: 'Hohmann transfer' }).click()
  await expect(page).toHaveURL(`/pages/${lecture.id}#${headingId}`)
  await expect(
    page.getByRole('region', { name: 'Referenced by' }).getByRole('link', { name: 'Orbital transfers' }),
  ).toBeVisible()
})
