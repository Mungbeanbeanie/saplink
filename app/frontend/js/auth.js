/* Real Google Identity Services (GIS) sign-in. Replaces the old localStorage-flag
   fake auth. Needs Saplink.config.googleClientId set to a real OAuth Web client id
   (see config.js's comment) -- everything below no-ops gracefully if it's still
   the placeholder, so an unconfigured build doesn't crash, it just shows no button.
   No manual token persistence across reloads: GIS's own auto_select silently
   re-fires the callback when there's a live Google session, and the ID token is
   only good for ~1hr anyway (see plan.md's Phase 7 Gotchas -- no refresh planned). */
(function (S) {
  var PLACEHOLDER = 'REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID';
  var email = null, credential = null, ready = false, listeners = [];

  function configured() {
    return !!(S.config.googleClientId && S.config.googleClientId !== PLACEHOLDER);
  }

  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function onCredential(resp) {
    credential = resp.credential;
    email = null;
    S.api('/api/auth/me', { headers: { Authorization: 'Bearer ' + credential } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) { email = d.email; notify(); }, function () { credential = null; notify(); });
  }

  function init() {
    if (ready || !configured() || !window.google) return;
    ready = true;
    google.accounts.id.initialize({ client_id: S.config.googleClientId, callback: onCredential, auto_select: true });
  }
  // google's script may still be loading when this file runs; a couple of quick
  // retries covers that without needing a real module loader.
  init();
  if (!ready) { var tries = 0, t = setInterval(function () { init(); if (ready || ++tries > 20) clearInterval(t); }, 100); }

  S.auth = {
    get: function () { return !!email; },
    email: function () { return email; },
    token: function () { return credential; },
    onChange: function (fn) { listeners.push(fn); },
    renderButton: function (el, opts) {
      if (!configured() || !window.google || !el) return;
      el.innerHTML = '';
      google.accounts.id.renderButton(el, Object.assign({ theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with' }, opts || {}));
    },
    signOut: function () {
      credential = null; email = null;
      if (window.google && configured()) google.accounts.id.disableAutoSelect();
      notify();
    }
  };
})(window.Saplink);
