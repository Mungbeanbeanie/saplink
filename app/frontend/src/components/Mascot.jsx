import React, { useEffect, useRef } from 'react';

// The Saplink mascot: a sprouting seed, fixed in the bottom-right corner.
// Artwork inlined verbatim from media/saplink-mascot/saplink-mascot.svg (idle,
// bar eyes) and saplink-mascot-smiling.svg (happy, arc eyes + smile) -- inline
// rather than an <img> because the eye group needs a ref to follow the cursor.
// Mounted once at the app root (see main.jsx) so it survives route changes.
// Its eyes track the cursor everywhere on the page; it only smiles while the
// cursor is actually hovering it (plain CSS :hover -- see index.css), and it
// blinks on an irregular timer.
export default function Mascot() {
  const svgRef = useRef(null);
  const faceRef = useRef(null);
  const eyesRef = useRef(null);
  const blinkRef = useRef(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const svgEl = svgRef.current;
    const face = faceRef.current;
    const eyes = eyesRef.current;
    const blinker = blinkRef.current;

    // How far the eyes may drift from their resting spot, in viewBox units
    // (the box is 320 wide), while still reading as part of the face.
    const MAX_EYE_OFFSET = 12;
    const MAX_TILT = 8; // degrees the whole face turns toward the cursor

    // Face center in the SVG's "200 140 320 420" viewBox, kept in sync with
    // screen space below since the mascot is fixed in place.
    const anchor = { x: 0, y: 0 };
    const updateAnchor = () => {
      const r = svgEl.getBoundingClientRect();
      anchor.x = r.left + r.width * 0.5;
      anchor.y = r.top + r.height * 0.54; // eyes sit at y~368 of 140..560
    };

    const look = (clientX, clientY) => {
      const dx = clientX - anchor.x, dy = clientY - anchor.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist, ny = dy / dist;
      // Short throw to full deflection -- a modest cursor move already reads
      // as a dramatic look, rather than a slow ease toward the edge of the eye.
      const reach = Math.min(1, dist / 70);
      const ox = nx * MAX_EYE_OFFSET * reach, oy = ny * MAX_EYE_OFFSET * reach;
      if (eyes) eyes.style.transform = 'translate(' + ox.toFixed(2) + 'px,' + oy.toFixed(2) + 'px)';
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

    // Blink every once in a while, on an irregular timer.
    let blinkTimer = null, openTimer = null;
    function scheduleBlink() {
      blinkTimer = setTimeout(() => {
        blinker.classList.add('is-blinking');
        openTimer = setTimeout(() => {
          blinker.classList.remove('is-blinking');
          scheduleBlink();
        }, 110);
      }, 3000 + Math.random() * 4000); // roughly every 3-7s
    }
    if (!reduceMotion && blinker) scheduleBlink();

    return () => {
      window.removeEventListener('resize', updateAnchor);
      document.removeEventListener('mousemove', onMouseMove);
      if (blinkTimer) clearTimeout(blinkTimer);
      if (openTimer) clearTimeout(openTimer);
    };
  }, []);

  return (
    <div className="mascot" aria-hidden="true">
      <svg ref={svgRef} viewBox="200 140 320 420" width="78" height="102">
        <ellipse className="m-shadow" cx="360" cy="541" rx="121" ry="11" fill="#e3d6c6" />
        <g className="m-body-g">
          {/* legs */}
          <g stroke="#8a5a3a" strokeWidth="11" strokeLinecap="round" fill="none">
            <path d="M331 500 L333 527" /><path d="M395 498 L398 525" />
          </g>
          {/* seed body */}
          <ellipse cx="362" cy="388" rx="141" ry="113" fill="#b98b67" stroke="#8a5a3a" strokeWidth="10" />
          {/* sprout on top */}
          <g className="m-sprout">
            <path d="M355 294 Q349 252 353 218" stroke="#6fa07e" strokeWidth="11" strokeLinecap="round" fill="none" />
            <path d="M262 222 Q300 196 351 217 Q352 232 340 238 Q300 250 262 222Z" fill="#86bb96" />
            <path d="M279 222 L344 224" stroke="#bfe0c7" strokeWidth="4.5" strokeLinecap="round" fill="none" />
            <path d="M350 220 Q366 166 443 158 Q441 214 386 224 Q365 227 350 220Z" fill="#86bb96" />
            <path d="M362 217 L430 168" stroke="#bfe0c7" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          </g>
          {/* shell highlight */}
          <path d="M254 358 Q262 308 332 299" stroke="#d0ad8e" strokeWidth="12" strokeLinecap="round" fill="none" opacity=".85" />
          {/* face -- idle bar eyes (tracking) or the happy arcs + smile */}
          <g ref={faceRef} className="mascot-face">
            <g ref={eyesRef} className="mascot-eyes">
              <g ref={blinkRef} className="m-face-idle" stroke="#4a2e1c" strokeWidth="10" strokeLinecap="round" fill="none">
                <path d="M323 347 L325 389" /><path d="M398 346 L400 390" />
              </g>
            </g>
            <g className="m-face-happy" stroke="#4a2e1c" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none">
              <path d="M306 372 Q324 344 342 372" /><path d="M381 372 Q399 344 417 372" />
              <path d="M338 410 Q361 436 384 410" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
