import {eventStarts} from './geometry-report.js'
import {allStaves,locateSymbol,staffY} from './structure.js'
import {orderScorePart} from './instruments.js'

export const PERCUSSION={
  agogo:{name:'Agogô Bells',sound:'metal.bells.agogo',pitches:[67,68,54]},
  sleigh:{name:'Sleigh Bells',sound:'metal.bells.sleigh-bells',pitches:[83]},
  tambourine:{name:'Tambourine',sound:'drum.tambourine',pitches:[54]},
  drums:{name:'Drum Kit',sound:'drum.group.set',pitches:[36,38,42,45,47,49,50,51]},
}
const el=(doc,tag,text,attrs={})=>{const out=doc.createElement(tag);if(text!=null)out.textContent=text;for(const [k,v] of Object.entries(attrs))out.setAttribute(k,v);return out}
export function percussionKind(text) {
  if(/sleigh|jingle|s\.?\s*bells|スレイ|鈴/i.test(text))return 'sleigh'
  if(/agogo|agogô|アゴゴ/i.test(text))return 'agogo'
  if(/tambourine|タンバリン/i.test(text))return 'tambourine'
  if(/\b(?:drums?|drs)\b|ドラム/i.test(text))return 'drums'
  return null
}
export function findDrumStaffs(page, text) {
  return new Set((page.structure?.staves || []).filter((staff, index, staves) => {
    const top = index ? (staves[index - 1].bottom + staff.top) / 2 : staff.top - staff.spacing * 3
    const bottom = staves[index + 1] ? (staff.bottom + staves[index + 1].top) / 2 : staff.bottom + staff.spacing * 3
    return text.some(token => percussionKind(token.str) === 'drums' &&
      (token.instrumentStaff ? token.instrumentStaff === staff.id :
        token.x + token.w <= staff.left && token.y - token.h / 2 >= top && token.y - token.h / 2 < bottom))
  }).map(staff => staff.id))
}

// Keep the MusicXML cursor intact when a note on the other staff is removed.
function retainStaff(doc, part, number) {
  for (const note of part.querySelectorAll('measure > note')) {
    const staff = note.querySelector(':scope > staff')
    if (Number(staff?.textContent || 1) === number) {
      staff?.remove()
    } else {
      const duration = note.querySelector(':scope > duration')
      if (duration && !note.querySelector('chord, grace')) {
        const forward = el(doc, 'forward')
        forward.append(duration.cloneNode(true))
        note.replaceWith(forward)
      } else note.remove()
    }
  }
  part.querySelectorAll('attributes > staves, attributes > part-symbol').forEach(node => node.remove())
  for (const node of part.querySelectorAll('attributes > [number]')) {
    if (Number(node.getAttribute('number')) === number) node.removeAttribute('number')
    else node.remove()
  }
  for (const event of part.querySelectorAll('measure > direction, measure > harmony, measure > forward')) {
    const staff = event.querySelector(':scope > staff')
    if (staff && Number(staff.textContent) !== number && event.tagName !== 'forward') event.remove()
    else staff?.remove()
  }
}

// OCR identifies the drum lane independently of the recognizer's grand-staff grouping.
export function separateRecognizedDrums(doc, pages, labels) {
  const drumStaffs = pages.map((page, index) => findDrumStaffs(page, labels[index] || []))
  const drumParts = new Set()
  for (const part of [...doc.querySelectorAll('score-partwise > part')]) {
    const count = Number(part.querySelector('attributes > staves')?.textContent || 1)
    const votes = new Map()
    for (const note of part.querySelectorAll('note[id]')) {
      const match = /-p(\d+)-(\d+)-(\d+)$/.exec(note.id)
      if (!match || !drumStaffs[+match[1]]?.size) continue
      const location = locateSymbol(pages[+match[1]].structure, +match[2], +match[3])
      if (!location || location.ambiguous) continue
      const number = Number(note.querySelector('staff')?.textContent || 1)
      const vote = votes.get(number) || {hits: 0, total: 0}
      vote.total++
      if (drumStaffs[+match[1]].has(location.staff)) vote.hits++
      votes.set(number, vote)
    }
    const matches = [...votes].filter(([, vote]) => vote.hits >= 2 && vote.hits / vote.total >= .75)
    if (matches.length !== 1) continue
    if (count === 1) {
      drumParts.add(part.id)
      continue
    }
    if (count !== 2) continue
    const [[drumNumber]] = matches

    const drum = part.cloneNode(true)
    let id = part.id + '-drums'
    while (doc.getElementById(id) || [...doc.querySelectorAll('part')].some(node => node.id === id)) id += '-1'
    drum.id = id
    retainStaff(doc, drum, drumNumber)
    retainStaff(doc, part, 3 - drumNumber)
    drum.querySelectorAll('note > instrument').forEach(node => node.remove())
    const meta = [...doc.querySelectorAll('score-part')].find(node => node.id === part.id)
    const drumMeta = el(doc, 'score-part', null, {id})
    drumMeta.append(el(doc, 'part-name', 'Drum Kit'))
    if (drumNumber === 1) {
      meta.before(drumMeta)
      part.before(drum)
    } else {
      meta.after(drumMeta)
      part.after(drum)
    }
    drumParts.add(id)
    // A fabricated second staff may contain only unpositioned filler rests.
    if (!part.querySelector('note > pitch, note > unpitched') &&
        ![...part.querySelectorAll('note[id]')].some(note => /-p\d+-\d+-\d+$/.test(note.id))) {
      part.remove()
      meta.remove()
    }
  }
  return drumParts
}

export const drumPitch=step=>step<=2?36:step===3?45:step===4?47:step===5?38:step===6?50:step===7?51:step>=10?49:42
const setupField=meta=>meta.querySelector('miscellaneous-field[name="percussion-setup"]')
function setup(doc,meta,kind) {
  const preset=PERCUSSION[kind],identification=meta.querySelector('identification')||el(doc,'identification')
  let miscellaneous=identification.querySelector('miscellaneous');if(!miscellaneous){miscellaneous=el(doc,'miscellaneous');identification.append(miscellaneous)}
  let field=setupField(meta);if(!field){field=el(doc,'miscellaneous-field',null,{name:'percussion-setup'});miscellaneous.append(field)}field.textContent=kind
  meta.replaceChildren(identification,el(doc,'part-name',preset.name))
  for(const pitch of preset.pitches){const id=`${meta.id}-GM${pitch}`,instrument=el(doc,'score-instrument',null,{id});instrument.append(el(doc,'instrument-name',`${preset.name} ${pitch}`),el(doc,'instrument-sound',preset.sound));meta.append(instrument)}
  for(const pitch of preset.pitches){const midi=el(doc,'midi-instrument',null,{id:`${meta.id}-GM${pitch}`});midi.append(el(doc,'midi-channel',10),el(doc,'midi-program',1),el(doc,'midi-unpitched',pitch+1));meta.append(midi)}
  orderScorePart(meta)
}
function rest(doc,duration,id) {
  const fragment=doc.createDocumentFragment();let i=0
  for(const [value,type,dotted] of [[4,'whole'],[3,'half',true],[2,'half'],[1.5,'quarter',true],[1,'quarter'],[.75,'eighth',true],[.5,'eighth'],[.375,'16th',true],[.25,'16th'],[.125,'32nd']])while(duration>=value-.01){const note=el(doc,'note',null,{id:`${id}-${i++}`});note.append(el(doc,'rest'),el(doc,'duration',Math.round(value*16)),el(doc,'type',type));if(dotted)note.append(el(doc,'dot'));fragment.append(note);duration-=value}
  return fragment
}
function attributes(doc,beats=4,unit=4,lines=1) {
  const attr=el(doc,'attributes'),time=el(doc,'time'),clef=el(doc,'clef'),details=el(doc,'staff-details');time.append(el(doc,'beats',beats),el(doc,'beat-type',unit));clef.append(el(doc,'sign','percussion'));details.append(el(doc,'staff-lines',lines));attr.append(el(doc,'divisions',16),time,clef,details);return attr
}
function setUnpitched(doc,note,pitch,part,level='high') {
  note.querySelector(':scope > pitch, :scope > unpitched')?.remove()
  const position=typeof level==='number'?30+level:level==='low'?29:level==='center'?30:31
  const display=el(doc,'unpitched');display.append(el(doc,'display-step','CDEFGAB'[((position%7)+7)%7]),el(doc,'display-octave',Math.floor(position/7)))
  note.insertBefore(display,note.querySelector(':scope > duration'))
  note.querySelectorAll(':scope > instrument,:scope > accidental').forEach(n=>n.remove())
  note.insertBefore(el(doc,'instrument',null,{id:`${part.id}-GM${pitch}`}),note.querySelector(':scope > voice, :scope > type, :scope > stem, :scope > staff, :scope > notations'))
}

export function rhythmGrid(doc,structures) {
  const points=new Map(),starts=new Map()
  for(const part of doc.querySelectorAll('score-partwise > part')) {
    let divisions=1
    for(const [index,m] of [...part.querySelectorAll(':scope > measure')].entries()) {
      divisions=Number(m.querySelector('attributes > divisions')?.textContent||divisions)
      const children=[...m.children],onsets=eventStarts(children.map(n=>({kind:n.tagName,duration:Number(n.querySelector(':scope > duration')?.textContent||0),chord:!!n.querySelector('chord'),grace:!!n.querySelector('grace')})))
      for(const note of m.querySelectorAll(':scope > note[id]')) {
        const at=/-p(\d+)-(\d+)-(\d+)$/.exec(note.id);if(!at)continue
        const page=+at[1],x=+at[2],y=+at[3],location=locateSymbol(structures[page],x,y);if(!location)continue
        const offset=index-location.measure+1
        if(!starts.has(page))starts.set(page,[]);starts.get(page).push(offset)
        if(!note.querySelector('pitch'))continue
        const key=`${page}/${location.measure-1}`
        if(!points.has(key))points.set(key,[]);points.get(key).push({x,onset:onsets[children.indexOf(note)]/divisions})
      }
    }
  }
  const offsets=new Map([...starts].map(([page,values])=>{const counts=new Map();for(const v of values)counts.set(v,(counts.get(v)||0)+1);return [page,[...counts].sort((a,b)=>b[1]-a[1])[0][0]]}))
  // Full-score assembly already records the exact XML start of each page.
  // Adopt it only where the image and XML agree on the number of bars.
  try {
    const field = doc.querySelector('miscellaneous-field[name="page-measures-v1"]')
    for (const range of JSON.parse(field?.textContent || '[]')) {
      const staffs = structures[range.page]?.staves || []
      if (staffs.length && staffs.every(staff => staff.measureCount === range.count)) {
        offsets.set(range.page, range.start)
      }
    }
  } catch {}
  const onsetAt=(page,measure,x,spacing)=>{
    const samples=(points.get(`${page}/${measure}`)||[]).filter(p=>Number.isFinite(p.onset)&&p.onset>=0).sort((a,b)=>Math.abs(a.x-x)-Math.abs(b.x-x))
    if(!samples.length)return null
    const near=samples.filter(p=>Math.abs(p.x-x)<=spacing*.9)
    if(near.length){const counts=new Map();for(const p of near)counts.set(p.onset,(counts.get(p.onset)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1])[0][0]}
    const sorted=samples.sort((a,b)=>a.x-b.x),a=sorted.filter(p=>p.x<x).at(-1),b=sorted.find(p=>p.x>x)
    if(!a)return 0;if(!b)return a.onset
    return Math.round((a.onset+(b.onset-a.onset)*(x-a.x)/(b.x-a.x))/.25)*.25
  }
  return {offsets,onsetAt}
}

function repeatMeasure(doc,part,index,record,report) {
  const measures=[...part.querySelectorAll(':scope > measure')],measure=measures[index],previous=measures[index-1]
  const events = [...(previous?.children || [])].filter(child => ['note','backup','forward'].includes(child.tagName))
  const missing = events.some(event => /^(recognition-gap-|unread-)/.test(event.id))
  const usable = previous?.querySelector('note > pitch, note > unpitched, note > rest[measure="yes"]')
  const warn = reason => {
    report.warnings.push(`原稿${record.sourcePage ?? record.page + 1}ページ ${part.id} 第${measure?.getAttribute('number') || index + 1}小節：${reason}`)
    return false
  }
  if (!measure || !usable || missing) return warn('前小節の認識結果を確認できず、反復を保留しました')
  if (measure.querySelectorAll('note > pitch,note > unpitched').length > 1) {
    return warn('反復記号と認識済み音符が重なっています')
  }
  const divisionsAt = end => {
    let value = 1
    for (let i = 0; i <= end; i++) {
      for (const item of measures[i].querySelectorAll(':scope > attributes > divisions')) value = Number(item.textContent)
    }
    return value
  }
  const scale = divisionsAt(index) / divisionsAt(index - 1)
  const copies = events.map(event => event.cloneNode(true))
  if (!Number.isFinite(scale) || scale <= 0 || copies.some(event => {
    const duration = event.querySelector(':scope > duration')
    return duration && !Number.isInteger(Number(duration.textContent) * scale)
  })) return warn('前小節と音価の分解能が異なり、反復を保留しました')
  for (const child of [...measure.children]) if (['note','backup','forward'].includes(child.tagName)) child.remove()
  let count = 0
  const rightBar = measure.querySelector(':scope > barline[location="right"]')
  for (const copy of copies) {
    const duration = copy.querySelector(':scope > duration')
    if (duration) duration.textContent = Number(duration.textContent) * scale
    if (copy.tagName === 'note') copy.id = `repeat-${part.id}-${index}-${++count}`
    measure.insertBefore(copy, rightBar)
  }
  // MusicXML contains sounding notes as well as the measure-repeat engraving.
  let attr=measure.querySelector('attributes');if(!attr){attr=el(doc,'attributes');measure.prepend(attr)}
  const style=el(doc,'measure-style');style.append(el(doc,'measure-repeat',1,{type:'start'}));attr.append(style)
  const next=measures[index+1]
  if(next){let a=next.querySelector('attributes');if(!a){a=el(doc,'attributes');next.prepend(a)}const stop=el(doc,'measure-style');stop.append(el(doc,'measure-repeat',null,{type:'stop'}));a.append(stop)}
  report.repeats.push({...record,part:part.id,index,notes:count});return true
}

function rebuildDrumBar(doc, part, measure, divisions, heads, page) {
  for (const event of measure.querySelectorAll(':scope > note, :scope > backup, :scope > forward')) event.remove()
  const rightBar = measure.querySelector(':scope > barline[location="right"]')
  let index = 0
  function appendHit(position, pitch, voice, type, duration, beam) {
    const id = `drum-${part.id}-${measure.getAttribute('number')}-${++index}-p${page}-${position.x}-${position.y}`
    const note = el(doc, 'note', null, {id})
    note.append(el(doc, 'duration', duration), el(doc, 'voice', voice), el(doc, 'type', type))
    setUnpitched(doc, note, pitch, part, position.step)
    note.append(el(doc, 'stem', voice === 1 ? 'up' : 'down'))
    if ([42, 49].includes(pitch)) note.append(el(doc, 'notehead', 'x'))
    if (beam) for (const number of [1, 2]) note.append(el(doc, 'beam', beam, {number}))
    measure.insertBefore(note, rightBar)
  }
  for (const [slot, head] of heads.entries()) {
    const pitch = head.step === 5 ? 38 : head.step >= 9 ? 49 : 42
    const beam = ['begin', 'continue', 'continue', 'end'][slot % 4]
    appendHit(head, pitch, 1, '16th', divisions / 4, beam)
  }
  const backup = el(doc, 'backup')
  backup.append(el(doc, 'duration', divisions * 4))
  measure.insertBefore(backup, rightBar)
  for (const head of heads) {
    if (head.kick) appendHit(head.kick, 36, 2, 'quarter', divisions)
  }
}

export function applyPercussion(doc,pages,analyses,labels,drumParts=new Set()) {
  const structures=pages.map(p=>p.structure),grid=rhythmGrid(doc,structures),report={lanes:[],repeats:[],warnings:[]}
  analyses.forEach((analysis,page)=>{if(analysis?.error)report.warnings.push(`${page+1}ページ: 打楽器解析に失敗しました（${analysis.error}）`)})
  const maxMeasures=Math.max(0,...[...doc.querySelectorAll('score-partwise > part')].map(p=>p.querySelectorAll(':scope > measure').length))
  const beats=Number(doc.querySelector('part > measure attributes > time > beats')?.textContent||4),unit=Number(doc.querySelector('part > measure attributes > time > beat-type')?.textContent||4),quarters=beats*4/unit
  const referenceMeasures = [...(doc.querySelector('score-partwise > part')?.querySelectorAll(':scope > measure') || [])]
  const percParts=new Map()
  for(const [page,analysis] of analyses.entries())for(const [laneIndex,lane] of (analysis?.lanes||[]).entries()) {
    const staff=structures[page].percussionStaves.find(s=>s.id===lane.staff)
    const source=(labels[page]||[]).filter(t=>t.instrumentStaff===lane.staff).map(t=>t.str).join(' ')
    const kind=percussionKind(source)||percParts.get(laneIndex)?.kind
    if(!kind){report.warnings.push(`${page+1}ページ 一線譜${laneIndex+1}: 楽器名を確定できません`);continue}
    let entry=percParts.get(laneIndex)
    if(!entry) {
      let meta=[...doc.querySelectorAll('score-part')].find(m=>setupField(m)?.textContent===kind)
      let part=meta&&[...doc.querySelectorAll('score-partwise > part')].find(p=>p.id===meta.id)
      if(!meta){const id=`P${doc.querySelectorAll('score-part').length+1}`;meta=el(doc,'score-part',null,{id});doc.querySelector('part-list').append(meta);part=el(doc,'part',null,{id});doc.documentElement.append(part)}
      setup(doc,meta,kind);part.replaceChildren()
      for(let i=0;i<maxMeasures;i++){const m=el(doc,'measure',null,{number:i+1});if(!i)m.append(attributes(doc,beats,unit));m.append(rest(doc,quarters,`unread-${part.id}-${i}`));part.append(m)}
      entry={part,kind};percParts.set(laneIndex,entry)
    }
    const offset=grid.offsets.get(page);if(offset==null)continue
    for(const [measureIndex,data] of lane.measures.entries()) {
      const index=offset+measureIndex,m=entry.part.querySelectorAll(':scope > measure')[index];if(!m)continue
      if(data.repeat){repeatMeasure(doc,entry.part,index,{page,sourcePage:structures[page]?.sourcePage,staff:lane.staff,measure:measureIndex,x:(data.left+data.right)/2,y:staff.top},report);continue}
      m.querySelectorAll('note,backup,forward').forEach(n=>n.remove());let cursor=0,number=0
      // A complete beamed pattern supplies its own timing. Other parts' OMR
      // anchors can drift; they must not erase clearly detected percussion heads.
      const complete=Math.abs(data.notes.reduce((n,h)=>n+h.duration,0)-quarters)<.01
      for(const head of data.notes) {
        const reference=complete?cursor:grid.onsetAt(page,measureIndex,head.x,staff.spacing)
        const onset=Math.max(cursor,reference!=null&&reference<quarters?reference:cursor)
        if(onset<cursor-.125||onset>=quarters){report.warnings.push(`${entry.part.id} 第${index+1}小節: 音符時刻の確認が必要`);continue}
        if(onset>cursor+.05)m.append(rest(doc,onset-cursor,`gap-${entry.part.id}-${index}-${number}`))
        const duration=Math.min(head.duration,quarters-onset),note=el(doc,'note',null,{id:`perc-${entry.part.id}-${index}-${++number}-p${page}-${Math.round(head.x)}-${Math.round(head.y)}`})
        note.append(el(doc,'duration',Math.round(duration*16)),el(doc,'type',head.beamCount===3?'32nd':head.beamCount===2?'16th':head.beamCount===1?'eighth':'quarter'))
        if(head.dotted)note.append(el(doc,'dot'))
        const pitch=kind==='agogo'?(head.level==='high'?67:68):PERCUSSION[kind].pitches[0]
        setUnpitched(doc,note,pitch,entry.part,kind==='agogo'?head.level:'center');note.append(el(doc,'stem',head.stem));m.append(note);cursor=onset+duration
      }
      if(cursor<quarters-.05)m.append(rest(doc,quarters-cursor,`end-${entry.part.id}-${index}`))
      report.lanes.push({page,staff:lane.staff,kind,part:entry.part.id,measure:measureIndex,notes:number})
    }
  }
  // Apply simile marks only to identified percussion parts, never to a pitched
  // whole note or rest which happens to resemble the same image template.
  for(const part of doc.querySelectorAll('score-partwise > part')) {
    const meta=[...doc.querySelectorAll('score-part')].find(m=>m.id===part.id)
    if(!drumParts.has(part.id)&&percussionKind(meta.querySelector('part-name')?.textContent||'')!=='drums')continue
    setup(doc,meta,'drums')
    for(const note of part.querySelectorAll('note[id]')) {
      if(!note.querySelector('pitch'))continue
      const at=/-p(\d+)-(\d+)-(\d+)$/.exec(note.id);if(!at)continue
      const staff=allStaves(structures[+at[1]]).find(s=>s.id===locateSymbol(structures[+at[1]],+at[2],+at[3])?.staff)
      if(staff){const step=Math.round((staffY(staff,+at[2])-Number(at[3]))/(staff.spacing/2));setUnpitched(doc,note,drumPitch(step),part,step)}
    }
    const measures = [...part.querySelectorAll(':scope > measure')]
    for (const [page, analysis] of analyses.entries()) {
      const offset = grid.offsets.get(page)
      if (offset == null) continue
      for (const bar of analysis?.drumBars || []) {
        const index = offset + bar.measure
        const measure = measures[index]
        if (!measure) continue
        const anchored = [...measure.querySelectorAll('note[id]')].some(note => {
          const at = /-p(\d+)-(\d+)-(\d+)$/.exec(note.id)
          return at && +at[1] === page && locateSymbol(structures[page], +at[2], +at[3])?.staff === bar.staff
        })
        if (!anchored && !drumParts.has(part.id)) continue
        const attrs = measures.slice(0, index + 1).flatMap(m => [...m.querySelectorAll('attributes')])
        const divisions = Number(attrs.map(a => a.querySelector('divisions')).filter(Boolean).at(-1)?.textContent || 1)
        const time = referenceMeasures.slice(0, index + 1).flatMap(m => [...m.querySelectorAll('attributes > time')]).at(-1)
        const meter = time ? [time.querySelector('beats')?.textContent, time.querySelector('beat-type')?.textContent] : [String(beats), String(unit)]
        if (meter.join('/') !== '4/4' || divisions % 4 !== 0) continue
        rebuildDrumBar(doc, part, measure, divisions, bar.heads, page)
        report.lanes.push({page, staff: bar.staff, kind: 'drums', part: part.id, measure: bar.measure, notes: bar.heads.length})
      }
    }
    for(const [page,analysis] of analyses.entries())for(const record of analysis?.repeats||[]) {
      const offset=grid.offsets.get(page);if(offset==null)continue
      const measure=part.querySelectorAll(':scope > measure')[offset+record.measure]
      const positions=[...(measure?.querySelectorAll('note[id]')||[])].map(n=>/-p(\d+)-(\d+)-(\d+)$/.exec(n.id)).filter(Boolean)
      if(positions.some(at=>+at[1]===page&&locateSymbol(structures[page],+at[2],+at[3])?.staff===record.staff))repeatMeasure(doc,part,offset+record.measure,{...record,page,sourcePage:structures[page]?.sourcePage},report)
    }
    part.querySelectorAll('attributes > clef, attributes > key, attributes > transpose, attributes > time').forEach(n=>n.remove())
    const first=part.querySelector('measure > attributes');if(first){const clef=el(doc,'clef'),time=el(doc,'time');time.append(el(doc,'beats',beats),el(doc,'beat-type',unit));clef.append(el(doc,'sign','percussion'));first.append(time,clef);const rank=['divisions','key','time','staves','part-symbol','instruments','clef','staff-details','transpose','measure-style'];for(const c of [...first.children].sort((a,b)=>rank.indexOf(a.tagName)-rank.indexOf(b.tagName)))first.append(c)}
  }
  let identification=doc.querySelector('score-partwise > identification');if(!identification){identification=el(doc,'identification');doc.documentElement.insertBefore(identification,doc.querySelector('part-list'))}
  let misc=identification.querySelector('miscellaneous');if(!misc){misc=el(doc,'miscellaneous');identification.append(misc)}
  let field=misc.querySelector('miscellaneous-field[name="percussion-analysis-v1"]');if(!field){field=el(doc,'miscellaneous-field',null,{name:'percussion-analysis-v1'});misc.append(field)}field.textContent=JSON.stringify(report)
  return report
}
