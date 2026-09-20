/* Durable record of every signal (electrical spike) the dashboard has seen. The CSV/JSON download
   exports this whole record, not only what the chart shows.

   Where it lives:
   - In the published page: the artifact's shared database (the `db` capability), one document per
     UTC day at signals/<YYYY-MM-DD> holding that day's events, so a busy plant never runs into the
     document limit.
   - Always mirrored to this browser's localStorage, which is also the fallback when the database is
     not available (for example when the files are opened locally).
   Event shape: { t: ms timestamp, mv, threshold, base: resting mV at the time, sim: true if preview data } */
(function (S) {
  var LS_KEY = 'saplink.signals.v1', COL = 'signals';
  var known = {};          // t -> true, everything already stored
  var chain = Promise.resolve();
  var dbPromise = null;

  function getDb() {
    if (!dbPromise) {
      dbPromise = (window.claude && window.claude.use)
        ? window.claude.use('db').then(function (d) { return d || null; }, function () { return null; })
        : Promise.resolve(null);
    }
    return dbPromise;
  }
  function lsRead() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } }
  function lsWrite(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) {} }
  function dayId(t) { return new Date(t).toISOString().slice(0, 10); }
  function merge(list) {
    var byT = {};
    list.forEach(function (e) { if (e && typeof e.t === 'number') byT[e.t] = Object.assign({}, byT[e.t], e); });
    return Object.keys(byT).map(function (k) { return byT[k]; }).sort(function (a, b) { return a.t - b.t; });
  }
  function clean(e) {
    return { t: e.t, mv: +e.mv, threshold: e.threshold == null ? null : +e.threshold, base: e.base == null ? null : +e.base, sim: !!e.sim };
  }

  S.store = {
    /* Resolves to every stored event, oldest first. Never rejects. */
    load: function () {
      var local = lsRead();
      return getDb().then(function (db) {
        if (!db) return local;
        return db.collection(COL).get().then(function (snap) {
          var all = [];
          snap.docs.forEach(function (d) { var x = d.data(); if (x && x.events) all = all.concat(x.events); });
          return all.concat(local);
        });
      }).catch(function () { return local; }).then(function (all) {
        var list = merge(all);
        list.forEach(function (e) { known[e.t] = true; });
        lsWrite(list);
        return list;
      });
    },

    /* Save events not stored yet. Safe to call with events that already exist. */
    addMany: function (events) {
      var fresh = events.filter(function (e) { return !known[e.t]; }).map(clean);
      if (!fresh.length) return Promise.resolve();
      fresh.forEach(function (e) { known[e.t] = true; });
      lsWrite(merge(lsRead().concat(fresh)));
      // one write at a time, so two quick saves to the same day cannot overwrite each other
      chain = chain.then(function () {
        return getDb().then(function (db) {
          if (!db) return;
          var days = {};
          fresh.forEach(function (e) { (days[dayId(e.t)] = days[dayId(e.t)] || []).push(e); });
          return Promise.all(Object.keys(days).map(function (day) {
            var ref = db.doc(COL + '/' + day);
            return ref.get().then(function (snap) {
              var have = snap.exists && snap.data() && snap.data().events ? snap.data().events : [];
              return ref.set({ day: day, events: merge(have.concat(days[day])) });
            });
          }));
        });
      }).catch(function () { /* the localStorage copy is already saved */ });
      return chain;
    }
  };
})(window.Saplink);
