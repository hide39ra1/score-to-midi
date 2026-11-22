import {test} from 'node:test'
import assert from 'node:assert/strict'
import {classifyDirection,parseMeter,findStaccatoDots,findArticulationShapes} from '../src/symbols.js'

test('recognize exact dynamics and performance words without treating ordinary labels as symbols',()=>{
  assert.deepEqual(classifyDirection(' sfz '),{kind:'dynamic',value:'sfz'})
  for(const value of ['cresc.','pizz.','a tempo','D.C.','To Coda'])assert.equal(classifyDirection(value).kind,'words')
  for(const value of ['Flute','F','Am','piano solo','f 123','copyright'])assert.equal(classifyDirection(value),null)
})
test('validate simple and additive meters, rejecting invalid and zero denominators',()=>{
  assert.deepEqual(parseMeter('3+2','8'),{beats:'3+2',beatType:8})
  for(const [a,b] of [['0',4],['4',0],['4',3],['-3',4],['3+',8]])assert.equal(parseMeter(a,b),null)
})
const binary=()=>({ink:new Uint8Array(100*100),width:100,height:100})
const rect=(b,x,y,w,h)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)b.ink[j*b.width+i]=1}
const anchor={x:50,y:40,spacing:10,top:30,bottom:70}
test('a compact dot outside its staff provides staccato evidence',()=>{
  const b=binary();rect(b,49,19,3,3)
  assert.deepEqual(findStaccatoDots(b,anchor),[{x:50,y:20}])
})
test('staff intersections, augmentation dots, tenuto and stems are not staccato evidence',()=>{
  const b=binary();rect(b,0,30,100,1);rect(b,49,34,3,3);rect(b,48,19,8,2);rect(b,50,74,1,20)
  assert.deepEqual(findStaccatoDots(b,anchor),[])
})
test('an accent and a separate dot are recognized together rather than replacing one another',()=>{
  const b=binary();rect(b,49,20,3,3)
  for(let i=0;i<=8;i++){rect(b,46+i,10+Math.round(i/4),1,2);rect(b,46+i,14-Math.round(i/4),1,2)}
  assert.deepEqual(findArticulationShapes(b,anchor).map(s=>s.tag).sort(),['accent','staccato'])
})
test('a detached slur endpoint is not automatically treated as a staccato dot',()=>{
  const b=binary();rect(b,49,20,3,3);rect(b,35,19,9,1)
  assert.deepEqual(findStaccatoDots(b,anchor),[])
})
