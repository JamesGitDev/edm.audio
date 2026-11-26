// Cache the interface, never a live stream or audio response. Increment on release.
const CACHE='edm-electronicdancemusic-public-shell-20261030-public-01';
const SHELL=['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./assets/mark.svg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('edm-electronicdancemusic-public-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||request.destination==='audio'||/\.(mp3|aac|m3u8|m4a|ts|apk|zip)(\?|$)/i.test(url.pathname)||url.pathname.includes('/downloads/')||url.pathname.includes('/api/')||url.pathname.includes('/media/')||url.pathname.includes('/stream/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));}return response;}).catch(()=>caches.match('./index.html')));return;
  }
  if(['style','script'].includes(request.destination)||url.pathname.endsWith('.webmanifest')){
    event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;}).catch(()=>caches.match(request)));return;
  }
  if(request.destination==='image')event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;})));
});
