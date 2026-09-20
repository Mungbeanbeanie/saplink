// Real Google Identity Services (GIS) sign-in. Needs VITE_GOOGLE_CLIENT_ID set
// to a real OAuth Web client id (see .env.example) -- everything below no-ops
// gracefully if it's unset, so an unconfigured build doesn't crash, it just
// shows no button. No manual token persistence across reloads: GIS's own
// auto_select silently re-fires the callback when there's a live Google
// session, and the ID token is only good for ~1hr anyway (see plan.md's
// Phase 7 Gotchas -- no refresh planned).
import { useCallback, useSyncExternalStore } from 'react';
import { apiFetch } from './api.js';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

let email = null;
let credential = null;
let ready = false;
const listeners = new Set();

function configured() {
  return !!CLIENT_ID;
}
export const isConfigured = configured;

function notify() { listeners.forEach((fn) => fn()); }

function onCredential(resp) {
  credential = resp.credential;
  email = null;
  apiFetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + credential } })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => { email = d.email; notify(); }, () => { credential = null; notify(); });
}

function init() {
  if (ready || !configured() || !window.google) return;
  ready = true;
  window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential, auto_select: true });
}
if (typeof window !== 'undefined') {
  init();
  if (!ready) {
    let tries = 0;
    const t = setInterval(() => { init(); if (ready || ++tries > 20) clearInterval(t); }, 100);
  }
}

export function renderGoogleButton(el, opts) {
  if (!configured() || !window.google || !el) return;
  el.innerHTML = '';
  window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', ...opts });
}

// Opens Google's own sign-in UI (the One Tap prompt) without needing a click
// on GIS's own rendered button -- for CTAs elsewhere (e.g. Landing's "Open
// the dashboard") that should gate on sign-in first. No-ops gracefully, same
// as the rest of this file, if GIS isn't configured/loaded yet.
export function promptSignIn() {
  if (!ready) return;
  window.google.accounts.id.prompt();
}

function signOutAuth() {
  credential = null;
  email = null;
  if (window.google && configured()) window.google.accounts.id.disableAutoSelect();
  notify();
}

function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function getSnapshot() { return email; }

export function useAuth() {
  const currentEmail = useSyncExternalStore(subscribe, getSnapshot);
  const signOut = useCallback(signOutAuth, []);
  return { signedIn: !!currentEmail, email: currentEmail, token: credential, signOut };
}
