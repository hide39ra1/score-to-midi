import {readMidi, writeMidi} from './performance.js'

// Give every sounding track its own channel; use MIDI Port metadata beyond 15
// melodic tracks. Channel 10 is reserved for percussion and is not auto-assigned.
export function melodicRoute(index) {
  const slot = index % 15
  return { port: Math.floor(index/15), channel: slot >= 9 ? slot+1 : slot }
}
export function separateMidiTracks(bytes) {
  const midi = readMidi(bytes)
  const inherited = new Map()
  let sounding = 0
  midi.tracks = midi.tracks.map(events => {
    const channelEvents = events.filter(event => event.status < 240)
    if (!channelEvents.length) return events

    const route = melodicRoute(sounding++)
    const percussion = channelEvents.some(event =>
      [128, 144].includes(event.status & 240) && (event.status & 15) === 9)
    const channel = percussion ? 9 : route.channel
    if (route.port > 127) throw new Error('MIDIパート数が多すぎます。')

    const old = channelEvents[0].status & 15
    const program = channelEvents.find(event => (event.status & 240) === 192)?.data[0] ?? inherited.get(old) ?? 0
    inherited.set(old, program)
    return [
      {tick: 0, status: 255, kind: 33, data: [33, 1, route.port], order: -2},
      {tick: 0, status: 192 | channel, data: [program], order: -1},
      // Events have absolute timestamps, so replacing an old port marker
      // cannot subtract its delta from the following notes.
      ...events.filter(event => event.kind !== 33).map(event => event.status < 240
        ? {...event, status: (event.status & 240) | channel}
        : event),
    ]
  })
  return writeMidi(midi)
}
