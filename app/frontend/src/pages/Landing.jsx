import React from 'react';
import Header from '../components/Header.jsx';
import Footer from '../components/Footer.jsx';
import Mascot from '../components/Mascot.jsx';
import FadeWords from '../components/FadeWords.jsx';
import DashboardLink from '../components/DashboardLink.jsx';
import BranchScene from '../scene/BranchScene.jsx';
import { twoPlantsSvg, forestSvg } from '../art/artwork.js';
import { css } from '../lib/css.js';

const STEPS = [
  ['01', 'One plant sends', 'The router covering that plant picks up a change in its electrical activity: water, light, a wound, anything it responds to.', 'sage'],
  ['02', 'Saplink carries it', 'The signal is passed over Wi-Fi, checked against that plant’s resting level, and logged.', 'accent'],
  ['03', 'The neighbour hears it', 'The router covering its neighbours delivers the signal, so they know what is happening next door.', 'sage']
];

const CTA_STYLE = css('border-radius: 999px; padding: 13px 26px; font-size: 16px');

export default function Landing() {
  const [sent, setSent] = React.useState(false);

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
            <span className="tag tag-accent-2" style={css('border-radius: 999px')}><FadeWords text="A Wi-Fi router for plants" /></span>
            <h1 style={css('margin: 0; font-size: clamp(42px, 6.4vw, 84px); line-height: 1.02; text-wrap: balance')}><FadeWords text="Saplink" delayOffset={80} /></h1>
            <p style={css('margin: 0; font-size: clamp(17px, 1.5vw, 20px); line-height: 1.6; color: var(--color-neutral-800); max-width: 56ch; text-wrap: pretty')}>
              <FadeWords delayOffset={180} text="In an old forest the largest trees are the router, passing water, nutrients, and warnings to the seedlings around them. Logging takes those trees first, so Saplink rebuilds that router in hardware: it clips onto a living stem and puts the plant’s signals back on the network within seconds." />
            </p>
            <div className="flex flex-wrap gap-3 items-center" style={css('padding-top: 6px')}>
              <DashboardLink className="btn btn-primary" style={CTA_STYLE}>Open the dashboard</DashboardLink>
            </div>
          </div>
        </section>

        <section id="who" style={css('position: relative; background: var(--color-accent-2-800); color: var(--color-neutral-100); padding: clamp(50px, 9vw, 96px) clamp(20px, 5vw, 64px)')}>
          <h2 style={css('margin: 0 0 10px; font-size: clamp(30px, 3.6vw, 46px); color: var(--color-neutral-100)')}><FadeWords text="How two plants connect" /></h2>
          <p style={css('margin: 0 0 36px; max-width: 52ch; color: var(--color-accent-2-200)')}>
            <FadeWords delayOffset={100} text="Routers are spread across a site, each one reading the plants around it and relaying what it finds to the next. The diagram below simplifies that to two plants, and what one reports reaches the other in about a second." />
          </p>
          <div
            style={css('border-radius: var(--radius-lg); background: color-mix(in srgb, #f9f4ed 8%, transparent); border: 1px solid color-mix(in srgb, #f9f4ed 20%, transparent); padding: clamp(14px, 2vw, 26px)')}
            dangerouslySetInnerHTML={{ __html: twoPlantsSvg }}
          />
          <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 18px; margin-top: 26px')}>
            {STEPS.map(([n, title, body, tone], i) => (
              <div key={n} className="flex flex-col gap-1.5">
                <span className="tag" style={{ borderRadius: 999, alignSelf: 'flex-start', background: tone === 'sage' ? 'var(--color-accent-2-200)' : 'var(--color-accent-200)', color: tone === 'sage' ? 'var(--color-accent-2-900)' : 'var(--color-accent-900)' }}>{n}</span>
                <h3 style={css('margin: 0; font-size: 21px; color: var(--color-neutral-100)')}><FadeWords text={title} delayOffset={i * 60} /></h3>
                <p style={css('margin: 0; color: var(--color-accent-2-200)')}><FadeWords text={body} delayOffset={40 + i * 60} /></p>
              </div>
            ))}
          </div>
        </section>

        <section id="mission" style={css('position: relative; background: var(--color-neutral-100); padding: clamp(50px, 8vw, 92px) clamp(20px, 5vw, 64px)')}>
          <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: clamp(24px, 4vw, 48px); align-items: center')}>
            <div style={css('min-width: 0; display: flex; flex-direction: column; gap: 16px; align-items: flex-start')}>
              <span className="tag tag-accent-2" style={css('border-radius: 999px')}>Our mission</span>
              <h2 style={css('margin: 0; font-size: clamp(28px, 3.4vw, 44px); line-height: 1.08')}>Deforestation cuts the network. Saplink restores it.</h2>
              <p style={css('margin: 0; color: var(--color-neutral-700); max-width: 52ch; line-height: 1.6; text-wrap: pretty')}>
                <FadeWords delayOffset={200} text="Deforestation takes the largest trees first, and the rest of the stand depends on them. Across 176 restoration sites in tropical Asia, 44 percent of planted saplings died within five years, while those planted near standing mature trees survived at roughly 20 percent higher rates." />
              </p>
              <p style={css('margin: 0; color: var(--color-neutral-700); max-width: 52ch; line-height: 1.6; text-wrap: pretty')}>
                <FadeWords delayOffset={340} text="Saplink spreads routers through the plants that remain, so what one of them senses still reaches its neighbours. We are building it for cleared ground that has been replanted and left to recover." />
              </p>
              <p style={css('margin: 0; font-size: 13px; color: var(--color-neutral-600); max-width: 52ch; line-height: 1.5')}>
                Source: Banin et al. (2022), <a href="https://doi.org/10.1098/rstb.2021.0090" target="_blank" rel="noreferrer" style={css('color: inherit')}>The road to recovery: a synthesis of outcomes from ecosystem restoration in tropical and sub-tropical Asian forests</a>, Philosophical Transactions of the Royal Society B.
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
            <h2 style={css('margin: 0; font-size: clamp(32px, 4.4vw, 56px); line-height: 1.05')}><FadeWords text="Put the first router on your site." /></h2>
            <p style={css('margin: 0; color: var(--color-neutral-700); max-width: 46ch')}><FadeWords delayOffset={140} text="A live network belongs to the team running it, so what you can open here is a public demo. Sign in with Google if you want to run Saplink on your own site." /></p>
            <div className="flex flex-wrap gap-3 items-center">
              <DashboardLink className="btn btn-primary" style={CTA_STYLE}>Open the dashboard</DashboardLink>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} style={css('display: flex; flex-wrap: wrap; gap: 10px; width: 100%; max-width: 520px')}>
              <input className="input" type="email" required placeholder="you@example.com" style={css('flex: 1 1 240px; border-radius: 999px; padding: 13px 20px')} />
              <button type="submit" className="btn btn-primary" style={css('border-radius: 999px; padding: 13px 26px; font-size: 16px')}>Request a router</button>
            </form>
            <p style={css('margin: 0; font-size: 13px; color: var(--color-neutral-600)')}>
              {sent ? 'Thanks, we will be in touch about a router.' : 'No spam. One note when routers ship in your area.'}
            </p>
          </div>
        </section>

        <Mascot />
      </div>
      <Footer />
    </>
  );
}
