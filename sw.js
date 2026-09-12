const CACHE='bale-app-v6-speed';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

async function fetchAndCache(request){
  const response=await fetch(request,{cache:'no-store'});
  if(response && response.ok){
    const cache=await caches.open(CACHE);
    await cache.put(request,response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method !== 'GET') return;

  const url=new URL(request.url);
  if(url.origin !== self.location.origin) return;
  if(url.pathname.startsWith('/api/')) return;

  if(request.mode === 'navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(request);
      const networkPromise=fetchAndCache(request).catch(()=>null);

      if(cached){
        event.waitUntil(networkPromise);
        return cached;
      }

      const network=await networkPromise;
      if(network) return network;
      return new Response('تعذر الاتصال بالخادم',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    })());
    return;
  }

  if(/\.(?:js|css|json|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(request);
      const networkPromise=fetchAndCache(request).catch(()=>null);

      if(cached){
        event.waitUntil(networkPromise);
        return cached;
      }

      const network=await networkPromise;
      return network || new Response('',{status:504});
    })());
  }
});
