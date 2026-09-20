import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import Footer from '../components/Footer.jsx';
import Mascot from '../components/Mascot.jsx';
import BranchScene from '../scene/BranchScene.jsx';
import { twoPlantsSvg, forestSvg } from '../art/artwork.js';
import { css } from '../lib/css.js';
import { useHealth } from '../lib/useHealth.js';
import { useAuth, isConfigured, promptSignIn } from '../lib/auth.js';

const STEPS = [
  ['01', 'One plant sends', 'Its router picks up a change in the plant’s electrical activity — water, light, a wound, anything it responds to.', 'sage'],
  ['02', 'Saplink carries it', 'The signal is passed over Wi-Fi, checked against that plant’s resting level, and logged.', 'accent'],
  ['03', 'The neighbour hears it', 'The neighbouring plant’s router delivers the signal, so it knows what is happening next door.', 'sage']
];

const CTA_STYLE = css('border-radius: 999px; padding: 13px 26px; font-size: 16px');

// "Open the dashboard": signed-in visitors go straight there; signed-out
// visitors are asked to sign in with Google first, then land on the
// dashboard once that completes.
function DashboardCta() {
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const [wantsDashboard, setWantsDashboard] = React.useState(false);

  React.useEffect(() => {
    if (wantsDashboard && signedIn) navigate('/dashboard');
  }, [wantsDashboard, signedIn, navigate]);

  if (signedIn) {
    return <Link to="/dashboard" className="btn btn-primary" style={CTA_STYLE}>Open the dashboard</Link>;
  }
  return (
    <button
      type="button"
      className="btn btn-primary"
      style={CTA_STYLE}
      title={isConfigured() ? undefined : 'Google sign-in needs VITE_GOOGLE_CLIENT_ID set -- see .env.example'}
      onClick={() => { setWantsDashboard(true); promptSignIn(); }}
    >
      Open the dashboard
    </button>
  );
}

export default function Landing() {
  const { health, error } = useHealth(15000);
  const [sent, setSent] = React.useState(false);

  const online = !!(health && health.ok);
  const ago = health && health.last_recv ? Math.max(0, Math.round((Date.now() - health.last_recv) / 1000)) : null;

  return (
    <>
      <div style={css('position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: -1')}>
        <BranchScene branchLayout="Overhead canopy" windStrength={1} motionSpeed={1} parallaxDepth={1} showDrips={false} />
      </div>

      <div style={css('position: relative; z-index: 1')}>
        <Header translucent />

        <section id="top" style={css('position: relative; min-height: 82vh; display: flex; align-items: center; padding: clamp(40px, 9vh, 110px) clamp(20px, 5vw, 64px) clamp(60px, 12vh, 140px)')}>
          <div style={css('position: relative; max-width: 680px; display: flex; flex-direction: column; align-items: flex-start; gap: 22px')}>
            <div style={css('position: absolute; inset: -190px -260px -170px -240px; z-index: -1; backdrop-filter: blur(16px); mask-image: radial-gradient(62% 58% at 40% 50%, #000 0%, #000 34%, rgba(0,0,0,.55) 62%, transparent 90%); -webkit-mask-image: radial-gradient(62% 58% at 40% 50%, #000 0%, #000 34%, rgba(0,0,0,.55) 62%, transparent 90%); pointer-events: none')} />
            <span className="tag tag-accent-2" style={css('border-radius: 999px')}>A Wi-Fi router for plants</span>
            <h1 style={css('margin: 0; font-size: clamp(42px, 6.4vw, 84px); line-height: 1.02; text-wrap: balance')}>Saplink</h1>
            <p style={css('margin: 0; font-size: clamp(17px, 1.5vw, 20px); line-height: 1.6; color: var(--color-neutral-800); max-width: 56ch; text-wrap: pretty')}>
              Saplink is a router for plants. One clips onto a living stem, picks up the electrical signals the plant sends as its conditions change — more water, more light, a wound, a dry spell — and puts them on the network, so nearby plants and you both get the message within seconds.
            </p>
            <div className="flex flex-wrap gap-3 items-center" style={css('padding-top: 6px')}>
              <DashboardCta />
            </div>
            <div style={css('display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-top: 14px; padding: 12px 20px; border-radius: 999px; background: var(--color-neutral-100); border: 1px solid var(--color-neutral-300); box-shadow: var(--shadow-sm); font-size: 13px; color: var(--color-neutral-700)')}>
              <span style={css('display: inline-flex; align-items: center; gap: 9px; font-weight: 600; color: var(--color-neutral-900)')}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: online ? 'var(--color-accent-2-600)' : error ? 'var(--color-accent-600)' : 'var(--color-neutral-400)' }} />
                {online ? 'System online' : error ? 'API unreachable' : 'Checking system…'}
              </span>
              <span>{health && health.devices ? health.devices.length + (health.devices.length === 1 ? ' device' : ' devices') : '— devices'}</span>
              <span>{health && health.batches != null ? health.batches.toLocaleString() + ' batches' : '— batches'}</span>
              <span style={css('color: var(--color-neutral-600)')}>{ago == null ? 'last reading unknown' : 'last reading ' + ago + 's ago'}</span>
            </div>
            <p style={css('margin: 10px 0 0; font-size: 13px; color: var(--color-neutral-600)')}>Live from the monitoring system, refreshed every fifteen seconds.</p>
          </div>
        </section>

        <section id="who" style={css('position: relative; background: var(--color-accent-2-800); color: var(--color-neutral-100); padding: clamp(50px, 9vw, 96px) clamp(20px, 5vw, 64px)')}>
          <h2 style={css('margin: 0 0 10px; font-size: clamp(30px, 3.6vw, 46px); color: var(--color-neutral-100)')}>How two plants connect</h2>
          <p style={css('margin: 0 0 36px; max-width: 52ch; color: var(--color-accent-2-200)')}>
            Each plant gets its own router. Whatever one plant reports — more water, more light, a wound — is carried across the network and delivered to the next plant in about a second.
          </p>
          <div
            style={css('border-radius: var(--radius-lg); background: color-mix(in srgb, #f9f4ed 8%, transparent); border: 1px solid color-mix(in srgb, #f9f4ed 20%, transparent); padding: clamp(14px, 2vw, 26px)')}
            dangerouslySetInnerHTML={{ __html: twoPlantsSvg }}
          />
          <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 18px; margin-top: 26px')}>
            {STEPS.map(([n, title, body, tone]) => (
              <div key={n} className="flex flex-col gap-1.5">
                <span className="tag" style={{ borderRadius: 999, alignSelf: 'flex-start', background: tone === 'sage' ? 'var(--color-accent-2-200)' : 'var(--color-accent-200)', color: tone === 'sage' ? 'var(--color-accent-2-900)' : 'var(--color-accent-900)' }}>{n}</span>
                <h3 style={css('margin: 0; font-size: 21px; color: var(--color-neutral-100)')}>{title}</h3>
                <p style={css('margin: 0; color: var(--color-accent-2-200)')}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="mission" style={css('position: relative; background: var(--color-neutral-100); padding: clamp(50px, 8vw, 92px) clamp(20px, 5vw, 64px)')}>
          <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: clamp(24px, 4vw, 48px); align-items: center')}>
            <div style={css('min-width: 0; display: flex; flex-direction: column; gap: 16px; align-items: flex-start')}>
              <span className="tag tag-accent-2" style={css('border-radius: 999px')}>Our mission</span>
              <h2 style={css('margin: 0; font-size: clamp(28px, 3.4vw, 44px); line-height: 1.08')}>Keep a cleared stand talking while it grows back.</h2>
              <p style={css('margin: 0; color: var(--color-neutral-700); max-width: 52ch; line-height: 1.6; text-wrap: pretty')}>
                Deforestation takes the largest species first. Those trees are the ones the rest of the stand depends on, and when they go the younger plants around them lose the signals that told them what was coming.
              </p>
              <p style={css('margin: 0; color: var(--color-neutral-700); max-width: 52ch; line-height: 1.6; text-wrap: pretty')}>
                Saplink puts a router on the plants that remain, so what one of them senses still reaches its neighbours. We are building it for the ground in between: land that has been cleared, replanted, and left to recover.
              </p>
            </div>
            <div
              style={css('min-width: 0; border-radius: var(--radius-lg); background: var(--color-neutral-200); overflow: hidden')}
              dangerouslySetInnerHTML={{ __html: forestSvg }}
            />
          </div>
        </section>

        <section id="join" style={css('position: relative; background: var(--color-bg); padding: clamp(56px, 10vw, 110px) clamp(20px, 5vw, 64px)')}>
          <div style={css('max-width: 620px; display: flex; flex-direction: column; gap: 18px; align-items: flex-start')}>
            <h2 style={css('margin: 0; font-size: clamp(32px, 4.4vw, 56px); line-height: 1.05')}>Put a router on your first plant.</h2>
            <p style={css('margin: 0; color: var(--color-neutral-700); max-width: 46ch')}>The readings are open to everyone. Sign in with Google to acknowledge signals and send a test signal across the plant network.</p>
            <div className="flex flex-wrap gap-3 items-center">
              <DashboardCta />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} style={css('display: flex; flex-wrap: wrap; gap: 10px; width: 100%; max-width: 520px')}>
              <input className="input" type="email" required placeholder="you@example.com" style={css('flex: 1 1 240px; border-radius: 999px; padding: 13px 20px')} />
              <button type="submit" className="btn btn-primary" style={css('border-radius: 999px; padding: 13px 26px; font-size: 16px')}>Request a router</button>
            </form>
            <p style={css('margin: 0; font-size: 13px; color: var(--color-neutral-600)')}>
              {sent ? 'Thanks — we will be in touch about a router.' : 'No spam. One note when routers ship in your area.'}
            </p>
          </div>
        </section>

        <Mascot />
      </div>
      <Footer />
    </>
  );
}
