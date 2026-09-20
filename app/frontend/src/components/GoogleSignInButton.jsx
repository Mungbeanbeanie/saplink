import React, { useEffect, useRef } from 'react';
import { renderGoogleButton, useAuth } from '../lib/auth.js';

// Renders Google's own button (reliability over a custom button driving
// prompt() -- see plan.md's Phase 6 notes) wherever "Sign in" is needed.
// Renders nothing once signed in.
export default function GoogleSignInButton(props) {
  const ref = useRef(null);
  const { signedIn } = useAuth();
  useEffect(() => {
    if (!signedIn) renderGoogleButton(ref.current, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);
  if (signedIn) return null;
  return <span ref={ref} />;
}
