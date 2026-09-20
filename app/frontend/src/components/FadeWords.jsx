import React from 'react';

// Splits a run of static text into one <span> per word, each fading/sliding
// up on its own staggered delay -- reads as the sentence cascading in rather
// than a whole block popping in at once. Renders inline (a <span> per call),
// so it drops straight into an existing heading/paragraph's markup and
// inherits that element's own font/color/spacing.
//
// Only meant for static copy that doesn't change after mount (headings,
// descriptions, labels) -- text that updates live (readings, counters)
// would replay this animation on every re-render, which reads as glitching
// rather than settling in, so those stay plain text.
const STEP_MS = 28;
const MAX_DELAY_MS = 520;

export default function FadeWords({ text, delayOffset = 0 }) {
  // A `~marked run~` renders highlighted: splitting on the marker leaves the
  // highlighted runs at odd indices. Kept as an in-string marker rather than a
  // prop so one call still covers a whole sentence and `wordIndex` keeps
  // counting across the highlight, which is what holds the stagger even.
  const segments = String(text).split('~');
  let wordIndex = 0;
  // Wrapped in one plain inline <span> so the whitespace tokens survive a flex
  // parent -- a flex container drops whitespace-only text nodes, which ran the
  // words together inside `.tag` (inline-flex) and the HowItWorks pills.
  return (
    <span>
      {segments.map((segment, s) => segment.split(/(\s+)/).map((chunk, i) => { // keep whitespace tokens so wrapping/spacing stays natural
        if (!chunk.trim()) return chunk;
        const delay = delayOffset + Math.min(wordIndex * STEP_MS, MAX_DELAY_MS);
        wordIndex++;
        return (
          <span key={s + '-' + i} className={'fade-up fade-word' + (s % 2 ? ' fade-hl' : '')} style={{ animationDelay: delay + 'ms' }}>{chunk}</span>
        );
      }))}
    </span>
  );
}
