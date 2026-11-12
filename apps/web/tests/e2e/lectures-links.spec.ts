import { expect, test } from '@playwright/test'

test('lectures in order from the sidebar, descriptions under formulas, and useful links', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Navigator')
  await page.getByLabel('Email').fill(`nav-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  // Every course numbers its own lectures.
  await page.request.post('/api/courses', { data: { name: 'Mission design' } })
  const create = async (title: string, type: string, lectureNumber: number | null, content: unknown[] = []) =>
    (
      (await (
        await page.request.post('/api/pages', {
          data: { courseId, title, type, lectureNumber, content: { type: 'doc', content } },
        })
      ).json()) as { id: string }
    ).id
  await create('Transfers', 'lecture', 2)
  const kepler = await create('Kepler orbits', 'lecture', 1, [
    {
      type: 'formula',
      attrs: {
        latex: 'v^2 = \\mu \\left(\\frac{2}{r} - \\frac{1}{a}\\right)',
        label: '1.1',
        description:
          'Vis-viva: the orbital speed at radius r on an orbit of semi-major axis a, for any conic section',
      },
    },
  ])
  await create('Kepler exercises', 'seminar', 1)
  await create('Kepler notes', 'note', 1)
  await create('Perturbations', 'lecture', 3)
  await create('Glossary', 'note', null)
  const calcId = (
    (await (
      await page.request.post('/api/calculators', {
        data: {
          courseId,
          spec: {
            version: 1,
            name: 'Orbital period',
            inputs: [{ key: 'a', label: 'Semi-major axis', unit: 'km', default: 7000 }],
            outputs: [{ key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(a^3 / 398600)' }],
          },
        },
      })
    ).json()) as { id: string }
  ).id

  // No originals yet: the Lectures tab says how to add one.
  await page.getByRole('link', { name: 'Lectures' }).click()
  await expect(page).toHaveURL('/lectures')
  await expect(page.getByText('No original lectures yet.')).toBeVisible()

  // Upload lecture 1's slides as its original, and mark an uploaded file as lecture 2's.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Uploads', exact: true })
    .click()
  await page.getByLabel('Upload to course').selectOption({ label: 'Astrodynamics' })
  await expect(page.getByText('Astrodynamics has no original lectures yet.')).toBeVisible()
  await page.getByLabel('Original of lecture (optional)').fill('1')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'lecture-1-slides.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Kepler orbits: slides'),
  })
  await expect(page.getByText('Original · Lecture 1')).toBeVisible()
  await expect(page.getByLabel('Original of lecture (optional)')).toHaveValue('')
  // The numbers already used in the chosen course are listed, and a taken one is caught before uploading.
  await expect(page.getByText('Lectures of Astrodynamics that already have an original: 1.')).toBeVisible()
  await page.getByLabel('Original of lecture (optional)').fill('1')
  await expect(
    page.getByText('Lecture 1 of Astrodynamics already has an original (lecture-1-slides.txt).'),
  ).toBeVisible()
  await page.getByLabel('Upload to course').selectOption({ label: 'Mission design' })
  await expect(page.getByText('Mission design has no original lectures yet.')).toBeVisible()
  await page.getByLabel('Original of lecture (optional)').fill('')
  await page.getByLabel('Upload to course').selectOption({ label: 'Astrodynamics' })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'lecture-2-handout.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Transfers: handout'),
  })
  const handout = page.getByRole('row').filter({ hasText: 'lecture-2-handout.txt' })
  await handout.getByRole('button', { name: 'Mark as original lecture' }).click()
  // Lecture 1 of Astrodynamics already has its original; Mission design's lecture 1 is free.
  await expect(handout.getByLabel('Course of the lecture')).toHaveValue(courseId)
  await handout.getByLabel('Lecture number').fill('1')
  await expect(handout).toContainText(
    'Lecture 1 of Astrodynamics already has an original (lecture-1-slides.txt)',
  )
  await expect(handout.getByRole('button', { name: 'Mark', exact: true })).toBeDisabled()
  await handout.getByLabel('Lecture number').fill('2')
  await handout.getByRole('button', { name: 'Mark', exact: true }).click()
  await expect(handout.getByText('Original · Lecture 2')).toBeVisible()

  // Marking a file as another course's lecture moves it there.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'mission-intro.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Mission design: introduction'),
  })
  const intro = page.getByRole('row').filter({ hasText: 'mission-intro.txt' })
  await intro.getByRole('button', { name: 'Mark as original lecture' }).click()
  await intro.getByLabel('Course of the lecture').selectOption({ label: 'Mission design' })
  await intro.getByLabel('Lecture number').fill('1')
  await expect(intro).toContainText('The file moves to Mission design.')
  await intro.getByRole('button', { name: 'Mark', exact: true }).click()
  await expect(intro.getByText('Original · Lecture 1')).toBeVisible()
  await expect(intro).toContainText('Mission design')

  // A calculator is tagged with a lecture of its course.
  await page.goto(`/calculators/${calcId}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Lecture (optional)').fill('1')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('link', { name: /Orbital period/ })).toContainText('Lecture 1')

  // Lectures lists only the originals, in order, each with its pages, example problems and calculators.
  await page.getByRole('link', { name: 'Lectures' }).click()
  const course = page.getByRole('region', { name: 'Astrodynamics' })
  const cards = course
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: /Open the original/ }) })
  await expect(cards).toHaveCount(2)
  await expect(
    page
      .getByRole('region', { name: 'Mission design' })
      .getByRole('listitem', { name: 'Lecture 1' })
      .getByRole('link', { name: 'Open the original: mission-intro.txt' }),
  ).toBeVisible()
  const first = course.getByRole('listitem', { name: 'Lecture 1' })
  await expect(first.getByRole('link', { name: 'Open the original: lecture-1-slides.txt' })).toHaveAttribute(
    'target',
    '_blank',
  )
  await expect(first.getByRole('link', { name: 'Kepler orbits' })).toBeVisible()
  await expect(first.getByRole('link', { name: 'Kepler exercises' })).toBeVisible()
  await expect(first.getByRole('link', { name: 'Kepler notes' })).toBeVisible()
  await expect(first.getByRole('link', { name: 'Orbital period' })).toBeVisible()
  await expect(
    course.getByRole('listitem', { name: 'Lecture 2' }).getByRole('link', { name: 'Transfers' }),
  ).toBeVisible()
  await expect(course.getByText('Lectures with pages or calculators but no original yet: 3.')).toBeVisible()

  // The Wiki groups a course by lecture too: its original, then the lecture, notes, problems and calculators.
  await page.getByRole('link', { name: 'Wiki' }).click()
  await page.getByRole('button', { name: 'By lecture' }).click()
  const wiki = page.getByRole('region', { name: 'Astrodynamics' })
  const wikiLecture1 = wiki.getByRole('region', { name: 'Lecture 1' })
  await expect(wikiLecture1.getByRole('link', { name: /Original: lecture-1-slides\.txt/ })).toBeVisible()
  await expect(wikiLecture1.getByRole('listitem')).toHaveText([
    /Lecture.*Kepler orbits/,
    /My notes.*Kepler notes/,
    /Example problems?.*Kepler exercises/,
    /Calculator.*Orbital period/,
  ])
  await expect(wiki.getByRole('region', { name: 'Not tied to a lecture' })).toContainText('Glossary')
  // The choice is remembered.
  await page.reload()
  await expect(page.getByRole('button', { name: 'By lecture' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'By type' }).click()
  await page.getByRole('link', { name: 'Lectures' }).click()

  // A long description sits under its formula instead of squeezing it.
  await first.getByRole('link', { name: 'Kepler orbits' }).click()
  await expect(page).toHaveURL(`/pages/${kepler}`)
  // The article links back to its lecture's original.
  // In the header and in the Connected panel.
  await expect(page.getByRole('link', { name: /Original: lecture-1-slides\.txt/ }).first()).toHaveAttribute(
    'target',
    '_blank',
  )
  const formula = page.locator('[data-formula-node]')
  const tex = await formula.locator('.katex').boundingBox()
  const description = await formula.getByText(/^Vis-viva: the orbital speed/).boundingBox()
  expect(tex && description && description.y >= tex.y + tex.height - 1).toBe(true)

  // Useful links: built in, opening in a new tab.
  await page.getByRole('link', { name: 'Useful links' }).click()
  const builtIn = page.getByRole('region', { name: 'Built in' })
  for (const [name, href] of [
    ["NASA's Eyes", 'https://science.nasa.gov/eyes/'],
    ['JPL Horizons', 'https://ssd.jpl.nasa.gov/horizons/'],
    ['CelesTrak', 'https://celestrak.org/'],
  ]) {
    const link = builtIn.getByRole('link', { name: new RegExp(name) })
    await expect(link).toHaveAttribute('href', href)
    await expect(link).toHaveAttribute('target', '_blank')
  }
  await expect(builtIn.getByRole('link', { name: /Copernicus Browser/ })).toHaveAttribute(
    'href',
    /^https:\/\/browser\.dataspace\.copernicus\.eu\/\?zoom=5/,
  )

  // Your own: only web addresses; removing one asks first.
  const mine = page.getByRole('region', { name: 'My links' })
  await expect(mine.getByText('Add your own links below.')).toBeVisible()
  await mine.getByLabel('Name').fill('Space-Track')
  await mine.getByLabel('Address').fill('javascript:alert(1)')
  await mine.getByRole('button', { name: 'Add a link' }).click()
  await expect(mine.getByRole('alert')).toBeVisible()
  await mine.getByLabel('Address').fill('https://www.space-track.org/')
  await mine.getByLabel('What it is for').fill('TLE catalogue')
  await mine.getByRole('button', { name: 'Add a link' }).click()
  await expect(mine.getByRole('link', { name: /Space-Track/ })).toHaveAttribute(
    'href',
    'https://www.space-track.org/',
  )
  await expect(mine.getByText('TLE catalogue')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await mine.getByRole('button', { name: 'Remove Space-Track' }).click()
  await expect(mine.getByRole('link', { name: /Space-Track/ })).toHaveCount(0)

  // Edit in Lectures: move lecture 2 with its pages to another course.
  await page.getByRole('link', { name: 'Lectures' }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const astro = page.getByRole('region', { name: 'Astrodynamics' })
  const transfers = astro.getByRole('listitem', { name: 'Lecture 2' })
  await transfers.getByRole('button', { name: 'Move lecture' }).click()
  await transfers.getByLabel('Move to course').selectOption({ label: 'Mission design' })
  // Mission design's lecture 1 is taken; lecture 2 is free.
  await transfers.getByLabel('Lecture number there').fill('1')
  await expect(transfers).toContainText(
    'Lecture 1 of Mission design already has an original (mission-intro.txt)',
  )
  await expect(transfers.getByRole('button', { name: 'Move', exact: true })).toBeDisabled()
  await transfers.getByLabel('Lecture number there').fill('2')
  await expect(transfers.getByLabel('Bring its pages, example problems and calculators')).toBeChecked()
  await transfers.getByRole('button', { name: 'Move', exact: true }).click()
  const mission = page.getByRole('region', { name: 'Mission design' })
  const movedLecture = mission.getByRole('listitem', { name: 'Lecture 2' })
  await expect(
    movedLecture.getByRole('link', { name: 'Open the original: lecture-2-handout.txt' }),
  ).toBeVisible()
  await expect(movedLecture.getByRole('link', { name: 'Transfers' })).toBeVisible()
  await expect(astro.getByRole('listitem', { name: 'Lecture 2' })).toHaveCount(0)
})
