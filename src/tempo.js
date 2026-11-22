const units = {
  q: ['quarter', 1], '♩': ['quarter', 1], J: ['quarter', 1], d: ['quarter', 1],
  h: ['half', 2], e: ['eighth', 0.5], '♪': ['eighth', 0.5],
}
const metronome = /^\(?\s*([qheJd♩♪])(\.)?\s*=\s*(?:c(?:irc)?a\.?\s*)?(\d{1,3})\s*\)?$/u

export function readMetronome(line) {
  const ordered = [...line].sort((a, b) => a.x - b.x)
  for (let start = 0; start < ordered.length; start++) {
    const tokens = []
    for (const token of ordered.slice(start, start + 5)) {
      const previous = tokens.at(-1)
      if (previous && token.x - previous.x - previous.w > 1.5 * Math.max(token.h, previous.h)) break
      tokens.push(token)
      const text = tokens.map((item) => item.str).join(' ')
      const match = metronome.exec(text)
      if (!match) continue
      const next = ordered[start + tokens.length]
      if (next && /^\d/.test(next.str) && next.x - token.x - token.w < token.h * 0.35) continue
      const [, glyph, dot, number] = match
      const [unit, multiplier] = units[glyph]
      const bpm = Number(number)
      const quarterBpm = bpm * multiplier * (dot ? 1.5 : 1)
      if (quarterBpm < 20 || quarterBpm > 400) continue
      return {tokens, x: tokens[0].x, bpm, unit, dotted: !!dot}
    }
  }
  return null
}

// Older scans accepted an isolated "= 11" as an executable tempo direction.
// The converter's manual tempo control and automatic recognition use 20–400.
export function removeLegacyScanTempos(doc) {
  if (!doc.querySelector('miscellaneous-field[name="recognition-version"], miscellaneous-field[name="staff-layout"]')) return 0
  let removed = 0
  for (const direction of doc.querySelectorAll('direction[placement="above"]')) {
    const sound = direction.querySelector(':scope > sound[tempo]')
    const metronome = direction.querySelector(':scope > direction-type > metronome')
    if (!sound || !metronome || !metronome.querySelector('per-minute')) continue
    const bpm = Number(sound.getAttribute('tempo'))
    if (bpm >= 20 || direction.children.length !== 2 || sound.attributes.length !== 1) continue
    direction.remove()
    removed++
  }
  return removed
}
