import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestApi } from '../testing/api'
import { testDatabaseUrl } from '../testing/database'

test('useful links: your own, web addresses only', { skip: !testDatabaseUrl, timeout: 60_000 }, async (t) => {
  if (!testDatabaseUrl) return
  const api = await startTestApi(t, testDatabaseUrl)
  const { request, send, ok } = api
  const owner = await api.signup('owner')
  const other = await api.signup('other')
  const add = (url: string) =>
    send(owner, 'POST', '/links', { title: 'Space-Track', url, note: 'TLE catalogue' })
  assert.equal((await add('javascript:alert(1)')).status, 400)
  assert.equal((await add('ftp://example.test/file')).status, 400)
  const link = await ok<{ id: string }>(add('https://www.space-track.org/'), 201)
  assert.deepEqual(
    (await ok<{ url: string }[]>(request(owner, '/links'))).map((l) => l.url),
    ['https://www.space-track.org/'],
  )
  assert.deepEqual(await ok(request(other, '/links')), [])
  assert.equal((await request(other, `/links/${link.id}`, { method: 'DELETE' })).status, 404)
  assert.equal((await request(owner, '/links/not-an-id', { method: 'DELETE' })).status, 400)
  assert.equal((await request(owner, `/links/${link.id}`, { method: 'DELETE' })).status, 204)
})
