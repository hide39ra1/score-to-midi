// Plays the score Verovio has loaded, with a small built-in synth.
import {articulationPolicy,performMidi} from './performance.js'
export class Player {
  notes = [] // {id, t, dur (ms), pitch (MIDI)}
  #timer = null
  #context = null
  #master = null

  /** Read notes and timing from the toolkit's current score. Returns separate MIDI bytes for notation and performance. */
  load(tk,doc) {
    // Verovio engraves simile measures but omits their sounding notes from MIDI.
    // Our MusicXML already contains the expanded notes; render those for playback.
    if(doc.querySelector('measure-repeat')) {
      const playback=doc.cloneNode(true)
      playback.querySelectorAll('measure-style').forEach(style=>{if(style.querySelector('measure-repeat'))style.remove()})
      tk.loadData(new XMLSerializer().serializeToString(playback))
    }
    const notationMidi = Uint8Array.from(atob(tk.renderToMIDI()), c => c.charCodeAt(0))
    const tracks=new Map();let slot=0
    for(const part of doc.querySelectorAll('score-partwise > part')) {tracks.set(part.id,slot);slot+=Number(part.querySelector('staves')?.textContent||1)}
    const specifications=[]
    const notesById=new Map([...doc.querySelectorAll('note[id]')].map(note=>[note.id,note]))
    this.notes = tk
      .renderToTimemap()
      .flatMap((entry) => (entry.on ?? []).map((id) => ({ id, t: entry.tstamp,quarter:entry.qstamp, ...tk.getMIDIValuesForElement(id) })))
      .map(({ id, t, pitch, duration,quarter }) => {
        const note=notesById.get(id)
        const policy=articulationPolicy({staccato:!!note?.querySelector('staccato'),staccatissimo:!!note?.querySelector('staccatissimo'),accent:!!note?.querySelector('accent'),strongAccent:!!note?.querySelector('strong-accent'),tied:!!note?.querySelector('tie,tied')})
        if(note)specifications.push({track:tracks.get(note.closest('part').id)+Number(note.querySelector('staff')?.textContent||1)-1,quarter,pitch,...policy})
        return {id,t,pitch,dur:duration*policy.gate,velocity:Math.min(127,80+policy.boost)}
      })
    return { notationMidi, performanceMidi: performMidi(notationMidi, specifications) }
  }

  get playing() {
    return this.#timer !== null
  }

  #audio() {
    this.#context ??= new AudioContext()
    this.#context.resume()
    if (!this.#master) {
      this.#master = this.#context.createGain()
      this.#master.gain.value = 0.5
      this.#master.connect(this.#context.destination)
    }
    return this.#context
  }

  #voice(pitch, when, seconds, velocity=80) {
    const context = this.#context
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = 'triangle'
    osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12)
    gain.gain.setValueAtTime(0, when)
    const length=Math.max(seconds,.02),level=.3*velocity/80
    gain.gain.linearRampToValueAtTime(level, when + Math.min(.01,length*.2))
    gain.gain.exponentialRampToValueAtTime(level*.2, when + length*.75)
    gain.gain.linearRampToValueAtTime(0, when + length)
    osc.connect(gain).connect(this.#master)
    osc.start(when)
    osc.stop(when + seconds + 0.1)
  }

  /** Sound one pitch now, as feedback while editing. */
  ping(pitch) {
    this.#voice(pitch, this.#audio().currentTime, 0.3)
  }

  /** Play from `from` ms. onTick(ids sounding now) runs ~25x a second; onEnd when it stops. */
  play(from, onTick, onEnd) {
    this.stop()
    const context = this.#audio()
    const start = context.currentTime + 0.1 - from / 1000
    const when = (ms) => start + ms / 1000
    const end = Math.max(0, ...this.notes.map((n) => n.t + n.dur))
    let next = this.notes.findIndex((n) => n.t >= from)
    if (next < 0) next = this.notes.length
    this.#onEnd = onEnd
    this.#timer = setInterval(() => {
      for (; next < this.notes.length && when(this.notes[next].t) < context.currentTime + 0.25; next++)
        this.#voice(this.notes[next].pitch, when(this.notes[next].t), this.notes[next].dur / 1000,this.notes[next].velocity)
      const now = (context.currentTime - start) * 1000
      onTick(this.notes.filter((n) => n.t <= now && now < n.t + n.dur).map((n) => n.id))
      if (now > end) this.stop()
    }, 40)
  }
  #onEnd = null

  stop() {
    if (!this.playing) return
    clearInterval(this.#timer)
    this.#timer = null
    this.#master?.disconnect() // silences whatever is scheduled
    this.#master = null
    this.#onEnd?.()
  }
}
