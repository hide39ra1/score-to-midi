import { test } from 'node:test'
import assert from 'node:assert/strict'
import { separateMidiTracks } from '../src/midi.js'
function midi(count) {
  const data=[77,84,104,100,0,0,0,6,0,1,count>>8,count&255,0,120]
  for(let i=0;i<count;i++) data.push(77,84,114,107,0,0,0,15,0,192,71,0,144,60,64,120,128,60,0,0,255,47,0)
  return new Uint8Array(data)
}
test('21 melodic tracks use distinct ports/channels and avoid drum channel', () => {
  const bytes=separateMidiTracks(midi(21)); let at=14; const seen=new Set()
  for(let track=0;track<21;track++) {
    const length=new DataView(bytes.buffer,at+4,4).getUint32(0), data=bytes.slice(at+8,at+8+length)
    assert.deepEqual([...data.slice(0,4)],[0,255,33,1])
    const port=data[4],channel=data[6]&15
    assert.notEqual(channel,9); assert.equal(data[7],71)
    seen.add(`${port}/${channel}`); at+=8+length
  }
  assert.equal(seen.size,21); assert.equal(at,bytes.length)
})
test('reject invalid MIDI rather than downloading corrupted bytes', () => {
  assert.throws(() => separateMidiTracks(new Uint8Array(14)))
})
