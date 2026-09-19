// Turns a CSS declaration string into a React style object.
// Keeps the design's inline styling readable and identical to the source markup.
const cache = new Map();

export function css(text) {
  if (cache.has(text)) return cache.get(text);
  const out = {};
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    if (prop.startsWith('--')) { out[prop] = value; continue; }
    const key = prop.replace(/^-(webkit|moz|ms)-/, (m, v) => v[0].toUpperCase() + v.slice(1) + '-')
      .replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    out[key] = value;
  }
  cache.set(text, out);
  return out;
}

export default css;
