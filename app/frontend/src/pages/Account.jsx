import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import Copyright from '../components/Copyright.jsx';
import { css } from '../lib/css.js';
import { useAuth } from '../lib/auth.js';
import { roster } from '../data/roster.js';

const tone = (status) => status === 'ok'
  ? { bg: 'var(--color-accent-2-200)', fg: 'var(--color-accent-2-900)', label: 'Reporting' }
  : { bg: 'var(--color-accent-200)', fg: 'var(--color-accent-900)', label: 'Battery low' };

export default function Account() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const initials = user.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <div style={css('min-height: 100vh; background: var(--color-bg)')}>
      <Header />
      <main style={css('padding: clamp(20px, 3vw, 40px) clamp(20px, 5vw, 64px) 80px; display: flex; flex-direction: column; gap: 26px; max-width: 1040px')}>
        <div><div className="card-kicker" style={css('margin-bottom: 6px')}>Account</div></div>

        <div className="card elev-md" style={css('border-radius: var(--radius-lg); padding: clamp(20px, 2.4vw, 30px); display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: clamp(18px, 2.4vw, 30px)')}>
          <div style={css('display: flex; align-items: center; justify-content: center; width: 96px; height: 96px; border-radius: 999px; background: var(--color-accent-2-600); color: var(--color-neutral-100); font-family: var(--font-heading); font-size: 34px; box-shadow: var(--shadow-sm)')}>{initials}</div>
          <div style={css('flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 6px')}>
            <div style={css('font-family: var(--font-heading); font-size: 26px')}>{user.name}</div>
            <div style={css('font-size: 15px; color: var(--color-neutral-700)')}>{user.email}</div>
            <div className="flex flex-wrap gap-2" style={css('margin-top: 6px')}>
              <span className="tag tag-accent-2" style={css('border-radius: 999px')}>{user.role}</span>
              <span className="tag tag-neutral" style={css('border-radius: 999px')}>Joined March 2026</span>
            </div>
          </div>
          <button type="button" onClick={() => { signOut(); navigate('/'); }} className="btn btn-secondary" style={css('border-radius: 999px; padding: 12px 24px')}>Sign out</button>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3.5">
          <div>
            <h2 style={css('margin: 0; font-size: clamp(24px, 2.6vw, 34px)')}>Linked routers</h2>
            <p style={css('margin: 6px 0 0; font-size: 15px; color: var(--color-neutral-700); max-width: 56ch')}>Plant routers registered to this account. Anything they pick up appears on your dashboard.</p>
          </div>
          <span className="tag tag-neutral" style={css('border-radius: 999px')}>{roster.length} linked</span>
        </div>

        <div className="flex flex-col gap-3.5">
          {roster.map((p) => {
            const t = tone(p.status);
            return (
              <div key={p.id} className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 18px 22px; display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0')}>
                <div style={css('flex: 0 1 170px; min-width: 0; display: flex; flex-direction: column; gap: 2px')}>
                  <span style={css('font-family: ui-monospace, monospace; font-size: 13px; color: var(--color-neutral-700)')}>{p.id}</span>
                  <h3 className="card-title" style={css('margin: 0; font-size: 19px')}>{p.plant}</h3>
                  <span style={css('font-size: 14px; font-style: italic; color: var(--color-neutral-700)')}>{p.latin}</span>
                </div>
                <div style={css('flex: 2 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px')}>
                  <span style={css('font-size: 13px; color: var(--color-neutral-700)')}>Location</span>
                  <span style={css('font-size: 15px; color: var(--color-neutral-900)')}>{p.site}</span>
                </div>
                <div style={css('flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px')}>
                  <span style={css('font-size: 13px; color: var(--color-neutral-700)')}>Resting level</span>
                  <span style={css('font-family: ui-monospace, monospace; font-size: 15px; color: var(--color-neutral-900)')}>{p.baseline}</span>
                </div>
                <div style={css('flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px')}>
                  <span style={css('font-size: 13px; color: var(--color-neutral-700)')}>Last reading</span>
                  <span style={css('font-size: 15px; color: var(--color-neutral-900)')}>{p.last}</span>
                </div>
                <div style={css('margin-left: auto; flex: none; display: flex; align-items: center; gap: 10px')}>
                  <span className="tag" style={{ borderRadius: 999, background: t.bg, color: t.fg }}>{t.label}</span>
                  <Link to="/dashboard" className="btn btn-secondary" style={css('border-radius: 999px; padding: 9px 16px; font-size: 14px; white-space: nowrap')}>View</Link>
                </div>
              </div>
            );
          })}
        </div>

        <Copyright />
      </main>
    </div>
  );
}
