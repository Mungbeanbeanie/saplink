// Tiny pub/sub singleton, same style as auth.js -- lets any signed-out click
// on a dashboard-gated control tell the mascot (mounted once, elsewhere in
// the tree) to react, without threading callbacks/props through the page tree.
const listeners = new Set();

export function notifyNeedsSignIn(rect) {
  listeners.forEach((fn) => fn(rect));
}

export function onNeedsSignIn(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
