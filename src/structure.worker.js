import {binarize,analyzeBinary} from './structure.js'
import {detectTieArc} from './ties.js'
import {staffY,locateSymbol} from './structure.js'
import {findStaccatoDots} from './symbols.js'
self.onmessage=async ({data})=>{
  try {
    const bitmap=await createImageBitmap(new Blob([data.png],{type:'image/png'}))
    const scale=Math.min(1,1800/bitmap.width)
    const canvas=new OffscreenCanvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale))
    const context=canvas.getContext('2d',{willReadFrequently:true})
    context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height)
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
    const binary=binarize(context.getImageData(0,0,canvas.width,canvas.height))
    let result
    if(data.operation==='symbols') {
      result=[]
      for(const note of data.notes||[]) {
        const location=locateSymbol(data.structure,note.x,note.y)
        const staff=data.structure?.staves.find(s=>s.id===location?.staff)
        if(!staff)continue
        const dots=findStaccatoDots(binary,{x:note.x*scale,y:note.y*scale,spacing:staff.spacing*scale,top:staffY(staff,note.x,0)*scale,bottom:staffY(staff,note.x,4)*scale})
          .filter(dot=>!(data.notes||[]).some(other=>other.id!==note.id&&Math.hypot(other.x*scale-dot.x,other.y*scale-dot.y)<staff.spacing*scale*1.4))
        if(dots.length===1&&!note.staccato)result.push({id:note.id,page:data.page,tag:'staccato',kind:'missing',x:dots[0].x/scale,y:dots[0].y/scale})
        else if(!dots.length&&note.staccato)result.push({id:note.id,page:data.page,tag:'staccato',kind:'unconfirmed',x:note.x,y:note.y})
      }
    } else if(data.operation==='ties') {
      result=[]
      for(const pair of data.pairs||[]) {
        const location=locateSymbol(data.structure,pair.a.x,pair.a.y)
        const staff=data.structure?.staves.find(s=>s.id===location?.staff)
        if(!staff||pair.b.x-pair.a.x<staff.spacing*5) continue
        const scaled={a:{...pair.a,x:pair.a.x*scale,y:pair.a.y*scale},b:{...pair.b,x:pair.b.x*scale,y:pair.b.y*scale}}
        const arc=detectTieArc(binary,scaled,staff.spacing*scale,staff.lines.map((_,i)=>staffY(staff,(pair.a.x+pair.b.x)/2,i)*scale))
        if(arc) {for(const key of ['x1','x2','y1','y2','controlX','controlY'])arc[key]/=scale;result.push({...arc,page:data.page})}
      }
    } else result=analyzeBinary(binary,{scale,fullScore:data.fullScore})
    self.postMessage({id:data.id,result})
  } catch(error) {self.postMessage({id:data.id,error:error.message})}
}
