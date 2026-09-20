import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { css } from '../lib/css.js';
import DashboardLink from './DashboardLink.jsx';

// Shared site footer -- every page renders exactly one of these, so Mascot.jsx
// can find it with a plain `document.querySelector('footer')` to avoid
// overlapping it while scrolled. Originally landing-page-only; now shared.
export default function Footer() {
  const onLanding = useLocation().pathname === '/';
  const linkStyle = css('color: var(--color-neutral-300)');
  // On the landing page itself, #top/#join are plain same-page anchors --
  // index.css's `html { scroll-behavior: smooth }` scrolls to them with no
  // JS needed. From any other page they have to be real navigations instead.
  const Overview = onLanding
    ? <a href="#top" style={linkStyle}>Overview</a>
    : <Link to="/" style={linkStyle}>Overview</Link>;
  const Contact = onLanding
    ? <a href="#join" style={linkStyle}>Contact</a>
    : <Link to="/#join" style={linkStyle}>Contact</Link>;

  return (
    <footer style={css('background: var(--color-neutral-900); color: var(--color-neutral-300); padding: 40px clamp(20px, 5vw, 64px); display: flex; flex-wrap: wrap; gap: 20px; justify-content: space-between; align-items: center')}>
      <span style={css('font-family: var(--font-heading); font-size: 20px; color: var(--color-neutral-100)')}>Saplink</span>
      <div className="flex flex-wrap" style={css('gap: 22px; font-size: 14px')}>
        {Overview}
        <Link to="/how-it-works" style={linkStyle}>How it works</Link>
        <DashboardLink style={linkStyle}>Dashboard</DashboardLink>
        {Contact}
      </div>
      <span style={css('font-size: 13px; color: var(--color-neutral-500)')}>Field trials, not a finished product. © Saplink 2026</span>
    </footer>
  );
}
