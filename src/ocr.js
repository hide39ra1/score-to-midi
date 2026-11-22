// Text on pages which have no text layer (scans, photos), for title, lyrics and chord
// symbols. Tesseract loads on first use: its code and language data come from the CDN.
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js'

let worker
let labelWorker

async function start() {
  const tesseract = await import(/* @vite-ignore */ TESSERACT)
  const made = await (tesseract.default ?? tesseract).createWorker(['eng', 'jpn'])
  // "Sparse text": words scattered over the page. The default layout analysis looks for
  // columns of prose and loses most of the text between staves.
  await made.setParameters({ tessedit_pageseg_mode: '11' })
  return made
}

let last = Promise.resolve()

/** Words on a page image as the tokens annotate.js takes: [{str, x, y, h, w}]. */
export function ocr(page) {
  return (last = last.catch(() => {}).then(() => read(page))) // the worker takes one page at a time
}

// Read labels independently of the surrounding music. Small alternatives stacked
// to the left of a staff are often lost in sparse full-page OCR.
export function ocrInstrumentLabels(page) {
  return (last=last.catch(()=>{}).then(async()=>{
    const staves=page.structure?.staves||[]
    if(!staves.length)return []
    labelWorker??=(async()=>{const t=await import(/* @vite-ignore */ TESSERACT);const w=await (t.default??t).createWorker('eng');await w.setParameters({tessedit_pageseg_mode:'6'});return w})()
    const engine=await labelWorker,bitmap=await createImageBitmap(new Blob([page.png],{type:'image/png'})),out=[]
    try {for(const [i,staff] of staves.entries()) {
      const top=Math.max(0,Math.floor(i?(staves[i-1].bottom+staff.top)/2:staff.top-staff.spacing*6))
      const bottom=Math.min(page.height,Math.ceil(staves[i+1]?(staff.bottom+staves[i+1].top)/2:staff.bottom+staff.spacing*6))
      const width=Math.floor(Math.min(staff.left-staff.spacing*.5,page.width*.4))
      if(width<20||bottom<=top)continue
      const canvas=Object.assign(document.createElement('canvas'),{width:width*3,height:(bottom-top)*3})
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,top,width,bottom-top,0,0,canvas.width,canvas.height)
      const {data}=await engine.recognize(canvas.toDataURL(),{},{blocks:true})
      const words=(data.blocks||[]).flatMap(b=>b.paragraphs).flatMap(p=>p.lines).flatMap(l=>l.words).filter(w=>w.confidence>=45)
      for(const word of words)out.push({str:word.text,confidence:word.confidence,x:word.bbox.x0/3,y:top+word.bbox.y1/3,w:(word.bbox.x1-word.bbox.x0)/3,h:(word.bbox.y1-word.bbox.y0)/3,instrumentStaff:staff.id})
    }} finally {bitmap.close()}
    return out
  }))
}

async function read(page) {
  const { data } = await (await (worker ??= start())).recognize(page.url, {}, { blocks: true })
  return (data.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .flatMap((line) => line.words)
    // Notes and beams come out as low-confidence scraps. Besides words, keep the hyphens
    // between syllables and the "= 120" of a metronome mark.
    .filter((word) => word.confidence > 55 && /\p{L}|^-+$|=|^\d{2,3}\)?$/u.test(word.text))
    .map(({ text, bbox, confidence }) => ({ str: text, confidence, x: bbox.x0, w: bbox.x1 - bbox.x0, y: bbox.y1, h: bbox.y1 - bbox.y0 }))
}
