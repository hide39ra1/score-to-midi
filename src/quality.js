// Flag timing inconsistencies without inventing or silently correcting notes.
export function measureSpan(events) {
  let cursor = 0, end = 0
  for (const event of events) {
    if (!Number.isFinite(event.duration) || event.duration < 0) continue
    if (event.kind === 'backup') cursor -= event.duration
    else if (event.kind === 'forward') cursor += event.duration
    else if (!event.chord && !event.grace) cursor += event.duration
    end = Math.max(end, cursor)
  }
  return end
}

export function inspectScore(doc) {
  const warnings = []
  const parts = [...doc.querySelectorAll('score-partwise > part')]
  const maxMeasures = Math.max(0, ...parts.map((part) => part.querySelectorAll(':scope > measure').length))
  let measures = 0
  for (const part of parts) {
    const count = part.querySelectorAll(':scope > measure').length
    if (count !== maxMeasures) warnings.push(`${part.id} 小節数 ${count}/${maxMeasures}`)
    let divisions = 1, beats = 4, beatType = 4
    for (const measure of part.querySelectorAll(':scope > measure')) {
      measures++
      const value = (selector, fallback) => Number(measure.querySelector(selector)?.textContent ?? fallback)
      divisions = value('attributes > divisions', divisions)
      const beatsText = measure.querySelector('attributes > time > beats')?.textContent
      if (beatsText) beats = beatsText.split('+').reduce((n, x) => n + Number(x), 0)
      beatType = value('attributes > time > beat-type', beatType)
      const events = [...measure.children].filter((el) => ['note', 'backup', 'forward'].includes(el.tagName)).map((el) => ({
        kind: el.tagName, duration: Number(el.querySelector(':scope > duration')?.textContent ?? 0),
        chord: !!el.querySelector(':scope > chord'), grace: !!el.querySelector(':scope > grace'),
      }))
      const expected = divisions * beats * 4 / beatType
      const actual = measureSpan(events)
      // First/implicit measures may be pickups; report only unambiguous overflow there.
      const pickup = measure === part.querySelector('measure') || measure.getAttribute('implicit') === 'yes'
      if (actual > expected + 0.01 || (!pickup && actual < expected - 0.01)) warnings.push(`${part.id} 第${measure.getAttribute('number')}小節`)
    }
  }
  return { parts: doc.querySelectorAll('score-partwise > part').length, notes: doc.querySelectorAll('note > pitch').length, measures, warnings }
}
