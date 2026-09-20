import React from 'react';

// The Google "G" mark, for the fallback sign-in button (GoogleSignInButton.jsx)
// shown before real GIS has configured/rendered its own branded button.
export default function GoogleMark({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: size, height: size, flex: 'none' }}>
      <path fill="#4285f4" d="M23.04 12.26c0-.85-.08-1.67-.22-2.45H12v4.63h6.19a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.43-4.96 3.43-8.55z" />
      <path fill="#34a853" d="M12 24c3.1 0 5.7-1.03 7.6-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.88 1.1-2.99 0-5.52-2.02-6.42-4.73H1.75v2.98A11.99 11.99 0 0 0 12 24z" />
      <path fill="#fbbc05" d="M5.58 14.69a7.2 7.2 0 0 1 0-4.6V7.11H1.75a11.99 11.99 0 0 0 0 10.56l3.83-2.98z" />
      <path fill="#ea4335" d="M12 4.76c1.69 0 3.2.58 4.39 1.72l3.29-3.29C17.7 1.2 15.1 0 12 0 7.44 0 3.5 2.6 1.75 6.42l3.83 2.98C6.48 6.7 9.01 4.76 12 4.76z" />
    </svg>
  );
}
