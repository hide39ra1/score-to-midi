// Names / MusicXML sound IDs checked against MuseScore 4.6.5's official
// share/instruments/instruments.xml. MIDI programs remain 1-based in MusicXML.
export const MUSESCORE_INSTRUMENTS={
  drums:['Drum Kit','drum.group.set','Drs.'],agogo:['Agogô Bells','metal.bells.agogo','Agogo'],sleigh:['Sleigh Bells','metal.bells.sleigh-bells','S.Bells'],tambourine:['Tambourine','drum.tambourine','Tamb.'],
  flute:['Flute','wind.flutes.flute','Fl.'],piccolo:['Piccolo','wind.flutes.flute.piccolo','Picc.'],
  oboe:['Oboe','wind.reed.oboe','Ob.'],clarinet:['B♭ Clarinet','wind.reed.clarinet.bflat','B♭ Cl.'],bassclarinet:['Bass Clarinet','wind.reed.clarinet.bass','B. Cl.'],
  soprano:['Soprano Saxophone','wind.reed.saxophone.soprano','S. Sax.'],alto:['Alto Saxophone','wind.reed.saxophone.alto','A. Sax.'],tenor:['Tenor Saxophone','wind.reed.saxophone.tenor','T. Sax.'],baritone:['Baritone Saxophone','wind.reed.saxophone.baritone','Bar. Sax.'],
  trumpet:['B♭ Trumpet','brass.trumpet.bflat','B♭ Tpt.'],horn:['Horn in F','brass.french-horn','F Hn.'],trombone:['Trombone','brass.trombone','Tbn.'],euphonium:['Euphonium','brass.euphonium','Euph.'],tuba:['Tuba','brass.tuba','Tba.'],
  bassoon:['Bassoon','wind.reed.bassoon','Bsn.'],violin:['Violin','strings.violin','Vln.'],viola:['Viola','strings.viola','Vla.'],cello:['Violoncello','strings.cello','Vc.'],bass:['Contrabass','strings.contrabass','Cb.'],
  piano:['Piano','keyboard.piano','Pno.'],glockenspiel:['Glockenspiel','pitched-percussion.glockenspiel','Glock.'],
}
// Keep recognition gaps visible, while avoiding a MuseScore import failure when
// one part ends before the others. Never invent missing pitches or durations.
export function exportForMuseScore(source) {
  const doc = source.cloneNode(true)
  const parts = [...doc.querySelectorAll('score-partwise > part')]
  const count = Math.max(0, ...parts.map(p => p.querySelectorAll(':scope > measure').length))
  for (const part of parts) {
    const measures = [...part.querySelectorAll(':scope > measure')]
    for (let i = measures.length; i < count; i++) {
      const measure = doc.createElement('measure')
      measure.setAttribute('number', String(i + 1))
      const direction = doc.createElement('direction')
      const type = doc.createElement('direction-type')
      const words = doc.createElement('words')
      words.textContent = '認識欠落：原稿を確認してください'
      type.append(words); direction.append(type); measure.append(direction); part.append(measure)
    }
  }
  return new XMLSerializer().serializeToString(doc)
}


// Repair clef changes only on scanned, single-staff parts whose instrument
// establishes the expected clef. Retain octave markings and all sounding pitches.
const fixedClefs = Object.fromEntries([
  ...['flute','piccolo','oboe','clarinet','bassclarinet','soprano','alto','tenor','baritone','trumpet','glockenspiel','violin'].map(id => [id, ['G', '2']]),
  ['viola', ['C', '3']],
].map(([id, clef]) => [MUSESCORE_INSTRUMENTS[id][1], clef]))

export function normalizeRecognizedClefs(doc) {
  const parts = new Map([...doc.querySelectorAll('score-partwise > part')].map(part => [part.id, part]))
  let repaired = 0
  for (const meta of doc.querySelectorAll('score-part')) {
    const part = parts.get(meta.id)
    const expected = fixedClefs[meta.querySelector('instrument-sound')?.textContent]
    if (!expected || !part || Number(part.querySelector('staves')?.textContent || 1) !== 1) continue
    for (const clef of part.querySelectorAll('attributes > clef')) {
      const sign = clef.querySelector('sign')
      const line = clef.querySelector('line')
      if (!sign || (sign.textContent === expected[0] && line?.textContent === expected[1])) continue
      sign.textContent = expected[0]
      if (line) line.textContent = expected[1]
      else {
        const newLine = doc.createElement('line')
        newLine.textContent = expected[1]
        sign.after(newLine)
      }
      repaired++
    }
  }
  return repaired
}
