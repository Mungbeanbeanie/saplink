import React, { useEffect, useRef } from 'react';

// A little seed character with stick legs (and one waving arm) and a sprout
// on its head, fixed in the bottom-right corner. Mounted once at the app
// root (see main.jsx) so it survives route changes. Its eyes track the
// cursor and its free arm waves every once in a while, on an irregular timer.
export default function Mascot() {
  const svgRef = useRef(null);
  const faceRef = useRef(null);
  const eyeLRef = useRef(null);
  const eyeRRef = useRef(null);
  const armRRef = useRef(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const svgEl = svgRef.current;
    const face = faceRef.current;
    const eyes = [eyeLRef.current, eyeRRef.current];
    const armR = armRRef.current;

    // How far an eye may drift from its resting spot while still reading as
    // part of the face, not a detached dot.
    const MAX_EYE_OFFSET = 3.2;
    const MAX_TILT = 10; // degrees the whole face turns toward the cursor

    // Face center in the SVG's 0-100 x 0-130 viewBox, kept in sync with
    // screen space below since the mascot is fixed in place.
    const anchor = { x: 0, y: 0 };
    const updateAnchor = () => {
      const r = svgEl.getBoundingClientRect();
      anchor.x = r.left + r.width * 0.5;
      anchor.y = r.top + r.height * (50 / 130);
    };

    const look = (clientX, clientY) => {
      const dx = clientX - anchor.x, dy = clientY - anchor.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist, ny = dy / dist;
      // Short throw to full deflection -- a modest cursor move already reads
      // as a dramatic look, rather than a slow ease toward the edge of the eye.
      const reach = Math.min(1, dist / 70);
      const ox = nx * MAX_EYE_OFFSET * reach, oy = ny * MAX_EYE_OFFSET * reach;
      eyes.forEach((e) => { if (e) e.style.transform = 'translate(' + ox.toFixed(2) + 'px,' + oy.toFixed(2) + 'px)'; });
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
      <svg ref={svgRef} viewBox="0 0 100 130" width="78" height="101">
        <ellipse cx="50" cy="125" rx="22" ry="4.5" fill="var(--color-neutral-900)" opacity="0.12" />
        {/* legs */}
        <line x1="50" y1="98" x2="34" y2="124" stroke="#8a6a45" strokeWidth="3.4" strokeLinecap="round" />
        <line x1="50" y1="98" x2="66" y2="124" stroke="#8a6a45" strokeWidth="3.4" strokeLinecap="round" />
        {/* static (left) arm */}
        <line x1="18" y1="60" x2="0" y2="80" stroke="#8a6a45" strokeWidth="3.4" strokeLinecap="round" />
        {/* waving (right) arm -- rotates around its shoulder, see .mascot-arm-r */}
        <g ref={armRRef} className="mascot-arm-r">
          <line x1="82" y1="60" x2="100" y2="80" stroke="#8a6a45" strokeWidth="3.4" strokeLinecap="round" />
        </g>
        {/* seed body */}
        <path d="M50 20 C 72 20, 84 40, 84 62 C 84 86, 68 100, 50 100 C 32 100, 16 86, 16 62 C 16 40, 28 20, 50 20 Z" fill="#ad8d63" />
        <ellipse cx="50" cy="90" rx="24" ry="9" fill="#8a6a45" opacity="0.15" />
        <path d="M50 24 C 58 40, 58 62, 50 96" stroke="#8a6a45" strokeWidth="1.6" fill="none" opacity="0.35" strokeLinecap="round" />
        {/* sprout on top */}
        <line x1="50" y1="20" x2="50" y2="4" stroke="var(--color-accent-2-700)" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="39" cy="9" rx="9.5" ry="5.5" fill="var(--color-accent-2-500)" transform="rotate(-35 39 9)" />
        <ellipse cx="61" cy="9" rx="9.5" ry="5.5" fill="var(--color-accent-2-500)" transform="rotate(35 61 9)" />
        {/* face -- two simple eyes and a smile */}
        <g ref={faceRef} className="mascot-face">
          <g ref={eyeLRef} className="mascot-pupil"><circle cx="40" cy="50" r="4.2" fill="var(--color-neutral-900)" /></g>
          <g ref={eyeRRef} className="mascot-pupil"><circle cx="60" cy="50" r="4.2" fill="var(--color-neutral-900)" /></g>
          <path d="M40 62 Q50 68 60 62" stroke="var(--color-neutral-900)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
