// Tiny sessionStorage wrapper -- lets the polling hooks paint the last-seen
// value immediately on mount instead of empty/null until their first poll
// resolves (the "loads slowly/weirdly at first" reload friction). Session,
// not local: clears itself per tab/browser-close, and the poll loop
// re-validates within seconds regardless, so no TTL logic is needed.
// Key naming follows the existing `saplink.signedIn` convention (see
// scene/BranchScene.jsx) -- `saplink.cache.<name>`.

export function readCache(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function writeCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // quota exceeded / private-mode storage disabled -- caching is a nicety
  }
}
