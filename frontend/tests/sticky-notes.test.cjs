// Run from the repository root: node --test frontend/tests/sticky-notes.test.cjs
// These deterministic store/queue tests use separate VM contexts for separate
// windows, shared localStorage, and per-window sessionStorage. React effects and
// debounce timers are intentionally disabled; saves are explicitly flushed.
// They do not replace DOM, pagehide lifecycle, or native-window integration QA.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../lib/sticky-notes.ts')
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

function storage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
    entries: () => [...values.entries()],
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function makeNote(id = '1', content = 'original', color = 'yellow') {
  return {
    id, date: `2026-10-${String(Number(id) + 2).padStart(2, '0')}`, content, color, revision: 0,
    createdAt: '2026-10-03 12:00:00', updatedAt: '2026-10-03 12:00:00',
  }
}

function environment(initialNotes = [makeNote()]) {
  const localStorage = storage()
  const notes = new Map(initialNotes.map(note => [note.id, structuredClone(note)]))
  const requests = []
  let nextId = Math.max(...initialNotes.map(note => Number(note.id)), 0) + 1
  let ownerCount = 0
  let clock = 1000

  const response = (status, data) => {
    // Snapshot at response creation, even if delivery is delayed by a test.
    const snapshot = structuredClone(data)
    return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(snapshot) }
  }
  const fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET'
    const body = options.body === undefined ? undefined : JSON.parse(options.body)
    requests.push({ url, method, body })
    if (url === '/api/sticky-notes' && method === 'POST') {
      if ([...notes.values()].some(note => note.date === body.date)) return response(409, { detail: 'This date already has a sticky note' })
      const note = { ...makeNote(String(nextId++), body.content, body.color ?? 'yellow'), date: body.date }
      notes.set(note.id, note)
      return response(201, note)
    }
    const id = /^\/api\/sticky-notes\/(\d+)$/.exec(url)?.[1]
    assert.ok(id, `Unexpected request: ${method} ${url}`)
    const current = notes.get(id)
    if (!current) return response(404, { detail: 'Not found' })
    if (method === 'GET') return response(200, current)
    if (method === 'DELETE') {
      if (body.revision !== current.revision) return response(409, { detail: 'Delete revision conflict' })
      notes.delete(id)
      return response(200, { success: true })
    }
    assert.equal(method, 'PUT', `Unexpected request method: ${method}`)
    if (body.revision !== current.revision) return response(409, { detail: 'Revision conflict' })
    const saved = { ...current, ...(body.content === undefined ? {} : { content: body.content }), ...(body.color === undefined ? {} : { color: body.color }), revision: current.revision + 1 }
    notes.set(id, saved)
    return response(200, saved)
  }

  function openWindow({ sessionStorage = storage(), fetch: fetchOverride = fetch } = {}) {
    const exports = {}
    const noteSnapshots = new Map()
    const events = []
    const downloads = []
    const objectURLs = new Map()
    class MockDate extends Date { static now() { return ++clock } }
    vm.runInNewContext(compiled, {
      exports,
      require: name => {
        assert.equal(name, 'react')
        return {
          useCallback: callback => callback,
          useEffect: () => {},
          useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        }
      },
      fetch: fetchOverride, localStorage, sessionStorage,
      crypto: { randomUUID: () => `test-owner-${++ownerCount}` },
      Date: MockDate, AbortController, Blob,
      URL: {
        createObjectURL: blob => { const url = `blob:test-${objectURLs.size}`; objectURLs.set(url, blob); return url },
        revokeObjectURL: url => objectURLs.delete(url),
      },
      document: {
        body: { appendChild: () => {} },
        createElement: tag => { assert.equal(tag, 'a'); return {
          click() { downloads.push({ filename: this.download, blob: objectURLs.get(this.href) }) },
          remove() {},
        } },
      },
      setTimeout: () => 1, clearTimeout: () => {},
      Event: class Event { constructor(type) { this.type = type } },
      window: { dispatchEvent: event => events.push(event.type) },
    }, { filename: sourcePath })
    return {
      sessionStorage, events, downloads,
      // Calling the hook again represents a render and reads the latest state.
      draft: (id = '1') => {
        const note = notes.get(id) ?? noteSnapshots.get(id)
        assert.ok(note, `No note ${id} has been supplied to this window`)
        noteSnapshots.set(id, structuredClone(note))
        return exports.useStickyDraft(structuredClone(note))
      },
      saveAll: () => exports.saveAllStickyDrafts(),
      remove: id => exports.deleteStickyNote(id),
      refresh: (id = '1') => exports.refreshStickyDraft(structuredClone(notes.get(id))),
    }
  }

  return {
    notes, requests, localStorage, fetch, openWindow,
    snapshots: () => localStorage.entries().filter(([key]) => key.startsWith('smart-notes:sticky-draft:')).map(([key, raw]) => ({ key, ...JSON.parse(raw) })),
    posts: () => requests.filter(request => request.method === 'POST'),
  }
}

const options = { timeout: 5000 }

test('a winning window cannot delete a losing draft; conflict survives edits and reloads', options, async () => {
  const env = environment()
  const a = env.openWindow()
  const b = env.openWindow()
  const draftA = a.draft()
  const draftB = b.draft()
  draftA.setText('A saved')
  draftB.setText('B unsaved')
  assert.equal(env.localStorage.length, 2)

  assert.equal(await draftA.flush(), true)
  assert.equal(await draftB.flush(), false)
  assert.equal(b.draft().status, 'conflict')
  assert.equal(env.localStorage.length, 1)
  assert.equal(env.snapshots()[0].text, 'B unsaved')

  const reloadedB = env.openWindow({ sessionStorage: b.sessionStorage })
  assert.equal(reloadedB.draft().text, 'B unsaved')
  assert.equal(reloadedB.draft().status, 'conflict')
  reloadedB.draft().setText('B edited after recovery')
  const reloadedAgain = env.openWindow({ sessionStorage: b.sessionStorage })
  assert.equal(reloadedAgain.draft().text, 'B edited after recovery')
  assert.equal(reloadedAgain.draft().status, 'conflict')
  assert.equal(await reloadedAgain.draft().flush(), false)
  assert.equal(env.notes.get('1').content, 'A saved')
  assert.equal(env.notes.get('1').revision, 1)
  assert.equal(env.snapshots()[0].revision, 0)
})

test('foreign recovery exports locally; explicit reload preserves a newer source draft', options, async () => {
  const env = environment()
  const source = env.openWindow()
  source.draft().setText('Source unsaved')
  const recovered = env.openWindow()
  assert.equal(recovered.draft().text, 'Source unsaved')
  assert.equal(recovered.draft().status, 'conflict')
  assert.equal(await recovered.draft().flush(), false)
  assert.equal(env.requests.length, 0)

  recovered.draft().setText('Recovered draft')
  source.draft().setText('Source continued typing')
  recovered.draft().exportDraft()
  assert.equal(await recovered.downloads[0].blob.text(), 'Recovered draft')
  assert.equal(recovered.downloads[0].filename, '2026-10-03-便签草稿.txt')
  assert.equal(recovered.draft().status, 'conflict')
  assert.equal(recovered.draft().text, 'Recovered draft')
  assert.equal(env.posts().length, 0)
  assert.equal(env.notes.size, 1)
  await recovered.draft().loadLatest({ discardDraft: true })
  assert.equal(env.notes.get('1').content, 'original')
  assert.equal(env.localStorage.length, 1)
  assert.equal(env.snapshots()[0].text, 'Source continued typing')
  const reloadedSource = env.openWindow({ sessionStorage: source.sessionStorage })
  assert.equal(reloadedSource.draft().text, 'Source continued typing')
})

test('own recovery takes priority and successful save leaves other owners drafts intact', options, async () => {
  const env = environment()
  const own = env.openWindow()
  own.draft().setText('My unsaved text')
  const other = env.openWindow()
  other.draft().setText('Other window newer text')

  const reloadedOwn = env.openWindow({ sessionStorage: own.sessionStorage })
  assert.equal(reloadedOwn.draft().text, 'My unsaved text')
  assert.equal(reloadedOwn.draft().status, 'pending')
  assert.equal(await reloadedOwn.draft().flush(), true)
  assert.equal(env.notes.get('1').content, 'My unsaved text')
  assert.equal(env.localStorage.length, 1)
  assert.equal(env.snapshots()[0].text, 'Other window newer text')
})

test('export retains the exact recovery snapshot and reload always requires explicit consent', options, async () => {
  const env = environment()
  env.openWindow().draft().setText('Orphan draft')
  const recovered = env.openWindow()
  assert.equal(recovered.draft().status, 'conflict')
  const snapshots = env.snapshots()
  await assert.rejects(recovered.draft().loadLatest(), /明确确认/)
  recovered.draft().exportDraft()
  assert.equal(recovered.draft().draftExported, true)
  assert.equal(await recovered.downloads[0].blob.text(), 'Orphan draft')
  assert.deepEqual(env.snapshots(), snapshots)
  assert.equal(env.notes.size, 1)
  assert.equal(env.posts().length, 0)
  assert.equal(recovered.draft().status, 'conflict')
  await assert.rejects(recovered.draft().loadLatest(), /明确确认/)
  await recovered.draft().loadLatest({ discardDraft: true })
  assert.equal(env.notes.get('1').content, 'original')
  assert.equal(recovered.draft().status, 'saved')
  assert.equal(env.localStorage.length, 0)
})

test('legacy unscoped recovery requires explicit resolution even at the current revision', options, async () => {
  const env = environment()
  env.localStorage.setItem('smart-notes:sticky-draft:1', JSON.stringify({ text: 'Legacy draft', revision: 0 }))
  const window = env.openWindow()
  assert.equal(window.draft().text, 'Legacy draft')
  assert.equal(window.draft().status, 'conflict')
  assert.equal(await window.draft().flush(), false)
  assert.equal(env.notes.get('1').content, 'original')
  assert.equal(env.requests.length, 0)
  assert.equal(env.localStorage.length, 1)
})

test('undo during an in-flight save retains recovery and queues the final text', options, async () => {
  const env = environment()
  const entered = deferred()
  const release = deferred()
  let firstPut = true
  const window = env.openWindow({ fetch: async (url, request) => {
    const response = await env.fetch(url, request)
    if (request.method === 'PUT' && firstPut) {
      firstPut = false
      entered.resolve()
      await release.promise
    }
    return response
  } })
  window.draft().setText('in-flight edit')
  const saving = window.draft().flush()
  await entered.promise
  assert.equal(env.notes.get('1').content, 'in-flight edit')
  window.draft().setText('original')
  assert.equal(env.snapshots()[0].text, 'original')

  const reload = env.openWindow({ sessionStorage: window.sessionStorage })
  assert.equal(reload.draft().text, 'original')
  assert.equal(reload.draft().status, 'conflict')
  release.resolve()
  assert.equal(await saving, true)
  assert.equal(env.notes.get('1').content, 'original')
  assert.equal(env.notes.get('1').revision, 2)
  assert.equal(env.requests.filter(request => request.method === 'PUT').length, 2)
  assert.equal(env.localStorage.length, 0)
})

test('close flush rechecks cards edited while another card is still saving', options, async () => {
  const env = environment([makeNote('1'), makeNote('2')])
  const entered = deferred()
  const release = deferred()
  const window = env.openWindow({ fetch: async (url, request) => {
    if (url.endsWith('/2') && request.method === 'PUT') {
      entered.resolve()
      await release.promise
    }
    return env.fetch(url, request)
  } })
  window.draft('1')
  window.draft('2').setText('B changed before close')
  let closed = false
  const closing = window.saveAll().then(result => { closed = true; return result })
  await entered.promise
  window.draft('1').setText('A changed during close')
  window.draft('1').setColor('pink')
  assert.equal(closed, false)
  release.resolve()
  assert.equal(await closing, true)
  assert.equal(env.notes.get('1').content, 'A changed during close')
  assert.equal(env.notes.get('1').color, 'pink')
  assert.equal(env.notes.get('2').content, 'B changed before close')
  assert.equal(env.localStorage.length, 0)
})

test('text and color share one revision queue while typing continues during a save', options, async () => {
  const env = environment()
  const entered = deferred()
  const release = deferred()
  let firstPut = true
  const window = env.openWindow({ fetch: async (url, request) => {
    const response = await env.fetch(url, request)
    if (request.method === 'PUT' && firstPut) {
      firstPut = false
      entered.resolve()
      await release.promise
    }
    return response
  } })
  window.draft().setText('first text')
  window.draft().setColor('blue')
  const saving = window.draft().flush()
  await entered.promise
  window.draft().setText('latest unsaved text')
  window.draft().setColor('pink')
  assert.equal(window.draft().text, 'latest unsaved text')
  assert.equal(window.draft().color, 'pink')
  assert.equal(env.snapshots()[0].color, 'pink')
  release.resolve()
  assert.equal(await saving, true)
  assert.deepEqual(env.requests.filter(request => request.method === 'PUT').map(request => request.body), [
    { content: 'first text', color: 'blue', revision: 0 },
    { content: 'latest unsaved text', color: 'pink', revision: 1 },
  ])
  assert.equal(env.notes.get('1').content, 'latest unsaved text')
  assert.equal(env.notes.get('1').color, 'pink')
  assert.equal(env.localStorage.length, 0)
})

test('cross-window refresh adopts saved colors but never replaces a dirty text/color pair', options, async () => {
  const env = environment()
  const a = env.openWindow(), b = env.openWindow()
  a.draft(); b.draft()
  a.draft().setColor('blue')
  assert.equal(await a.draft().flush(), true)
  b.refresh()
  assert.equal(b.draft().color, 'blue')
  b.draft().setText('B unsaved text')
  a.draft().setColor('green')
  assert.equal(await a.draft().flush(), true)
  b.refresh()
  assert.equal(b.draft().text, 'B unsaved text')
  assert.equal(b.draft().color, 'blue')
  assert.equal(await b.draft().flush(), false)
  assert.equal(b.draft().status, 'conflict')
  const reloaded = env.openWindow({ sessionStorage: b.sessionStorage })
  assert.equal(reloaded.draft().text, 'B unsaved text')
  assert.equal(reloaded.draft().color, 'blue')
  assert.equal(reloaded.draft().status, 'conflict')
  assert.equal(env.notes.get('1').content, 'original')
  assert.equal(env.notes.get('1').color, 'green')
  assert.equal(env.notes.size, 1)
  assert.equal(env.posts().length, 0)
  assert.equal(reloaded.draft().saveCopy, undefined)
})

test('color-only drafts recover and legacy text drafts inherit the server color', options, async () => {
  const env = environment()
  const own = env.openWindow()
  own.draft().setColor('pink')
  const reload = env.openWindow({ sessionStorage: own.sessionStorage })
  assert.equal(reload.draft().text, 'original')
  assert.equal(reload.draft().color, 'pink')
  assert.equal(reload.draft().status, 'pending')
  assert.equal(await reload.draft().flush(), true)
  assert.equal(env.notes.get('1').color, 'pink')

  const legacy = environment([makeNote('1', 'server text', 'green')])
  legacy.localStorage.setItem('smart-notes:sticky-draft:1', JSON.stringify({ text: 'legacy text', revision: 0 }))
  const recovered = legacy.openWindow()
  assert.equal(recovered.draft().text, 'legacy text')
  assert.equal(recovered.draft().color, 'green')
  assert.equal(recovered.draft().status, 'conflict')
})

test('undoing an in-flight color change queues the final color without losing text', options, async () => {
  const env = environment()
  const entered = deferred(), release = deferred()
  let firstPut = true
  const window = env.openWindow({ fetch: async (url, request) => {
    const response = await env.fetch(url, request)
    if (request.method === 'PUT' && firstPut) {
      firstPut = false; entered.resolve(); await release.promise
    }
    return response
  } })
  window.draft().setColor('blue')
  const saving = window.draft().flush()
  await entered.promise
  window.draft().setColor('yellow')
  assert.equal(env.snapshots()[0].color, 'yellow')
  release.resolve()
  assert.equal(await saving, true)
  assert.equal(env.notes.get('1').content, 'original')
  assert.equal(env.notes.get('1').color, 'yellow')
  assert.equal(env.notes.get('1').revision, 2)
})

test('export retains pending text and color and never authorizes automatic discard', options, async () => {
  const env = environment()
  const window = env.openWindow()
  window.draft().setText('local text')
  window.draft().setColor('blue')
  const recovery = env.snapshots()
  window.draft().exportDraft()
  assert.equal(await window.downloads[0].blob.text(), 'local text')
  assert.equal(window.draft().draftExported, true)
  assert.equal(window.draft().color, 'blue')
  assert.deepEqual(env.snapshots(), recovery)
  await assert.rejects(window.draft().loadLatest(), /明确确认/)
  window.draft().setColor('green')
  assert.equal(window.draft().draftExported, false)
  window.draft().setColor('not-a-color')
  assert.equal(window.draft().color, 'green')
  assert.equal(env.posts().length, 0)
  assert.equal(env.notes.size, 1)
})

test('explicit reload freezes edits, coalesces clicks, and a failed GET retains the conflict draft', options, async () => {
  const env = environment()
  env.openWindow().draft().setText('Recover me')
  const entered = deferred()
  const release = deferred()
  let failGet = true
  const window = env.openWindow({ fetch: async (url, request) => {
    if (request.method === 'GET' && failGet) {
      failGet = false
      entered.resolve()
      await release.promise
      throw new Error('offline')
    }
    return env.fetch(url, request)
  } })
  assert.equal(window.draft().status, 'conflict')
  const loading = window.draft().loadLatest({ discardDraft: true })
  const rejected = assert.rejects(loading, /无法连接便签服务/)
  await entered.promise
  assert.equal(window.draft().loadingLatest, true)
  window.draft().setText('Ignored during reload')
  window.draft().setColor('blue')
  assert.equal(window.draft().text, 'Recover me')
  assert.equal(window.draft().color, 'yellow')
  assert.equal(window.draft().loadLatest({ discardDraft: true }), loading)
  let closed = false
  const closing = window.saveAll().then(result => { closed = true; return result })
  assert.equal(closed, false)
  release.resolve()
  await rejected
  assert.equal(await closing, false)
  assert.equal(window.draft().loadingLatest, false)
  assert.equal(window.draft().text, 'Recover me')
  assert.equal(env.localStorage.length, 1)
  await window.draft().loadLatest({ discardDraft: true })
  assert.equal(env.notes.size, 1)
  assert.equal(env.posts().length, 0)
  assert.equal(window.draft().text, 'original')
  assert.equal(env.localStorage.length, 0)
  assert.equal(await window.saveAll(), true)
})

test('delete freezes edits, waits for every queued save, and clears only that note across windows', options, async () => {
  const env = environment([makeNote('1'), makeNote('10')])
  const putEntered = deferred()
  const releasePut = deferred()
  const deleteEntered = deferred()
  const releaseDelete = deferred()
  let firstPut = true
  const window = env.openWindow({ fetch: async (url, request) => {
    const response = await env.fetch(url, request)
    if (request.method === 'PUT' && firstPut) {
      firstPut = false
      putEntered.resolve()
      await releasePut.promise
    }
    if (request.method === 'DELETE') {
      deleteEntered.resolve()
      await releaseDelete.promise
    }
    return response
  } })
  const other = env.openWindow()
  window.draft()
  other.draft().setText('Other window unsaved')
  other.draft('10').setText('Keep another note recovery')
  window.draft().setText('First queued text')
  const saving = window.draft().flush()
  await putEntered.promise
  window.draft().setText('Latest queued text')
  const removing = window.draft().remove()
  assert.equal(window.draft().deleting, true)
  window.draft().setText('Ignored while deleting')
  assert.equal(window.draft().text, 'Latest queued text')
  assert.equal(window.remove('1'), removing)
  let closed = false
  const closing = window.saveAll().then(result => { closed = true; return result })
  assert.equal(env.requests.some(request => request.method === 'DELETE'), false)
  releasePut.resolve()
  await deleteEntered.promise
  assert.equal(await saving, true)
  const writes = env.requests.filter(request => request.url.endsWith('/1'))
  assert.deepEqual(writes.map(request => request.method), ['PUT', 'PUT', 'DELETE'])
  assert.equal(writes[1].body.content, 'Latest queued text')
  assert.equal(writes[2].body.revision, 2)
  assert.equal(closed, false)
  releaseDelete.resolve()
  await removing
  assert.equal(await closing, true)
  assert.equal(window.draft().deleted, true)
  assert.equal(window.draft().deleting, false)
  assert.equal(env.notes.has('1'), false)
  assert.equal(env.notes.get('10').content, 'original')
  assert.equal(env.snapshots().length, 1)
  assert.equal(env.snapshots()[0].text, 'Keep another note recovery')
  assert.ok(env.snapshots()[0].key.startsWith('smart-notes:sticky-draft:10:'))
  assert.deepEqual(window.events, ['sticky-notes-changed'])

  other.draft().setText('A stale window must not recreate a ghost')
  assert.equal(await other.draft().flush(), true)
  assert.equal(other.draft().deleted, true)
  assert.equal(env.snapshots().length, 1)
  await window.remove('1')
  assert.equal(env.requests.filter(request => request.method === 'DELETE').length, 1)
})

test('delete rejects a newer remote revision and requires an explicit retry at the refreshed revision', options, async () => {
  const env = environment()
  const stale = env.openWindow()
  const writer = env.openWindow()
  stale.draft()
  writer.draft().setText('New content from another window')
  assert.equal(await writer.draft().flush(), true)
  await assert.rejects(stale.draft().remove(), error => error.status === 409)
  assert.equal(stale.draft().deleting, false)
  assert.equal(stale.draft().deleted, false)
  assert.equal(stale.draft().status, 'conflict')
  assert.equal(stale.draft().text, 'original')
  assert.equal(stale.draft().note.content, 'New content from another window')
  assert.equal(env.notes.get('1').revision, 1)
  assert.equal(env.localStorage.getItem('smart-notes:sticky-deleted:1'), null)
  assert.equal(env.requests.filter(request => request.method === 'DELETE').length, 1)

  stale.draft().setText('Draft remains editable after failed deletion')
  await stale.draft().remove()
  assert.equal(env.notes.has('1'), false)
  assert.equal(env.requests.filter(request => request.method === 'PUT').length, 1)
  assert.deepEqual(env.requests.filter(request => request.method === 'DELETE').map(request => request.body.revision), [0, 1])
  assert.equal(env.snapshots().length, 0)
})

test('a failed pre-delete save retains the draft and unlocks editing for a successful retry', options, async () => {
  const env = environment()
  let failPut = true
  const window = env.openWindow({ fetch: async (url, request) => {
    if (request.method === 'PUT' && failPut) {
      failPut = false
      throw new Error('offline')
    }
    return env.fetch(url, request)
  } })
  window.draft().setText('Preserve unsaved draft')
  await assert.rejects(window.draft().remove(), /无法连接便签服务/)
  assert.equal(window.draft().deleting, false)
  assert.equal(window.draft().deleted, false)
  assert.equal(env.notes.get('1').content, 'original')
  assert.equal(env.snapshots()[0].text, 'Preserve unsaved draft')
  assert.equal(env.requests.some(request => request.method === 'DELETE'), false)
  window.draft().setText('Retry with this complete draft')
  await window.draft().remove()
  assert.equal(env.notes.has('1'), false)
  assert.equal(env.requests.find(request => request.method === 'PUT').body.content, 'Retry with this complete draft')
  assert.equal(env.snapshots().length, 0)
})

test('a lost successful DELETE response can be retried without restoring the deleted note', options, async () => {
  const env = environment()
  let loseResponse = true
  const window = env.openWindow({ fetch: async (url, request) => {
    const response = await env.fetch(url, request)
    if (request.method === 'DELETE' && loseResponse) {
      loseResponse = false
      throw new Error('response lost after server commit')
    }
    return response
  } })
  window.draft()
  await assert.rejects(window.draft().remove(), /无法连接便签服务/)
  assert.equal(window.draft().deleting, false)
  assert.equal(window.draft().deleted, false)
  assert.equal(env.notes.has('1'), false)
  assert.equal(env.snapshots().length, 1)
  await window.draft().remove()
  assert.equal(window.draft().deleted, true)
  assert.equal(env.snapshots().length, 0)
  assert.equal(env.requests.filter(request => request.method === 'DELETE').length, 2)
  assert.equal(await window.saveAll(), true)
})

test('deleting during explicit reload waits for that reload and creates no second note', options, async () => {
  const env = environment()
  const entered = deferred()
  const release = deferred()
  const window = env.openWindow({ fetch: async (url, request) => {
    const response = await env.fetch(url, request)
    if (request.method === 'GET') {
      entered.resolve()
      await release.promise
    }
    return response
  } })
  window.draft().setText('Discard with confirmation')
  const loading = window.draft().loadLatest({ discardDraft: true })
  await entered.promise
  const removing = window.draft().remove()
  assert.equal(window.draft().deleting, true)
  assert.throws(() => window.draft().exportDraft(), /正在删除或已删除/)
  assert.equal(env.requests.some(request => request.method === 'DELETE'), false)
  release.resolve()
  await Promise.all([loading, removing])
  assert.equal(env.notes.size, 0)
  assert.equal(env.posts().length, 0)
  assert.equal(env.snapshots().length, 0)
})
