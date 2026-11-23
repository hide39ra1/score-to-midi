// Verovio exports notation timing, but does not perform articulation marks.
export function articulationPolicy({staccato=false,staccatissimo=false,accent=false,strongAccent=false,tied=false}={}) {
  return {gate:tied?1:staccatissimo ? .25 : staccato ? .5 : 1,boost:strongAccent?28:accent?18:0}
}
export function readMidi(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),u32=at=>view.getUint32(at),text=at=>String.fromCharCode(...bytes.slice(at,at+4))
  if(bytes.length<14||text(0)!=='MThd'||u32(4)<6||u32(4)>bytes.length-8)throw new Error('MIDIヘッダーが不正です')
  const division=view.getUint16(12);if(!division)throw new Error('MIDI分解能が不正です');if(division&0x8000)throw new Error('SMPTE形式のMIDIには対応していません')
  const tracks=[];let at=8+u32(4)
  while(at<bytes.length) {
    if(at+8>bytes.length||text(at)!=='MTrk')throw new Error('MIDIトラックが不正です')
    const end=at+8+u32(at+4);if(end>bytes.length)throw new Error('MIDIトラックが途中で切れています')
    let i=at+8,tick=0,running=0;const events=[]
    const variable=()=>{let value=0;for(let n=0;n<4&&i<end;n++){const byte=bytes[i++];value=(value<<7)|(byte&127);if(byte<128)return value}throw new Error('MIDIイベント長が不正です')}
    while(i<end) {
      tick+=variable();let status=bytes[i]
      if(status>=128){i++;if(status<240)running=status}else status=running
      if(status<128)throw new Error('MIDIステータスが不正です')
      const start=i;let kind=null
      if(status===255){kind=bytes[i++];const length=variable();i+=length}
      else if(status===240||status===247){const length=variable();i+=length}
      else i+=[192,208].includes(status&240)?1:2
      if(i>end)throw new Error('MIDIイベントが途中で切れています')
      events.push({tick,status,kind,data:[...bytes.slice(start,i)],order:events.length})
    }
    tracks.push(events);at=end
  }
  if(tracks.length!==view.getUint16(10))throw new Error('MIDIトラック数が一致しません')
  return {header:bytes.slice(0,8+u32(4)),division,tracks}
}
const variable=value=>{const bytes=[value&127];while((value=Math.floor(value/128)))bytes.unshift((value&127)|128);return bytes}
export function writeMidi({header,tracks}) {
  const chunks=[header]
  for(const events of tracks) {
    const data=[];let tick=0
    const priority=e=>e.status===255&&e.kind===47?3:(e.status&240)===128||((e.status&240)===144&&e.data[1]===0)?0:(e.status&240)===144?2:1
    for(const e of [...events].sort((a,b)=>a.tick-b.tick||priority(a)-priority(b)||a.order-b.order)) {data.push(...variable(e.tick-tick),e.status,...e.data);tick=e.tick}
    const head=new Uint8Array(8);head.set([77,84,114,107]);new DataView(head.buffer).setUint32(4,data.length);chunks.push(head,Uint8Array.from(data))
  }
  const out=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length}return out
}
export function performMidi(bytes,specifications) {
  const midi=readMidi(bytes),specs=new Map()
  for(const spec of specifications)specs.set(`${spec.track}/${Math.round(spec.quarter*midi.division)}/${spec.pitch}`,spec)
  let track=-1
  for(const events of midi.tracks) {
    if(!events.some(e=>e.status<240))continue
    track++;const active=new Map()
    for(const event of events) {
      const kind=event.status&240,key=`${event.status&15}/${event.data[0]}`
      if(kind===144&&event.data[1]>0) {
        const spec=specs.get(`${track}/${event.tick}/${event.data[0]}`)
        if(spec){event.data[1]=Math.min(127,event.data[1]+spec.boost);if(!active.has(key))active.set(key,[]);active.get(key).push({event,spec})}
      } else if(kind===128||kind===144&&event.data[1]===0) {
        const on=active.get(key)?.shift()
        if(on&&on.spec.gate<1)event.tick=on.event.tick+Math.max(1,Math.round((event.tick-on.event.tick)*on.spec.gate))
      }
    }
  }
  return writeMidi(midi)
}
