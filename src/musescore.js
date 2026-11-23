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
  if (doc.querySelector('miscellaneous-field[name="recognition-version"]')) removeRepeatedScoreAttributes(doc)
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


// Page-by-page OMR repeats the current clef, key and meter at each page start.
// Carry their musical state per staff so only genuine state changes survive.
const staffAttributes = new Set(['clef', 'key', 'time'])
function attributeSignature(element, root = true) {
  const attributes = [...element.attributes]
    .filter(attribute => !root || attribute.name !== 'number')
    .map(attribute => [attribute.name, attribute.value])
    .sort(([a], [b]) => a.localeCompare(b))
  const children = [...element.children].map(child => attributeSignature(child, false))
  return JSON.stringify([element.tagName, attributes, children.length ? children : element.textContent.trim()])
}

export function removeRepeatedScoreAttributes(doc) {
  let removed = 0
  for (const part of doc.querySelectorAll('score-partwise > part')) {
    const states = new Map()
    for (const attributes of part.querySelectorAll('measure > attributes')) {
      for (const item of [...attributes.children]) {
        const name = item.tagName
        if (!staffAttributes.has(name)) continue
        if (!states.has(name)) states.set(name, new Map())
        const values = states.get(name)
        const staff = item.getAttribute('number') || (name === 'clef' ? '1' : '*')
        const signature = attributeSignature(item)
        const previous = values.get(staff) ?? (staff !== '*' ? values.get('*') : undefined)
        const sameForAll = staff !== '*' || [...values.values()].every(value => value === signature)
        if (previous === signature && sameForAll) {
          item.remove()
          removed++
          continue
        }
        if (staff === '*') values.clear()
        values.set(staff, signature)
      }
      if (!attributes.children.length && !attributes.attributes.length) attributes.remove()
    }
  }
  return removed
}
