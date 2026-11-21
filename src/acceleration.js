export function backendCandidates(mode,{npu=false,gpu=false}={}) {
  if(mode==='cpu') return ['wasm']
  const out=[]
  if(npu&&mode!=='gpu') out.push('webnn')
  if(gpu&&mode!=='npu') out.push('webgpu')
  if(mode==='npu'&&gpu) out.push('webgpu')
  return [...out,'wasm']
}
export async function createBackendSession(ort,bytes,candidates,onStatus=()=>{},timeoutMs=45000) {
  for(const backend of candidates) {
    onStatus({backend,stage:'loading'})
    let timer,expired=false
    const creation=Promise.resolve().then(()=>ort.InferenceSession.create(bytes,{executionProviders:backend==='webnn'?[{name:'webnn',deviceType:'npu',powerPreference:'high-performance'},'wasm']:backend==='webgpu'?['webgpu','wasm']:['wasm']}))
    // Session creation cannot be cancelled. Release late results after timeout.
    creation.then(session=>{if(expired) session.release().catch(()=>{})},()=>{})
    try {
      const session=await Promise.race([creation,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error('初期化が時間内に完了しませんでした'))},backend==='wasm'?180000:timeoutMs)})])
      clearTimeout(timer);onStatus({backend,stage:'ready'});return {session,backend}
    } catch(error) {
      clearTimeout(timer);onStatus({backend,stage:'fallback',reason:String(error.message||error)})
      if(backend==='wasm') throw error
    }
  }
  throw new Error('利用できる認識バックエンドがありません')
}
