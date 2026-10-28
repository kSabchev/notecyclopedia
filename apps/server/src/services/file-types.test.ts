import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileType } from './file-types'

test('derives the served type from the extension', () => {
  assert.deepEqual(fileType('Orbit.PNG'), { mime: 'image/png', inline: true })
  assert.equal(fileType('notes.md')?.mime, 'text/plain; charset=utf-8')
  assert.equal(fileType('slides.pptx')?.inline, false)
})

test('rejects extensions that may not be uploaded, including web content', () => {
  for (const name of ['page.html', 'x.svg', 'run.js', 'archive.zip', 'README'])
    assert.equal(fileType(name), null)
})
