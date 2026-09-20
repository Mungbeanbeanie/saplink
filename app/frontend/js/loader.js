/* Intro loader: plays the droplet-and-puddle clip over the page, then fades into the site.
   - Plays once per browser session (sessionStorage), and never for people who prefer reduced motion.
   - The clip runs to CUT seconds (the moment the water fills the screen) and the page fades in from there,
     but only once the page itself has finished loading.
   - Skip button, and every failure path (video won't load or play, stalls, takes too long) just opens the site. */
(function () {
  var el = document.getElementById('loader');
  if (!el) return;
  var video = el.querySelector('video'), skip = el.querySelector('.loader-skip');
  var CUT = 5.0, START_TIMEOUT = 3500, MAX = 9000;
  var done = false, pageReady = document.readyState === 'complete', ticker = null;

  function finish() {
    if (done) return;
    done = true;
    clearInterval(ticker);
    try { sessionStorage.setItem('saplink.intro', '1'); } catch (e) {}
    el.classList.add('is-leaving');
    document.documentElement.classList.remove('is-loading');
    setTimeout(function () {
      try { video.pause(); } catch (e) {}
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 800);
  }
  function check() {
    if (done || !pageReady) return;
    if (video.currentTime >= CUT || video.ended) finish();
  }

  window.addEventListener('load', function () { pageReady = true; check(); });
  skip.addEventListener('click', finish);
  video.addEventListener('ended', check);
  video.addEventListener('error', finish);
  var sources = video.querySelectorAll('source');   // only the last source failing means nothing is playable
  if (sources.length) sources[sources.length - 1].addEventListener('error', finish);
  video.addEventListener('playing', function () { started = true; });
  var started = false;
  ticker = setInterval(check, 100);
  setTimeout(function () { if (!started) finish(); }, START_TIMEOUT);
  setTimeout(finish, MAX);

  var p = video.play();
  if (p && p.catch) p.catch(finish);   // autoplay blocked
})();
