import {test} from 'node:test'
import assert from 'node:assert/strict'
import {planSlurRepair} from '../src/symbols.js'

const event = (type, voice = '1') => ({type, number: '1', staff: '1', voice})

test('a dangling start does not consume the next complete slur', () => {
  const plan = planSlurRepair(['start','start','stop'].map(type => event(type)))
  assert.deepEqual(plan, {pairs: [{start: 1, end: 2, number: 1}], unmatched: [0]})
})

test('overlapping complete slurs keep both endpoints and get distinct numbers', () => {
  const plan = planSlurRepair([event('start'), event('start','2'), event('stop','2'), event('stop')])
  assert.deepEqual(plan, {pairs: [{start: 0, end: 3, number: 1}, {start: 1, end: 2, number: 2}], unmatched: []})
})
