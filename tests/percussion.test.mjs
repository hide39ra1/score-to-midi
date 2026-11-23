import {test} from 'node:test'
import assert from 'node:assert/strict'
import {analyzeBinary,detectSingleLineStaves,mergeStaffDetections} from '../src/structure.js'
import {detectMeasureRepeat,detectOneLineNotes,detectOneLineMeasureRest} from '../src/percussion-image.js'
import {percussionKind,drumPitch,findDrumStaffs} from '../src/percussion.js'
import {readMidi} from '../src/performance.js'
import {separateMidiTracks} from '../src/midi.js'
import create from 'verovio/wasm'
import {VerovioToolkit} from 'verovio/esm'

function fixture() {
  const width=400,height=270,ink=new Uint8Array(width*height),mark=(x,y)=>{ink[Math.round(y)*width+Math.round(x)]=1}
  for(const top of [20,90])for(let l=0;l<5;l++)for(let x=20;x<=380;x++)mark(x,top+l*10)
  for(const y of [180,230])for(let x=20;x<=380;x++)mark(x,y)
  for(const x of [20,140,260,380])for(let y=20;y<=230;y++)mark(x,y)
  return {width,height,ink,mark}
}
test('single-line percussion remains distinct from the two five-line staves',()=>{
  const b=fixture(),s=analyzeBinary(b,{fullScore:true})
  assert.equal(s.staves.length,2)
  assert.deepEqual(detectSingleLineStaves(b,s).map(p=>p.top),[180,230])
})
test('alternate threshold adds a genuinely missed staff without overlapping duplicates',()=>{
  const a={staves:[{top:20,bottom:60,spacing:10},{top:180,bottom:220,spacing:10}]}
  const b={staves:[{top:21,bottom:61,spacing:10},{top:100,bottom:140,spacing:10}]}
  assert.deepEqual(mergeStaffDetections(a,b).staves.map(s=>s.top),[20,100,180])
})
test('the percent-shaped measure repeat needs two isolated dots and a slash',()=>{
  const b=fixture(),s=detectSingleLineStaves(b,analyzeBinary(b,{fullScore:true}))[0]
  for(let d=-8;d<=8;d++)b.mark(80+d,180-d)
  for(const [cx,cy] of [[74,174],[86,186]])for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++)b.mark(cx+dx,cy+dy)
  assert.ok(detectMeasureRepeat(b,s,20,140))
  assert.equal(detectMeasureRepeat(fixture(),s,20,140),null)
})
test('beamed single-line noteheads are eighths, not pitches or text',()=>{
  const b=fixture(),s=detectSingleLineStaves(b,analyzeBinary(b,{fullScore:true}))[0]
  for(const cx of [55,105]){for(let dx=-6;dx<=6;dx++)for(let dy=-4;dy<=4;dy++)if((dx/6)**2+(dy/3.5)**2<=1)b.mark(cx+dx,180+dy);for(let y=180;y<=212;y++)b.mark(cx-5,y)}
  for(let x=50;x<=100;x++)for(let y=210;y<=212;y++)b.mark(x,y)
  const notes=detectOneLineNotes(b,s,20,140)
  assert.equal(notes.length,2);assert.ok(notes.every(n=>n.duration===.5))
})
test('percussion names and standard kit positions use explicit GM keys',()=>{
  assert.equal(percussionKind('S.Bells'),'sleigh');assert.equal(percussionKind('Agogo'),'agogo');assert.equal(percussionKind('Drs.'),'drums')
  assert.equal(percussionKind('Flute'),null);assert.equal(drumPitch(1),36);assert.equal(drumPitch(5),38);assert.equal(drumPitch(9),42)
})
test('unpitched GM notes and channel 10 survive MIDI track separation',async()=>{
  const tk=new VerovioToolkit(await create())
  tk.loadData('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Agogo</part-name><score-instrument id="I1"><instrument-name>High Agogo</instrument-name><instrument-sound>metal.bells.agogo</instrument-sound></score-instrument><midi-instrument id="I1"><midi-channel>10</midi-channel><midi-program>1</midi-program><midi-unpitched>68</midi-unpitched></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes><note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><instrument id="I1"/><type>quarter</type></note></measure></part></score-partwise>')
  const bytes=separateMidiTracks(Uint8Array.from(Buffer.from(tk.renderToMIDI(),'base64'))),on=readMidi(bytes).tracks.flat().find(e=>(e.status&240)===144&&e.data[1]>0)
  assert.equal(on.status&15,9);assert.equal(on.data[0],67)
})

test('the drum label is assigned to its own physical staff, not neighboring Glockenspiel', () => {
  const page = {structure: {staves: [
    {id: 21, top: 100, bottom: 140, spacing: 10, left: 90},
    {id: 22, top: 170, bottom: 210, spacing: 10, left: 90},
  ]}}
  assert.deepEqual([...findDrumStaffs(page, [
    {str: 'Drums', x: 40, y: 130, w: 35, h: 15},
    {str: 'Glockenspiel', x: 5, y: 200, w: 80, h: 15},
    {str: 'Drum', x: 180, y: 190, w: 35, h: 15},
  ])], [21])
})

test('a shifted opening simile is recognized beyond the geometric center', () => {
  const b = fixture()
  const staff = detectSingleLineStaves(b, analyzeBinary(b, {fullScore: true}))[0]
  for (let d = -8; d <= 8; d++) b.mark(98+d, 180-d)
  for (const [x,y] of [[92,174],[104,186]]) for (let dx=0;dx<2;dx++) for (let dy=0;dy<2;dy++) b.mark(x+dx,y+dy)
  assert.equal(detectMeasureRepeat(b, staff, 20, 140), null)
  assert.ok(detectMeasureRepeat(b, staff, 20, 140, {first: true}))
})

test('a one-line full-measure rest requires a printed rectangle', () => {
  const b = fixture()
  const staff = detectSingleLineStaves(b, analyzeBinary(b, {fullScore: true}))[0]
  assert.equal(detectOneLineMeasureRest(b, staff, 20, 140), null)
  for (let y = 181; y <= 184; y++) for (let x = 75; x <= 85; x++) b.mark(x,y)
  assert.equal(detectOneLineMeasureRest(b, staff, 20, 140)?.x, 80)
})
