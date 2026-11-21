import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measureSpan } from '../src/quality.js'
test('simultaneous voices do not double the measure length', () => {
  assert.equal(measureSpan([{kind:'note',duration:4},{kind:'backup',duration:4},{kind:'note',duration:2},{kind:'note',duration:2}]),4)
})
test('chord and grace notes do not advance the cursor', () => {
  assert.equal(measureSpan([{kind:'note',duration:1},{kind:'note',duration:1,chord:true},{kind:'note',duration:1,grace:true},{kind:'forward',duration:3}]),4)
})
test('overfull measures and invalid durations are handled', () => {
  assert.equal(measureSpan([{kind:'note',duration:5},{kind:'note',duration:NaN},{kind:'note',duration:-1}]),5)
})
