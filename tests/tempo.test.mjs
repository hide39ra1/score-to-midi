import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readMetronome} from '../src/tempo.js'
const line = (...words) => words.map((str, index) => ({str, x: index * 18, w: 12, h: 14}))

test('recognizes adjacent metronome fragments without accepting a false BPM 11', () => {
  assert.equal(readMetronome(line('J', '=', '108')).bpm, 108)
  assert.equal(readMetronome(line('q = 132')).bpm, 132)
  assert.equal(readMetronome(line('h. = 60')).dotted, true)
  for (const text of ['q = 11', '= 108', 'q = 1080', '♪ = 22', 'page = 11']) {
    assert.equal(readMetronome(line(text)), null, text)
  }
  const separated = line('q', '=', '108')
  separated[2].x = 300
  assert.equal(readMetronome(separated), null)
})
