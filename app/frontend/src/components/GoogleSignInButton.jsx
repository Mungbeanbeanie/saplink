import React, { useEffect, useRef } from 'react';
import { renderGoogleButton, isConfigured, useAuth } from '../lib/auth.js';
import { css } from '../lib/css.js';
import GoogleMark from './GoogleMark.jsx';

// Renders Google's own button (reliability over a custom button driving
// prompt() -- see plan.md's Phase 6 notes) wherever "Sign in" is needed.
// Renders nothing once signed in. Without VITE_GOOGLE_CLIENT_ID set, GIS has
// nothing to render -- rather than leave that spot empty, show an inert,
// site-styled placeholder so the corner always has a visible sign-in
// affordance. It never fakes a sign-in; it just explains what's missing.
export default function GoogleSignInButton(props) {
  const ref = useRef(null);
  const { signedIn } = useAuth();
  const configured = isConfigured();

  useEffect(() => {
    if (!signedIn && configured) renderGoogleButton(ref.current, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, configured]);

  if (signedIn) return null;

  if (!configured) {
    return (
      <span
        className="btn btn-secondary"
        title="Google sign-in needs VITE_GOOGLE_CLIENT_ID set -- see .env.example"
        style={css('border-radius: 999px; gap: 9px; background: var(--color-neutral-100); border-color: var(--color-neutral-300); opacity: 0.65; cursor: not-allowed')}
      >
        <GoogleMark size={16} />Sign in
      </span>
    );
  }

  return <span ref={ref} />;
}
