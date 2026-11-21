// Independent image geometry. Coordinates are always in original-page pixels.
// Five equally spaced horizontal traces define a staff. A barline must cover
// the spaces between them, not merely intersect the five horizontal strokes.
const median = values => { const a = [...values].sort((a,b)=>a-b); return a.length ? a[a.length>>1] : 0 }
const groupRuns = values => {
  const groups=[]
  for(const value of values) { const last=groups.at(-1); if(last && value<=last.at(-1)+1) last.push(value); else groups.push([value]) }
  return groups
}

export function binarize({data,width,height}) {
  const histogram=new Uint32Array(256), gray=new Uint8Array(width*height)
  for(let i=0;i<gray.length;i++) { const at=i*4; gray[i]=Math.round((data[at]*.299+data[at+1]*.587+data[at+2]*.114)*(data[at+3]/255)+255*(1-data[at+3]/255)); histogram[gray[i]]++ }
  let totalSum=0; for(let i=0;i<256;i++) totalSum+=i*histogram[i]
  let background=0,sum=0,best=-1,threshold=128
  for(let t=0;t<255;t++) {
    background+=histogram[t]; sum+=t*histogram[t]
    const foreground=gray.length-background
    if(!background || !foreground) continue
    const difference=sum/background-(totalSum-sum)/foreground
    const variance=background*foreground*difference*difference
    if(variance>best) { best=variance;threshold=t }
  }
  return {width,height,ink:Uint8Array.from(gray,value=>value<=threshold?1:0),threshold}
}

export function analyzeBinary({ink,width,height}, {fullScore=false, scale=1}={}) {
  const mid=width/2
  const pixel=(x,y)=> { x=Math.round(x);y=Math.round(y);return x>=0&&y>=0&&x<width&&y<height ? ink[y*width+x] : 0 }
  // Estimate skew by maximizing long horizontal projections. Sampling bounds
  // the work; the final line and barline tests use the complete image.
  const dots=[]
  for(let y=0;y<height;y++) for(let x=0;x<width;x+=4) if(ink[y*width+x]) dots.push([x,y])
  let slope=0,bestScore=-1
  for(let step=-16;step<=16;step++) {
    const candidate=Math.tan(step*.125*Math.PI/180), projection=new Uint32Array(height)
    for(const [x,y] of dots) {const at=Math.round(y-candidate*(x-mid));if(at>=0&&at<height) projection[at]++}
    let score=0;for(const value of projection) if(value>width*.04) score+=value*value
    if(score>bestScore) {bestScore=score;slope=candidate}
  }
  const projection=new Uint32Array(height)
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) if(ink[y*width+x]) {
    const at=Math.round(y-slope*(x-mid));if(at>=0&&at<height) projection[at]++
  }
  const maximum=Math.max(0,...projection)
  const peaks=groupRuns([...projection.keys()].filter(y=>projection[y]>=Math.max(width*.23,maximum*.42))).map(run=>({ y:run.reduce((n,y)=>n+y*projection[y],0)/run.reduce((n,y)=>n+projection[y],0),thickness:run.length,strength:Math.max(...run.map(y=>projection[y])) }))
  const claimed=new Set(), staves=[]
  for(let i=0;i<peaks.length;i++) {
    if(claimed.has(i)) continue
    let chosen=null
    for(let j=i+1;j<Math.min(i+5,peaks.length);j++) {
      const spacing=peaks[j].y-peaks[i].y
      if(spacing<3 || spacing>Math.max(20,height*.025)) continue
      const indices=[i,j]
      for(let line=2;line<5;line++) {
        const expected=peaks[i].y+spacing*line
        const match=peaks.findIndex((p,k)=>k>indices.at(-1)&&!claimed.has(k)&&Math.abs(p.y-expected)<=Math.max(1.2,spacing*.16))
        if(match<0) break
        indices.push(match)
      }
      if(indices.length===5) {
        const error=indices.reduce((n,k,line)=>n+Math.abs(peaks[k].y-peaks[i].y-line*spacing),0)
        if(!chosen||error<chosen.error) chosen={indices,spacing,error}
      }
    }
    if(!chosen) continue
    const rows=chosen.indices.map(k=>peaks[k].y), spacing=(rows[4]-rows[0])/4
    const thickness=median(chosen.indices.map(k=>peaks[k].thickness))
    const sample=(x,y)=>pixel(x,y+slope*(x-mid))
    const near=(x,y,r=1)=> {for(let dy=-r;dy<=r;dy++) if(sample(x,y+dy)) return true;return false}
    const support=[]
    for(let x=0;x<width;x++) if(rows.filter(y=>near(x,y,Math.max(1,Math.ceil(thickness/2)))).length>=4) support.push(x)
    // Join interruptions made by noteheads, scanning damage, and tiny breaks.
    const spans=[]
    for(const x of support) {const last=spans.at(-1);if(last&&x-last[1]<=spacing*2) last[1]=x;else spans.push([x,x])}
    const span=spans.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0]
    if(!span||span[1]-span[0]<width*.23) continue
    chosen.indices.forEach(k=>claimed.add(k))
    const [left,right]=span, traces=[]
    for(const row of rows) {
      const trace=[]
      for(let x=left;x<=right;x+=Math.max(16,Math.round((right-left)/20))) {
        let refined=row,best=-1
        for(let dy=-Math.floor(spacing*.25);dy<=Math.floor(spacing*.25);dy++) {
          let value=0;for(let dx=-10;dx<=10;dx++) value+=sample(x+dx,row+dy)
          if(value>best) {best=value;refined=row+dy}
        }
        trace.push([x/scale,(refined+slope*(x-mid))/scale])
      }
      trace.push([right/scale,(row+slope*(right-mid))/scale]);traces.push(trace)
    }
    const barColumns=[]
    for(let x=left;x<=right;x++) {
      let count=0,total=0,gap=0,longestGap=0,wide=0
      for(let y=Math.ceil(rows[0]);y<=Math.floor(rows[4]);y++) {
        if(rows.some(row=>Math.abs(row-y)<=Math.max(1,thickness))) continue
        total++
        const present=near(x,y,0)||near(x-1,y,0)||near(x+1,y,0)
        if(present) {count++;gap=0} else {gap++;longestGap=Math.max(gap,longestGap)}
        // A stem attached to a notehead is not a barline. Exclude the staff
        // rows above; otherwise every horizontal staff line looks like a head.
      }
      for(let y=Math.floor(rows[0]-spacing*1.5);y<=Math.ceil(rows[4]+spacing*1.5);y++) {
        if(rows.some(row=>Math.abs(row-y)<=Math.max(1,thickness))) continue
        const center=[x,x-1,x+1].find(cx=>sample(cx,y))
        if(center===undefined) continue
        let a=center,b=center
        while(a>center-spacing*1.5&&sample(a-1,y)) a--
        while(b<center+spacing*1.5&&sample(b+1,y)) b++
        if(b-a+1>=spacing*.85) wide++
      }
      if(total&&count/total>=.88&&longestGap<=Math.max(2,spacing*.4)&&wide<=Math.max(1,spacing*.12)) barColumns.push(x)
    }
    const strokes=groupRuns(barColumns).map(run=>({x:(run[0]+run.at(-1))/2,width:run.length})).filter(s=>s.width<spacing*.85)
    const bars=[]
    for(const stroke of strokes) {
      const last=bars.at(-1)
      if(last&&stroke.x-last.lastX<spacing*.8) {last.x=(last.x*last.strokes+stroke.x)/(last.strokes+1);last.lastX=stroke.x;last.strokes++;last.width+=stroke.width}
      else bars.push({...stroke,lastX:stroke.x,strokes:1})
    }
    staves.push({id:staves.length+1,left:left/scale,right:right/scale,top:(rows[0]+slope*(left-mid))/scale,bottom:(rows[4]+slope*(left-mid))/scale,spacing:spacing/scale,lines:traces,
      bars:bars.map(bar=>({x:bar.x/scale,top:(rows[0]+slope*(bar.x-mid))/scale,bottom:(rows[4]+slope*(bar.x-mid))/scale,type:bar.strokes>1?'double':bar.width>thickness*1.7?'thick':'single',confidence:.88})),confidence:Math.max(.5,1-chosen.error/(spacing*5))})
  }
  // Candidate barlines repeated in other staves have stronger evidence than a
  // single tall stem. Keep uncorroborated lines visible as candidates.
  let system=0
  for(let i=0;i<staves.length;i++) {
    const staff=staves[i], previous=staves[i-1]
    if(!fullScore&&previous&&staff.top-previous.bottom>staff.spacing*10) system++
    staff.system=system
    for(const bar of staff.bars) {
      bar.support=staves.filter(other=>other!==staff&&other.bars.some(b=>Math.abs(b.x-bar.x)<staff.spacing*.55)).length+1
      bar.confidence=bar.support>1?.98:.88
    }
    // Image edges are boundaries even when the first barline is not printed.
    staff.boundaries=[staff.left,...staff.bars.map(b=>b.x).filter(x=>x>staff.left+staff.spacing*2&&x<staff.right-staff.spacing*2),staff.right]
    staff.measureCount=staff.boundaries.length-1
  }
  for(const systemId of new Set(staves.map(s=>s.system))) {
    const group=staves.filter(s=>s.system===systemId)
    const required=group.length>=3?Math.max(2,Math.ceil(group.length*.35)):group.length
    const left=median(group.map(s=>s.left)),right=median(group.map(s=>s.right)),spacing=median(group.map(s=>s.spacing))
    const grid=[]
    for(const bar of group.flatMap(s=>s.bars).filter(b=>b.support>=required&&b.x>left+spacing*3&&b.x<right-spacing*3).sort((a,b)=>a.x-b.x)) {
      if(!grid.length||bar.x-grid.at(-1)>spacing*.7) grid.push(bar.x)
    }
    for(const staff of group) {
      staff.boundaries=[Math.max(staff.left,left-spacing),...grid.filter(x=>x>staff.left+spacing&&x<staff.right-spacing),staff.right]
      staff.measureCount=staff.boundaries.length-1
      for(const bar of staff.bars) bar.accepted=grid.some(x=>Math.abs(x-bar.x)<spacing*.7)||bar.x<left+spacing*3||bar.x>right-spacing*3
      staff.inferredBars=grid.filter(x=>!staff.bars.some(bar=>Math.abs(bar.x-x)<spacing*.7))
    }
  }
  return {version:1,width:width/scale,height:height/scale,skewDegrees:Math.atan(slope)*180/Math.PI,staves}
}

export function staffY(staff,x,line=4) {
  const points=staff.lines[line]
  const right=points.findIndex(p=>p[0]>=x)
  if(right<0) return points.at(-1)[1]
  if(right<=0) return points[Math.max(0,right)][1]
  const a=points[right-1],b=points[right]
  return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]||1)
}

export function locateSymbol(structure,x,y) {
  const options=structure.staves.filter(s=>x>=s.left-s.spacing&&x<=s.right+s.spacing).map(staff=>{
    const top=staffY(staff,x,0),bottom=staffY(staff,x)
    return {staff,distance:Math.max(top-y,y-bottom,0),top,bottom}
  }).sort((a,b)=>a.distance-b.distance)
  if(!options.length||options[0].distance>options[0].staff.spacing*4) return null
  const {staff,bottom,distance}=options[0]
  const measure=Math.min(staff.measureCount,Math.max(1,staff.boundaries.findIndex(boundary=>boundary>x)))
  return {staff:staff.id,system:staff.system,measure,staffStep:Math.round((bottom-y)/(staff.spacing/2)),nearBar:staff.bars.some(bar=>Math.abs(x-bar.x)<staff.spacing*.5),ambiguous:distance>staff.spacing*2||!!options[1]&&Math.abs(options[1].distance-distance)<staff.spacing*.3}
}
