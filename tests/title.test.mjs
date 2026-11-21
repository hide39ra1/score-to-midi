import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sourceTitle,safeFileName,unknownTitle,detectTitle} from '../src/title.js'
test('use meaningful original names but reject generic scan names',()=>{
  assert.equal(sourceTitle('ジングルベル.pdf'),'ジングルベル')
  for(const name of ['スコア.pdf','scan001.pdf','楽譜.pdf','score.png']) assert.equal(sourceTitle(name),'')
})
test('safe Unicode names, forbidden characters, reserved Windows names',()=>{
  assert.equal(safeFileName('ジングルベル'),'ジングルベル')
  assert.equal(safeFileName('曲: A/B?'),'曲_ A_B_')
  assert.equal(safeFileName('CON'),'_CON')
  assert.equal(safeFileName(' ... '),'')
  assert.equal(safeFileName('a'.repeat(99)+'. long'),'a'.repeat(99))
})
test('unknown title has a stable explicit date and time',()=>{
  assert.equal(unknownTitle(new Date(2026,10,22,9,3,5)),'曲名不明_20261122_090305')
})
test('right-aligned composer is not mistaken for a centered title',()=>{
  const staff=[200,200,1200,232]
  const composer={str:'James Pierpont',x:1030,y:80,w:180,h:18}
  assert.equal(detectTitle([composer],staff),null)
  assert.equal(detectTitle([composer,{str:'ジングルベル',x:500,y:90,w:350,h:45}],staff).str,'ジングルベル')
  assert.equal(detectTitle([{...composer,y:90,h:23},{str:'ジン グルベル',x:500,y:90,w:350,h:45}],staff).str,'ジングルベル')
})
