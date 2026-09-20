/* Shell: sign-in state, header, and the hash router.
   Routes:  #/  landing   #/how-it-works   #/dashboard   #/account   */
(function (S) {
  var AUTH_KEY = 'saplink.signedIn';
  var memAuth = false;

  S.user = { name: 'Rowan Ashfield', email: 'r.ashfield@wealdtrust.org', role: 'Conservation lead', since: 'Joined March 2026' };
  S.initials = function (n) { return n.split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); };

  S.auth = {
    get: function () { try { return localStorage.getItem(AUTH_KEY) === '1'; } catch (e) { return memAuth; } },
    signIn: function () { memAuth = true; try { localStorage.setItem(AUTH_KEY, '1'); } catch (e) {} },
    signOut: function () { memAuth = false; try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }
  };

  S.googleButton = function (large) {
    return '<a href="#/account" data-signin class="btn btn-secondary btn-light btn-google' + (large ? ' btn-lg' : '') + '">' + S.svg.google + 'Sign in</a>';
  };
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
    var auth = (S.auth.get() || current === 'account')
      ? '<a class="avatar" href="#/account" title="' + S.user.name + '">' + S.initials(S.user.name) + '</a>'
      : S.googleButton(false);
    headerSlot.innerHTML =
      '<header class="site-header' + (current === 'landing' ? ' is-scene' : '') + '">' +
      '<a class="brand" href="#/">' + S.svg.logo + 'Saplink</a>' +
      '<nav class="site-nav">' + links + auth + '</nav></header>';
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
    if (a.hasAttribute('data-signin')) { S.auth.signIn(); setTimeout(renderHeader, 0); }
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
  window.addEventListener('hashchange', render);
  render();
})(window.Saplink);
