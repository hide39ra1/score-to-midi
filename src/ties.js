import {eventStarts} from './geometry-report.js'

export function adjacentTiePairs(events) {
  const voices=new Map(),pairs=[]
  for(const event of events) {
    const key=`${event.part}/${event.voice}/${event.staff}`
    if(!voices.has(key)) voices.set(key,[])
    voices.get(key).push(event)
  }
  for(const notes of voices.values()) {
    const groups=[]
    for(const note of notes.sort((a,b)=>a.onset-b.onset)) {
      const last=groups.at(-1)
      if(last&&Math.abs(last[0].onset-note.onset)<1e-6) last.push(note);else groups.push([note])
    }
    for(let i=1;i<groups.length;i++) for(const a of groups[i-1]) for(const b of groups[i]) {
      if(a.pitch&&a.pitch===b.pitch&&Math.abs(a.end-b.onset)<1e-6) pairs.push({a,b})
    }
  }
  return pairs
}

export function collectTiePairs(doc) {
  const events=[]
  for(const part of doc.querySelectorAll('score-partwise > part')) {
    let divisions=1,base=0
    for(const measure of part.querySelectorAll(':scope > measure')) {
      divisions=Number(measure.querySelector('attributes > divisions')?.textContent||divisions)
      const elements=[...measure.children],raw=elements.map(el=>({kind:el.tagName,duration:Number(el.querySelector(':scope > duration')?.textContent||0),chord:!!el.querySelector(':scope > chord'),grace:!!el.querySelector(':scope > grace')})),starts=eventStarts(raw)
      let length=0
      elements.forEach((note,i)=>{
        if(note.tagName!=='note'||raw[i].grace) return
        const onset=base+(starts[i]||0)/divisions,end=onset+raw[i].duration/divisions
        length=Math.max(length,end-base)
        const at=/-p(\d+)-(\d+)-(\d+)$/.exec(note.id||''),pitch=note.querySelector(':scope > pitch')
        events.push({id:note.id,part:part.id,voice:note.querySelector(':scope > voice')?.textContent||'1',staff:note.querySelector(':scope > staff')?.textContent||'1',onset,end,
          pitch:pitch?`${pitch.querySelector('step')?.textContent}/${pitch.querySelector('alter')?.textContent||0}/${pitch.querySelector('octave')?.textContent}`:null,
          page:at?Number(at[1]):null,x:at?Number(at[2]):null,y:at?Number(at[3]):null,tied:!!note.querySelector(':scope > tie[type="start"], :scope > notations > tied[type="start"]'),tieStop:!!note.querySelector(':scope > tie[type="stop"], :scope > notations > tied[type="stop"]'),slurStart:!!note.querySelector('slur[type="start"]'),slurStop:!!note.querySelector('slur[type="stop"]')})
      })
      base+=length
    }
  }
  return adjacentTiePairs(events)
}

export function normalizeTies(doc) {
  const pairs=collectTiePairs(doc),notes=[...doc.querySelectorAll('note[id]')]
  let repaired=0
  for(const {a,b} of pairs) {
    const start=notes.find(n=>n.id===a.id),end=notes.find(n=>n.id===b.id)
    const sound=start.querySelector(':scope > tie[type="start"]')&&end.querySelector(':scope > tie[type="stop"]')
    const written=start.querySelector('notations > tied[type="start"]')&&end.querySelector('notations > tied[type="stop"]')
    const slur=a.slurStart&&b.slurStop
    if(sound||written||slur) {
      if(!sound||!written) repaired++
      setTie(doc,a.id,b.id,true)
      if(slur) {start.querySelector('slur[type="start"]')?.remove();end.querySelector('slur[type="stop"]')?.remove()}
    }
  }
  return repaired
}
export function inspectTies(doc) {
  const pairs=collectTiePairs(doc).filter(p=>p.a.tied&&p.b.tieStop),validStarts=new Set(pairs.map(p=>p.a.id)),validStops=new Set(pairs.map(p=>p.b.id))
  const warnings=[]
  for(const note of doc.querySelectorAll('note[id]')) {
    if(note.querySelector('tie[type="start"],tied[type="start"]')&&!validStarts.has(note.id)) warnings.push(note.id)
    if(note.querySelector('tie[type="stop"],tied[type="stop"]')&&!validStops.has(note.id)) warnings.push(note.id)
  }
  return {pairs:pairs.length,slurs:doc.querySelectorAll('slur[type="start"]').length,warnings:[...new Set(warnings)]}
}
export function tieCandidates(doc,values) {
  let field=doc.querySelector('miscellaneous-field[name="image-tie-candidates-v1"]')
  if(values===undefined) {try{return JSON.parse(field?.textContent||'[]')}catch{return []}}
  let identification=doc.querySelector('identification')
  if(!identification) {identification=doc.createElement('identification');doc.documentElement.insertBefore(identification,doc.querySelector('defaults,part-list,part'))}
  let miscellaneous=identification.querySelector('miscellaneous')
  if(!miscellaneous){miscellaneous=doc.createElement('miscellaneous');identification.append(miscellaneous)}
  if(!field){field=doc.createElement('miscellaneous-field');field.setAttribute('name','image-tie-candidates-v1');miscellaneous.append(field)}
  field.textContent=JSON.stringify(values)
}

export function setTie(doc,startId,endId,enabled=true) {
  const notes=[...doc.querySelectorAll('note[id]')]
  for(const [id,type] of [[startId,'start'],[endId,'stop']]) {
    const note=notes.find(n=>n.id===id);if(!note) continue
    note.querySelectorAll(`:scope > tie[type="${type}"], :scope > notations > tied[type="${type}"]`).forEach(el=>el.remove())
    if(!enabled) continue
    const sound=doc.createElement('tie');sound.setAttribute('type',type)
    const duration=note.querySelector(':scope > duration')
    note.insertBefore(sound,duration?.nextSibling||note.firstChild)
    let notation=note.querySelector(':scope > notations')
    if(!notation) {notation=doc.createElement('notations');note.insertBefore(notation,note.querySelector(':scope > lyric, :scope > play, :scope > listen'))}
    const tied=doc.createElement('tied');tied.setAttribute('type',type);notation.prepend(tied)
  }
}

// A quadratic arc must be visible between adjacent equal-pitch notes. Staff
// strokes are masked; a straight beam or repeated notes alone are not evidence.
export function detectTieArc({ink,width,height},pair,spacing,staffLines=[]) {
  const {a,b}=pair,span=b.x-a.x
  if(span<spacing*2||span>spacing*40||Math.abs(a.y-b.y)>spacing*1.6) return null
  const pixel=(x,y)=>{x=Math.round(x);y=Math.round(y);return x>=0&&y>=0&&x<width&&y<height?ink[y*width+x]:0}
  const visible=(x,y)=>{
    if(staffLines.some(line=>Math.abs(y-line)<1.2)) return null
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) if(pixel(x+dx,y+dy)) return true
    return false
  }
  let best=null
  for(const side of [-1,1]) for(const offset of [.4,.8,1.2,1.6,2]) for(const rise of [.5,.9,1.3,1.8,2.3]) {
    let hits=0,total=0,flatHits=0,flatTotal=0,gap=0,maxGap=0
    for(let i=2;i<=28;i++) {
      const t=i/30,x=a.x+span*t,baseline=a.y+(b.y-a.y)*t+side*offset*spacing,y=baseline+side*rise*spacing*4*t*(1-t)
      const value=visible(x,y),flat=visible(x,baseline)
      if(flat!==null) {flatTotal++;if(flat) flatHits++}
      if(value===null) continue
      total++;if(value) {hits++;gap=0}else {gap++;maxGap=Math.max(maxGap,gap)}
    }
    const score=hits/(total||1),flatScore=flatHits/(flatTotal||1)
    if(total>=15&&score>=.85&&score-flatScore>=.18&&maxGap<=3&&(!best||score>best.score)) best={startId:a.id,endId:b.id,x1:a.x,y1:a.y+side*offset*spacing,x2:b.x,y2:b.y+side*offset*spacing,controlX:(a.x+b.x)/2,controlY:(a.y+b.y)/2+side*(offset+2*rise)*spacing,score,source:'image-arc'}
  }
  return best
}
