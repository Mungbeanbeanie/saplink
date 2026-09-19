import React, { useEffect, useRef } from 'react';

// A little leaf character on stick arms and legs, fixed in the bottom-right
// corner. Mounted once at the app root (see main.jsx) so it survives route
// changes. Its eyes track the cursor and its free arm waves every once in a
// while, on an irregular timer.
export default function Mascot() {
  const svgRef = useRef(null);
  const faceRef = useRef(null);
  const pupilLRef = useRef(null);
  const pupilRRef = useRef(null);
  const armRRef = useRef(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const svgEl = svgRef.current;
    const face = faceRef.current;
    const pupils = [pupilLRef.current, pupilRRef.current];
    const armR = armRRef.current;

    // Eye geometry from the markup below -- how far a pupil may drift before
    // it starts to leave the white of the eye.
    const EYE_RX = 7.5, EYE_RY = 9, PUPIL_R = 3.6, MARGIN = 0.7;
    const maxX = EYE_RX - PUPIL_R - MARGIN;
    const maxY = EYE_RY - PUPIL_R - MARGIN;
    const MAX_TILT = 10; // degrees the whole face turns toward the cursor

    // Face center in the SVG's 0-100 x 0-132 viewBox, kept in sync with
    // screen space below since the mascot is fixed in place.
    const anchor = { x: 0, y: 0 };
    const updateAnchor = () => {
      const r = svgEl.getBoundingClientRect();
      anchor.x = r.left + r.width * 0.5;
      anchor.y = r.top + r.height * (44 / 132);
    };

    const look = (clientX, clientY) => {
      const dx = clientX - anchor.x, dy = clientY - anchor.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist, ny = dy / dist;
      // Short throw to full deflection -- a modest cursor move already reads
      // as a dramatic look, rather than a slow ease toward the edge of the eye.
      const reach = Math.min(1, dist / 70);
      const ox = nx * maxX * reach, oy = ny * maxY * reach;
      pupils.forEach((p) => { if (p) p.style.transform = 'translate(' + ox.toFixed(2) + 'px,' + oy.toFixed(2) + 'px)'; });
      if (face) face.style.transform = 'rotate(' + (nx * reach * MAX_TILT).toFixed(2) + 'deg)';
    };

    let queued = false, lastX = 0, lastY = 0;
    const onMouseMove = (e) => {
      lastX = e.clientX; lastY = e.clientY;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; look(lastX, lastY); });
    };

    window.addEventListener('resize', updateAnchor);
    document.addEventListener('mousemove', onMouseMove);
    updateAnchor();

    // Wave hello every once in a while, on an irregular timer.
    let waveTimer = null;
    const onWaveEnd = () => {
      armR.classList.remove('is-waving');
      scheduleWave();
    };
    function scheduleWave() {
      const delay = 6000 + Math.random() * 9000; // roughly every 6-15s
      waveTimer = setTimeout(() => {
        armR.classList.add('is-waving');
        armR.addEventListener('animationend', onWaveEnd, { once: true });
      }, delay);
    }
    if (!reduceMotion && armR) scheduleWave();

    return () => {
      window.removeEventListener('resize', updateAnchor);
      document.removeEventListener('mousemove', onMouseMove);
      if (waveTimer) clearTimeout(waveTimer);
      if (armR) armR.removeEventListener('animationend', onWaveEnd);
    };
  }, []);

  return (
    <div className="mascot" aria-hidden="true">
      <svg ref={svgRef} viewBox="0 0 100 132" width="78" height="103">
        <ellipse cx="50" cy="127" rx="22" ry="4.5" fill="var(--color-neutral-900)" opacity="0.12" />
        {/* legs */}
        <line x1="50" y1="90" x2="34" y2="122" stroke="#8a6a45" strokeWidth="3.4" strokeLinecap="round" />
        <line x1="50" y1="90" x2="66" y2="122" stroke="#8a6a45" strokeWidth="3.4" strokeLinecap="round" />
        {/* static (left) arm */}
        <line x1="20" y1="55" x2="2" y2="74" stroke="#8a6a45" strokeWidth="3.4" strokeLinecap="round" />
        {/* waving (right) arm -- rotates around its shoulder, see .mascot-arm-r */}
        <g ref={armRRef} className="mascot-arm-r">
          <line x1="80" y1="55" x2="98" y2="74" stroke="#8a6a45" strokeWidth="3.4" strokeLinecap="round" />
        </g>
        {/* leaf body */}
        <path d="M50 12 C 78 20, 88 42, 85 55 C 82 72, 68 88, 50 96 C 32 88, 18 72, 15 55 C 12 42, 22 20, 50 12 Z" fill="var(--color-accent-2-500)" />
        <path d="M50 18 L50 90" stroke="var(--color-accent-2-700)" strokeWidth="1.6" fill="none" opacity="0.55" strokeLinecap="round" />
        <path d="M50 34 L38 26 M50 34 L62 26 M50 52 L35 45 M50 52 L65 45 M50 70 L38 64 M50 70 L62 64" stroke="var(--color-accent-2-700)" strokeWidth="1.3" fill="none" opacity="0.4" strokeLinecap="round" />
        {/* face */}
        <g ref={faceRef} className="mascot-face">
          <ellipse cx="38" cy="44" rx="7.5" ry="9" fill="var(--color-neutral-100)" />
          <ellipse cx="62" cy="44" rx="7.5" ry="9" fill="var(--color-neutral-100)" />
          <g ref={pupilLRef} className="mascot-pupil"><circle cx="38" cy="44" r="3.6" fill="var(--color-neutral-900)" /></g>
          <g ref={pupilRRef} className="mascot-pupil"><circle cx="62" cy="44" r="3.6" fill="var(--color-neutral-900)" /></g>
          <path d="M41 58 Q50 65 59 58" stroke="var(--color-neutral-900)" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
          <ellipse cx="27" cy="52" rx="4.2" ry="2.8" fill="var(--color-accent-300)" opacity="0.5" />
          <ellipse cx="73" cy="52" rx="4.2" ry="2.8" fill="var(--color-accent-300)" opacity="0.5" />
        </g>
      </svg>
    </div>
  );
}
