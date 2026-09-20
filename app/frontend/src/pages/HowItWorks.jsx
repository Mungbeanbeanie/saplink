import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import Footer from '../components/Footer.jsx';
import Mascot from '../components/Mascot.jsx';
import FadeWords from '../components/FadeWords.jsx';
import { css } from '../lib/css.js';

const PILLS = [
  ['Probe', 'var(--color-accent-2-200)', 'var(--color-accent-2-900)', 'var(--color-accent-2-600)'],
  ['Saplink router', 'var(--color-accent-200)', 'var(--color-accent-900)', 'var(--color-accent-600)'],
  ['Plant network', 'var(--color-neutral-200)', 'var(--color-neutral-900)', 'var(--color-neutral-600)'],
  ['Browser', 'var(--color-accent-2-200)', 'var(--color-accent-2-900)', 'var(--color-accent-2-600)']
];

const CARDS = [
  ['01 — Plug in', 'Router on the plant', 'Two small electrodes clip onto the stem and read the plant’s electrical activity, thousandths of a volt at a time. That reading is what the router puts on the network.'],
  ['02 — Join', 'On the network', 'The router runs on a battery and joins your Wi-Fi like any other device. Readings go out in numbered batches, so anything lost on the way shows up as a gap rather than passing unnoticed.'],
  ['03 — Relay', 'Passed between plants', 'A signal from one plant is relayed to the routers on its neighbours, and every reading is kept for the whole season. Anything that moves clear of the plant’s resting level is flagged the moment it lands.'],
  ['04 — Read', 'Dashboard', 'The dashboard shows every router on the network and draws each signal against that plant’s resting level, flagging anything that stands out. Anyone can view it; signing in is only needed to send a test signal.']
];

export default function HowItWorks() {
  return (
    <>
    <div style={css('min-height: 100vh; background: var(--color-bg)')}>
      <Header />
      <main style={css('padding: clamp(30px, 5vw, 70px) clamp(20px, 5vw, 64px) 90px; display: flex; flex-direction: column; gap: clamp(28px, 4vw, 48px)')}>
        <div>
          <div className="card-kicker" style={css('margin-bottom: 8px')}><FadeWords text="How it works" /></div>
          <h1 style={css('margin: 0; font-size: clamp(34px, 5vw, 60px); line-height: 1.04')}><FadeWords text="One router per plant" delayOffset={70} /></h1>
          <p style={css('margin: 14px 0 0; max-width: 60ch; font-size: clamp(16px, 1.4vw, 19px); line-height: 1.6; color: var(--color-neutral-700); text-wrap: pretty')}>
            <FadeWords delayOffset={200} text="Think of it as home Wi-Fi for a hedgerow. Each plant gets a router: it reads the plant’s electrical activity, joins the network, passes whatever that plant reports to the other routers, and keeps a record you can read at a glance." />
          </p>
        </div>

        <div style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(10px, 1.4vw, 20px)')}>
          {PILLS.map(([label, bg, fg, dot], i) => (
            <div key={label} style={css('position: relative; min-width: 0')}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderRadius: 999, background: bg, color: fg, fontWeight: 600, fontSize: 'clamp(13px, 1.05vw, 15px)', minWidth: 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: dot, flex: 'none' }} /><FadeWords text={label} delayOffset={260 + i * 50} />
              </span>
              {i < PILLS.length - 1 && (
                <span style={css('position: absolute; top: 50%; right: -16px; transform: translateY(-50%); color: var(--color-neutral-500); font-size: 18px; line-height: 1')}>→</span>
              )}
            </div>
          ))}
        </div>

        <div style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(10px, 1.4vw, 20px)')}>
          {CARDS.map(([kicker, title, body], i) => (
            <div key={kicker} className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: clamp(14px, 1.8vw, 28px); min-width: 0; overflow-wrap: break-word')}>
              <div className="card-kicker"><FadeWords text={kicker} delayOffset={420 + i * 60} /></div>
              <h3 className="card-title" style={css('font-size: clamp(17px, 1.7vw, 24px)')}><FadeWords text={title} delayOffset={460 + i * 60} /></h3>
              <p className="card-body" style={css('margin: 0; font-size: clamp(13px, 1.05vw, 16px)')}><FadeWords text={body} delayOffset={500 + i * 60} /></p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link to="/dashboard" className="btn btn-primary" style={css('border-radius: 999px; padding: 13px 26px; font-size: 16px')}>See it on the dashboard</Link>
          <Link to="/" className="btn btn-secondary" style={css('border-radius: 999px; padding: 13px 26px; font-size: 16px')}>Back to overview</Link>
        </div>

      </main>
      <Mascot />
    </div>
    <Footer />
    </>
  );
}
