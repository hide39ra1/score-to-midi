import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import create from 'verovio/wasm'
import {VerovioToolkit} from 'verovio/esm'
import {articulationPolicy,readMidi,performMidi} from '../src/performance.js'

test('staccato with accent shortens sound and boosts velocity; ties remain sustained',()=>{
  assert.deepEqual(articulationPolicy({staccato:true,accent:true}),{gate:.5,boost:18})
  assert.equal(articulationPolicy({staccatissimo:true}).gate,.25)
  assert.equal(articulationPolicy({staccato:true,tied:true}).gate,1)
})
test('actual Verovio MIDI receives articulation without shifting later onsets or tempo',async()=>{
  const tk=new VerovioToolkit(await create())
  tk.loadData(readFileSync('tests/fixtures/instrument.musicxml','utf8'))
  const original=Uint8Array.from(Buffer.from(tk.renderToMIDI(),'base64'))
  const baseline=readMidi(original),before=baseline.tracks.flat().filter(e=>(e.status&240)===144&&e.data[1]>0)
  const processed=readMidi(performMidi(original,[{track:0,quarter:0,pitch:60,gate:.5,boost:18}]))
  const on=processed.tracks.flat().find(e=>(e.status&240)===144&&e.data[1]>0)
  const off=processed.tracks.flat().find(e=>(e.status&240)===128||((e.status&240)===144&&e.data[1]===0))
  const oldOff=baseline.tracks.flat().find(e=>(e.status&240)===128||((e.status&240)===144&&e.data[1]===0))
  assert.equal(on.tick,before[0].tick);assert.equal(on.data[1],Math.min(127,before[0].data[1]+18))
  assert.equal(off.tick,Math.round(oldOff.tick*.5))
  assert.deepEqual(processed.tracks.flat().filter(e=>e.kind===81),baseline.tracks.flat().filter(e=>e.kind===81))
})
test('a marked recognition gap keeps later measures aligned in playback',async()=>{
  const tk=new VerovioToolkit(await create())
  let xml=readFileSync('tests/fixtures/instrument.musicxml','utf8')
  xml=xml.replace('</part>','<measure number="2"><direction><direction-type><words>認識欠落</words></direction-type></direction><note print-object="no"><rest measure="yes"/><duration>4</duration><type>whole</type></note></measure><measure number="3"><note id="after-gap"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>')
  tk.loadData(xml)
  tk.renderToMIDI()
  assert.equal(tk.getMIDIValuesForElement('after-gap').time,4000)
})
test('simultaneous pitches in other instrument tracks keep their original articulation',async()=>{
  const tk=new VerovioToolkit(await create());const base=readFileSync('tests/fixtures/instrument.musicxml','utf8')
  const meta=base.match(/<score-part id="P1">.*?<\/score-part>/s)[0].replace('id="P1"','id="P2"')
  const part=base.match(/<part id="P1">.*?<\/part>/s)[0].replace('id="P1"','id="P2"').replace('fixture-note','other-note')
  tk.loadData(base.replace('</part-list>',meta+'</part-list>').replace('</score-partwise>',part+'</score-partwise>'))
  const source=Uint8Array.from(Buffer.from(tk.renderToMIDI(),'base64'))
  const old=readMidi(source).tracks.filter(t=>t.some(e=>(e.status&240)===144&&e.data[1]>0))
  const result=readMidi(performMidi(source,[{track:0,quarter:0,pitch:60,gate:.5,boost:18}])).tracks.filter(t=>t.some(e=>(e.status&240)===144&&e.data[1]>0))
  assert.deepEqual(result[1],old[1])
  assert.notDeepEqual(result[0],old[0])
})
