// Run from the repository root: node --test frontend/tests/sticky-layout.test.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../lib/sticky-layout.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

function environment({ blockedStorage = false } = {}) {
  const values = new Map()
  const listeners = new Map()
  const effects = []
  const states = []
  const events = []
  const exports = {}
  const window = {
    localStorage: {
      getItem: key => { if (blockedStorage) throw new Error('storage blocked'); return values.get(key) ?? null },
      setItem: (key, value) => { if (blockedStorage) throw new Error('storage blocked'); values.set(key, value) },
    },
    dispatchEvent: event => { events.push(event); for (const callback of listeners.get(event.type) ?? []) callback(event) },
    addEventListener: (type, callback) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback) },
    removeEventListener: (type, callback) => listeners.get(type)?.delete(callback),
  }
  vm.runInNewContext(compiled, {
    exports, window,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    require: name => {
      assert.equal(name, 'react')
      return {
        useEffect: callback => effects.push(callback),
        useState: value => { const index = states.push(value) - 1; return [value, next => { states[index] = next }] },
      }
    },
  })
  return { api: exports, values, events, states, window, mount: () => effects.map(effect => effect()) }
}

test('the shared size defaults to 240 and remains inside the square-window bounds', () => {
  const { api } = environment()
  assert.equal(api.STICKY_DEFAULT_SIZE, 240)
  assert.equal(api.clampStickySize(100), 200)
  assert.equal(api.clampStickySize(1000), 420)
  assert.equal(api.clampStickySize(241.6), 242)
  assert.equal(api.clampStickySize(NaN), 240)
  assert.equal(api.clampStickySize(Infinity), 240)
})

test('the top-left corner responds equally to horizontal, vertical, and diagonal movement', () => {
  const { api } = environment()
  assert.equal(api.resizeStickySize(240, -30, 0, 'top-left'), 270)
  assert.equal(api.resizeStickySize(240, 0, -30, 'top-left'), 270)
  assert.equal(api.resizeStickySize(240, -30, -30, 'top-left'), 270)
  assert.equal(api.resizeStickySize(240, 30, 30, 'top-left'), 210)
})

test('the bottom-left corner grows downward and leftward and respects the sidebar width', () => {
  const { api } = environment()
  assert.equal(api.resizeStickySize(240, -30, 0, 'bottom-left'), 270)
  assert.equal(api.resizeStickySize(240, 0, 30, 'bottom-left'), 270)
  assert.equal(api.resizeStickySize(240, 30, -30, 'bottom-left'), 210)
  assert.equal(api.resizeStickySize(240, -300, 300, 'bottom-left', 312), 312)
  assert.equal(api.resizeStickySize(240, 300, -300, 'bottom-left', 312), 200)
})

test('saved sizes belong to individual notes and publish a bounded synchronization event', () => {
  const { api, events, values } = environment()
  assert.equal(api.readStickySize('1'), 240)
  api.saveStickySize('1', 999)
  assert.equal(api.readStickySize('1'), 420)
  assert.equal(api.readStickySize('2'), 240)
  assert.equal(events[0].type, 'sticky-size-changed')
  assert.equal(events[0].detail.id, '1')
  assert.equal(events[0].detail.size, 420)
  values.set('smart-notes:sticky-size:2', 'invalid')
  assert.equal(api.readStickySize('2'), 240)
})

test('native size events synchronize the matching note and detached listeners are cleaned up', () => {
  const env = environment()
  env.api.useStickySize('1')
  const cleanups = env.mount()
  env.window.dispatchEvent({ type: 'sticky-size-changed', detail: { id: '2', size: 320 } })
  assert.equal(env.states[0], 240)
  env.window.dispatchEvent({ type: 'sticky-size-changed', detail: { id: '1', size: 280 } })
  assert.equal(env.states[0], 280)
  assert.equal(env.api.readStickySize('1'), 280)
  env.values.set('smart-notes:sticky-size:1', '300')
  env.window.dispatchEvent({ type: 'storage', key: 'smart-notes:sticky-size:1' })
  assert.equal(env.states[0], 300)
  cleanups.forEach(cleanup => cleanup())
  env.window.dispatchEvent({ type: 'sticky-size-changed', detail: { id: '1', size: 240 } })
  assert.equal(env.states[0], 300)
})

test('disabled local storage does not prevent resizing or live synchronization', () => {
  const { api, events } = environment({ blockedStorage: true })
  assert.equal(api.readStickySize('1'), 240)
  assert.equal(api.saveStickySize('1', 280), 280)
  assert.equal(events[0].detail.size, 280)
})
