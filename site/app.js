(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const config = window.EDM_CONFIG || {stations:[],liveMode:false};
  const live = config.liveMode === true;
  const allStations = Array.isArray(config.stations) ? config.stations : [];
  const stations = allStations.filter(s => s && /^[a-z0-9-]+$/.test(s.id) && (!live || safeUrl(s.streamUrl)));
  const audio = $('radio-audio');
  const keys = {saved:'edm.saved.v1',station:'edm.station.v1',volume:'edm.volume.v1'};
  const storage = {
    get(key,fallback) {try {const v=localStorage.getItem(key);return v === null ? fallback : JSON.parse(v);} catch {return fallback;}},
    set(key,value) {try {localStorage.setItem(key,JSON.stringify(value));} catch {}},
    remove(key) {try {localStorage.removeItem(key);} catch {}}
  };
  const savedValue = storage.get(keys.saved,[]);
  let saved = new Set(Array.isArray(savedValue) ? savedValue.filter(id => allStations.some(s=>s.id===id)) : []);
  let current = stations.find(s=>s.id===storage.get(keys.station,'')) || stations[0];
  let status = 'ready', wantsPlay = false, operation = 0, retryCount = 0;
  let retryTimer, watchdogTimer, stableTimer, toastTimer, metadataTimer, metadataAbort, installPrompt;
  let metadata = null, renderProgressAt = 0;
  const playButtons = [$('hero-play'),$('art-play'),$('player-play'),$('phone-play')];
  const retries = [1500,3000,6000,12000];
  let volume = Number(storage.get(keys.volume,.7));
  if (!Number.isFinite(volume)) volume=.7;
  audio.volume=Math.min(1,Math.max(0,volume));
  $('volume').value=audio.volume;

  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url=new URL(value,location.href);
      if (url.username || url.password) return null;
      if (url.protocol==='https:' || (url.origin===location.origin && /^https?:$/.test(url.protocol))) return url.href;
    } catch {}
    return null;
  }
  function icon(button,name) {const use=button.querySelector('use');if(use) use.setAttribute('href','#i-'+name);}
  function announce(message) {
    clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('visible');
    toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);
  }
  function clearWaiting() {clearTimeout(retryTimer);clearTimeout(watchdogTimer);clearTimeout(stableTimer);retryTimer=null;watchdogTimer=null;stableTimer=null;}
  function updateState(next) {
    status=next;
    const playing=next==='playing';
    const pending=next==='connecting'||next==='reconnecting'||next==='buffering';
    document.body.classList.toggle('is-playing',playing);
    document.body.dataset.playerState=next;
    const messages={ready:'Ready when you are',connecting:'Connecting…',playing:live?'Live now':'Playing original preview',blocked:'Tap to listen',paused:'Paused',reconnecting:'Reconnecting…',buffering:'Buffering…',offline:'Waiting for connection',error:'Unable to play · Try again',unavailable:'Stream coming soon'};
    $('player-status').textContent=messages[next]||messages.ready;
    $('mobile-player-status').textContent=messages[next]||messages.ready;
    for(const button of playButtons) {
      icon(button,playing?'pause':'play');
      button.setAttribute('aria-label',playing?'Pause audio':pending?'Cancel playback request':'Play '+(current?.title||'audio'));
    }
    $('hero-play').querySelector('span').textContent=playing?'Pause listening':pending?'Connecting…':next==='blocked'?'Tap to listen':next==='error'?'Try again':'Start listening';
    const hints={blocked:'Your browser needs one tap to start the sound.',offline:'You’re offline. We’ll reconnect when your signal returns.',error:'The audio could not connect. Tap Play to try again.',connecting:'Finding your frequency…',reconnecting:'Your connection dropped. Finding the beat again…',buffering:'A little buffering. The music will return shortly.',unavailable:'The live station is getting ready. Check back soon.'};
    $('playback-hint').textContent=hints[next]||(live?'Your live frequency. Wherever you are.':'Original preview mixes. One tap takes you in.');
    for(const card of document.querySelectorAll('[data-channel]')) {
      const selected=card.dataset.channel===current?.id;
      card.classList.toggle('is-selected',selected&&playing);
      const control=card.querySelector('[data-play]');
      if(control){icon(control,selected&&playing?'pause':'play');const s=stations.find(s=>s.id===card.dataset.channel);if(s)control.setAttribute('aria-label',(selected&&playing?'Pause ':'Play ')+s.name+(live?'':': '+s.title));}
    }
    if('mediaSession' in navigator) {try{navigator.mediaSession.playbackState=playing?'playing':wantsPlay?'none':'paused';}catch{}}
  }
  function setWatchdog() {
    clearTimeout(watchdogTimer);
    watchdogTimer=setTimeout(()=>{if(wantsPlay && status!=='playing') scheduleRetry();},20000);
  }
  function setSource(force=false) {
    if(!current) return false;
    const source=safeUrl(live?current.streamUrl:current.previewUrl);
    if(!source) return false;
    if(force || audio.src!==source) {
      audio.src=source;audio.loop=!live;
      // Keep one media element. No Web Audio graph: cross-origin radio may lack analyser CORS.
      audio.load();
    }
    return true;
  }
  function startPlayback({autoplay=false,retrying=false}={}) {
    if(!current){updateState('unavailable');return Promise.resolve();}
    clearWaiting();
    wantsPlay=true;
    const token=++operation;
    if(!retrying) retryCount=0;
    if(!setSource(retrying)){wantsPlay=false;updateState('error');return Promise.resolve();}
    updateState(retrying?'reconnecting':'connecting');
    setWatchdog();
    // This call is synchronous within the click handler, preserving mobile user activation.
    let promise;
    try {promise=audio.play();} catch(error){promise=Promise.reject(error);}
    return Promise.resolve(promise).then(()=>{
      if(token!==operation || !wantsPlay) return;
      updateState('playing');
      refreshMetadata();
    }).catch(error=>{
      if(token!==operation || !wantsPlay) return;
      clearTimeout(watchdogTimer);
      if(error.name==='NotAllowedError') {
        wantsPlay=false;clearWaiting();updateState('blocked');
      } else if(error.name!=='AbortError') {
        scheduleRetry();
      } else {
        setWatchdog();
      }
    });
  }
  function pausePlayback() {
    wantsPlay=false;++operation;clearWaiting();stopMetadata();audio.pause();
    if(live){audio.removeAttribute('src');audio.load();}
    updateState('paused');
  }
  function togglePlayback() {
    if(wantsPlay || (!audio.paused&&status==='playing')) pausePlayback();
    else startPlayback();
  }
  function scheduleRetry() {
    if(!wantsPlay || retryTimer) return;
    clearTimeout(watchdogTimer);clearTimeout(stableTimer);
    if(!navigator.onLine){updateState('offline');return;}
    if(retryCount>=retries.length) {
      wantsPlay=false;++operation;audio.pause();clearWaiting();stopMetadata();updateState('error');return;
    }
    updateState('reconnecting');
    const delay=retries[retryCount++];
    retryTimer=setTimeout(()=>{retryTimer=null;if(wantsPlay)startPlayback({retrying:true});},delay);
  }
  function chooseStation(id,{play=true}={}) {
    const next=stations.find(s=>s.id===id);
    if(!next) return;
    if(current?.id===id&&play){togglePlayback();return;}
    wantsPlay=false;++operation;clearWaiting();stopMetadata();audio.pause();
    current=next;metadata=null;retryCount=0;storage.set(keys.station,id);
    audio.removeAttribute('src');audio.load();
    updateStation();updateState('ready');
    if(play)startPlayback();
  }
  function stepStation(direction) {
    if(stations.length<2) return;
    const index=stations.indexOf(current);chooseStation(stations[(index+direction+stations.length)%stations.length].id);
  }
  function updateStation() {
    if(!current) return;
    const title=metadata?.title||(live?current.name+' Radio':current.title);
    const artist=metadata?.artist||(live?'electronicdancemusic.audio':current.artist);
    const artwork=safeUrl(metadata?.artwork)||safeUrl(current.artwork);
    $('hero-genre').textContent=live?current.name.toUpperCase()+' / LIVE RADIO':current.name.toUpperCase()+' / '+current.bpm+' BPM';
    $('hero-track').textContent=title;$('hero-artist').textContent=artist;
    $('player-title').textContent=title;$('player-subtitle').textContent=artist;
    $('player-genre').textContent=current.name.toUpperCase()+(live?' RADIO':' SESSION');
    $('player-art').src=artwork;$('player-art').alt=current.name+' artwork';
    $('phone-art').src=artwork;$('phone-track').textContent=title;
    $('phone-genre').textContent=current.name.toUpperCase()+(live?' / LIVE RADIO':' / THE PREVIEW SESSIONS');
    $('phone-track').nextElementSibling.textContent=artist;
    $('player-progress-fill').style.width='0%';
    updateSavedUI();
    if('mediaSession' in navigator && typeof MediaMetadata!=='undefined') {
      try{navigator.mediaSession.metadata=new MediaMetadata({title,artist,album:live?'EDM Audio Radio':'Original Preview Sessions',artwork:artwork?[{src:artwork}]:[]});}catch{}
    }
    document.title=(status==='playing'?title+' — ':'')+'electronicdancemusic.audio';
  }
  function stopMetadata() {clearTimeout(metadataTimer);metadataAbort?.abort();metadataAbort=null;}
  async function refreshMetadata() {
    stopMetadata();
    const url=live&&safeUrl(current?.nowPlayingUrl);
    if(!url||!wantsPlay) return;
    const stationId=current.id;
    const controller=new AbortController();metadataAbort=controller;
    const timeout=setTimeout(()=>controller.abort(),5000);
    try {
      const response=await fetch(url,{signal:controller.signal,cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('metadata unavailable');
      const data=await response.json();
      if(current.id===stationId&&wantsPlay&&data&&typeof data.title==='string') {
        metadata={title:data.title.slice(0,160),artist:typeof data.artist==='string'?data.artist.slice(0,160):'electronicdancemusic.audio',artwork:safeUrl(data.artwork)};
        updateStation();
      }
    } catch {} finally {
      clearTimeout(timeout);
      if(metadataAbort===controller&&wantsPlay)metadataTimer=setTimeout(refreshMetadata,25000);
    }
  }
  function toggleSaved(id) {
    if(!stations.some(s=>s.id===id)) return;
    if(saved.has(id)){saved.delete(id);announce('Removed from your saved frequencies.');}
    else{saved.add(id);announce('Frequency saved. Find it in Saved.');}
    storage.set(keys.saved,[...saved]);updateSavedUI();renderSaved();
  }
  function updateSavedUI() {
    document.querySelectorAll('[data-save]').forEach(button=>{
      const station=allStations.find(s=>s.id===button.dataset.save);
      const isSaved=saved.has(button.dataset.save);
      button.setAttribute('aria-pressed',String(isSaved));
      button.setAttribute('aria-label',(isSaved?'Unsave ':'Save ')+(station?.name||'frequency'));
    });
    if(current){$('player-save').setAttribute('aria-pressed',String(saved.has(current.id)));$('player-save').setAttribute('aria-label',(saved.has(current.id)?'Unsave ':'Save ')+current.name);}
    document.querySelectorAll('.saved-count').forEach(el=>{el.textContent=saved.size;el.hidden=saved.size===0;});
  }
  function renderResults(container,items,emptyMessage) {
    container.replaceChildren();
    if(!items.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent=emptyMessage;container.append(empty);return;}
    items.forEach(station=>{
      const row=document.createElement('div');row.className='result-row';
      const play=document.createElement('button');play.type='button';play.setAttribute('aria-label','Play '+station.name);
      const art=document.createElement('img');art.src=station.artwork;art.alt='';art.width=48;art.height=48;
      const copy=document.createElement('span');const title=document.createElement('strong');title.textContent=station.name;
      const subtitle=document.createElement('small');subtitle.textContent=live?'Live radio':station.title+' · '+station.bpm+' BPM · Preview';copy.append(title,subtitle);play.append(art,copy);
      play.addEventListener('click',()=>{closeDialogs();chooseStation(station.id);});
      const heart=document.createElement('button');heart.type='button';heart.className='icon-button';heart.dataset.save=station.id;
      heart.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-heart"/></svg>';
      heart.addEventListener('click',()=>toggleSaved(station.id));row.append(play,heart);container.append(row);
    });updateSavedUI();
  }
  function renderSaved(){renderResults($('saved-results'),stations.filter(s=>saved.has(s.id)),'Your next favorite is out there. Tap the heart on any frequency to keep it here.');}
  function renderSearch(){const term=$('search-input').value.trim().toLowerCase();renderResults($('search-results'),stations.filter(s=>[s.name,s.title,s.description,s.keywords].join(' ').toLowerCase().includes(term)),'No frequencies match yet. Try house, techno, trance, or liquid.');}
  function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());}
  function openDialog(id){closeDialogs();if(id==='saved-dialog')renderSaved();if(id==='search-dialog')renderSearch();const dialog=$(id);dialog?.showModal();if(id==='search-dialog')$('search-input').focus();}

  playButtons.forEach(button=>button.addEventListener('click',togglePlayback));
  document.querySelectorAll('[data-play]').forEach(button=>button.addEventListener('click',()=>chooseStation(button.dataset.play)));
  document.querySelectorAll('.save-button').forEach(button=>button.addEventListener('click',()=>toggleSaved(button.dataset.save)));
  $('player-save').addEventListener('click',()=>current&&toggleSaved(current.id));
  $('next-button').addEventListener('click',()=>stepStation(1));$('previous-button').addEventListener('click',()=>stepStation(-1));
  document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>openDialog(button.dataset.open)));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>closeDialogs()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
  $('search-input').addEventListener('input',renderSearch);
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
    const selected=button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(filter=>{const active=filter===button;filter.classList.toggle('active',active);filter.setAttribute('aria-pressed',String(active));});
    document.querySelectorAll('[data-channel]').forEach(card=>{card.hidden=!stations.some(s=>s.id===card.dataset.channel)||(selected!=='all'&&card.dataset.channel!==selected);});
  }));
  $('volume').addEventListener('input',event=>{audio.volume=Number(event.target.value);audio.muted=false;storage.set(keys.volume,audio.volume);updateVolume();});
  $('mute-button').addEventListener('click',()=>{audio.muted=!audio.muted;updateVolume();});
  function updateVolume(){const muted=audio.muted||audio.volume===0;icon($('mute-button'),muted?'mute':'volume');$('mute-button').setAttribute('aria-label',muted?'Unmute audio':'Mute audio');}
  $('clear-data').addEventListener('click',()=>{
    Object.values(keys).forEach(key=>storage.remove(key));saved=new Set();audio.volume=.7;audio.muted=false;$('volume').value=.7;updateVolume();updateSavedUI();renderSaved();announce('Your saved preferences have been cleared.');
  });
  $('share-button').addEventListener('click',async()=>{
    const url=location.origin+location.pathname;
    try{if(navigator.share){await navigator.share({title:'Find your frequency — electronicdancemusic.audio',text:'Electronic music. Human connection.',url});}else if(navigator.clipboard){await navigator.clipboard.writeText(url);announce('Link copied. Share the frequency.');}else{announce('Copy this page’s address to share the frequency.');}}catch(error){if(error.name!=='AbortError')announce('Copy this page’s address to share the frequency.');}
  });
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
  $('install-button').addEventListener('click',async()=>{
    if(config.androidAppUrl && safeUrl(config.androidAppUrl)){location.href=safeUrl(config.androidAppUrl);return;}
    if(installPrompt){const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();const result=await prompt.userChoice;if(result.outcome==='accepted')announce('Your frequency is coming to your home screen.');}catch{openDialog('install-dialog');}}
    else openDialog('install-dialog');
  });
  window.addEventListener('appinstalled',()=>{installPrompt=null;announce('Your frequency is on your home screen.');});

  audio.addEventListener('playing',()=>{
    if(!wantsPlay){audio.pause();return;}
    clearTimeout(watchdogTimer);clearTimeout(retryTimer);retryTimer=null;
    clearTimeout(stableTimer);stableTimer=setTimeout(()=>{retryCount=0;},10000);
    updateState('playing');updateStation();refreshMetadata();
  });
  audio.addEventListener('pause',()=>{
    if(audio.paused&&wantsPlay&&(status==='playing'||status==='buffering')){pausePlayback();return;}
    if(!wantsPlay&&status!=='blocked'&&status!=='error')updateState('paused');
  });
  audio.addEventListener('waiting',()=>{if(wantsPlay){clearTimeout(stableTimer);updateState('buffering');setWatchdog();}});
  audio.addEventListener('stalled',()=>{if(wantsPlay&&audio.readyState<3){clearTimeout(stableTimer);updateState('buffering');setWatchdog();}});
  audio.addEventListener('error',()=>{if(wantsPlay)scheduleRetry();});
  audio.addEventListener('ended',()=>{if(live&&wantsPlay)scheduleRetry();});
  audio.addEventListener('timeupdate',()=>{
    const now=performance.now();if(now-renderProgressAt<200)return;renderProgressAt=now;
    if(!live&&Number.isFinite(audio.duration)&&audio.duration>0)$('player-progress-fill').style.width=Math.min(100,audio.currentTime/audio.duration*100)+'%';
  });
  window.addEventListener('offline',()=>{if(wantsPlay&&audio.readyState<3){clearWaiting();updateState('offline');}});
  window.addEventListener('online',()=>{if(wantsPlay&&status!=='playing'){retryCount=0;startPlayback({retrying:true});}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&wantsPlay){if(status==='error'||status==='offline')startPlayback({retrying:true});else refreshMetadata();}});
  // No global gesture listener: browsing or closing a dialog must never start music unexpectedly.
  document.addEventListener('keydown',event=>{if(event.code==='Space'&&event.target===document.body&&!document.querySelector('dialog[open]')){event.preventDefault();togglePlayback();}});
  if('mediaSession' in navigator) {
    const handlers={play:()=>startPlayback(),pause:pausePlayback,stop:pausePlayback,nexttrack:()=>stepStation(1),previoustrack:()=>stepStation(-1)};
    Object.entries(handlers).forEach(([action,handler])=>{try{navigator.mediaSession.setActionHandler(action,handler);}catch{}});
  }
  if('serviceWorker' in navigator&&window.isSecureContext) {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
  function applyConfig() {
    document.querySelector('[data-filter="all"] span').textContent=String(stations.length).padStart(2,'0');
    for(const card of document.querySelectorAll('[data-channel]')) {
      const station=stations.find(s=>s.id===card.dataset.channel);card.hidden=!station;
      const filter=document.querySelector('[data-filter="'+card.dataset.channel+'"]');if(filter)filter.hidden=!station;
      if(station){card.querySelector('h3').textContent=station.name;card.querySelector(':scope > p')?.replaceChildren(document.createTextNode(station.description||''));card.querySelector('.cover-play img').src=station.artwork;if(live){card.querySelector('.preview-label').textContent='LIVE RADIO';card.querySelector('.channel-title>span').textContent='LIVE';}}
    }
    if(live){$('hero-mode').textContent='THE LIVE FREQUENCIES';$('mode-badge').lastChild.textContent='LIVE';$('preview-disclosure').hidden=true;$('footer-preview').textContent='ELECTRONICDANCEMUSIC.AUDIO · 2026';}
    if(config.androidAppUrl&&safeUrl(config.androidAppUrl)){$('install-button').innerHTML='<svg class="icon"><use href="#i-phone"/></svg>Get the Android app <svg class="icon arrow"><use href="#i-up-right"/></svg>';document.querySelector('.app-availability').textContent='Available for Android. Listen on the web, too.';}
    $('next-button').hidden=stations.length<2;$('previous-button').hidden=stations.length<2;
  }
  applyConfig();updateVolume();updateStation();updateState(current?'ready':'unavailable');
  if(config.autoStart&&current)startPlayback({autoplay:true});
})();
