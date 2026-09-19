/* #/account */
(function (S) {
  S.pages.account = {
    title: 'Account',
    html: function () {
      var u = S.user;
      var rows = S.probes.map(function (p) {
        var ok = p.status === 'Reporting';
        return '<div class="card elev-sm panel router">' +
          '<div class="col id"><span class="mono">' + p.id + '</span><h3 class="card-title">' + p.plant + '</h3><span class="latin">' + p.latin + '</span></div>' +
          '<div class="col site"><span class="k">Location</span><span class="v">' + p.site + '</span></div>' +
          '<div class="col"><span class="k">Resting level</span><span class="v mono">' + p.baseline + '</span></div>' +
          '<div class="col"><span class="k">Last reading</span><span class="v">' + p.last + '</span></div>' +
          '<div class="end"><span class="tag ' + (ok ? 'tone-ok' : 'tone-warn') + '">' + p.status + '</span>' +
          '<a href="#/dashboard" class="btn btn-secondary">View</a></div></div>';
      }).join('');
      return '<div class="account">' +
        '<div><div class="card-kicker kicker">Account</div></div>' +
        '<div class="card elev-md panel profile">' +
        '<div class="profile-disc">' + S.initials(u.name) + '</div>' +
        '<div class="profile-main"><div class="profile-name">' + u.name + '</div><div class="profile-email">' + u.email + '</div>' +
        '<div class="profile-tags"><span class="tag tag-accent-2">' + u.role + '</span><span class="tag tag-neutral">' + u.since + '</span></div></div>' +
        '<button type="button" id="sign-out" class="btn btn-secondary btn-md">Sign out</button></div>' +
        '<div class="sec-head"><div><h2>Linked routers</h2><p>Plant routers registered to this account. Anything they pick up appears on your dashboard.</p></div>' +
        '<span class="tag tag-neutral">' + S.probes.length + ' linked</span></div>' +
        '<div class="routers">' + rows + '</div>' + S.copyright() + '</div>';
    },
    mount: function (root) {
      root.querySelector('#sign-out').addEventListener('click', function () {
        S.auth.signOut();
        location.hash = '#/';
      });
    }
  };
})(window.Saplink);
