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
  const tokens = String(text).split(/(\s+)/); // keep whitespace tokens so wrapping/spacing stays natural
  let wordIndex = 0;
  return tokens.map((chunk, i) => {
    if (!chunk.trim()) return chunk;
    const delay = delayOffset + Math.min(wordIndex * STEP_MS, MAX_DELAY_MS);
    wordIndex++;
    return (
      <span key={i} className="fade-up fade-word" style={{ animationDelay: delay + 'ms' }}>{chunk}</span>
    );
  });
}
