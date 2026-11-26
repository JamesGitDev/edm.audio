(() => {
  'use strict';
  const config = window.EDM_ANALYTICS_CONFIG || {};
  const id = config.measurementId;
  const key = 'edm.analytics-consent.v1';
  const host = 'electronicdancemusic.audio';
  const configured = /^G-[A-Z0-9]{6,20}$/.test(id || '') && config.enhancedMeasurementDisabled === true;
  const allowedPage = location.protocol === 'https:' && location.hostname === host && ['/', '/index.html'].includes(location.pathname);
  const optOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  let enabled = false, loaded = false, pageSent = false;
  let screen = 'Home', playback = 'paused', station = null, since = performance.now(), foreground = document.visibilityState === 'visible';
  const views = new Set(['Home', 'Search', 'Library', 'Privacy', 'Terms', 'Install', 'About']);
  function resetTiming() { since = performance.now(); }
  function flush() {
    const now = performance.now(), elapsed = Math.min(120000, Math.max(0, Math.round(now - since))); since = now;
    if (!elapsed || !enabled || !loaded || !configured || !allowedPage || optOut) return;
    const params = {screen, page_location:'https://' + host + '/', page_referrer:'', page_title:'ElectronicDanceMusic.Audio', send_to:id};
    if (foreground) {
      tag('event', 'foreground_time', {...params, foreground_duration_ms:elapsed});
      tag('event', 'screen_time', {...params, screen_duration_ms:elapsed});
    }
    if (playback === 'playing' || playback === 'buffering') {
      const playing = playback === 'playing';
      tag('event', playing ? 'playback_time' : 'buffering_time', {...params, playback_mode:'preview', ...(stationIds.has(station) ? {station} : {}), [playing ? 'playback_duration_ms' : 'buffering_duration_ms']:elapsed});
    }
  }
  function view(value) { if (!views.has(value) || value === screen) return; flush(); screen = value; resetTiming(); }
  function state(value, selected) {
    if (!['playing','buffering','paused'].includes(value)) return;
    flush(); playback = value; station = stationIds.has(selected) ? selected : null; resetTiming();
  }
  function choice() { try { const value = JSON.parse(localStorage.getItem(key)); return typeof value === 'boolean' ? value : null; } catch { return null; } }
  function remember(value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
  function tag() { (window.dataLayer = window.dataLayer || []).push(arguments); }
  function removeCookies() {
    for (const item of document.cookie.split(';')) {
      const name = item.split('=')[0].trim();
      if (!/^_ga(?:_|$)|^_gid$|^_gat(?:_|$)/.test(name)) continue;
      for (const domain of ['', host, '.' + host]) document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax; Secure' + (domain ? '; Domain=' + domain : '');
    }
  }
  function start() {
    if (!configured || !allowedPage || optOut || !enabled) return;
    window['ga-disable-' + id] = false;
    if (!loaded) {
      loaded = true;
      window.gtag = tag;
      tag('consent', 'default', {analytics_storage:'denied', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'});
      tag('set', 'ads_data_redaction', true);
      tag('set', 'url_passthrough', false);
      tag('set', {page_location:'https://' + host + '/', page_referrer:'', page_title:'ElectronicDanceMusic.Audio'});
      tag('consent', 'update', {analytics_storage:'granted', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'});
      tag('js', new Date());
      tag('config', id, {send_page_view:false, allow_google_signals:false, allow_ad_personalization_signals:false, cookie_flags:'SameSite=Lax;Secure', cookie_expires:2592000, page_location:'https://' + host + '/', page_referrer:'', page_title:'ElectronicDanceMusic.Audio'});
      const script = document.createElement('script');
      script.id = 'edm-google-analytics'; script.async = true; script.referrerPolicy = 'no-referrer';
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
      document.head.append(script);
    } else tag('consent', 'update', {analytics_storage:'granted', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'});
    if (!pageSent) { pageSent = true; event('page_view'); }
  }
  const events = new Set(['page_view', 'playback_started', 'playback_paused', 'playback_error', 'select_station', 'save_station', 'remove_saved_station', 'open_search', 'open_library', 'download_app', 'share_site', 'playback_retry', 'playback_buffering', 'page_departure']);
  const stationIds = new Set(['house', 'techno', 'trance', 'dnb']);
  function event(name, station) {
    if (!enabled || !configured || !allowedPage || optOut || !loaded || !events.has(name)) return;
    const params = {send_to:id, page_location:'https://' + host + '/', page_referrer:'', page_title:'ElectronicDanceMusic.Audio'};
    if (stationIds.has(station)) params.station = station;
    tag('event', name, params);
  }
  function render() {
    document.getElementById('analytics-consent')?.toggleAttribute('hidden', !configured || !allowedPage || optOut || choice() !== null);
    const status = document.getElementById('analytics-status');
    if (status) status.textContent = optOut ? 'Off — respecting your browser privacy preference.' : enabled ? 'On for this browser.' : 'Off for this browser.';
    const allow = document.getElementById('analytics-enable'); if (allow) allow.disabled = !configured || optOut || enabled;
    const deny = document.getElementById('analytics-disable'); if (deny) deny.disabled = !configured || (!enabled && choice() === false);
  }
  function consent(value) {
    // Discard all unreported time when withdrawing; enabling starts a fresh baseline.
    resetTiming();
    enabled = value === true && configured && allowedPage && !optOut;
    if (!remember(enabled)) enabled = false;
    if (enabled) start();
    else {
      if (configured) window['ga-disable-' + id] = true;
      if (loaded) tag('consent', 'update', {analytics_storage:'denied', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'});
      removeCookies();
    }
    render();
  }
  // Fixed event names and fixed public station slugs only. Never accept arbitrary payloads.
  window.EDM_ANALYTICS = Object.freeze({event, consent, view, state, isEnabled:() => enabled});
  document.querySelectorAll('[data-analytics-choice]').forEach(button => button.addEventListener('click', () => consent(button.dataset.analyticsChoice === 'allow')));
  document.getElementById('analytics-enable')?.addEventListener('click', () => consent(true));
  document.getElementById('analytics-disable')?.addEventListener('click', () => consent(false));
  document.getElementById('clear-data')?.addEventListener('click', () => consent(false));
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) consent(choice() === true); });
  document.addEventListener('visibilitychange', () => { flush(); foreground = document.visibilityState === 'visible'; resetTiming(); });
  window.addEventListener('pagehide', () => { flush(); if (enabled) event('page_departure'); });
  setInterval(flush, 60000);
  enabled = configured && allowedPage && !optOut && choice() === true;
  if (enabled) start(); else if (configured) { window['ga-disable-' + id] = true; removeCookies(); }
  render();
})();
