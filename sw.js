const CACHE='bale-app-v3';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith((async()=>{
      const response=await fetch(event.request,{cache:'no-store'});
      const type=response.headers.get('content-type')||'';
      if(!type.includes('text/html')) return response;
      const html=await response.text();
      const injected=html.includes('sale_patch.js')
        ? html
        : html.replace('</body>','<script src="/sale_patch.js?v=3"></script></body>');
      const headers=new Headers(response.headers);
      headers.set('Cache-Control','no-store, no-cache, must-revalidate');
      return new Response(injected,{status:response.status,statusText:response.statusText,headers});
    })());
  }
});
