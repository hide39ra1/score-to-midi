import {allStaves,staffY} from './structure.js'
const runs=values=>{const out=[];for(const v of values){const last=out.at(-1);if(last&&v<=last.at(-1)+1)last.push(v);else out.push([v])}return out}
const sample=(b,x,y)=>{x=Math.round(x);y=Math.round(y);return x>=0&&x<b.width&&y>=0&&y<b.height?b.ink[y*b.width+x]:0}

export function detectMeasureRepeat(binary,staff,left,right,{first=false}={}) {
  const s=staff.spacing,mid=(left+right)/2,cy=(staffY(staff,mid,0)+staffY(staff,mid))/2
  const isLine=(x,y)=>staff.lines.some((_,i)=>Math.abs(y-staffY(staff,x,i))<=Math.max(.7,s*.12))
  const ink=(x,y)=>!isLine(x,y)&&sample(binary,x,y)
  function dot(x,y) {
    const seen=new Set(),queue=[]
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(ink(x+dx,y+dy))queue.push([Math.round(x+dx),Math.round(y+dy)])
    if(!queue.length)return false
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity
    for(let i=0;i<queue.length;i++) {
      const [px,py]=queue[i],key=py*binary.width+px;if(seen.has(key))continue;seen.add(key)
      minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py)
      if(maxX-minX>s*.65||maxY-minY>s*.65||seen.size>s*s*.4)return false
      for(const [nx,ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]])if(!seen.has(ny*binary.width+nx)&&ink(nx,ny))queue.push([nx,ny])
    }
    return seen.size>=1&&Math.abs((minX+maxX)/2-x)<s*.35&&Math.abs((minY+maxY)/2-y)<s*.35
  }
  for(let dx=-s;dx<=(first?Math.max(s,(right-left)*.18):s);dx+=Math.max(1,s*.25))for(let dy=-s*.7;dy<=s*.7;dy+=Math.max(1,s*.25)) {
    const x=mid+dx,y=cy+dy
    for (const offset of [.45,.65,.85]) for (const rise of [.45,.65,.85]) {
      if(!dot(x-s*offset,y-s*rise)||!dot(x+s*offset,y+s*rise))continue
      let hits=0,total=0
      for(let i=-8;i<=8;i++) {const px=x+i*s*.085,py=y-i*s*.085;if(isLine(px,py))continue;total++;if([-1,0,1].some(d=>sample(binary,px+d,py)))hits++}
      if(total>=5&&hits/total>=.8)return {x,y,confidence:hits/total}
    }
  }
  return null
}

export function detectOneLineNotes(binary,staff,left,right) {
  const s=staff.spacing,candidates=[]
  for(let x=Math.ceil(left+s);x<right-s;x++) {
    const line=staffY(staff,x,0)
    for(let y=Math.floor(line-s*.85);y<=line+s*.85;y++) {
      let hits=0,total=0
      for(let dx=-Math.floor(s*.6);dx<=s*.6;dx++)for(let dy=-Math.floor(s*.35);dy<=s*.35;dy++) {
        if((dx/(s*.6))**2+(dy/(s*.35))**2>1||Math.abs(y+dy-line)<Math.max(.7,s*.12))continue
        total++;hits+=sample(binary,x+dx,y+dy)
      }
      if(total>=5&&hits/total>.78)candidates.push({x,y,score:hits/total})
    }
  }
  const heads=[]
  for(const head of candidates.sort((a,b)=>b.score-a.score))if(!heads.some(h=>Math.abs(h.x-head.x)<s&&Math.abs(h.y-head.y)<s*.9))heads.push(head)
  heads.sort((a,b)=>a.x-b.x)
  return heads.map(head=>{
    let best=0,stemSide=1,bestStem=0,accepted=false
    for(const side of [-1,1])for(const offset of [-1,-.8,-.6,-.4,.4,.6,.8,1]) {
      const sx=head.x+s*offset
      let stemHits=0,stemTotal=0
      for(let d=Math.ceil(s);d<s*2.8;d++){stemTotal++;if([-1,0,1].some(dx=>sample(binary,sx+dx,head.y+side*d)))stemHits++}
      const stemScore=stemHits/(stemTotal||1)
      if(stemScore<.75&&side<0)continue
      const ys=[],flagRows=[]
      for(let d=Math.ceil(s*1.2);d<s*4.6;d++) {
        const y=head.y+side*d
        let longest=0
        for(const direction of [-1,1]){let hits=0;for(let dx=1;dx<s*1.2;dx++)if(sample(binary,sx+direction*dx,y))hits++;longest=Math.max(longest,hits)}
        if(longest>s*.8)ys.push(d)
        if(longest>s*.4)flagRows.push(d)
      }
      let count=runs(ys).filter(run=>run.length<=s*.9).length
      if(!count)count=Math.min(2,runs(flagRows).filter(run=>run.length<=s*1.3).length)
      if(stemScore<.75&&!count)continue
      if(count<=3&&(!accepted||stemScore>bestStem||stemScore===bestStem&&count>best)){best=count;stemSide=side;bestStem=stemScore;accepted=true}
    }
    const line=staffY(staff,head.x,0)
    let dotted=false
    for(let x=Math.ceil(head.x+s*.8);x<head.x+s*1.9&&!dotted;x++)for(let y=Math.floor(head.y-s*.7);y<=head.y+s*.7;y++) {
      if(Math.abs(y-line)<Math.max(1,s*.3)||!sample(binary,x,y))continue
      let area=0,minX=x,maxX=x,minY=y,maxY=y;const seen=new Set(),queue=[[x,y]]
      for(let i=0;i<queue.length&&area<s*s*.4;i++){const [px,py]=queue[i],key=py*binary.width+px;if(seen.has(key)||!sample(binary,px,py)||Math.abs(py-line)<Math.max(1,s*.3))continue;seen.add(key);area++;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);if(maxX-minX>s*.55||maxY-minY>s*.55)break;queue.push([px-1,py],[px+1,py],[px,py-1],[px,py+1])}
      if(area>=2&&area<s*s*.3&&maxX-minX<s*.5&&maxY-minY<s*.5)dotted=true
    }
    return accepted?{...head,beamCount:best,duration:(best?1/(2**best):1)*(dotted?1.5:1),dotted,stem:stemSide<0?'up':'down',level:head.y<line?'high':'low',weakStem:bestStem<.75}:null
  }).filter(Boolean)
}

// A whole-measure rest on a one-line staff is a short rectangle immediately
// below the line, with no other ink in the central portion of the measure.
export function detectOneLineMeasureRest(binary, staff, left, right, first = false) {
  const spacing = staff.spacing
  const mid = (left + right) / 2
  const start = Math.ceil(mid - spacing * 2)
  const end = Math.floor(mid + ((right-left) * (first ? .18 : .12)))
  const candidates = []
  for (let x = start; x <= end; x++) {
    const line = staffY(staff, x, 0)
    if ([.23, .36].every(offset => sample(binary, x, line + spacing * offset))) candidates.push(x)
  }
  for (const run of runs(candidates)) {
    if (run.length < spacing * .65 || run.length > spacing * 1.8) continue
    const x = run[Math.floor(run.length / 2)]
    const y = staffY(staff, x, 0)
    let outside = 0
    for (let col = Math.ceil(left + (right-left) * .23); col < right - spacing * 3; col++) {
      const line = staffY(staff, col, 0)
      for (let row = Math.round(line - spacing * 2); row <= line + spacing * 2; row++) {
        if (Math.abs(row - line) <= 1.1) continue
        if (col >= run[0] - 1 && col <= run.at(-1) + 1 && row > line && row < line + spacing * .65) continue
        outside += sample(binary, col, row)
      }
    }
    if (outside <= spacing * 2.5) return {x, y}
  }
  return null
}

export function analyzePercussion(binary,structure,drumStaffs=[]) {
  const lanes=[],repeats=[],drumBars=[]
  for(const staff of allStaves(structure)) {
    const measures=[]
    for(let i=0;i<staff.boundaries.length-1;i++) {
      const left=staff.boundaries[i],right=staff.boundaries[i+1],repeat=detectMeasureRepeat(binary,staff,left,right,{first:i===0})
      if(repeat)repeats.push({...repeat,staff:staff.id,measure:i})
      if (!repeat && drumStaffs.includes(staff.id)) {
        const heads = detectDrumSixteenths(binary, staff, left, right)
        if (heads) drumBars.push({staff: staff.id, measure: i, heads})
      }
      if (staff.lineCount === 1) {
        const notes = repeat ? [] : detectOneLineNotes(binary, staff, left, right)
        const wholeRest = !repeat && !notes.length ? detectOneLineMeasureRest(binary, staff, left, right, i === 0) : null
        measures.push({left, right, repeat: !!repeat, notes, wholeRest})
      }
    }
    if(staff.lineCount===1)lanes.push({staff:staff.id,measures})
  }
  return {lanes,repeats,drumBars}
}

// Recover a bar of continuous sixteenths only when both the cross heads and
// their two beams are visible. Each sixteenth is one slot, even with kick/snare.
export function detectDrumSixteenths(binary, staff, left, right) {
  const spacing = staff.spacing
  const radius = Math.max(2, Math.round(spacing * .33))
  const candidates = []
  for (let x = Math.ceil(left + spacing); x < right - spacing; x++) {
    for (const step of [5, 7, 8, 9, 10]) {
      const y = Math.round(staffY(staff, x) - step * spacing / 2)
      let diagonal = 0
      let outside = 0
      for (const vertical of [-1, 1]) for (const horizontal of [-1, 1]) {
        if (sample(binary, x + horizontal * radius, y + vertical * radius) ||
            sample(binary, x + horizontal * radius, y + vertical * (radius - 1))) diagonal++
        outside += sample(binary, x + horizontal * (radius + 1), y + vertical * (radius - 1))
      }
      const snare = step === 5
      if (!sample(binary, x, y) || (snare
        ? ![-radius, radius].every(dx => sample(binary, x + dx, y)) || !sample(binary, x, y + 1)
        : diagonal < 3 || outside > 3)) continue
      const beams = []
      for (const shift of [0, 1, 2, 3, 4]) for (const side of [-1, 1]) {
        const stem = x + shift
        const levels = []
        for (let row = y - Math.round(spacing * 4.5); row < y - spacing * 1.5; row++) {
          if ([1, 2, 3].every(n => sample(binary, stem + side * n, row))) levels.push(row)
        }
        const groups = runs(levels)
        if (groups.length === 2 &&
            groups.every(group => group.length <= spacing * .65) &&
            groups[1][0] - groups[0][0] <= spacing * .9) {
          const stemInk = Array.from({length: Math.floor(spacing)}, (_, n) =>
            [-1, 0, 1].some(dx => sample(binary, stem + dx, y - radius - n))).filter(Boolean).length
          if (stemInk >= Math.floor(spacing) * .8) beams.push(groups[0][0])
        }
      }
      if (beams.length) candidates.push({x, y, step, score: snare ? 2 : diagonal - outside, beam: beams[0]})
    }
  }
  const heads = []
  for (const head of candidates.sort((a, b) => b.score - a.score)) {
    if (!heads.some(other => Math.abs(other.x - head.x) < spacing * .85)) heads.push(head)
  }
  heads.sort((a, b) => a.x - b.x)
  if (heads.length !== 16) return null
  const gaps = heads.slice(1).map((head, i) => head.x - heads[i].x)
  if (Math.max(...gaps) > Math.min(...gaps) * 2.4) return null

  const filled = (head, step) => {
    const y = Math.round(staffY(staff, head.x) - step * spacing / 2)
    const horizontal = Math.max(2, Math.round(spacing * .36))
    for (const dx of [0, 1, -1, 2, -2, 3, -3]) {
      const x = head.x + dx
      if ([-horizontal, 0, horizontal].every(offset => sample(binary, x + offset, y)) &&
          [-1, 1].every(dy => sample(binary, x, y + dy))) return {x, y, step}
    }
    return null
  }
  const beats = heads.map((head, index) => ({
    ...head, kick: index % 4 === 0 ? filled(head, 1) : null,
  }))
  return beats.filter(head => head.kick).length === 4 ? beats : null
}
