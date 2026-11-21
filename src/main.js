import { annotate, tokens } from './annotate.js'
import { loadPages } from './input.js'
import { ocr } from './ocr.js'
import { Player } from './player.js'
import { Score, verovio } from './score.js'
import { inspectScore } from './quality.js'
import { INSTRUMENTS, partSettings, namePartsFromText, identifyInstruments, routeParts } from './instruments.js'
import { separateMidiTracks } from './midi.js'
import { sourceTitle, safeFileName, unknownTitle } from './title.js'

const $ = (id) => document.getElementById(id)
const show = (view) => (document.body.dataset.view = view)
const query = new URLSearchParams(location.search)
const worker = new Worker(new URL('./omr.worker.js', import.meta.url), { type: 'module' })
// Browsers without WebAssembly JSPI (Safari before 27) need the networks in a worker of
// their own, see omr.worker.js. ?nojspi forces that way, to test it in other browsers.
let bridgePort = null
if (typeof WebAssembly.Suspending !== 'function' || query.has('nojspi')) {
  const channel = new MessageChannel()
  new Worker(new URL('./ort.worker.js', import.meta.url), { type: 'module' }).postMessage({ port: channel.port1 }, [channel.port1])
  bridgePort = channel.port2
}
const player = new Player()
const SETTINGS_KEY = 'score-to-midi.settings.v1'
const DRAFT_KEY = 'score-to-midi.draft.v1'
try {
  const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
  for (const id of ['page-from','page-to','layout']) if (settings[id] != null) $(id).value = settings[id]
  $('resume').hidden = !localStorage.getItem(DRAFT_KEY)
} catch {}
for (const id of ['page-from','page-to','layout']) $(id).addEventListener('change', () => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(['page-from','page-to','layout'].map(id => [id,$(id).value])))) } catch {}
})

let pages = [] // the scanned pages: {png, url, width, height, text}
let score = null
let selected = null // id of the selected note
let midi = '' // base64, kept current for the MIDI download
let started = 0 // when the current scan began
let inputName = ''

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
  readText() // OCR runs beside the recognition
  // Copies go to the worker; the originals stay here for the side-by-side view.
  started = performance.now()
  worker.postMessage({ pages: pages.map((p) => p.png), layout: $('layout').value, port: bridgePort }, bridgePort ? [bridgePort] : [])
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
  if (data.type === 'status') {
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
  unnamedFileName = unknownTitle()
  score = new Score(xml)
  selected = null
  progress('文字を読み込み中…', 1, 1)
  if (recognize) {
    const text = (await readText()).map(tokens)
    namePartsFromText(score.doc, text)
    const result = annotate(score.doc, text)
    // Engine placeholders and author guesses are not a verified title.
    score.title = result.title || sourceTitle(inputName) || unknownTitle()
    $('title-status').textContent = result.title ? '曲名を自動認識しました。保存名を確認・修正できます。' : sourceTitle(inputName) ? '曲名を読み取れなかったため、元ファイル名を使用しています。' : '曲名を読み取れませんでした。「曲名不明＋日時」で保存します。曲名欄で変更できます。'
  } else namePartsFromText(score.doc, [], { preservePiano: true })
  if (!recognize) {
    score.title = score.title.trim() || sourceTitle(inputName) || unknownTitle()
    $('title-status').textContent = '保存名は曲名欄で確認・変更できます。'
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
    const guesses = identifyInstruments(part.name)
    instrument.value = guesses.length === 1 && INSTRUMENTS.find(x => x[0] === guesses[0])[2] === part.program ? guesses[0] : 'unset'
    instrument.options[0].textContent = `未設定・その他（現在GM ${part.program}）`
    const transpose = document.createElement('input'); transpose.type = 'number'; transpose.min = -36; transpose.max = 36; transpose.value = part.transpose; transpose.setAttribute('aria-label', `${index+1}番の移調（半音）`)
    const apply = document.createElement('button'); apply.textContent = '選択楽器の移調を適用'
    const commit = async (program = part.program) => {
      if (!Number.isInteger(Number(transpose.value)) || Number(transpose.value) < -36 || Number(transpose.value) > 36) { $('save-status').textContent = '移調は−36〜36の整数で指定してください。'; return }
      part.program = program
      player.stop(); score.configurePart(part.id, {name:name.value,program,transpose:Number(transpose.value)}); await draw()
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
    row.append(label,name,instrument,transpose,apply); return row
  }))
}

// ---------- the two panes ----------

function scanPage(page, index) {
  const div = document.createElement('div')
  div.className = 'page'
  div.append(Object.assign(new Image(), { src: page.url }))
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
  const pane = $('score')
  const scroll = pane.scrollTop
  const svgs = await score.render(Math.max(pane.clientWidth - 28, 320))
  pane.innerHTML = svgs.map((svg) => `<div class="page">${svg}</div>`).join('')
  pane.scrollTop = scroll
  midi = player.load(await verovio())
  $('save-midi').disabled = !midi
  $('play').disabled = !midi
  select(selected)
  $('bpm').value = score.tempo
  $('undo').disabled = !score.done.length
  $('redo').disabled = !score.undone.length
  saveDraft()
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
  } else if (!score[action](selected, arg)) return
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
$('save-xml').onclick = () => download(`${fileName()}.musicxml`, 'application/vnd.recordare.musicxml+xml', score.xml)
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
