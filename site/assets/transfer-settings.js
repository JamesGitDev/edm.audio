(() => {
  'use strict';
  const previousOrigin = 'https://electronicdancemusic.audio';
  const newOrigin = 'https://edm.audio';
  if (![previousOrigin, newOrigin].includes(location.origin)) return;

  const stationIds = new Set(['house', 'techno', 'trance', 'dnb']);
  const fields = {
    saved: ['edm.saved.v1', value => Array.isArray(value) && value.length <= 4 && value.every(id => stationIds.has(id))],
    station: ['edm.station.v1', value => stationIds.has(value)],
    volume: ['edm.volume.v1', value => Number.isFinite(value) && value >= 0 && value <= 1],
  };
  const status = document.getElementById('transfer-status');
  if (location.origin === previousOrigin) {
    const preferences = {};
    for (const [name, [key, valid]] of Object.entries(fields)) {
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (valid(value)) preferences[name] = value;
      } catch {}
    }
    location.replace(newOrigin + '/app/transfer-settings#' + encodeURIComponent(JSON.stringify(preferences)));
    return;
  }

  const fragment = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const pending = [];
  if (fragment.length && fragment.length <= 512) {
    try {
      const preferences = JSON.parse(decodeURIComponent(fragment));
      for (const [name, [key, valid]] of Object.entries(fields)) {
        if (!valid(preferences?.[name]) || localStorage.getItem(key) !== null) continue;
        pending.push([key, preferences[name]]);
      }
    } catch {}
  }
  if (!pending.length) {
    status.textContent = 'There are no new preferences to import from this browser.';
    return;
  }
  status.textContent = 'Copy your saved player preferences to EDM.Audio. Any preferences already set here will be kept.';
  const confirm = document.getElementById('confirm-transfer');
  confirm.hidden = false;
  confirm.addEventListener('click', () => {
    try {
      for (const [key, value] of pending) {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
      }
      status.textContent = 'Your saved preferences are ready on EDM.Audio.';
    } catch {
      status.textContent = 'Your browser could not save the imported preferences.';
    }
    confirm.hidden = true;
  }, { once: true });
})();
