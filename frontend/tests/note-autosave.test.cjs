// Run from the repository root: node --test frontend/tests/note-autosave.test.cjs
// Queue, debounce and recovery tests use only in-memory storage and virtual time.
// Browser composition events and native window closure are verified separately.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../lib/note-autosave.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

const emptyDraft = () => ({ title: '', content: '', category: '未分类' })
const draft = content => ({ title: '随手记', content, category: '笔记' })
const plain = value => JSON.parse(JSON.stringify(value))
const microtasks = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function environment() {
  const values = new Map()
  const timers = new Map()
  let now = 0
  let nextTimerId = 0
  let nextUuidId = 0
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    Error,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextUuidId).padStart(12, '0')}` },
    setTimeout: (callback, delay) => {
      const id = ++nextTimerId
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimeout: id => timers.delete(id),
  })
  return {
    storage,
    values,
    create: (save, initial = emptyDraft(), key = 'new-note') =>
      new exports.NoteAutosave(initial, save, { storage, key }),
    advance: async milliseconds => {
      const target = now + milliseconds
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!next) break
        now = next[1].at
        timers.delete(next[0])
        next[1].callback()
        await microtasks()
      }
      now = target
      await microtasks()
    },
  }
}

test('opening a blank draft or changing only its category does not create a note', async () => {
  const env = environment()
  const requests = []
  const autosave = env.create(async (...args) => { requests.push(args); throw new Error('Unexpected save') })
  assert.equal(await autosave.flush(), true)
  autosave.update({ title: '  ', content: '\n  ', category: '工作' })
  await env.advance(1000)
  assert.equal(await autosave.flush(), true)
  assert.equal(requests.length, 0)
  assert.equal(autosave.getSnapshot().status, 'empty')
  assert.equal(env.storage.getItem('new-note'), null)
})

test('content alone gets default metadata and preserves its original whitespace', async () => {
  const env = environment()
  const requests = []
  const autosave = env.create(async (payload, id, draftId) => {
    requests.push({ payload: plain(payload), id, draftId })
    return { ...payload, id: '1' }
  })
  autosave.update({ title: '  ', content: '  第一行\n第二行  \n', category: ' ' })
  assert.equal(await autosave.flush(), true)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].payload, { title: '未命名笔记', content: '  第一行\n第二行  \n', category: '未分类' })
  assert.equal(requests[0].id, null)
  assert.match(requests[0].draftId, /^[0-9a-f-]{36}$/)
  assert.equal(autosave.getSnapshot().status, 'saved')
})

test('typing is debounced for 500 ms after the most recent change', async () => {
  const env = environment()
  const requests = []
  const autosave = env.create(async payload => { requests.push(plain(payload)); return { ...payload, id: '1' } })
  autosave.update(draft('最初'))
  await env.advance(400)
  assert.equal(requests.length, 0)
  autosave.update(draft('最新'))
  await env.advance(499)
  assert.equal(requests.length, 0)
  assert.equal(autosave.getSnapshot().status, 'pending')
  await env.advance(1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].content, '最新')
  assert.equal(autosave.getSnapshot().status, 'saved')
})

test('an in-flight create and multiple flushes form one queue that saves the latest typing', async () => {
  const env = environment()
  const first = deferred()
  const second = deferred()
  const requests = []
  const autosave = env.create((payload, id, draftId) => {
    requests.push({ payload: plain(payload), id, draftId })
    return requests.length === 1 ? first.promise : second.promise
  })
  autosave.update(draft('初稿'))
  const saving = autosave.flush()
  autosave.update(draft('继续输入'))
  const savingAgain = autosave.flush()
  autosave.update(draft('最终内容'))
  const savingThird = autosave.flush()
  assert.equal(savingAgain, saving)
  assert.equal(savingThird, saving)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].id, null)
  first.resolve({ ...requests[0].payload, id: '7' })
  await microtasks()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].id, '7')
  assert.equal(requests[1].draftId, requests[0].draftId)
  assert.equal(requests[1].payload.content, '最终内容')
  let finished = false
  saving.then(() => { finished = true })
  await microtasks()
  assert.equal(finished, false)
  second.resolve({ ...requests[1].payload, id: '7' })
  assert.deepEqual(await Promise.all([saving, savingAgain, savingThird]), [true, true, true])
  assert.equal(autosave.getSnapshot().status, 'saved')
  await env.advance(1000)
  assert.equal(requests.length, 2)
})

test('a lost create response recovers the same token and updates the existing note with newer text', async () => {
  const env = environment()
  const notesByToken = new Map()
  const requests = []
  let loseFirstResponse = true
  const save = async (payload, id, draftId) => {
    requests.push({ payload: plain(payload), id, draftId })
    if (id === null) {
      if (!notesByToken.has(draftId)) notesByToken.set(draftId, { ...payload, id: '9' })
      if (loseFirstResponse) {
        loseFirstResponse = false
        throw new Error('首次响应丢失')
      }
      return { ...notesByToken.get(draftId) }
    }
    const note = { ...payload, id }
    notesByToken.set(draftId, note)
    return note
  }
  const interrupted = env.create(save)
  interrupted.update(draft('已创建的旧内容'))
  assert.equal(await interrupted.flush(), false)
  assert.equal(interrupted.getSnapshot().status, 'error')
  assert.equal(interrupted.getSnapshot().error, '首次响应丢失')
  const record = JSON.parse(env.storage.getItem('new-note'))
  assert.equal(record.id, null)
  assert.equal(record.draftId, requests[0].draftId)
  assert.equal(notesByToken.size, 1)

  const recovered = env.create(save)
  assert.equal(recovered.getSnapshot().status, 'empty')
  assert.deepEqual(plain(recovered.restoreRecovery()), draft('已创建的旧内容'))
  recovered.update(draft('恢复后继续写的最新内容'))
  assert.equal(await recovered.flush(), true)
  assert.equal(notesByToken.size, 1)
  assert.equal(requests.length, 3)
  assert.equal(requests[1].id, null)
  assert.equal(requests[1].draftId, requests[0].draftId)
  assert.equal(requests[2].id, '9')
  assert.equal(requests[2].payload.content, '恢复后继续写的最新内容')
  assert.equal(notesByToken.get(requests[0].draftId).content, '恢复后继续写的最新内容')
  assert.equal(recovered.getSnapshot().status, 'saved')
})

test('clearing an already saved draft updates that note instead of creating another one', async () => {
  const env = environment()
  const requests = []
  const autosave = env.create(async (payload, id) => {
    requests.push({ payload: plain(payload), id })
    return { ...payload, id: id ?? '5' }
  })
  autosave.update(draft('稍后清空'))
  assert.equal(await autosave.flush(), true)
  autosave.update({ title: '', content: '', category: '笔记' })
  assert.equal(await autosave.flush(), true)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].id, '5')
  assert.deepEqual(requests[1].payload, { title: '未命名笔记', content: '', category: '笔记' })
  assert.equal(autosave.getSnapshot().status, 'saved')
})

test('composition or upload pause blocks requests and resumes the latest draft after the debounce', async () => {
  const env = environment()
  const requests = []
  const autosave = env.create(async (payload, id) => {
    requests.push({ payload: plain(payload), id })
    return { ...payload, id: id ?? '3' }
  })
  autosave.setPaused(true)
  autosave.update(draft('拼音组合中的内容'))
  await env.advance(1000)
  assert.equal(await autosave.flush(), false)
  assert.equal(requests.length, 0)
  assert.equal(autosave.getSnapshot().status, 'pending')
  autosave.update(draft('中文确认后的内容'))
  autosave.setPaused(false)
  await env.advance(499)
  assert.equal(requests.length, 0)
  await env.advance(1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].payload.content, '中文确认后的内容')

  autosave.setPaused(true)
  autosave.update(draft('等待插入图片'))
  assert.equal(await autosave.flush(), false)
  autosave.update(draft('等待插入图片\n![图](/uploads/example.png)'))
  autosave.setPaused(false)
  await env.advance(500)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].id, '3')
  assert.equal(requests[1].payload.content, '等待插入图片\n![图](/uploads/example.png)')
  assert.equal(autosave.getSnapshot().status, 'saved')
})

test('pausing during a save leaves newer text pending and resuming updates the same note', async () => {
  const env = environment()
  const first = deferred()
  const requests = []
  const autosave = env.create((payload, id) => {
    requests.push({ payload: plain(payload), id })
    return requests.length === 1 ? first.promise : Promise.resolve({ ...payload, id })
  })
  autosave.update(draft('请求中的内容'))
  const saving = autosave.flush()
  autosave.setPaused(true)
  autosave.update(draft('组合输入的新内容'))
  first.resolve({ ...requests[0].payload, id: '4' })
  assert.equal(await saving, false)
  assert.equal(autosave.getSnapshot().status, 'pending')
  assert.equal(requests.length, 1)
  autosave.setPaused(false)
  await env.advance(500)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].id, '4')
  assert.equal(requests[1].payload.content, '组合输入的新内容')
  assert.equal(autosave.getSnapshot().status, 'saved')
})

test('successful departure clears recovery and the next draft creates an independent note', async () => {
  const env = environment()
  const requests = []
  const save = async (payload, id, draftId) => {
    requests.push({ payload: plain(payload), id, draftId })
    return { ...payload, id: id ?? String(requests.length) }
  }
  const first = env.create(save)
  first.update(draft('第一篇'))
  assert.equal(await first.flush(), true)
  assert.ok(env.storage.getItem('new-note'))
  first.forgetRecovery()
  assert.equal(env.storage.getItem('new-note'), null)

  const second = env.create(save)
  assert.deepEqual(plain(second.restoreRecovery()), emptyDraft())
  assert.equal(await second.flush(), true)
  assert.equal(requests.length, 1)
  second.update(draft('第二篇'))
  assert.equal(await second.flush(), true)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].id, null)
  assert.notEqual(requests[1].draftId, requests[0].draftId)
})
