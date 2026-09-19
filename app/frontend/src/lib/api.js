// Where the real API lives. Empty string = same origin (local dev, proxied to
// server/index.js by vite.config.js). In production the web box and the api
// box are separate origins, so the build sets VITE_API_BASE_URL (see
// compose.web.yaml) and every request below is sent cross-origin to it.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export function apiFetch(path, opts) {
  return fetch(API_BASE + path, opts);
}
