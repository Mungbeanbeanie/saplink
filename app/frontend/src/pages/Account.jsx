import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import GoogleSignInButton from '../components/GoogleSignInButton.jsx';
import Copyright from '../components/Copyright.jsx';
import { css } from '../lib/css.js';
import { useAuth } from '../lib/auth.js';
import { useHealth } from '../lib/useHealth.js';

export default function Account() {
  const { signedIn, email, signOut } = useAuth();
  const navigate = useNavigate();
  // Real devices from /api/health -- there's no per-account device linkage on
  // the backend (devices aren't owned by users), so this is every router
  // currently on the network, not a fake "linked to you" subset.
  const { health } = useHealth();
  const devices = (health && health.devices) || [];
  const initials = (email || '?').split('@')[0].split(/[._-]+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  if (!signedIn) {
    return (
      <div style={css('min-height: 100vh; background: var(--color-bg)')}>
        <Header />
        <main style={css('padding: clamp(20px, 3vw, 40px) clamp(20px, 5vw, 64px) 80px; display: flex; flex-direction: column; gap: 18px; max-width: 640px')}>
          <div className="card-kicker" style={css('margin-bottom: 6px')}>Account</div>
          <h1 style={css('margin: 0; font-size: clamp(26px, 3vw, 36px)')}>Sign in to see your account</h1>
          <p style={css('margin: 0; color: var(--color-neutral-700)')}>Anyone can view the readings; signing in with Google lets you send a test signal and see every router on the network here.</p>
          <GoogleSignInButton size="large" shape="pill" />
        </main>
      </div>
    );
  }

  return (
    <div style={css('min-height: 100vh; background: var(--color-bg)')}>
      <Header />
      <main style={css('padding: clamp(20px, 3vw, 40px) clamp(20px, 5vw, 64px) 80px; display: flex; flex-direction: column; gap: 26px; max-width: 1040px')}>
        <div><div className="card-kicker" style={css('margin-bottom: 6px')}>Account</div></div>

        <div className="card elev-md" style={css('border-radius: var(--radius-lg); padding: clamp(20px, 2.4vw, 30px); display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: clamp(18px, 2.4vw, 30px)')}>
          <div style={css('display: flex; align-items: center; justify-content: center; width: 96px; height: 96px; border-radius: 999px; background: var(--color-accent-2-600); color: var(--color-neutral-100); font-family: var(--font-heading); font-size: 34px; box-shadow: var(--shadow-sm)')}>{initials}</div>
          <div style={css('flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 6px')}>
            <div style={css('font-family: var(--font-heading); font-size: 26px')}>{email}</div>
            <div style={css('font-size: 15px; color: var(--color-neutral-700)')}>Signed in with Google</div>
          </div>
          <button type="button" onClick={() => { signOut(); navigate('/'); }} className="btn btn-secondary" style={css('border-radius: 999px; padding: 12px 24px')}>Sign out</button>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3.5">
          <div>
            <h2 style={css('margin: 0; font-size: clamp(24px, 2.6vw, 34px)')}>Routers on the network</h2>
            <p style={css('margin: 6px 0 0; font-size: 15px; color: var(--color-neutral-700); max-width: 56ch')}>Every router currently reporting in. Select one to open its dashboard.</p>
          </div>
          <span className="tag tag-neutral" style={css('border-radius: 999px')}>{devices.length} reporting</span>
        </div>

        {devices.length ? (
          <div className="flex flex-col gap-3.5">
            {devices.map((id) => (
              <div key={id} className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 18px 22px; display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0')}>
                <span style={css('font-family: ui-monospace, monospace; font-size: 15px; color: var(--color-neutral-900); flex: 1 1 0; min-width: 0')}>{id}</span>
                <div style={css('margin-left: auto; flex: none; display: flex; align-items: center; gap: 10px')}>
                  <span className="tag" style={{ borderRadius: 999, background: 'var(--color-accent-2-200)', color: 'var(--color-accent-2-900)' }}>Reporting</span>
                  <Link to={'/dashboard?device=' + encodeURIComponent(id)} className="btn btn-secondary" style={css('border-radius: 999px; padding: 9px 16px; font-size: 14px; white-space: nowrap')}>View</Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={css('margin: 0; font-size: 15px; color: var(--color-neutral-700)')}>No routers are reporting right now.</p>
        )}

        <Copyright />
      </main>
    </div>
  );
}
