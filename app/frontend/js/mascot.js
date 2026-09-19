/* Mascot: a little leaf character on stick arms and legs, fixed in the
   bottom-right corner. Mounted once to <body> (outside #app) so it survives
   route changes instead of being wiped by the router's view swaps. Its eyes
   track the cursor and its free arm waves every once in a while. */
(function (S) {
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var root = document.createElement('div');
  root.className = 'mascot';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML =
    '<svg viewBox="0 0 100 132" width="78" height="103">' +
      '<ellipse cx="50" cy="127" rx="22" ry="4.5" fill="var(--color-neutral-900)" opacity="0.12"></ellipse>' +
      // legs
      '<line x1="50" y1="90" x2="34" y2="122" stroke="#8a6a45" stroke-width="3.4" stroke-linecap="round"></line>' +
      '<line x1="50" y1="90" x2="66" y2="122" stroke="#8a6a45" stroke-width="3.4" stroke-linecap="round"></line>' +
      // static (left) arm
      '<line x1="20" y1="55" x2="2" y2="74" stroke="#8a6a45" stroke-width="3.4" stroke-linecap="round"></line>' +
      // waving (right) arm -- rotates around its shoulder, see .mascot-arm-r
      '<g class="mascot-arm-r"><line x1="80" y1="55" x2="98" y2="74" stroke="#8a6a45" stroke-width="3.4" stroke-linecap="round"></line></g>' +
      // leaf body
      '<path d="M50 12 C 78 20, 88 42, 85 55 C 82 72, 68 88, 50 96 C 32 88, 18 72, 15 55 C 12 42, 22 20, 50 12 Z" fill="var(--color-accent-2-500)"></path>' +
      '<path d="M50 18 L50 90" stroke="var(--color-accent-2-700)" stroke-width="1.6" fill="none" opacity="0.55" stroke-linecap="round"></path>' +
      '<path d="M50 34 L38 26 M50 34 L62 26 M50 52 L35 45 M50 52 L65 45 M50 70 L38 64 M50 70 L62 64" stroke="var(--color-accent-2-700)" stroke-width="1.3" fill="none" opacity="0.4" stroke-linecap="round"></path>' +
      // face
      '<g class="mascot-face">' +
        '<ellipse cx="38" cy="44" rx="7.5" ry="9" fill="var(--color-neutral-100)"></ellipse>' +
        '<ellipse cx="62" cy="44" rx="7.5" ry="9" fill="var(--color-neutral-100)"></ellipse>' +
        '<g class="mascot-pupil" data-pupil="l"><circle cx="38" cy="44" r="3.6" fill="var(--color-neutral-900)"></circle></g>' +
        '<g class="mascot-pupil" data-pupil="r"><circle cx="62" cy="44" r="3.6" fill="var(--color-neutral-900)"></circle></g>' +
        '<path d="M41 58 Q50 65 59 58" stroke="var(--color-neutral-900)" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.7"></path>' +
        '<ellipse cx="27" cy="52" rx="4.2" ry="2.8" fill="var(--color-accent-300)" opacity="0.5"></ellipse>' +
        '<ellipse cx="73" cy="52" rx="4.2" ry="2.8" fill="var(--color-accent-300)" opacity="0.5"></ellipse>' +
      '</g>' +
    '</svg>';
  document.body.appendChild(root);

  var svgEl = root.querySelector('svg');
  var face = root.querySelector('.mascot-face');
  var pupils = root.querySelectorAll('.mascot-pupil');
  var armR = root.querySelector('.mascot-arm-r');

  // Eye geometry from the markup above -- how far a pupil may drift before
  // it starts to leave the white of the eye.
  var EYE_RX = 7.5, EYE_RY = 9, PUPIL_R = 3.6, MARGIN = 0.7;
  var maxX = EYE_RX - PUPIL_R - MARGIN;
  var maxY = EYE_RY - PUPIL_R - MARGIN;
  var MAX_TILT = 10; // degrees the whole face turns toward the cursor

  // Face center in the SVG's 0-100 x 0-132 viewBox, kept in sync with screen
  // space below since the mascot is fixed in place.
  var anchor = { x: 0, y: 0 };

  function updateAnchor() {
    var r = svgEl.getBoundingClientRect();
    anchor.x = r.left + r.width * 0.5;
    anchor.y = r.top + r.height * (44 / 132);
  }

  function look(clientX, clientY) {
    var dx = clientX - anchor.x, dy = clientY - anchor.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dx / dist, ny = dy / dist;
    // Short throw to full deflection -- a modest cursor move already reads
    // as a dramatic look, rather than a slow ease toward the edge of the eye.
    var reach = Math.min(1, dist / 70);
    var ox = nx * maxX * reach, oy = ny * maxY * reach;
    for (var i = 0; i < pupils.length; i++) {
      pupils[i].style.transform = 'translate(' + ox.toFixed(2) + 'px,' + oy.toFixed(2) + 'px)';
    }
    face.style.transform = 'rotate(' + (nx * reach * MAX_TILT).toFixed(2) + 'deg)';
  }

  var queued = false, lastX = 0, lastY = 0;
  function onMouseMove(e) {
    lastX = e.clientX; lastY = e.clientY;
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; look(lastX, lastY); });
  }

  window.addEventListener('resize', updateAnchor);
  document.addEventListener('mousemove', onMouseMove);
  updateAnchor();

  // Wave hello every once in a while, on an irregular timer.
  function scheduleWave() {
    var delay = 6000 + Math.random() * 9000; // roughly every 6-15s
    setTimeout(function () {
      armR.classList.add('is-waving');
      armR.addEventListener('animationend', function onEnd() {
        armR.removeEventListener('animationend', onEnd);
        armR.classList.remove('is-waving');
        scheduleWave();
      });
    }, delay);
  }
  if (!reduceMotion) scheduleWave();
})(window.Saplink);
