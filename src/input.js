// Files (PDFs, photos) -> page images for the recogniser, plus any text a PDF carries.
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

const DPI = 200 // what the recogniser was benchmarked at
const MAX_SIDE = 2600 // photos larger than this gain nothing

async function finish(canvas, text = []) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  return { png: await blob.arrayBuffer(), url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, text }
}

async function* pdfPages(file, range) {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pdf = await task.promise
  try {
  if (range.from > pdf.numPages) throw new Error(`開始ページが総ページ数（${pdf.numPages}）を超えています。`)
  for (let n = range.from; n <= Math.min(range.to, pdf.numPages); n++) {
    const page = await pdf.getPage(n)
    const viewport = page.getViewport({ scale: DPI / 72 })
    const canvas = Object.assign(document.createElement('canvas'), { width: viewport.width, height: viewport.height })
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    // "print" renders without waiting for animation frames, which stop in a background tab.
    await page.render({ canvasContext: context, canvas, viewport, intent: 'print' }).promise
    // Text items in page-image pixels: x/y is the start of the baseline, h the font height.
    const text = (await page.getTextContent()).items
      .filter((item) => item.str?.trim())
      .map((item) => {
        const t = pdfjs.Util.transform(viewport.transform, item.transform)
        return { str: item.str, x: t[4], y: t[5], h: Math.hypot(t[2], t[3]), w: item.width * viewport.scale }
      })
    const result = await finish(canvas, text)
    result.sourcePage = n
    yield result
    page.cleanup()
  }
  } finally { await task.destroy() }
}

async function imagePage(file) {
  const bitmap = await createImageBitmap(file) // applies the photo's EXIF rotation
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width * scale, height: bitmap.height * scale })
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return finish(canvas)
}

/** All pages of the given files, in order: [{png, url, width, height, text}]. */
export async function loadPages(files, onProgress = () => {}, range = { from: 1, to: Infinity }) {
  const pages = []
  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (isPdf) for await (const page of pdfPages(file, range)) { page.sourceFile=file.name;onProgress(pages.push(page)) }
    else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)) {const page=await imagePage(file);page.sourceFile=file.name;page.sourcePage=1;onProgress(pages.push(page))}
    else throw new Error('PDFまたは画像ファイルを選んでください。')
  }
  return pages
}
