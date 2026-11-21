import{test}from'node:test';import assert from'node:assert/strict';import{backendCandidates,createBackendSession}from'../src/acceleration.js'
test('use exposed NPU, then GPU, then CPU; CPU can be explicitly forced',()=>{
  assert.deepEqual(backendCandidates('auto',{npu:true,gpu:true}),['webnn','webgpu','wasm'])
  assert.deepEqual(backendCandidates('auto',{}),['wasm'])
  assert.deepEqual(backendCandidates('cpu',{npu:true,gpu:true}),['wasm'])
})
test('unsupported accelerator falls back and reports the backend actually selected',async()=>{
  const statuses=[],ort={InferenceSession:{create:async(_,options)=>{if(options.executionProviders[0]!=='wasm')throw new Error('unsupported');return{release:async()=>{}}}}}
  const result=await createBackendSession(ort,new Uint8Array(),['webgpu','wasm'],s=>statuses.push(s))
  assert.equal(result.backend,'wasm');assert.ok(statuses.some(s=>s.stage==='fallback'))
})
test('stalled accelerator initialization is bounded and a late session is released',async()=>{
  let released=false
  const ort={InferenceSession:{create:(_,options)=>options.executionProviders[0]==='wasm'?Promise.resolve({release:async()=>{}}):new Promise(resolve=>setTimeout(()=>resolve({release:async()=>{released=true}}),20))}}
  const result=await createBackendSession(ort,new Uint8Array(),['webgpu','wasm'],()=>{},2)
  assert.equal(result.backend,'wasm');await new Promise(resolve=>setTimeout(resolve,30));assert.ok(released)
})
