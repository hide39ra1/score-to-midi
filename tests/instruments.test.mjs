import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identifyInstruments } from '../src/instruments.js'
test('alternative instruments remain ambiguous instead of choosing one', () => {
  assert.deepEqual(identifyInstruments('Clarinet in B / Trumpet in B / Soprano Saxophone'), ['clarinet','soprano','trumpet'])
})
test('bass clarinet does not become an ordinary clarinet', () => {
  assert.deepEqual(identifyInstruments('Bass Clarinet in Bb'), ['bassclarinet'])
})
test('instrument names must actually be present', () => {
  assert.deepEqual(identifyInstruments('Voice'), [])
  assert.deepEqual(identifyInstruments('Alto Saxophone in Eb'), ['alto'])
})
