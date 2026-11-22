import {test} from 'node:test'
import assert from 'node:assert/strict'
import {analyzeBinary,binarize,locateSymbol,staffY,reconcileBarlines} from '../src/structure.js'
import {eventStarts,auditGeometry} from '../src/geometry-report.js'

function fixture({slope=0,broken=false}={}) {
  const width=640,height=320,ink=new Uint8Array(width*height)
  const mark=(x,y)=>{y=Math.round(y+slope*(x-width/2));if(x>=0&&y>=0&&x<width&&y<height) ink[y*width+x]=1}
  for(const top of [60,180]) {
    for(let line=0;line<5;line++) for(let x=45;x<=595;x++) if(!broken||x<310||x>315) mark(x,top+line*10)
    for(const x of [45,225,405,595]) for(let y=top;y<=top+40;y++) mark(x,y)
    // Ordinary stem, too short to span the staff; a tall stem with an attached head.
    for(let y=top+5;y<=top+35;y++) mark(135,y)
    for(let y=top;y<=top+40;y++) mark(305,y)
    for(let y=top+26;y<=top+32;y++) for(let x=298;x<=312;x++) mark(x,y)
  }
  return {width,height,ink}
}
test('find five evenly spaced lines and barlines without confusing stems',()=>{
  const result=analyzeBinary(fixture(),{fullScore:true})
  assert.equal(result.staves.length,2)
  for(const staff of result.staves) {
    assert.equal(staff.lines.length,5)
    assert.ok(Math.abs(staff.spacing-10)<1)
    assert.equal(staff.measureCount,3)
    assert.ok(!staff.bars.some(bar=>Math.abs(bar.x-305)<5))
  }
})
test('skewed and interrupted staff lines retain page coordinates',()=>{
  const slope=Math.tan(1*Math.PI/180),result=analyzeBinary(fixture({slope,broken:true}))
  assert.equal(result.staves.length,2)
  assert.ok(Math.abs(result.skewDegrees-1)<.3)
  assert.ok(Math.abs(staffY(result.staves[0],500,0)-(60+slope*180))<2)
})
test('anchor coordinates map to a staff, measure and half-space step',()=>{
  const result=analyzeBinary(fixture())
  assert.deepEqual({...locateSymbol(result,270,85),ambiguous:false},{staff:1,system:0,measure:2,staffStep:3,nearBar:false,ambiguous:false})
  assert.equal(locateSymbol(result,10,10),null)
})
test('blank or text-only page produces no invented staves',()=>{
  const width=200,height=100,data=new Uint8ClampedArray(width*height*4).fill(255)
  assert.equal(analyzeBinary(binarize({data,width,height})).staves.length,0)
})
test('double barlines form one boundary rather than a tiny extra measure',()=>{
  const image=fixture()
  for(const top of [60,180]) for(let y=top;y<=top+40;y++) image.ink[y*image.width+409]=1
  const result=analyzeBinary(image,{fullScore:true})
  assert.equal(result.staves[0].measureCount,3)
  assert.ok(result.staves[0].bars.some(bar=>bar.type==='double'))
})
test('a missing line is a marked inference supported by other staves',()=>{
  const image=fixture()
  for(let y=60;y<=100;y++) if(![60,70,80,90,100].includes(y)) image.ink[y*image.width+225]=0
  for(let line=0;line<5;line++) for(let x=45;x<=595;x++) image.ink[(260+line*10)*image.width+x]=1
  for(const x of [45,225,405,595]) for(let y=260;y<=300;y++) image.ink[y*image.width+x]=1
  const result=analyzeBinary(image,{fullScore:true})
  assert.equal(result.staves[0].measureCount,3)
  assert.ok(result.staves[0].inferredBars.some(x=>Math.abs(x-225)<2))
})
test('note sequence keeps simultaneous chords and independent voices',()=>{
  assert.deepEqual(eventStarts([{kind:'note',duration:2},{kind:'note',duration:2,chord:true},{kind:'note',duration:2},{kind:'backup',duration:4},{kind:'note',duration:4}]),[0,0,2,null,0])
})
test('analysis at reduced resolution maps anchors back to original pixels',()=>{
  const result=analyzeBinary(fixture(),{scale:.5,fullScore:true})
  assert.equal(result.width,1280)
  assert.ok(Math.abs(result.staves[0].spacing-20)<1)
  const symbol=locateSymbol(result,540,170)
  assert.equal(symbol.measure,2)
  assert.equal(symbol.staffStep,3)
})


test('separated strokes of a double bar share one boundary across all staffs',()=>{
  const staves=Array.from({length:4},(_,i)=>({id:i+1,system:0,left:20,right:700,spacing:8,bars:[{x:220},{x:i%2?403:397},{x:403},{x:550}]}))
  reconcileBarlines(staves)
  assert.ok(staves.every(s=>s.measureCount===4))
  assert.ok(staves.every(s=>s.boundaries[2]>=397&&s.boundaries[2]<=403))
})

test('a terminal courtesy key area is not a tiny extra measure',()=>{
  const staves=Array.from({length:3},(_,i)=>({id:i+1,system:0,left:20,right:700,spacing:8,bars:[{x:220},{x:400},{x:671}]}))
  reconcileBarlines(staves)
  assert.deepEqual(staves[0].boundaries,[20,220,400,700])
})

test('a thick bar continued through staff gaps survives notehead rejection',()=>{
  const image=fixture()
  for(let x=222;x<=228;x++)for(let y=45;y<240;y++)image.ink[y*image.width+x]=1
  const result=analyzeBinary(image,{fullScore:true})
  assert.equal(result.staves[0].measureCount,3)
  assert.ok(result.staves[0].boundaries.some(x=>Math.abs(x-225)<3))
})

test('unanchored recognized rests count, while repeats do not mark a staff unread',()=>{
  const structures=[{sourcePage:6,staves:[{id:1,system:0,measureCount:2}],percussionStaves:[{id:2,system:0,measureCount:2}]}]
  const symbols=[{id:'n1',part:'P1',page:0,system:0,staff:1,measure:1,measureIndex:0}]
  const report=auditGeometry(symbols,structures,[{part:'P2',page:0,staff:2,index:1}],[{part:'P1',page:0,count:2}])
  assert.deepEqual(report,[])
  const missing=auditGeometry(symbols,structures,[],[{part:'P1',page:0,count:1}])
  assert.ok(missing.find(w=>w.kind==='measure-count').message.includes('原稿6ページ'))
  assert.ok(missing.some(w=>w.kind==='unread-staff'&&w.staff===2))
})
