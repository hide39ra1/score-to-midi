import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identifyInstruments, orderScorePart, preferredInstrument, inferredTranspose,partStaffIndex,preferFocusedLabel } from '../src/instruments.js'
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
test('alternative instruments provisionally use print order instead of defaulting to piano',()=>{
  assert.equal(preferredInstrument('Trumpet in B / Clarinet in B'), 'trumpet')
  assert.equal(preferredInstrument('Oboe/Violin'),'oboe')
  assert.equal(preferredInstrument('Trombone/Euphonium/ Bassoon/Cello'),'trombone')
  assert.equal(preferredInstrument('Voice'),null)
  assert.equal(preferredInstrument('トランペット／クラリネット'),'trumpet')
})
test('a clipped instrument crop cannot discard alternatives found on the full page',()=>{
  assert.equal(preferFocusedLabel('Trombone/Euphonium/Bassoon/Cello','Bassoon/Cello'),false)
  assert.equal(preferFocusedLabel('', 'Oboe/Violin'),true)
})
test('written keys confirm transposition while concert scores keep concert pitch',()=>{
  assert.equal(inferredTranspose('clarinet',1,-1),-2)
  assert.equal(inferredTranspose('alto',2,-1),-9)
  assert.equal(inferredTranspose('horn',0,-1),-7)
  assert.equal(inferredTranspose('clarinet',-1,-1),0)
  assert.equal(inferredTranspose('clarinet',3,-1),null)
})
test('one misplaced anchor cannot assign an entire part to the neighboring staff',()=>{
  const part={querySelector:()=>null,querySelectorAll:()=>['n1-p0-100-220','n2-p0-120-110','n3-p0-140-115','n4-p1-140-220'].map(id=>({id}))}
  assert.equal(partStaffIndex(part,[[0,100,300,140],[0,200,300,240]],0),0)
})
