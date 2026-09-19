import React, { useEffect, useRef, useState } from 'react';

const CUT = 5.0;          // seconds into the clip where the puddle fills the screen
const START_TIMEOUT = 3500;
const MAX = 9000;

// Plays the droplet-and-puddle clip over the page once per browser session,
// then fades into the site. Never plays for people who prefer reduced motion.
// Skip button, and every failure path (video won't load or play, stalls,
// takes too long) just opens the site.
export default function IntroLoader() {
  const [show, setShow] = useState(false); // mounted at all
  const [leaving, setLeaving] = useState(false);
  const videoRef = useRef(null);
  const skipRef = useRef(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem('saplink.intro') === '1'; } catch (e) {}
    const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (seen || calm) return;
    document.documentElement.classList.add('is-loading');
    setShow(true);
  }, []);

  useEffect(() => {
    if (!show) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    let pageReady = document.readyState === 'complete';
    let started = false;
    let ticker = null;

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearInterval(ticker);
      try { sessionStorage.setItem('saplink.intro', '1'); } catch (e) {}
      setLeaving(true);
      document.documentElement.classList.remove('is-loading');
      setTimeout(() => {
        try { video.pause(); } catch (e) {}
        setShow(false);
      }, 800);
    };
    const check = () => {
      if (doneRef.current || !pageReady) return;
      if (video.currentTime >= CUT || video.ended) finish();
    };
    const onLoad = () => { pageReady = true; check(); };
    const onPlaying = () => { started = true; };

    window.addEventListener('load', onLoad);
    video.addEventListener('ended', check);
    video.addEventListener('error', finish);
    video.addEventListener('playing', onPlaying);
    const sources = video.querySelectorAll('source');
    const lastSource = sources[sources.length - 1];
    if (lastSource) lastSource.addEventListener('error', finish);
    const skip = skipRef.current;
    if (skip) skip.addEventListener('click', finish);

    ticker = setInterval(check, 100);
    const startTimer = setTimeout(() => { if (!started) finish(); }, START_TIMEOUT);
    const maxTimer = setTimeout(finish, MAX);

    const p = video.play();
    if (p && p.catch) p.catch(finish);

    return () => {
      window.removeEventListener('load', onLoad);
      video.removeEventListener('ended', check);
      video.removeEventListener('error', finish);
      video.removeEventListener('playing', onPlaying);
      if (lastSource) lastSource.removeEventListener('error', finish);
      if (skip) skip.removeEventListener('click', finish);
      clearInterval(ticker);
      clearTimeout(startTimer);
      clearTimeout(maxTimer);
    };
  }, [show]);

  if (!show) return null;

  return (
    <div className={'loader' + (leaving ? ' is-leaving' : '')} role="status" aria-label="Loading Saplink">
      <video ref={videoRef} className="loader-video" muted autoPlay playsInline preload="auto" poster="/media/loader-poster.jpg">
        <source src="/media/saplink-puddle.webm" type="video/webm" />
        <source src="/media/saplink-puddle.mp4" type="video/mp4" />
      </video>
      <button ref={skipRef} type="button" className="btn btn-secondary btn-light loader-skip">
        Skip
      </button>
    </div>
  );
}
