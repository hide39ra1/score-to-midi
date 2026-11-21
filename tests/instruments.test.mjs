import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identifyInstruments, orderScorePart } from '../src/instruments.js'
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

test('editing an instrument keeps its abbreviation before MIDI routing', () => {
  const meta = {children: ['part-name','midi-device','part-abbreviation','score-instrument','midi-instrument'].map(tagName => ({tagName})), append(child) { this.children.splice(this.children.indexOf(child),1); this.children.push(child) }}
  orderScorePart(meta)
  assert.deepEqual(meta.children.map(x=>x.tagName), ['part-name','part-abbreviation','score-instrument','midi-device','midi-instrument'])
})
