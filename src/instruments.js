// GM programs are MusicXML's 1-based values. Transposition is sounding minus written pitch.
import { melodicRoute } from './midi.js'
export const INSTRUMENTS = [
  ['unset','未設定',1,0], ['flute','フルート',74,0], ['piccolo','ピッコロ',73,12],
  ['oboe','オーボエ',69,0], ['clarinet','B♭クラリネット',72,-2], ['bassclarinet','B♭バスクラリネット',72,-14],
  ['soprano','B♭ソプラノサックス',65,-2], ['alto','E♭アルトサックス',66,-9],
  ['tenor','B♭テナーサックス',67,-14], ['baritone','E♭バリトンサックス',68,-21],
  ['trumpet','B♭トランペット',57,-2], ['horn','Fホルン',61,-7],
  ['trombone','トロンボーン',58,0], ['euphonium','ユーフォニアム（実音）',59,0],
  ['tuba','テューバ',59,0], ['bassoon','ファゴット',71,0], ['violin','ヴァイオリン',41,0],
  ['viola','ヴィオラ',42,0], ['cello','チェロ',43,0], ['bass','コントラバス',44,-12],
  ['piano','ピアノ',1,0], ['glockenspiel','グロッケン',10,24],
]

export function identifyInstruments(text) {
  const rules = [
    ['piccolo', /piccolo|ピッコロ/i], ['flute', /flute|フルート/i], ['oboe', /oboe|オーボエ/i],
    ['bassclarinet', /bass\s*clarinet|バスクラリネット/i],
    ['clarinet', /(?<!bass\s)clarinet|クラリネット/i],
    ['soprano', /soprano\s*sax|ソプラノサックス/i], ['alto', /alto\s*sax|アルトサックス/i],
    ['tenor', /tenor\s*sax|テナーサックス/i], ['baritone', /baritone\s*sax|バリトンサックス/i],
    ['trumpet', /trumpet|トランペット/i], ['horn', /(?:alto\s*)?horn|ホルン/i],
    ['trombone', /trombone|トロンボーン/i], ['euphonium', /euphonium|ユーフォニアム/i],
    ['tuba', /tuba|テューバ|チューバ/i], ['bassoon', /bassoon|ファゴット/i],
    ['violin', /violin|ヴァイオリン/i], ['viola', /viola|ヴィオラ/i], ['cello', /cello|チェロ/i],
    ['bass', /string\s*bass|double\s*bass|コントラバス/i], ['piano', /piano|ピアノ/i],
    ['glockenspiel', /glockenspiel|グロッケン/i],
  ]
  const found = rules.filter(([,pattern]) => pattern.test(text)).map(([id]) => id)
  return found.includes('bassclarinet') ? found.filter(id => id !== 'clarinet') : found
}

const set = (doc, parent, tag, text) => {
  let el = [...parent.children].find(x => x.tagName === tag)
  if (!el) { el = doc.createElement(tag); parent.append(el) }
  el.textContent = text
  return el
}

export function partSettings(doc) {
  return [...doc.querySelectorAll('part-list > score-part')].map((meta, index) => {
    const part = [...doc.querySelectorAll('score-partwise > part')].find(p => p.id === meta.id)
    const shift = part?.querySelector('transpose')
    return { id: meta.id, name: meta.querySelector('part-name')?.textContent || `パート ${index+1}`,
      program: Number(meta.querySelector('midi-program')?.textContent || 1),
      transpose: Number(shift?.querySelector('chromatic')?.textContent || 0) + 12 * Number(shift?.querySelector('octave-change')?.textContent || 0) }
  })
}

export function routeParts(doc) {
  for (const [index,meta] of [...doc.querySelectorAll('part-list > score-part')].entries()) {
    const midi = meta.querySelector('midi-instrument')
    if (!midi) continue
    const route = melodicRoute(index)
    meta.querySelectorAll('midi-device').forEach(el => el.remove())
    const device = doc.createElement('midi-device'); device.setAttribute('port',route.port+1); device.id = midi.id
    meta.insertBefore(device,midi)
    const channel = set(doc,midi,'midi-channel',route.channel+1)
    midi.insertBefore(channel,midi.firstChild)
  }
}

export function applyPartSettings(doc, id, {name, program, transpose}) {
  const meta = [...doc.querySelectorAll('part-list > score-part')].find(p => p.id === id)
  const part = [...doc.querySelectorAll('score-partwise > part')].find(p => p.id === id)
  if (!meta || !part) return
  set(doc, meta, 'part-name', name.trim() || id)
  meta.querySelectorAll('part-name-display, part-abbreviation, part-abbreviation-display').forEach(el => el.remove())
  let instrument = meta.querySelector('score-instrument')
  if (!instrument) { instrument = doc.createElement('score-instrument'); instrument.id = `${id}-instrument`; meta.append(instrument) }
  set(doc, instrument, 'instrument-name', name.trim() || id)
  instrument.querySelectorAll('instrument-sound').forEach(el => el.remove())
  // Keep the MusicXML child order: score-instrument before midi-instrument.
  let midi = meta.querySelector('midi-instrument')
  if (!midi) { midi = doc.createElement('midi-instrument'); meta.append(midi) }
  meta.insertBefore(instrument, midi)
  midi.id = instrument.id
  set(doc, midi, 'midi-program', Math.max(1, Math.min(128, Math.round(program) || 1)))
  const amount = Math.max(-36, Math.min(36, Math.round(transpose) || 0))
  // Explicit user assignment replaces earlier inferred shifts, including later attributes.
  part.querySelectorAll('transpose').forEach(el => el.remove())
  const measure = part.querySelector('measure')
  if (!measure) return
  let attributes = measure.querySelector('attributes')
  if (!attributes) { attributes = doc.createElement('attributes'); measure.insertBefore(attributes, measure.firstChild) }
  const shift = doc.createElement('transpose')
  set(doc, shift, 'chromatic', amount)
  const following = [...attributes.children].find(el => ['for-part','directive','measure-style'].includes(el.tagName))
  attributes.insertBefore(shift, following || null)
}

// Associate OCR labels by the first note's original position, never by the current row index.
export function namePartsFromText(doc, text, { preservePiano = false } = {}) {
  let layout = []
  try { layout = JSON.parse(doc.querySelector('miscellaneous-field[name="staff-layout"]')?.textContent || '[]') } catch {}
  const candidates = new Map()
  for (const [index, meta] of [...doc.querySelectorAll('part-list > score-part')].entries()) {
    const part = [...doc.querySelectorAll('score-partwise > part')].find(p => p.id === meta.id)
    const note = [...(part?.querySelectorAll('note[id]') || [])].map(n => /-p(\d+)-(\d+)-(\d+)$/.exec(n.id)).find(Boolean)
    let label = ''
    if (note) {
      const page = Number(note[1]), y = Number(note[3]), staffs = layout[page] || []
      const nearest = staffs.map((s,i) => ({ s,i,d: Math.max(s[1]-y, y-s[3],0) })).sort((a,b) => a.d-b.d)[0]
      if (nearest) {
        const { s,i } = nearest
        const count = Math.max(1, Number(part.querySelector('attributes > staves')?.textContent || 1))
        const last = Math.min(i + count - 1, staffs.length - 1)
        const top = i ? (staffs[i-1][3]+s[1])/2 : s[1]-(s[3]-s[1])
        const bottom = staffs[last+1] ? (staffs[last][3]+staffs[last+1][1])/2 : staffs[last][3]+(s[3]-s[1])
        const words = (text[page] || []).filter(t => t.x+t.w < s[0]+(s[3]-s[1])/4 && t.y-t.h/2 > top && t.y-t.h/2 < bottom).sort((a,b) => Math.abs(a.y-b.y)>Math.max(a.h,b.h)*0.6 ? a.y-b.y : a.x-b.x)
        const raw = words.map(t => t.str).join(' ')
        if (identifyInstruments(raw).length || /drums|agogo|tambourine|sleigh\s*bells|打楽器/i.test(raw)) label = raw
      }
    }
    // An OMR-generated Piano label is also a guess, not evidence of instrument identity.
    if (label) {
      set(doc, meta, 'part-name', label); candidates.set(meta.id, label)
      const guessed = identifyInstruments(label)
      const current = partSettings(doc).find(p => p.id === meta.id)
      applyPartSettings(doc, meta.id, { name: label, program: guessed.length === 1 ? INSTRUMENTS.find(x => x[0] === guessed[0])[2] : 1, transpose: current.transpose })
    }
    else if ((preservePiano ? /^voice$/i : /^(voice|piano)$/i).test(meta.querySelector('part-name')?.textContent?.trim() || '')) {
      const current = partSettings(doc).find(p => p.id === meta.id)
      applyPartSettings(doc, meta.id, { name: `パート ${index+1}（楽器未確認）`, program: 1, transpose: current.transpose })
    }
    meta.querySelectorAll('part-abbreviation, part-name-display, part-abbreviation-display').forEach(el => el.remove())
  }
  return candidates
}
