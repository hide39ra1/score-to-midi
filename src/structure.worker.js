import {binarize,analyzeBinary} from './structure.js'
self.onmessage=async ({data})=>{
  try {
    const bitmap=await createImageBitmap(new Blob([data.png],{type:'image/png'}))
    const scale=Math.min(1,1800/bitmap.width)
    const canvas=new OffscreenCanvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale))
    const context=canvas.getContext('2d',{willReadFrequently:true})
    context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height)
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
    const result=analyzeBinary(binarize(context.getImageData(0,0,canvas.width,canvas.height)),{scale,fullScore:data.fullScore})
    self.postMessage({id:data.id,result})
  } catch(error) {self.postMessage({id:data.id,error:error.message})}
}
