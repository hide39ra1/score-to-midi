// The three recognition networks on onnxruntime-web, behind the two calls the Python side
// needs (see py/ort_shim.py). Used inside the recognition worker where the browser has
// WebAssembly JSPI, and in a worker of its own (ort.worker.js) where it has not.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/'
const MODELS = ['segnet', 'encoder', 'decoder']
import {backendCandidates,createBackendSession} from './acceleration.js'

let ort
const sessions = {}
const modelBytes = {},backends={}
let reportBackend=()=>{}
const kept = new Map() // outputs which stay here: the decoder's cache, fed back in each step

/** Fetch with byte progress, kept in the Cache API so that it downloads once. */
export async function cached(url, onBytes = () => {}) {
  const cache = await caches.open('omr-assets-v1')
  let res = await cache.match(url)
  if (!res) {
    res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    const total = +res.headers.get('content-length') || 0
    const reader = res.body.getReader()
    const chunks = []
    for (let got = 0; ;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      onBytes((got += value.length), total)
    }
    const blob = new Blob(chunks)
    await cache.put(url, new Response(blob))
    return blob.arrayBuffer()
  }
  return res.arrayBuffer()
}

/** Download the models from `base` and start them. onProgress(bytes done, bytes in all). */
export async function load(base, onProgress, mode='auto', onBackend=()=>{}) {
  reportBackend=onBackend
  let gpu=false,npu=false
  if(mode!=='cpu') {
    try {gpu=!!(await navigator.gpu?.requestAdapter({powerPreference:'high-performance'}))} catch {}
    // NPU availability is established by successful WebNN session creation;
    // hardware presence alone does not imply that the browser exposes WebNN.
    npu=!!navigator.ml?.createContext
  }
  const candidates=backendCandidates(mode,{gpu,npu})
  onBackend({stage:'capabilities',gpu,npu,mode})
  ort = await import(/* @vite-ignore */ ORT + (candidates.length>1?'ort.all.min.mjs':'ort.wasm.min.mjs'))
  ort.env.wasm.wasmPaths = ORT
  // Threads need shared memory; phones get fewer, each costs memory.
  ort.env.wasm.numThreads = typeof SharedArrayBuffer === 'function' ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1
  const progress = {}
  for(const name of MODELS) {
    const bytes = await cached(`${base}models/${name}.onnx`, (got, total) => {
      progress[name] = [got, total]
      const sum = (i) => Object.values(progress).reduce((s, p) => s + p[i], 0)
      onProgress(sum(0), sum(1))
    })
    modelBytes[name]=bytes
    const result=await createBackendSession(ort,bytes,candidates,status=>onBackend({model:name,...status}))
    sessions[name]=result.session;backends[name]=result.backend
  }
}

const session = (path) => sessions[MODELS.find((name) => path.includes(name))]

/** Input and output names of the model stored at `path` (as homr names its files). */
export const names = (path) => ({ inputs: session(path).inputNames, outputs: session(path).outputNames })

/**
 * Run a model. feeds: {input: {type, dims, data} | {keep: name of an output kept earlier}}.
 * Returns {output: {type, dims, data}} for the wanted outputs, except "cache_out…" ones,
 * which are kept here under their name.
 */
export async function run(path, feeds, wanted) {
  const inputs = {}
  for (const [name, feed] of Object.entries(feeds))
    inputs[name] = feed.keep ? kept.get(`${path}/${feed.keep}`) : new ort.Tensor(feed.type, feed.data, feed.dims)
  let results
  const model=MODELS.find(name=>path.includes(name))
  try {results=await session(path).run(inputs)}
  catch(error) {
    if(backends[model]==='wasm') throw error
    reportBackend({model,backend:backends[model],stage:'fallback',reason:String(error.message||error)})
    await sessions[model].release().catch(()=>{})
    const fallback=await createBackendSession(ort,modelBytes[model],['wasm'],status=>reportBackend({model,...status}))
    sessions[model]=fallback.session;backends[model]='wasm'
    results=await sessions[model].run(inputs)
  }
  const out = {}
  for (const name of wanted) {
    if (name.startsWith('cache_out')) {const key=`${path}/${name}`;const previous=kept.get(key);if(previous&&previous!==results[name]) previous.dispose();kept.set(key,results[name])}
    else out[name] = { type: results[name].type, dims: results[name].dims, data: results[name].data }
  }
  for(const [name,tensor] of Object.entries(inputs)) if(!feeds[name].keep) tensor.dispose()
  return out
}
