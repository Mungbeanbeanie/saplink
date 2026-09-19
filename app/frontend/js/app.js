/* Shell: sign-in state, header, and the hash router.
   Routes:  #/  landing   #/how-it-works   #/dashboard   #/account   */
(function (S) {
  S.initials = function (n) { return n.split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); };
  S.copyright = function () { return '<p class="copyright">© Saplink 2026</p>'; };

  var ROUTES = { '': 'landing', 'how-it-works': 'how', dashboard: 'dashboard', account: 'account' };
  var NAV = [
    { route: 'landing', href: '#/', label: 'Overview' },
    { route: 'how', href: '#/how-it-works', label: 'How it works' },
    { route: 'dashboard', href: '#/dashboard', label: 'Dashboard' }
  ];

  var current = null, pendingScroll = null;
  var headerSlot = document.getElementById('header-slot');
  var view = document.getElementById('view');

  function routeFromHash() {
    var h = location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');
    return ROUTES[h] || 'landing';
  }

  function renderHeader() {
    var links = NAV.map(function (n) {
      return '<a class="nav-link' + (n.route === current ? ' is-active' : '') + '" href="' + n.href + '">' + n.label + '</a>';
    }).join('');
    var signedIn = S.auth.get();
    var auth;
    if (signedIn || current === 'account') {
      var label = S.auth.email() || 'Account';
      auth = '<a class="avatar" href="#/account" title="' + label + '">' + S.initials(label.split('@')[0].replace(/[._-]+/g, ' ')) + '</a>';
    } else {
      auth = '<span id="hdr-signin" class="signin-slot"></span>';
    }
    headerSlot.innerHTML =
      '<header class="site-header' + (current === 'landing' ? ' is-scene' : '') + '">' +
      '<a class="brand" href="#/">' + S.svg.logo + 'Saplink</a>' +
      '<nav class="site-nav">' + links + auth + '</nav></header>';
    if (!signedIn && current !== 'account') S.auth.renderButton(document.getElementById('hdr-signin'), { size: 'medium' });
  }

  function render() {
    var name = routeFromHash();
    var prev = current && S.pages[current];
    if (prev && prev.unmount) prev.unmount();
    current = name;
    var page = S.pages[name];
    renderHeader();
    view.innerHTML = page.html();
    document.title = name === 'landing' ? 'Saplink' : 'Saplink · ' + page.title;
    window.scrollTo(0, 0);
    if (page.mount) page.mount(view);
    if (pendingScroll) { var id = pendingScroll; pendingScroll = null; scrollToId(id); }
  }

  function scrollToId(id) {
    if (id === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var target = a.getAttribute('data-scroll');
    if (target) {
      e.preventDefault();
      if (current === 'landing') scrollToId(target);
      else { pendingScroll = target; location.hash = '#/'; }
    } else if (a.getAttribute('href') === '#/' && current === 'landing') {
      e.preventDefault();
      scrollToId('top');
    }
  });

  S.refreshHeader = renderHeader;
  S.auth.onChange(renderHeader);
  window.addEventListener('hashchange', render);
  render();
})(window.Saplink);
