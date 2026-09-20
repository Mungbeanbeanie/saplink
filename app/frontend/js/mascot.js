/* Corner mascot. Hover/focus shows a smile (CSS); a click or tap makes it hop and smile for a moment. */
(function () {
  var el = document.getElementById('mascot');
  if (!el) return;
  var t = null;
  el.addEventListener('click', function () {
    el.classList.remove('is-hop');
    void el.offsetWidth;                 // restart the animation on quick repeat taps
    el.classList.add('is-hop', 'is-happy');
    clearTimeout(t);
    t = setTimeout(function () { el.classList.remove('is-hop', 'is-happy'); }, 1100);
  });
})();
