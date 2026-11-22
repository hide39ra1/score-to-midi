// GM programs are MusicXML's 1-based values. Transposition is sounding minus written pitch.
import { melodicRoute } from './midi.js'
import {staffLayout} from './geometry-report.js'
import {MUSESCORE_INSTRUMENTS} from './musescore.js'
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
  ['drums','ドラムセット',1,0],['agogo','アゴゴ',1,0],['sleigh','スレイベル',1,0],['tambourine','タンバリン',1,0],
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

// Alternative parts list real choices in print order. Use the first as a visible
// provisional assignment, rather than silently turning every ambiguous part into piano.
export function preferredInstrument(text) {
  const candidates=identifyInstruments(text)
  const words={soprano:'soprano',alto:'alto',tenor:'tenor',baritone:'baritone',bass:'(?:string|double)\\s*bass',bassclarinet:'bass\\s*clarinet',horn:'horn'}
  return candidates.map(id=>{const japanese=INSTRUMENTS.find(row=>row[0]===id)[1].replace(/^[^ァ-ヶ一-龥]+/u,'').replace(/（.*$/,'');return {id,index:Math.min(...[new RegExp(words[id]||id,'i').exec(text)?.index,text.indexOf(japanese)].filter(i=>i!=null&&i>=0),Infinity)}}).sort((a,b)=>a.index-b.index)[0]?.id||null
}

export function preferFocusedLabel(full,focused) {
  const found=identifyInstruments(focused).length
  return found>0&&found>=identifyInstruments(full).length||/drums|agogo|tambourine|sleigh\s*bells/i.test(focused)
}

export function inferredTranspose(id,writtenFifths,concertFifths) {
  const expected=INSTRUMENTS.find(row=>row[0]===id)?.[3]
  if(expected==null||!Number.isFinite(writtenFifths)||!Number.isFinite(concertFifths))return null
  const mod=n=>((n%12)+12)%12
  if(mod(writtenFifths*7+expected)===mod(concertFifths*7))return expected
  if(mod(writtenFifths*7)===mod(concertFifths*7))return 0
  return null
}

export function partStaffIndex(part,staffs,page) {
  const count=Math.max(1,Number(part.querySelector('staves')?.textContent||1)),votes=new Map()
  for(const note of part.querySelectorAll('note[id]')) {
    const at=/-p(\d+)-(\d+)-(\d+)$/.exec(note.id)
    if(!at||+at[1]!==page)continue
    const y=+at[3],nearest=staffs.map((s,i)=>({i,d:Math.max(s[1]-y,y-s[3],0)})).sort((a,b)=>a.d-b.d)[0]
    if(nearest)votes.set(nearest.i,(votes.get(nearest.i)||0)+1)
  }
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]).slice(0,count)
  return ranked.length?Math.min(...ranked.map(([i])=>i)):null
}

const set = (doc, parent, tag, text) => {
  let el = [...parent.children].find(x => x.tagName === tag)
  if (!el) { el = doc.createElement(tag); parent.append(el) }
  el.textContent = text
  return el
}

// MusicXML requires metadata before MIDI routing, including after repeated edits.
export function orderScorePart(meta) {
  const order = ['identification','part-link','part-name','part-name-display','part-abbreviation','part-abbreviation-display','group','score-instrument','midi-device','midi-instrument']
  for (const child of [...meta.children].sort((a,b) => order.indexOf(a.tagName)-order.indexOf(b.tagName))) meta.append(child)
}

export function partSettings(doc) {
  return [...doc.querySelectorAll('part-list > score-part')].map((meta, index) => {
    const part = [...doc.querySelectorAll('score-partwise > part')].find(p => p.id === meta.id)
    const shift = part?.querySelector('transpose')
    return { id: meta.id, name: meta.querySelector('part-name')?.textContent || `パート ${index+1}`,
      sourceLabel:meta.querySelector('miscellaneous-field[name="instrument-label"]')?.textContent||meta.querySelector('part-name')?.textContent||'',
      instrumentId:Object.entries(MUSESCORE_INSTRUMENTS).find(([,v])=>v[1]===meta.querySelector('instrument-sound')?.textContent)?.[0]||null,
      percussion:!!meta.querySelector('midi-unpitched'),
      program: Number(meta.querySelector('midi-program')?.textContent || 1),
      transpose: Number(shift?.querySelector('chromatic')?.textContent || 0) + 12 * Number(shift?.querySelector('octave-change')?.textContent || 0) }
  })
}

export function routeParts(doc) {
  for (const [index,meta] of [...doc.querySelectorAll('part-list > score-part')].entries()) {
    const midi = meta.querySelector('midi-instrument')
    if (!midi) continue
    const route = melodicRoute(index),percussion=!!meta.querySelector('midi-unpitched')
    meta.querySelectorAll('midi-device').forEach(el => el.remove())
    const device = doc.createElement('midi-device'); device.setAttribute('port',route.port+1); device.id = midi.id
    meta.insertBefore(device,midi)
    for(const instrument of meta.querySelectorAll('midi-instrument')){const channel=set(doc,instrument,'midi-channel',percussion?10:route.channel+1);instrument.insertBefore(channel,instrument.firstChild)}
    orderScorePart(meta)
  }
}

export function applyPartSettings(doc, id, {name, program, transpose,instrumentId}) {
  const meta = [...doc.querySelectorAll('part-list > score-part')].find(p => p.id === id)
  const part = [...doc.querySelectorAll('score-partwise > part')].find(p => p.id === id)
  if (!meta || !part) return
  set(doc, meta, 'part-name', name.trim() || id)
  // Renaming a percussion part must preserve all of its GM instrument IDs.
  if(meta.querySelector('midi-unpitched')) {orderScorePart(meta);return}
  meta.querySelectorAll('part-name-display, part-abbreviation, part-abbreviation-display').forEach(el => el.remove())
  let instrument = meta.querySelector('score-instrument')
  if (!instrument) { instrument = doc.createElement('score-instrument'); instrument.id = `${id}-instrument`; meta.append(instrument) }
  const guesses=identifyInstruments(name)
  const preset=MUSESCORE_INSTRUMENTS[instrumentId]||(guesses.length===1?MUSESCORE_INSTRUMENTS[guesses[0]]:null)
  set(doc, instrument, 'instrument-name', preset?.[0]||name.trim() || id)
  instrument.querySelectorAll('instrument-sound').forEach(el => el.remove())
  if(preset) {
    set(doc,instrument,'instrument-sound',preset[1])
    const abbreviation=set(doc,meta,'part-abbreviation',preset[2]);meta.insertBefore(abbreviation,instrument)
  }
  // Keep the MusicXML child order: score-instrument before midi-instrument.
  let midi = meta.querySelector('midi-instrument')
  if (!midi) { midi = doc.createElement('midi-instrument'); meta.append(midi) }
  meta.insertBefore(instrument, midi)
  midi.id = instrument.id
  set(doc, midi, 'midi-program', Math.max(1, Math.min(128, Math.round(program) || 1)))
  orderScorePart(meta)
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
  const layout = staffLayout(doc)
  const candidates = new Map()
  for (const [index, meta] of [...doc.querySelectorAll('part-list > score-part')].entries()) {
    const part = [...doc.querySelectorAll('score-partwise > part')].find(p => p.id === meta.id)
    const note = [...(part?.querySelectorAll('note[id]') || [])].map(n => /-p(\d+)-(\d+)-(\d+)$/.exec(n.id)).find(Boolean)
    let label = ''
    if (note) {
      const page = Number(note[1]), y = Number(note[3]), staffs = layout[page] || []
      const staffIndex=partStaffIndex(part,staffs,page)
      const nearest=staffIndex==null?null:{s:staffs[staffIndex],i:staffIndex}
      if (nearest) {
        const { s,i } = nearest
        const count = Math.max(1, Number(part.querySelector('attributes > staves')?.textContent || 1))
        const last = Math.min(i + count - 1, staffs.length - 1)
        const top = i ? (staffs[i-1][3]+s[1])/2 : s[1]-(s[3]-s[1])
        const bottom = staffs[last+1] ? (staffs[last][3]+staffs[last+1][1])/2 : staffs[last][3]+(s[3]-s[1])
        const focused=(text[page]||[]).filter(t=>t.instrumentStaff>=i+1&&t.instrumentStaff<=last+1)
        const focusedText=focused.map(t=>t.str).join(' ')
        const inRegion=t=>t.x+t.w<s[0]+(s[3]-s[1])/4&&t.y-t.h/2>top&&t.y-t.h/2<bottom
        const full=(text[page]||[]).filter(t=>!t.instrumentStaff&&inRegion(t))
        const useFocused=preferFocusedLabel(full.map(t=>t.str).join(' '),focusedText)
        const source=useFocused?focused:full
        const words = source.filter(inRegion).sort((a,b) => Math.abs(a.y-b.y)>Math.max(a.h,b.h)*0.6 ? a.y-b.y : a.x-b.x)
        const raw = words.map(t => t.str).join(' ')
        if (identifyInstruments(raw).length || /drums|agogo|tambourine|sleigh\s*bells|打楽器/i.test(raw)) label = raw
      }
    }
    // An OMR-generated Piano label is also a guess, not evidence of instrument identity.
    if (label) {
      set(doc, meta, 'part-name', label); candidates.set(meta.id, label)
      let identification=meta.querySelector(':scope > identification')
      if(!identification){identification=doc.createElement('identification');meta.prepend(identification)}
      let miscellaneous=identification.querySelector('miscellaneous')
      if(!miscellaneous){miscellaneous=doc.createElement('miscellaneous');identification.append(miscellaneous)}
      let source=miscellaneous.querySelector('miscellaneous-field[name="instrument-label"]')
      if(!source){source=doc.createElement('miscellaneous-field');source.setAttribute('name','instrument-label');miscellaneous.append(source)}
      source.textContent=label
      const guessed = identifyInstruments(label)
      const preferred=preferredInstrument(label)
      const current = partSettings(doc).find(p => p.id === meta.id)
      applyPartSettings(doc, meta.id, { name: MUSESCORE_INSTRUMENTS[preferred]?.[0]||label, instrumentId:preferred, program: preferred ? INSTRUMENTS.find(x => x[0] === preferred)[2] : current.program, transpose: current.transpose })
    }
    else if ((preservePiano ? /^voice$/i : /^(voice|piano)$/i).test(meta.querySelector('part-name')?.textContent?.trim() || '')) {
      const current = partSettings(doc).find(p => p.id === meta.id)
      applyPartSettings(doc, meta.id, { name: `パート ${index+1}（楽器未確認）`, program: 1, transpose: current.transpose })
    }
    meta.querySelectorAll('part-abbreviation, part-name-display, part-abbreviation-display').forEach(el => el.remove())
  }
  if(text.some(page=>page.length)) {
    const reference=new Map()
    for(const setting of partSettings(doc)) {
      const id=setting.instrumentId,known=INSTRUMENTS.find(row=>row[0]===id)
      const part=[...doc.querySelectorAll('score-partwise > part')].find(p=>p.id===setting.id)
      const key=part.querySelector('key > fifths')
      if(known&&known[3]===0&&key)reference.set(Number(key.textContent),(reference.get(Number(key.textContent))||0)+1)
    }
    const ranked=[...reference].sort((a,b)=>b[1]-a[1])
    if(ranked[0]&&(!ranked[1]||ranked[0][1]>ranked[1][1]))for(const setting of partSettings(doc)) {
      const part=[...doc.querySelectorAll('score-partwise > part')].find(p=>p.id===setting.id),key=part.querySelector('key > fifths')
      const amount=key?inferredTranspose(setting.instrumentId,Number(key.textContent),ranked[0][0]):null
      if(amount!=null)applyPartSettings(doc,setting.id,{...setting,transpose:amount})
    }
  }
  return candidates
}
