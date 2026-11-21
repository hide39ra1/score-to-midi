const GENERIC = /^(?:score|scan|sheet(?: music)?|document|untitled|image|スコア|楽譜|譜面|無題|スキャン|画像|曲名不明)(?:[\s_\-()\d]*)$/i
export function sourceTitle(fileName = '') {
  const base = fileName.split(/[\\/]/).pop().replace(/\.(pdf|musicxml|xml|png|jpe?g|webp|bmp)$/i, '').trim()
  return !base || GENERIC.test(base) ? '' : base
}
export function safeFileName(title) {
  let name = String(title || '').normalize('NFC').replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g,'_').replace(/[.\s]+$/g,'').trim()
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return [...name].slice(0,100).join('').replace(/[.\s]+$/g,'')
}
export function unknownTitle(date = new Date()) {
  const n = x => String(x).padStart(2,'0')
  return `曲名不明_${date.getFullYear()}${n(date.getMonth()+1)}${n(date.getDate())}_${n(date.getHours())}${n(date.getMinutes())}${n(date.getSeconds())}`
}
// Prefer a prominent centered heading; right-aligned credits and tempo labels
// must not become the title merely because Japanese OCR missed the real heading.
export function detectTitle(items, staff) {
  if (!staff) return null
  const [left,top,right,bottom] = staff, width = right-left, height = bottom-top
  const eligible = items.filter(t => t.y < top-height && t.h >= height*.65 && t.str.trim().length > 1 && !/作曲|編曲|composer|arrang|copyright|©|full\s*score|^\s*[♩qJ]?\s*=\s*\d+/i.test(t.str))
  const lines = []
  for (const t of [...eligible].sort((a,b) => a.y-b.y)) {
    const line = lines.find(line => Math.abs(line[0].y-t.y) < Math.max(line[0].h,t.h)*.5)
    if (line) line.push(t); else lines.push([t])
  }
  return lines.map(line => {
    const headingHeight = Math.max(...line.map(t => t.h))
    line = line.filter(t => t.h >= headingHeight*.72)
    line.sort((a,b) => a.x-b.x)
    const x = line[0].x, end = Math.max(...line.map(t => t.x+t.w))
    const str = line.map(t => t.str).join(' ').trim().replace(/([一-龯ぁ-ゖァ-ヺー])\s+(?=[一-龯ぁ-ゖァ-ヺー])/g,'$1')
    return { str, x, w:end-x, y:line[0].y, h:Math.max(...line.map(t => t.h)) }
  }).filter(t => Math.abs(t.x+t.w/2-(left+right)/2) < width*.23 && !GENERIC.test(t.str))
    .sort((a,b) => b.h-a.h)[0] || null
}
