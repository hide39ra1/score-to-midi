import {staffLayout} from './geometry-report.js'

export const DYNAMICS = ['pppp','ppp','pp','p','mp','mf','f','ff','fff','ffff','sf','sfz','sffz','fp','sfp','rfz','fz']
export const MARKS = {staccato:'スタッカート',accent:'アクセント',tenuto:'テヌート','strong-accent':'マルカート',staccatissimo:'スタッカティッシモ',fermata:'フェルマータ','breath-mark':'ブレス','trill-mark':'トリル',mordent:'モルデント',turn:'ターン',arpeggiate:'アルペジオ'}
const ornament = new Set(['trill-mark','mordent','turn'])
const make = (doc,tag,text) => { const el=doc.createElement(tag);if(text!=null)el.textContent=text;return el }
const beforeNote = note => note.parentNode
function notation(note) {
  let el=note.querySelector(':scope > notations')
  if(!el){el=make(note.ownerDocument,'notations');note.insertBefore(el,note.querySelector(':scope > lyric, :scope > play, :scope > listen'))}
  return el
}
export function normalizeSymbolStructure(doc) {
  for(const el of doc.querySelectorAll('notations > articulations > mordent')) {
    const old=el.parentNode,parent=old.parentNode
    let ornaments=parent.querySelector('ornaments')
    if(!ornaments){ornaments=make(doc,'ornaments');parent.append(ornaments)}
    ornaments.append(el);if(!old.children.length)old.remove()
  }
}
export function toggleMark(note,tag) {
  if(!MARKS[tag]||!note.querySelector('pitch,unpitched')) return false
  const container=notation(note),existing=container.querySelector(tag)
  if(existing){const parent=existing.parentNode;existing.remove();if(parent!==container&&!parent.children.length)parent.remove();return true}
  let parent=container
  const group=ornament.has(tag)?'ornaments':!['fermata','arpeggiate'].includes(tag)?'articulations':null
  if(group){parent=container.querySelector(group);if(!parent){parent=make(note.ownerDocument,group);container.append(parent)}}
  const el=make(note.ownerDocument,tag);if(tag==='strong-accent')el.setAttribute('type','up');parent.append(el);return true
}

export function parseMeter(beats,beatType) {
  if(!/^\d{1,2}(?:\+\d{1,2})*$/.test(String(beats)))return null
  const values=String(beats).split('+').map(Number),den=Number(beatType)
  return values.every(n=>n>0&&n<=32)&&[1,2,4,8,16,32,64].includes(den)?{beats:String(beats),beatType:den}:null
}
export function attributeContext(note) {
  const result={clef:'G2',fifths:0,beats:'4',beatType:4},staff=note.querySelector('staff')?.textContent||'1'
  for(const measure of note.closest('part').querySelectorAll(':scope > measure')) {
    for(const attr of measure.querySelectorAll(':scope > attributes'))for(const el of attr.children) {
      if(el.hasAttribute('number')&&el.getAttribute('number')!==staff)continue
      if(el.tagName==='key')result.fifths=Number(el.querySelector('fifths')?.textContent||0)
      if(el.tagName==='time'){result.beats=el.querySelector('beats')?.textContent||result.beats;result.beatType=Number(el.querySelector('beat-type')?.textContent||result.beatType)}
      if(el.tagName==='clef')result.clef=(el.querySelector('sign')?.textContent||'G')+(el.querySelector('line')?.textContent||'')
    }
    if(measure===note.closest('measure'))break
  }
  return result
}
export function setAttributes(note,{clef,fifths,beats,beatType}) {
  const meter=parseMeter(beats,beatType),key=Number(fifths)
  if(!meter||!Number.isInteger(key)||Math.abs(key)>7||!['G2','F4','C3','C4','percussion'].includes(clef))return false
  const doc=note.ownerDocument,measure=note.closest('measure'),staff=note.querySelector('staff')?.textContent||'1'
  const multi=Number(note.closest('part').querySelector('staves')?.textContent||1)>1
  let attr=measure.querySelector(':scope > attributes')
  if(!attr){attr=make(doc,'attributes');measure.insertBefore(attr,measure.firstChild)}
  for(const tag of ['clef','key','time']) {
    attr.querySelectorAll(':scope > '+tag).forEach(el=>{if(el.getAttribute('number')===staff||!multi&&!el.hasAttribute('number'))el.remove()})
    const el=make(doc,tag);if(staff!=='1'||Number(note.closest('part').querySelector('staves')?.textContent||1)>1)el.setAttribute('number',staff)
    if(tag==='key')el.append(make(doc,'fifths',key))
    if(tag==='time')el.append(make(doc,'beats',meter.beats),make(doc,'beat-type',meter.beatType))
    if(tag==='clef'){el.append(make(doc,'sign',clef==='percussion'?'percussion':clef[0]));if(clef!=='percussion')el.append(make(doc,'line',clef[1]))}
    attr.append(el)
  }
  const order=['footnote','level','divisions','key','time','staves','part-symbol','instruments','clef','staff-details','transpose','for-part','directive','measure-style']
  for(const el of [...attr.children].sort((a,b)=>order.indexOf(a.tagName)-order.indexOf(b.tagName)))attr.append(el)
  return true
}

export function connectSpan(start,end,kind) {
  if(!start||!end||start===end||start.closest('part')!==end.closest('part')||(start.querySelector('staff')?.textContent||'1')!==(end.querySelector('staff')?.textContent||'1')||!['slur','crescendo','diminuendo'].includes(kind))return false
  const notes=[...start.closest('part').querySelectorAll('note')]
  const chordRoot=note=>{while(note.querySelector(':scope > chord')&&note.previousElementSibling?.tagName==='note')note=note.previousElementSibling;return note}
  if(chordRoot(start)===chordRoot(end))return false
  if(notes.indexOf(start)>=notes.indexOf(end))return false
  if(kind==='slur'&&(!start.querySelector('pitch,unpitched')||!end.querySelector('pitch,unpitched')||(start.querySelector('voice')?.textContent||'1')!==(end.querySelector('voice')?.textContent||'1')))return false
  const tag=kind==='slur'?'slur':'wedge',used=new Set([...start.closest('part').querySelectorAll(tag)].map(el=>Number(el.getAttribute('number')||1)))
  let number=1;while(used.has(number)&&number<=16)number++;if(number>16)return false
  for(const [note,type] of [[start,kind==='slur'?'start':kind],[end,'stop']]) {
    const doc=note.ownerDocument,el=make(doc,tag);el.setAttribute('type',type);el.setAttribute('number',number)
    if(kind==='slur')notation(note).append(el)
    else {const direction=make(doc,'direction');direction.setAttribute('placement','below');const dt=make(doc,'direction-type');dt.append(el);direction.append(dt,make(doc,'staff',note.querySelector('staff')?.textContent||'1'));note.parentNode.insertBefore(direction,note)}
  }
  return true
}

export function classifyDirection(text) {
  const value=text.trim().replace(/\s+/g,' '),compact=value.replace(/\s/g,'')
  if(DYNAMICS.includes(compact)) return {kind:'dynamic',value:compact}
  if(/^(?:cresc(?:endo)?|decresc(?:endo)?|dim(?:inuendo)?|rit(?:ardando)?|rall(?:entando)?|accel(?:erando)?|a tempo|pizz(?:icato)?|arco|dolce|espress(?:ivo)?|cantabile|legato|marcato|simile|subito(?: p| f)?|D\.\s*C\.|D\.\s*S\.|Fine|To Coda)\.?$/i.test(value)) return {kind:'words',value}
  return null
}

export function addDirection(note,kind,value,{placement='below',automatic=false}={}) {
  if(!note || (kind==='dynamic'&&!DYNAMICS.includes(value)) || !['dynamic','words'].includes(kind) || !value.trim())return false
  const doc=note.ownerDocument,staff=note.querySelector(':scope > staff')?.textContent||'1'
  // Only directions at this onset and staff count as duplicates, not earlier dynamics.
  for(let prev=note.previousElementSibling;prev&&prev.tagName!=='note'&&prev.tagName!=='backup'&&prev.tagName!=='forward';prev=prev.previousElementSibling) {
    if(prev.tagName!=='direction'||(prev.querySelector('staff')?.textContent||'1')!==staff)continue
    const same=kind==='dynamic'?prev.querySelector('dynamics > '+value):[...prev.querySelectorAll('words')].some(w=>w.textContent===value)
    if(same)return false
    if(automatic&&kind==='dynamic'&&prev.querySelector('dynamics'))return false
  }
  const direction=make(doc,'direction');direction.setAttribute('placement',placement)
  const type=make(doc,'direction-type');direction.append(type)
  if(kind==='dynamic'){const dynamic=make(doc,'dynamics');dynamic.append(make(doc,value));type.append(dynamic)}else type.append(make(doc,'words',value))
  direction.append(make(doc,'staff',staff));beforeNote(note).insertBefore(direction,note);return true
}

export function annotateDirections(doc,text) {
  const layout=staffLayout(doc),notes=[...doc.querySelectorAll('note[id]')],added=[]
  for(const [page,items] of text.entries()) for(const item of items) {
    const mark=classifyDirection(item.str)
    if(!mark||item.confidence!=null&&item.confidence<75)continue
    const staves=layout[page]||[],y=item.y-item.h*.4,x=item.x+item.w/2
    const nearest=staves.map((s,i)=>({s,i,d:Math.max(s[1]-y,y-s[3],0)})).filter(({s})=>x>=s[0]&&x<=s[2]).sort((a,b)=>a.d-b.d)[0]
    if(!nearest)continue
    const {s,i,d}=nearest,space=(s[3]-s[1])/4
    // Text inside the five lines is often a misread note, never auto-apply it.
    if(y>=s[1]&&y<=s[3]||d>space*4||item.h>space*3||item.h<space*.5)continue
    const anchors=notes.map(note=>({note,at:/-p(\d+)-(\d+)-(\d+)$/.exec(note.id)})).filter(({at})=>at&&+at[1]===page&&Math.max(s[1]-Number(at[3]),Number(at[3])-s[3],0)<space*4)
      .filter(({at})=>{const ny=+at[3];return staves.reduce((best,t,j)=>Math.max(t[1]-ny,ny-t[3],0)<Math.max(staves[best][1]-ny,ny-staves[best][3],0)?j:best,0)===i})
      .sort((a,b)=>Math.abs(+a.at[2]-x)-Math.abs(+b.at[2]-x))
    const anchor=anchors[0]
    if(anchor&&Math.abs(+anchor.at[2]-x)<space*5&&addDirection(anchor.note,mark.kind,mark.value,{placement:y<s[1]?'above':'below',automatic:true}))added.push({id:anchor.note.id,...mark})
  }
  return added
}

export function listNoteSymbols(note) {
  if(!note)return []
  const out=[]
  for(const [tag,label] of Object.entries(MARKS))if(note.querySelector('notations '+tag))out.push({label,element:note.querySelector('notations '+tag)})
  for(const el of note.querySelectorAll('notations > slur'))out.push({label:`スラー ${el.getAttribute('type')} #${el.getAttribute('number')||1}`,element:el})
  for(let el=note.previousElementSibling;el&&!['note','backup','forward'].includes(el.tagName);el=el.previousElementSibling)if(el.tagName==='direction'&&(el.querySelector('staff')?.textContent||'1')===(note.querySelector('staff')?.textContent||'1')) {
    const label=el.querySelector('dynamics')?.textContent||el.querySelector('dynamics')?.firstElementChild?.tagName||el.querySelector('words')?.textContent||el.querySelector('wedge')?.getAttribute('type')
    if(label)out.push({label,element:el})
  }
  return out
}

export function inspectSymbols(doc) {
  const counts={},warnings=[]
  for(const tag of ['clef','key','time','dynamics','wedge','slur','repeat',...Object.keys(MARKS)])counts[tag]=doc.querySelectorAll(tag).length
  for(const part of doc.querySelectorAll('score-partwise > part')) {
    const spans=new Map()
    for(const el of part.querySelectorAll('slur,wedge')) {
      const type=el.getAttribute('type'),key=el.tagName+'/'+(el.getAttribute('number')||'1')+'/'+(el.closest('note')?.querySelector('staff')?.textContent||el.closest('direction')?.querySelector('staff')?.textContent||'1')
      if(['start','crescendo','diminuendo'].includes(type)){if(spans.has(key))warnings.push(`${part.id}: ${el.tagName}の開始が重複`);spans.set(key,el)}
      else if(type==='stop'){if(!spans.delete(key))warnings.push(`${part.id}: ${el.tagName}の終端に対応する開始がありません`)}
    }
    for(const key of spans.keys())warnings.push(`${part.id}: ${key.split('/')[0]}の終端がありません`)
  }
  return {counts,warnings}
}

// Connected components outside the staff distinguish compact staccato dots
// from long stems/tenuto strokes. Evidence is reviewable, never an auto-edit.
export function findStaccatoDots({ink,width,height},{x,y,spacing:s,top,bottom}) {
  const left=Math.max(0,Math.floor(x-s)),right=Math.min(width-1,Math.ceil(x+s)),lo=Math.max(0,Math.floor(Math.min(y,top)-s*4)),hi=Math.min(height-1,Math.ceil(Math.max(y,bottom)+s*4))
  const visited=new Set(),dots=[]
  for(let cy=lo;cy<=hi;cy++)for(let cx=left;cx<=right;cx++) {
    const start=cy*width+cx
    if(!ink[start]||visited.has(start))continue
    const queue=[[cx,cy]];visited.add(start);let minX=cx,maxX=cx,minY=cy,maxY=cy,n=0
    for(let i=0;i<queue.length;i++) {
      const [px,py]=queue[i];n++;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py)
      for(const [nx,ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]])if(nx>=left&&nx<=right&&ny>=lo&&ny<=hi) {const key=ny*width+nx;if(ink[key]&&!visited.has(key)){visited.add(key);queue.push([nx,ny])}}
    }
    const w=maxX-minX+1,h=maxY-minY+1,midX=(minX+maxX)/2,midY=(minY+maxY)/2
    if(minX===left||maxX===right||minY===lo||maxY===hi)continue
    if(w<s*.15||h<s*.15||w>s*.65||h>s*.65||w/h<.55||w/h>1.8||n/(w*h)<.5||n<2)continue
    if(Math.abs(midX-x)>s*.55||Math.abs(midY-y)<s*.9||Math.abs(midY-y)>s*5)continue
    if(midY>top-s*.35&&midY<bottom+s*.35)continue
    dots.push({x:midX,y:midY})
  }
  return dots
}

export function symbolReview(doc,value) {
  let field=doc.querySelector('miscellaneous-field[name="symbol-review-v1"]')
  if(value===undefined){try{return JSON.parse(field?.textContent||'[]')}catch{return []}}
  let identification=doc.querySelector('identification')
  if(!identification){identification=make(doc,'identification');doc.documentElement.insertBefore(identification,doc.querySelector('defaults,part-list,part'))}
  let miscellaneous=identification.querySelector('miscellaneous')
  if(!miscellaneous){miscellaneous=make(doc,'miscellaneous');identification.append(miscellaneous)}
  if(!field){field=make(doc,'miscellaneous-field');field.setAttribute('name','symbol-review-v1');miscellaneous.append(field)}
  field.textContent=JSON.stringify(value)
}
