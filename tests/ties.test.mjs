import {test} from 'node:test'
import assert from 'node:assert/strict'
import {adjacentTiePairs,detectTieArc} from '../src/ties.js'
const event=(id,onset,pitch='C/0/4',extra={})=>({id,onset,end:onset+1,pitch,part:'P1',voice:'1',staff:'1',...extra})
test('ties pair equal adjacent pitches across a bar without crossing a rest or another voice',()=>{
  assert.equal(adjacentTiePairs([event('a',0),event('b',1)]).length,1)
  assert.equal(adjacentTiePairs([event('a',0),event('r',1,null),event('b',2)]).length,0)
  assert.equal(adjacentTiePairs([event('a',0),event('b',1,'C/0/4',{voice:'2'})]).length,0)
  assert.equal(adjacentTiePairs([event('a',0),event('b',1,'D/0/4')]).length,0)
})
test('chord pitches find their actual next chord member',()=>{
  const pairs=adjacentTiePairs([event('c1',0),event('e1',0,'E/0/4'),event('e2',1,'E/0/4'),event('c2',1)])
  assert.deepEqual(pairs.map(p=>[p.a.id,p.b.id]),[['c1','c2'],['e1','e2']])
})
test('curved tie evidence is required; a straight beam is rejected',()=>{
  const width=200,height=100,ink=new Uint8Array(width*height),pair={a:{id:'a',x:20,y:60},b:{id:'b',x:180,y:60}}
  for(let x=20;x<=180;x++){const t=(x-20)/160,y=Math.round(60-8-9*4*t*(1-t));ink[y*width+x]=1}
  assert.ok(detectTieArc({ink,width,height},pair,10))
  ink.fill(0);for(let x=20;x<=180;x++)ink[43*width+x]=1
  assert.equal(detectTieArc({ink,width,height},pair,10),null)
})
