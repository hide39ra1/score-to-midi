// Give every sounding track its own channel; use MIDI Port metadata beyond 15
// melodic tracks. Channel 10 is reserved for percussion and is not auto-assigned.
export function separateMidiTracks(bytes) {
  const u32 = (at) => new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0)
  const text = at => String.fromCharCode(...bytes.slice(at, at+4))
  if (text(0) !== 'MThd') throw new Error('MIDIヘッダーが不正です。')
  const chunks = [bytes.slice(0, 8+u32(4))]
  const inherited = new Map()
  let at = chunks[0].length, sounding = 0
  while (at < bytes.length) {
    if (text(at) !== 'MTrk') throw new Error('MIDIトラックが不正です。')
    const end = at+8+u32(at+4), events = []
    let i = at+8, running = 0
    const variable = () => {
      let value = 0
      for (let n=0;n<4;n++) { const b=bytes[i++]; value=(value<<7)|(b&127); if (b<128) return value }
      throw new Error('MIDIイベント長が不正です。')
    }
    while (i < end) {
      const deltaStart = i; variable(); const delta = bytes.slice(deltaStart, i)
      let status = bytes[i]
      if (status >= 128) { i++; if (status < 240) running = status }
      else status = running
      if (status < 128) throw new Error('MIDIステータスが不正です。')
      const start = i
      let kind = null
      if (status === 255) { kind=bytes[i++]; const n=variable(); i+=n }
      else if (status === 240 || status === 247) { const n=variable(); i+=n }
      else i += [192,208].includes(status & 240) ? 1 : 2
      if (i > end) throw new Error('MIDIイベントが途中で切れています。')
      events.push({delta,status,kind,data:bytes.slice(start,i)})
    }
    const channelEvents = events.filter(e => e.status < 240)
    const output = []
    if (channelEvents.length) {
      const port = Math.floor(sounding/15), slot = sounding++ % 15, channel = slot >= 9 ? slot+1 : slot
      if (port > 127) throw new Error('MIDIパート数が多すぎます。')
      output.push(0,255,33,1,port)
      const old = channelEvents[0].status & 15
      const program = channelEvents.find(e => (e.status&240) === 192)?.data[0] ?? inherited.get(old) ?? 0
      inherited.set(old,program)
      output.push(0,192|channel,program)
      for (const e of events) {
        if (e.status === 255 && e.kind === 33) continue
        output.push(...e.delta,e.status < 240 ? (e.status&240)|channel : e.status,...e.data)
      }
    } else for (const e of events) output.push(...e.delta,e.status,...e.data)
    const header = new Uint8Array(8); header.set([77,84,114,107]); new DataView(header.buffer).setUint32(4,output.length)
    chunks.push(header,new Uint8Array(output)); at=end
  }
  const out = new Uint8Array(chunks.reduce((n,c) => n+c.length,0))
  let cursor=0; for (const chunk of chunks) { out.set(chunk,cursor); cursor+=chunk.length }
  return out
}
