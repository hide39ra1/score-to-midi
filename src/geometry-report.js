import {locateSymbol,staffY} from './structure.js'
const fieldName='image-structure-v1'
export function eventStarts(events) {
  let cursor=0,previous=0
  return events.map(event=>{
    const duration=Number.isFinite(event.duration)?event.duration:0
    if(event.kind==='backup') {cursor-=duration;return null}
    if(event.kind==='forward') {cursor+=duration;return null}
    if(event.kind!=='note') return null
    const onset=event.chord?previous:cursor
    if(!event.chord) {previous=cursor;if(!event.grace) cursor+=duration}
    return onset
  })
}
export function readGeometry(doc) {
  try {return JSON.parse(doc.querySelector(`miscellaneous-field[name="${fieldName}"]`)?.textContent||'[]')} catch {return []}
}
export function storeGeometry(doc,structures) {
  let identification=doc.querySelector('score-partwise > identification')
  if(!identification) {identification=doc.createElement('identification');const root=doc.documentElement;root.insertBefore(identification,root.querySelector('defaults,part-list,part'))}
  let miscellaneous=identification.querySelector('miscellaneous')
  if(!miscellaneous) {miscellaneous=doc.createElement('miscellaneous');identification.append(miscellaneous)}
  let field=miscellaneous.querySelector(`miscellaneous-field[name="${fieldName}"]`)
  if(!field) {field=doc.createElement('miscellaneous-field');field.setAttribute('name',fieldName);miscellaneous.append(field)}
  field.textContent=JSON.stringify(structures)
}
export function staffLayout(doc) {
  let original=[]
  try {original=JSON.parse(doc.querySelector('miscellaneous-field[name="staff-layout"]')?.textContent||'[]')} catch {}
  const geometry=readGeometry(doc)
  return Array.from({length:Math.max(original.length,geometry.length)},(_,i)=>geometry[i]?.staves?.length ? geometry[i].staves.map(s=>[s.left,staffY(s,s.left,0),s.right,staffY(s,s.left,4),s.system]) : original[i]||[])
}
export function inspectGeometry(doc,structures=readGeometry(doc)) {
  const symbols=[],warnings=[],byPart=new Map(),observed=new Map()
  for(const part of doc.querySelectorAll('score-partwise > part')) {
    let divisions=1
    for(const [measureIndex,measure] of [...part.querySelectorAll(':scope > measure')].entries()) {
      divisions=Number(measure.querySelector('attributes > divisions')?.textContent||divisions)
      const elements=[...measure.children]
      const starts=eventStarts(elements.map(el=>({kind:el.tagName,duration:Number(el.querySelector(':scope > duration')?.textContent||0),chord:!!el.querySelector(':scope > chord'),grace:!!el.querySelector(':scope > grace')})))
      for(const note of measure.querySelectorAll(':scope > note')) {
        const at=/-p(\d+)-(\d+)-(\d+)$/.exec(note.id||'')
        if(!at) continue
        const page=Number(at[1]),x=Number(at[2]),y=Number(at[3]),structure=structures[page]
        if(!structure?.staves?.length) continue
        const location=locateSymbol(structure,x,y)
        const symbol={id:note.id,part:part.id,page,x,y,kind:note.querySelector(':scope > rest')?'rest':'note',type:note.querySelector(':scope > type')?.textContent||null,
          pitch:note.querySelector(':scope > pitch')?{step:note.querySelector('pitch > step')?.textContent,alter:Number(note.querySelector('pitch > alter')?.textContent||0),octave:Number(note.querySelector('pitch > octave')?.textContent)}:null,
          onset:starts[elements.indexOf(note)],divisions,duration:Number(note.querySelector(':scope > duration')?.textContent||0),voice:note.querySelector(':scope > voice')?.textContent||'1',chord:!!note.querySelector(':scope > chord'),tieStart:!!note.querySelector('tie[type="start"]'),tieStop:!!note.querySelector('tie[type="stop"]'),xmlMeasure:measure.getAttribute('number'),measureIndex,...location}
        symbols.push(symbol)
        if(!location) continue
        const key=`${part.id}/${page}/${location.system}`
        if(!byPart.has(key)) byPart.set(key,[])
        byPart.get(key).push(symbol)
        if(!location.ambiguous) observed.set(`${page}/${location.staff}`,true)
      }
    }
  }
  for(const entries of byPart.values()) {
    const reliable=entries.filter(s=>!s.nearBar&&!s.ambiguous)
    if(!reliable.length) continue
    const offsets=new Map()
    for(const s of reliable) {const offset=s.measureIndex-s.measure;offsets.set(offset,(offsets.get(offset)||0)+1)}
    const offset=[...offsets].sort((a,b)=>b[1]-a[1])[0][0]
    const wrong=reliable.filter(s=>s.measureIndex-s.measure!==offset)
    if(wrong.length) warnings.push({kind:'measure-position',part:entries[0].part,page:entries[0].page,ids:wrong.map(s=>s.id),message:`${entries[0].part}：画像の小節位置と認識結果が${wrong.length}記号で一致しません`})
    const expected=Math.max(...entries.map(s=>structures[s.page].staves.find(staff=>staff.id===s.staff).measureCount))
    const count=new Set(entries.map(s=>s.measureIndex)).size
    if(count!==expected) warnings.push({kind:'measure-count',part:entries[0].part,page:entries[0].page,message:`${entries[0].part}：画像${expected}小節／認識${count}小節（部分小節・誤検出を含む確認候補）`})
  }
  structures.forEach((structure,page)=>{
    for(const staff of structure?.staves||[]) if(!observed.has(`${page}/${staff.id}`)) warnings.push({kind:'unread-staff',page,sourcePage:structure.sourcePage||page+1,staff:staff.id,message:`原稿${structure.sourcePage||page+1}ページの第${staff.id}五線に対応する音符・休符がありません`})
  })
  symbols.sort((a,b)=>a.page-b.page||(a.system??0)-(b.system??0)||(a.measure??0)-(b.measure??0)||a.x-b.x||a.y-b.y)
  const metadata=name=>{try{return JSON.parse(doc.querySelector(`miscellaneous-field[name="${name}"]`)?.textContent||'[]')}catch{return []}}
  return {version:1,source:'image-geometry + homr symbol anchors',structures,symbols,warnings,recognitionReview:metadata('recognition-review-v1'),staffRecovery:metadata('staff-recovery-v1')}
}
