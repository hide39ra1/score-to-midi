import { annotate, tokens } from './annotate.js'
import { loadPages } from './input.js'
import { ocr,ocrInstrumentLabels } from './ocr.js'
import { Player } from './player.js'
import { Score, verovio } from './score.js'
import { inspectScore } from './quality.js'
import { INSTRUMENTS, partSettings, namePartsFromText, identifyInstruments, routeParts } from './instruments.js'
import { separateMidiTracks } from './midi.js'
import { sourceTitle, safeFileName, unknownTitle } from './title.js'
import {storeGeometry,inspectGeometry} from './geometry-report.js'
import {staffY} from './structure.js'
import {normalizeTies,collectTiePairs,inspectTies,tieCandidates} from './ties.js'
import {exportForMuseScore} from './musescore.js'
import {MARKS,DYNAMICS,annotateDirections,inspectSymbols,listNoteSymbols,symbolReview,attributeContext,parseMeter,normalizeSymbolStructure,applyImageArticulations} from './symbols.js'

const $ = (id) => document.getElementById(id)
const show = (view) => (document.body.dataset.view = view)
const query = new URLSearchParams(location.search)
let worker = new Worker(new URL('./omr.worker.js', import.meta.url), { type: 'module' })
const geometryWorker = new Worker(new URL('./structure.worker.js', import.meta.url), {type:'module'})
let geometryRequest=0
const geometryRequests=new Map()
geometryWorker.onmessage=({data})=>{const request=geometryRequests.get(data.id);geometryRequests.delete(data.id);if(data.error) request?.reject(new Error(data.error));else request?.resolve(data.result)}
geometryWorker.onerror=(error)=>{for(const request of geometryRequests.values()) request.reject(new Error(error.message||'構造解析ワーカーを起動できません'));geometryRequests.clear()}
async function ensureGeometry() {
  for(const [index,page] of pages.entries()) {
    if(page.structure) continue
    progress(`五線・小節線を解析中… ${index+1}/${pages.length}`)
    try {page.structure=await new Promise((resolve,reject)=>{const id=++geometryRequest;geometryRequests.set(id,{resolve,reject});geometryWorker.postMessage({id,png:page.png,fullScore:$('layout').value==='full-score'})});page.structure.sourcePage=page.sourcePage||index+1;page.structure.sourceFile=page.sourceFile||''}
    catch(error) {page.structure={version:1,width:page.width,height:page.height,staves:[],error:error.message}}
  }
}
// Browsers without WebAssembly JSPI (Safari before 27) need the networks in a worker of
// their own, see omr.worker.js. ?nojspi forces that way, to test it in other browsers.
let bridgePort = null,ortBridgeWorker=null,recognitionMode=null
function prepareBridge() {
if (typeof WebAssembly.Suspending !== 'function' || query.has('nojspi')) {
  const channel = new MessageChannel()
  ortBridgeWorker=new Worker(new URL('./ort.worker.js', import.meta.url), { type: 'module' });ortBridgeWorker.postMessage({ port: channel.port1 }, [channel.port1])
  bridgePort = channel.port2
}
}
prepareBridge()
const backendState={}
function configureRecognizer(mode) {
  if(recognitionMode!==null&&recognitionMode!==mode) {
    const handler=worker.onmessage,error=worker.onerror
    worker.terminate();ortBridgeWorker?.terminate();bridgePort=null
    worker=new Worker(new URL('./omr.worker.js',import.meta.url),{type:'module'})
    worker.onmessage=handler;worker.onerror=error;prepareBridge()
    for(const key of Object.keys(backendState)) delete backendState[key]
  }
  recognitionMode=mode
}
const player = new Player()
const SETTINGS_KEY = 'score-to-midi.settings.v1'
const DRAFT_KEY = 'score-to-midi.draft.v1'
try {
  const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
  for (const id of ['page-from','page-to','layout','hardware']) if (settings[id] != null) $(id).value = settings[id]
  $('resume').hidden = !localStorage.getItem(DRAFT_KEY)
} catch {}
for (const id of ['page-from','page-to','layout','hardware']) $(id).addEventListener('change', () => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(['page-from','page-to','layout','hardware'].map(id => [id,$(id).value])))) } catch {}
})

let pages = [] // the scanned pages: {png, url, width, height, text}
let score = null
let selected = null // id of the selected note
let midi = '' // base64, kept current for the MIDI download
let started = 0 // when the current scan began
let inputName = ''
let geometryReport=null

// For tests and the curious: the current score from the console.
window.sheetscan = { get xml() { return score?.xml }, seconds: null, bridge: null }

// ---------- scanning ----------

async function scan(files) {
  if (!files.length || document.body.dataset.view === 'busy') return
  inputName = files[0].name
  if (files.length === 1 && /\.(musicxml|xml)$/i.test(files[0].name)) {
    player.stop()
    pages.forEach(p => URL.revokeObjectURL(p.url)); pages = []
    try { await open(await files[0].text(), false) } catch (e) { fail(e.message) }
    return
  }
  const from = Number($('page-from').value)
  const to = $('page-to').value ? Number($('page-to').value) : Infinity
  if (!Number.isInteger(from) || from < 1 || to < from || (to !== Infinity && !Number.isInteger(to))) return fail('ページ範囲を正しく指定してください。')
  $('unsupported').hidden = true
  $('detail').textContent = ''
  pages.forEach((p) => URL.revokeObjectURL(p.url))
  pages = []
  show('busy')
  progress('ページを準備しています…')
  $('thumbs').replaceChildren()
  try {
    pages = await loadPages(files, (n) => progress(`${n}ページを準備しています…`), { from, to })
  } catch (e) {
    return fail(`ファイルを読み込めませんでした: ${e.message}`)
  }
  $('thumbs').replaceChildren(...pages.map((p) => Object.assign(new Image(), { src: p.url })))
  await ensureGeometry()
  readText() // OCR runs beside the recognition
  // Copies go to the worker; the originals stay here for the side-by-side view.
  started = performance.now()
  configureRecognizer($('hardware').value)
  worker.postMessage({ pages: pages.map((p) => p.png), structures:pages.map(p=>p.structure),layout: $('layout').value,mode:$('hardware').value, port: bridgePort }, bridgePort ? [bridgePort] : [])
  bridgePort = null // handed over with the first scan
}

function progress(text, done, total) {
  text = text.replace('Loading Python runtime…', '実行環境を読み込み中…').replace('Loading image libraries…', '画像処理ライブラリを読み込み中…').replace('Starting recognition engine…', '認識エンジンを起動中…').replace('Downloading recognition models (once)…', '認識モデルを取得中（初回のみ）…').replace(/Reading page (\d+) of (\d+)…/, '$2ページ中 $1ページを認識中…')
  $('status').textContent = text
  $('bar').style.width = total ? `${(100 * done) / total}%` : '0'
}

function fail(text) {
  show('start')
  $('unsupported').hidden = false
  $('unsupported').textContent = text
}

// What the recogniser logs, turned into a line for the user and a share of the page done.
let reading = { page: 0, pages: 1, staves: 1 }
const DETAILS = [
  [/Starting Inference/, () => ['五線と記号を検出中…', 0.05]],
  [/Systems after the repair of the layout: \[(.*)\]/, (m) => {
    reading.staves = m[1].split(',').reduce((sum, n) => sum + +n, 0) || 1
    return [`${m[1].split(',').length}段を検出しました`, 0.25]
  }],
  [/Running TrOmr inference on staff image (\d+)/, (m) => [`五線 ${+m[1] + 1}/${reading.staves} を認識中…`, 0.25 + (0.75 * m[1]) / reading.staves]],
  [/page (\d+) skipped/, (m) => [`${m[1]}ページを認識できずスキップしました`, 1]],
]

worker.onmessage = async ({ data }) => {
  if(data.type==='backend') {
    const labels={webnn:'NPU要求＋CPU補助',webgpu:'GPU＋CPU補助',wasm:'CPU'}
    if(data.stage==='capabilities') backendState.capabilities=`GPU API: ${data.gpu?'利用可能':'利用不可'} / NPU API: ${data.npu?'公開あり':'ブラウザー未対応'}`
    if(data.model) backendState[data.model]=`${data.model}: ${labels[data.backend]||data.backend}${data.stage==='loading'?' 初期化中':data.stage==='fallback'?' 利用できず切替中':''}`
    const text=[backendState.capabilities,...['segnet','encoder','decoder'].map(key=>backendState[key])].filter(Boolean).join(' / ')
    $('hardware-status').textContent=text;$('backend-status').textContent=text
  } else if (data.type === 'status') {
    progress(data.text, data.done, data.total)
    if (/Reading page/.test(data.text)) {
      reading = { page: data.done, pages: data.total, staves: 1 }
      ;[...$('thumbs').children].forEach((img, i) => (img.className = i < data.done ? 'done' : i === data.done ? 'now' : ''))
    }
  } else if (data.type === 'log') {
    for (const [pattern, describe] of DETAILS) {
      const m = data.text.match(pattern)
      if (!m) continue
      const [text, share] = describe(m)
      $('detail').textContent = text
      $('bar').style.width = `${(100 * (reading.page + Math.min(share, 1))) / reading.pages}%`
    }
  } else if (data.type === 'error') fail(data.text)
  else if (data.type === 'result') {
    Object.assign(window.sheetscan, { seconds: Math.round((performance.now() - started) / 100) / 10, bridge: data.bridge })
    try { await open(data.xml) } catch (e) { fail(`結果を表示できませんでした: ${e.message}`) }
  }
}
worker.onerror = (e) => fail(`認識処理に失敗しました。再読み込みしてお試しください。${e.message || ''}`)
$('cancel').onclick = () => location.reload()

/** The text of every page: a PDF brings it along, images are read by OCR (begun on load). */
function readText() {
  for (const page of pages) page.words ??= page.text.length ? page.text : ocr(page).catch(() => [])
  return Promise.all(pages.map((p) => p.words))
}

async function open(xml, recognize = true) {
  player.stop()
  spanStart=null
  $('span-status').textContent=''
  unnamedFileName = unknownTitle()
  score = new Score(xml)
  normalizeSymbolStructure(score.doc)
  await ensureGeometry()
  if(pages.length) storeGeometry(score.doc,pages.map(page=>page.structure))
  selected = null
  progress('文字を読み込み中…', 1, 1)
  if (recognize) {
    const text = (await readText()).map(tokens)
    const labels=await Promise.all(pages.map(async(page,index)=>{
      progress(`楽器名を拡大して確認中… ${index+1}/${pages.length}`)
      try{return await ocrInstrumentLabels(page)}catch{return []}
    }))
    namePartsFromText(score.doc, text.map((items,index)=>[...items,...labels[index]]))
    annotateDirections(score.doc,text)
    const result = annotate(score.doc, text)
    // Engine placeholders and author guesses are not a verified title.
    score.title = result.title || sourceTitle(inputName) || unknownTitle()
    $('title-status').textContent = result.title ? '曲名を自動認識しました。保存名を確認・修正できます。' : sourceTitle(inputName) ? '曲名を読み取れなかったため、元ファイル名を使用しています。' : '曲名を読み取れませんでした。「曲名不明＋日時」で保存します。曲名欄で変更できます。'
  } else namePartsFromText(score.doc, [], { preservePiano: true })
  if (!recognize) {
    score.title = score.title.trim() || sourceTitle(inputName) || unknownTitle()
    $('title-status').textContent = '保存名は曲名欄で確認・変更できます。'
  }
  normalizeTies(score.doc)
  if(recognize&&pages.length) {
    progress('タイの曲線候補を照合中…')
    const pairs=collectTiePairs(score.doc).filter(p=>!p.a.tied&&p.a.page!==null&&p.a.page===p.b.page&&p.a.x<p.b.x&&!/drum|打楽器/i.test([...score.doc.querySelectorAll('score-part')].find(part=>part.id===p.a.part)?.querySelector('part-name')?.textContent||''))
    const candidates=[]
    for(const [page,image] of pages.entries()) {
      if(!image.structure?.staves?.length) continue
      try {candidates.push(...await new Promise((resolve,reject)=>{const id=++geometryRequest;geometryRequests.set(id,{resolve,reject});geometryWorker.postMessage({id,operation:'ties',png:image.png,structure:image.structure,page,pairs:pairs.filter(p=>p.a.page===page)})}))}catch{}
    }
    tieCandidates(score.doc,candidates)
    progress('奏法記号の画像を照合中…')
    const notes=[...score.doc.querySelectorAll('note[id]')].filter(n=>n.querySelector('pitch')).map(n=>{const at=/-p(\d+)-(\d+)-(\d+)$/.exec(n.id);return at?{id:n.id,page:+at[1],x:+at[2],y:+at[3],staccato:!!n.querySelector('staccato'),accent:!!n.querySelector('accent'),staccatissimo:!!n.querySelector('staccatissimo')}:null}).filter(Boolean)
    const reviews=[]
    for(const [page,image] of pages.entries())if(image.structure?.staves?.length) {
      try{reviews.push(...await new Promise((resolve,reject)=>{const id=++geometryRequest;geometryRequests.set(id,{resolve,reject});geometryWorker.postMessage({id,operation:'symbols',png:image.png,structure:image.structure,page,notes:notes.filter(n=>n.page===page)})}))}
      catch(error){reviews.push({kind:'error',message:`${page+1}ページ: ${error.message}`})}
    }
    applyImageArticulations(score.doc,reviews)
    symbolReview(score.doc,reviews)
  }
  routeParts(score.doc)
  $('title').value = score.title
  updateSaveName()
  $('scan').replaceChildren(...pages.map(scanPage))
  document.body.classList.toggle('no-scan', !pages.length)
  $('toggle-scan').disabled = !pages.length
  show('work')
  renderParts()
  await draw()
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, score.xml)
    $('resume').hidden = false
    $('save-status').textContent = '編集結果はこのブラウザーに自動保存済み（原稿画像・取り消し履歴は含みません）。MusicXMLでも保存できます。'
  } catch { $('save-status').textContent = 'ブラウザーに保存できません。MusicXMLを保存してください。' }
}
$('resume').onclick = async () => {
  try { const xml = localStorage.getItem(DRAFT_KEY); if (xml) { pages = []; inputName = ''; await open(xml, false) } } catch (e) { fail(e.message) }
}

function renderParts() {
  $('parts').replaceChildren(...partSettings(score.doc).map((part, index) => {
    const row = document.createElement('div'); row.className = 'part-row'
    const label = document.createElement('span'); label.textContent = `${index+1}`
    const name = document.createElement('input'); name.value = part.name; name.setAttribute('aria-label', `${index+1}番のパート名`)
    const instrument = document.createElement('select'); instrument.setAttribute('aria-label', `${index+1}番の楽器・音色`)
    for (const [id,title,program,shift] of INSTRUMENTS) {
      const option = document.createElement('option'); option.value = id; option.textContent = title; instrument.append(option)
    }
    // Selection is a suggestion only; the original transpose remains unchanged until applied.
    const guesses = identifyInstruments(part.sourceLabel||part.name)
    instrument.value = part.instrumentId || (guesses.length === 1 && INSTRUMENTS.find(x => x[0] === guesses[0])[2] === part.program ? guesses[0] : 'unset')
    instrument.options[0].textContent = `未設定・その他（現在GM ${part.program}）`
    const transpose = document.createElement('input'); transpose.type = 'number'; transpose.min = -36; transpose.max = 36; transpose.value = part.transpose; transpose.setAttribute('aria-label', `${index+1}番の移調（半音）`)
    const apply = document.createElement('button'); apply.textContent = '選択楽器の移調を適用'
    const commit = async (program = part.program) => {
      if (!Number.isInteger(Number(transpose.value)) || Number(transpose.value) < -36 || Number(transpose.value) > 36) { $('save-status').textContent = '移調は−36〜36の整数で指定してください。'; return }
      part.program = program
      player.stop(); score.configurePart(part.id, {name:name.value,program,transpose:Number(transpose.value),instrumentId:instrument.value}); await draw()
    }
    name.onchange = () => commit()
    transpose.onchange = () => commit()
    instrument.onchange = () => {
      const selected = INSTRUMENTS.find(x => x[0] === instrument.value)
      if (selected[0] !== 'unset') name.value = selected[1]
      part.program = selected[2]; commit(part.program)
    }
    apply.onclick = () => {
      const selected = INSTRUMENTS.find(x => x[0] === instrument.value)
      transpose.value = selected[3]; commit(selected[2])
    }
    row.append(label,name,instrument,transpose,apply)
    const hint=document.createElement('small');hint.style.gridColumn='2 / -1'
    hint.textContent=`原稿の楽器名候補: ${part.sourceLabel||'未取得'}`+(guesses.length>1?'／併記された代替楽器です。自動処理では先頭候補を仮割当します。実際に使う楽器へ変更できます。':'')
    if(/drums|agogo|tambourine|sleigh\s*bells|打楽器/i.test(part.sourceLabel))hint.textContent+='／打楽器の音色・リズムの自動割当ては未対応です。'
    row.append(hint)
    return row
  }))
}

// ---------- the two panes ----------

function scanPage(page, index) {
  const div = document.createElement('div')
  div.className = 'page'
  div.append(Object.assign(new Image(), { src: page.url }))
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg')
  overlay.setAttribute('viewBox',`0 0 ${page.width} ${page.height}`);overlay.setAttribute('aria-hidden','true');overlay.classList.add('structure-overlay')
  div.append(overlay)
  div.onclick = (e) => {
    // Select the note which was read closest to the click.
    const box = div.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * page.width
    const y = ((e.clientY - box.top) / box.height) * page.height
    let best = null
    for (const el of $('score').querySelectorAll('g.note, g.rest')) {
      const at = place(el.id)
      if (at?.page !== index) continue
      const d = Math.hypot(at.x - x, at.y - y)
      if (!best || d < best.d) best = { d, id: el.id }
    }
    if (best) select(best.id, true)
  }
  return div
}

/** Where on the scan a note was read; its id says so (see pipeline.py). */
function place(id) {
  const m = /-p(\d+)-(\d+)-(\d+)$/.exec(id ?? '')
  return m && { page: +m[1], x: +m[2], y: +m[3] }
}

async function draw() {
  $('save-midi').disabled = true
  $('play').disabled = true
  const report = inspectScore(score.doc)
  $('quality').textContent = `${report.parts}パート・${report.notes}音符。` + (report.warnings.length ? `拍数・小節数の確認候補 ${report.warnings.length}件: ${report.warnings.slice(0, 8).join('、')}。弱起・カデンツァなど正しい例外も含まれます。` : '拍数の不一致は検出されませんでした。音高・移調・声部は原稿と照合してください。')
  const unread = score.doc.querySelector('miscellaneous-field[name="unread-pages"]')?.textContent
  if (unread) $('quality').textContent += ` 認識できなかったページ（選択範囲内の順番）: ${unread}。出力には含まれていません。`
  drawGeometry()
  drawTies()
  drawSymbols()
  const pane = $('score')
  const scroll = pane.scrollTop
  const svgs = await score.render(Math.max(pane.clientWidth - 28, 320))
  pane.innerHTML = svgs.map((svg) => `<div class="page">${svg}</div>`).join('')
  pane.scrollTop = scroll
  midi = player.load(await verovio(),score.doc)
  $('save-midi').disabled = !midi
  $('play').disabled = !midi
  select(selected)
  $('bpm').value = score.tempo
  $('undo').disabled = !score.done.length
  $('redo').disabled = !score.undone.length
  saveDraft()
}

function drawGeometry() {
  geometryReport=inspectGeometry(score.doc)
  if(geometryReport.recognitionVersion==='legacy'&&score.doc.querySelector('miscellaneous-field[name="staff-layout"],miscellaneous-field[name="image-structure-v1"]'))$('quality').textContent+=' 以前の認識処理の結果です。PDFを再認識すると画像補完・小節再試行・ページ結合の修正を適用できます。'
  if(geometryReport.pageAlignment.length)$('quality').textContent+=` ページ間のパート対応に${geometryReport.pageAlignment.length}件の欠落・未割当てがあります。空欄と原稿を確認してください。`
  if(geometryReport.warnings.length) $('quality').textContent+=` 五線・小節の構造照合で${geometryReport.warnings.length}件の確認候補があります。`
  const structures=geometryReport.structures
  const staffCount=structures.reduce((n,p)=>n+(p?.staves?.length||0),0)
  const barCount=structures.reduce((n,p)=>n+(p?.staves||[]).reduce((sum,s)=>sum+s.bars.filter(b=>b.accepted).length,0),0)
  const failed=structures.filter(p=>p?.error).length
  $('geometry-summary').textContent=staffCount?`画像から${staffCount}組の五線・${barCount}本の小節線候補を検出。${geometryReport.symbols.length}個の音符・休符の座標を照合しました。`:'五線を検出できませんでした。原稿のない編集再開時は、保存された解析情報だけを表示します。'
  if(failed) $('geometry-summary').textContent+=` ${failed}ページで構造解析に失敗しています。`
  const recovered=geometryReport.staffRecovery.filter(item=>item.notes),matched=geometryReport.recognitionReview.reduce((n,item)=>n+(item.matched||0),0)
  const retriesFailed=geometryReport.staffRecovery.filter(item=>item.error).length
  if(retriesFailed)$('quality').textContent+=` 再試行で改善を確認できない五線が${retriesFailed}組あります。`
  if(recovered.length)$('quality').textContent+=` 五線${recovered.length}組を再認識し、${recovered.reduce((n,item)=>n+(item.addedNotes??item.notes),0)}音符を追加しました。先頭小節の不整合も再試行の対象です。`
  if(matched)$('geometry-summary').textContent+=` ${matched}音符の推定位置を符頭検出と対応付けて補正しました。丸印は認識結果の位置であり、音高・音価が正しいという判定ではありません。`
  $('geometry-warnings').replaceChildren(...geometryReport.warnings.map(w=>{const li=document.createElement('li');li.textContent=w.message;return li}))
  $('toggle-structure').disabled=!pages.length||!staffCount
  $('save-analysis').disabled=!staffCount
  const svgNS='http://www.w3.org/2000/svg'
  pages.forEach((page,index)=>{
    const overlay=$('scan').children[index]?.querySelector('.structure-overlay')
    if(!overlay) return
    const children=[]
    const shape=(tag,attributes,title)=>{const el=document.createElementNS(svgNS,tag);for(const [key,value] of Object.entries(attributes)) el.setAttribute(key,value);if(title){const text=document.createElementNS(svgNS,'title');text.textContent=title;el.append(text)}children.push(el)}
    for(const staff of structures[index]?.staves||[]) {
      for(const points of staff.lines) shape('polyline',{points:points.map(p=>p.join(',')).join(' '),class:'staff-trace'},`五線 ${staff.id}`)
      for(const x of [staff.left,staff.right]) for(const line of [0,4]) shape('circle',{cx:x,cy:staffY(staff,x,line),r:staff.spacing*.3,class:'staff-corner'})
      for(const bar of staff.bars) shape('line',{x1:bar.x,x2:bar.x,y1:bar.top,y2:bar.bottom,class:bar.accepted?'bar-trace':'bar-candidate'},`小節線候補：${bar.type}／支持五線${bar.support}`)
      for(const x of staff.inferredBars||[]) shape('line',{x1:x,x2:x,y1:staffY(staff,x,0),y2:staffY(staff,x,4),class:'bar-inferred'},'他パートとの一致から補った境界候補')
    }
    const wrong=new Set(geometryReport.warnings.flatMap(w=>w.ids||[]))
    for(const arc of tieCandidates(score.doc).filter(arc=>arc.page===index)) shape('path',{d:`M ${arc.x1} ${arc.y1} Q ${arc.controlX} ${arc.controlY} ${arc.x2} ${arc.y2}`,class:'tie-arc-candidate'},'タイの画像候補（未確定）')
    for(const symbol of geometryReport.symbols.filter(s=>s.page===index)) {
      const staff=structures[index]?.staves.find(s=>s.id===symbol.staff),radius=(staff?.spacing||8)*.7
      shape('circle',{cx:symbol.x,cy:symbol.y,r:radius,class:wrong.has(symbol.id)?'symbol-mismatch':symbol.kind==='rest'?'rest-anchor':'note-anchor'},`${symbol.kind==='rest'?'休符':'音符'} ${symbol.type||''}／五線${symbol.staff??'?'} 小節${symbol.measure??'?'} (${symbol.x},${symbol.y})`)
    }
    for(const item of symbolReview(score.doc).filter(item=>item.page===index&&item.kind==='missing'))shape('circle',{cx:item.x,cy:item.y,r:5,class:'symbol-mismatch'},'スタッカートの点形状候補（未確定）')
    overlay.replaceChildren(...children)
  })
}
$('toggle-structure').onclick=()=>{const visible=document.body.classList.toggle('show-structure');$('toggle-structure').setAttribute('aria-pressed',String(visible))}

function drawTies() {
  const report=inspectTies(score.doc)
  $('tie-summary').textContent=`タイ ${report.pairs}組 / スラー ${report.slurs}本。`+(report.warnings.length?`タイの接続に${report.warnings.length}件の確認候補があります。`:'')+' MuseScoreで記号を保持するには「MuseScore用MusicXML」を開いてください。MIDIは発音の長さを保持しますが、スラーや元のタイの書き方は保持しません。'
  $('tie-candidates').replaceChildren(...tieCandidates(score.doc).filter(arc=>!score.note(arc.startId)?.querySelector('tie[type="start"]')).map((arc,index)=>{
    const li=document.createElement('li'),button=document.createElement('button'),preview=document.createElement('button')
    preview.textContent=`曲線候補 ${index+1} を原稿で表示`
    preview.onclick=()=>{select(arc.startId,true);document.body.classList.add('show-structure');$('toggle-structure').setAttribute('aria-pressed','true')}
    button.textContent='確認してタイにする'
    button.onclick=async()=>{player.stop();if(score.connectTie(arc.startId,arc.endId)) await draw()}
    li.append(preview,button);return li
  }))
}

for(const [value,label] of Object.entries(MARKS))$('mark-type').append(new Option(label,value))
for(const value of DYNAMICS)$('dynamic-type').append(new Option(value,value))
$('dynamic-type').value='mf'
let spanStart=null
$('span-start').onclick=()=>{spanStart=selected;$('span-status').textContent='始点を設定しました。後の音符を選び「選択音符まで結ぶ」を押してください。';$('span-end').disabled=!selected}
$('span-end').onclick=async()=>{
  if(!spanStart||!selected)return
  player.stop()
  if(score.span(spanStart,selected,$('span-type').value)){spanStart=null;$('span-status').textContent='範囲記号を追加しました。';await draw()}
  else $('span-status').textContent='同じパート・五線の後の音符を選んでください。スラーは同じ声部の音符同士を結びます。'
}
async function symbolChange(change){if(!score||!selected)return;player.stop();if(change())await draw()}
$('mark-toggle').onclick=()=>symbolChange(()=>score.mark(selected,$('mark-type').value))
$('mark-type').onchange=()=>{$('mark-toggle').disabled=!score?.note(selected)?.querySelector($('mark-type').value==='fermata'?'pitch,unpitched,rest':'pitch,unpitched')}
$('dynamic-add').onclick=()=>symbolChange(()=>score.direction(selected,'dynamic',$('dynamic-type').value))
$('direction-add').onclick=()=>symbolChange(()=>score.direction(selected,'words',$('direction-text').value.trim()))
$('attributes-apply').onclick=()=>{
  if(!parseMeter($('meter-beats').value,$('meter-unit').value)||!Number.isInteger(Number($('key-fifths').value))||Math.abs(Number($('key-fifths').value))>7){$('symbol-selection').textContent='拍子は正の分子（3+2なども可）と1・2・4・8・16・32・64の分母、調号は−7〜7を指定してください。';return}
  symbolChange(()=>score.attributes(selected,{clef:$('clef-type').value,fifths:Number($('key-fifths').value),beats:$('meter-beats').value,beatType:Number($('meter-unit').value)}))
}
function selectedSymbols() {
  const note=score?.note(selected),pitched=!!note?.querySelector('pitch,unpitched')
  $('mark-toggle').disabled=!note?.querySelector($('mark-type').value==='fermata'?'pitch,unpitched,rest':'pitch,unpitched')
  $('dynamic-add').disabled=$('direction-add').disabled=!note
  $('attributes-apply').disabled=!note
  $('span-start').disabled=!pitched;$('span-end').disabled=!pitched||!spanStart
  if(note){const context=attributeContext(note);$('clef-type').value=context.clef;$('key-fifths').value=context.fifths;$('meter-beats').value=context.beats;$('meter-unit').value=context.beatType}
  $('symbol-selection').textContent=note?`${note.closest('part').id} 第${note.closest('measure').getAttribute('number')}小節・選択位置の記号`:'音符・休符を選択してください。'
  $('selected-symbols').replaceChildren(...listNoteSymbols(note).map((mark,index)=>{const li=document.createElement('li'),button=document.createElement('button');button.textContent=`${mark.label} を削除`;button.onclick=()=>symbolChange(()=>score.removeSymbol(selected,index));li.append(button);return li}))
}
function drawSymbols() {
  const report=inspectSymbols(score.doc),c=report.counts
  $('symbol-summary').textContent=`音部記号 ${c.clef} / 調号 ${c.key} / 拍子 ${c.time} / 強弱 ${c.dynamics} / アクセント ${c.accent} / スタッカート ${c.staccato} / フェルマータ ${c.fermata} / ヘアピン ${c.wedge} / 反復 ${c.repeat}。出力数であり、原稿の全記号を検出できたことを示すものではありません。`
  $('symbol-warnings').replaceChildren(...report.warnings.map(message=>{const li=document.createElement('li');li.textContent=message;return li}))
  const missing=[],uncertain=[]
  const imageAdded=symbolReview(score.doc).filter(item=>item.kind==='added').length
  if(imageAdded)$('symbol-summary').textContent+=` 画像照合で奏法記号${imageAdded}個を補完しました。`
  for(const item of symbolReview(score.doc).filter(item=>item.kind!=='added'&&(item.kind==='error'||!!score.note(item.id)))) {
    const li=document.createElement('li')
    if(item.kind==='error'){li.textContent=item.message;missing.push(li);continue}
    const present=!!score.note(item.id).querySelector(item.tag)
    if(item.kind==='missing'&&present)continue
    if(item.kind==='unconfirmed'&&!present)continue
    const preview=document.createElement('button');preview.textContent=item.kind==='missing'?`${MARKS[item.tag]}の画像候補：確認`:`${MARKS[item.tag]}の形状を照合できません：確認`
    preview.onclick=()=>{select(item.id,true);if(pages.length){document.body.classList.add('show-structure');$('toggle-structure').setAttribute('aria-pressed','true')}$('symbol-selection').textContent+='／原稿を確認して「記号を追加・解除」で修正できます。';$('mark-type').value=item.tag}
    li.append(preview);(item.kind==='missing'?missing:uncertain).push(li)
  }
  if(uncertain.length){const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');summary.textContent=`点形状を照合できない既出記号 ${uncertain.length}件（未検証）`;list.append(...uncertain);details.append(summary,list);li.append(details);missing.push(li)}
  $('symbol-review').replaceChildren(...missing)
}

function select(id, reveal = false) {
  const pane = $('score')
  pane.querySelector('.selected')?.classList.remove('selected')
  const el = id && pane.querySelector(`#${CSS.escape(id)}`)
  selected = el ? id : null
  el?.classList.add('selected')
  if (el && reveal) el.scrollIntoView({ block: 'center', behavior: 'smooth' })

  document.querySelector('.marker')?.remove()
  const at = place(selected)
  const page = at && $('scan').children[at.page]
  if (page) {
    const marker = Object.assign(document.createElement('div'), { className: 'marker' })
    marker.style.left = `${(100 * at.x) / pages[at.page].width}%`
    marker.style.top = `${(100 * at.y) / pages[at.page].height}%`
    page.append(marker)
    marker.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  for (const button of $('inspector').querySelectorAll('button')) button.disabled = !selected
  $('hint').textContent = selected ? '' : '音符をクリックして修正。左右キーで音符を移動。'
  selectedSymbols()
}

$('score').onclick = (e) => {
  // Noteheads are small targets: take the closest one within reach of the click.
  let best = { d: 14, id: null }
  for (const el of $('score').querySelectorAll('g.note, g.rest')) {
    const box = (el.querySelector('.notehead') ?? el).getBoundingClientRect()
    const d = Math.hypot(
      Math.max(box.left - e.clientX, 0, e.clientX - box.right),
      Math.max(box.top - e.clientY, 0, e.clientY - box.bottom),
    )
    if (d < best.d) best = { d, id: el.id }
  }
  select(best.id)
}

// ---------- editing ----------

async function edit(action, arg) {
  if (!score) return
  player.stop()
  if (action === 'undo' || action === 'redo') {
    if (!score[action]()) return
  } else if (action === 'add') {
    const added = score.add(selected)
    if (!added) return
    selected = added
  } else if (!score[action](selected, arg)) {if(action==='tie')$('hint').textContent='同じ声部で連続する同じ高さの音符を選択してください。';return}
  await draw()
  if (action === 'undo' || action === 'redo') renderParts()
  const sounding = player.notes.find((n) => n.id === selected)
  if (sounding && ['move', 'alter', 'add'].includes(action)) player.ping(sounding.pitch)
}

$('inspector').onclick = (e) => {
  const button = e.target.closest('button')
  if (button) edit(button.dataset.do, button.dataset.arg === undefined ? undefined : +button.dataset.arg)
}
$('undo').onclick = () => edit('undo')
$('redo').onclick = () => edit('redo')
$('title').oninput = (e) => { score.title = e.target.value; updateSaveName(); saveDraft() }

function step(by) {
  const all = [...$('score').querySelectorAll('g.note, g.rest')]
  const next = all[all.findIndex((el) => el.id === selected) + by] ?? all[by > 0 ? 0 : all.length - 1]
  if (next) select(next.id, true)
}

const KEYS = {
  ArrowUp: (e) => edit('move', e.shiftKey ? 7 : 1),
  ArrowDown: (e) => edit('move', e.shiftKey ? -7 : -1),
  ArrowLeft: () => step(-1),
  ArrowRight: () => step(1),
  '+': () => edit('alter', 1), '=': () => edit('alter', 1), '-': () => edit('alter', -1), n: () => edit('alter', 0),
  '.': () => edit('dot'), r: () => edit('rest'), a: () => edit('add'),
  t: () => edit('tie'),
  Delete: () => edit('remove'), Backspace: () => edit('remove'),
  ' ': () => togglePlay(),
  z: (e) => e.ctrlKey || e.metaKey ? edit(e.shiftKey ? 'redo' : 'undo') : false,
  y: (e) => e.ctrlKey || e.metaKey ? edit('redo') : false,
}
for (let i = 0; i < 6; i++) KEYS[i + 1] = () => edit('duration', i)

document.addEventListener('keydown', (e) => {
  if (document.body.dataset.view !== 'work' || e.target.matches('input, select, textarea')) return
  const action = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
  if (action && action(e) !== false) e.preventDefault()
})

// ---------- playback ----------

function togglePlay() {
  if (player.playing) return player.stop()
  const pane = $('score')
  let shown = []
  $('play').textContent = '■ 停止'
  player.play(
    player.notes.find((n) => n.id === selected)?.t ?? 0,
    (ids) => {
      shown.forEach((el) => el.classList.remove('playing'))
      shown = ids.map((id) => pane.querySelector(`#${CSS.escape(id)}`)).filter(Boolean)
      shown.forEach((el) => el.classList.add('playing'))
      const box = shown[0]?.getBoundingClientRect()
      const view = pane.getBoundingClientRect()
      if (box && (box.bottom > view.bottom - 40 || box.top < view.top)) shown[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    () => {
      shown.forEach((el) => el.classList.remove('playing'))
      $('play').textContent = '▶ 再生'
    },
  )
}
$('play').onclick = togglePlay
$('bpm').onchange = async (e) => {
  player.stop()
  score.tempo = Math.min(Math.max(Math.round(e.target.value) || 120, 20), 400)
  await draw()
}

// ---------- files in, files out ----------

function download(name, type, content) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000) // revoking at once cancels the download in some browsers
}
let unnamedFileName = unknownTitle()
const fileName = () => safeFileName(score.title) || unnamedFileName
function updateSaveName() {
  $('save-name').textContent = `保存名: ${fileName()}.mid / ${fileName()}.musicxml`
}
$('save-xml').onclick = () => download(`${fileName()}.musicxml`, 'application/vnd.recordare.musicxml+xml', exportForMuseScore(score.doc))
$('save-analysis').onclick=()=>download(`${fileName()}_解析.json`,'application/json',JSON.stringify({...geometryReport,notation:inspectSymbols(score.doc),notationReview:symbolReview(score.doc)},null,2))
$('save-midi').onclick = () => {
  try { download(`${fileName()}.mid`, 'audio/midi', separateMidiTracks(Uint8Array.from(atob(midi), (c) => c.charCodeAt(0)))) }
  catch (e) { $('save-status').textContent = `MIDIを保存できませんでした: ${e.message}`; $('parts-panel').open = true }
}
$('again').onclick = () => {
  player.stop()
  show('start')
}
$('toggle-scan').onclick = () => {
  document.body.classList.toggle('no-scan')
  if (score) draw()
}

$('files').onchange = (e) => scan([...e.target.files])
if (query.has('test')) {
  const sample = document.createElement('button'); sample.id = 'sample'; sample.textContent = '開発用サンプル認識'
  sample.onclick = async () => scan([new File([await (await fetch('sample.png')).blob()], 'sample.png')])
  $('start').append(sample)
}
addEventListener('dragover', (e) => (e.preventDefault(), document.body.classList.add('dragging')))
addEventListener('dragleave', () => document.body.classList.remove('dragging'))
addEventListener('drop', (e) => {
  e.preventDefault()
  document.body.classList.remove('dragging')
  scan([...e.dataTransfer.files])
})
addEventListener('paste', (e) => scan([...e.clipboardData.files]))
let resizing
addEventListener('resize', () => {
  clearTimeout(resizing)
  resizing = setTimeout(() => score && document.body.dataset.view === 'work' && draw(), 250)
})


// Development: ?demo=a.png,b.png scans images served next to the app;
// with &xml=result.musicxml it skips recognition and opens that result for them.
if (query.get('demo')) {
  const files = await Promise.all(query.get('demo').split(',').map(async (u) => new File([await (await fetch(u)).blob()], u)))
  if (!query.get('xml')) scan(files)
  else {
    pages = await loadPages(files)
    open(await (await fetch(query.get('xml'))).text())
  }
}
else if(import.meta.env.DEV&&query.get('xml')) open(await (await fetch(query.get('xml'))).text(),false)
