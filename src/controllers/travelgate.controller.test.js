import test from 'node:test'
import assert from 'node:assert'
import { getMarkup } from '../utils/markup.js'

test('getMarkup returns expected markup for roles', () => {
  // guest tiers
  assert.strictEqual(getMarkup(0, 80), 0.5)
  assert.strictEqual(getMarkup(0, 100), 0.4)
  assert.strictEqual(getMarkup(0, 250), 0.4)
  assert.strictEqual(getMarkup(0, 301), 0.3)

  // other roles
  assert.strictEqual(getMarkup(1, 100), 0.2)
  assert.strictEqual(getMarkup(2, 100), 0.1)
  assert.strictEqual(getMarkup(3, 100), 0.1)
  assert.strictEqual(getMarkup(4, 100), 0.05)
  assert.strictEqual(getMarkup(100, 100), 0)
  assert.strictEqual(getMarkup(99, 100), 0)
})
