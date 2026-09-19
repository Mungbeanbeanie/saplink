import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import Logo from './Logo.jsx';
import GoogleMark from './GoogleMark.jsx';
import { css } from '../lib/css.js';
import { useAuth } from '../lib/auth.js';

const LINKS = [
  { to: '/', label: 'Overview' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/dashboard', label: 'Dashboard' }
];

export default function Header({ translucent = false }) {
  const { pathname } = useLocation();
  const { signedIn, signIn, user } = useAuth();
  const initials = user.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('');

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-6"
      style={css('padding: 18px clamp(20px, 5vw, 64px); backdrop-filter: blur(8px); background: color-mix(in srgb, #f5ead8 ' + (translucent ? '72' : '82') + '%, transparent)')}
    >
      <Link to="/" style={css('display: flex; align-items: center; gap: 10px; font-family: var(--font-heading); font-size: 22px; color: var(--color-text)')}>
        <Logo />Saplink
      </Link>
      <nav className="flex items-center" style={css('gap: clamp(14px, 2.5vw, 30px); font-size: 14px')}>
        {LINKS.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            style={pathname === to
              ? css('color: var(--color-neutral-900); font-weight: 700')
              : css('color: var(--color-neutral-800)')}
          >
            {label}
          </Link>
        ))}
        {signedIn ? (
          <Link to="/account" title={user.name} style={css('display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 999px; background: var(--color-accent-2-600); color: var(--color-neutral-100); font-weight: 600; font-size: 14px; border: 2px solid var(--color-neutral-100); box-shadow: var(--shadow-sm)')}>
            {initials}
          </Link>
        ) : (
          <Link to="/account" onClick={signIn} className="btn btn-secondary" style={css('border-radius: 999px; gap: 9px; background: var(--color-neutral-100); border-color: var(--color-neutral-300)')}>
            <GoogleMark />Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
