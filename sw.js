const CACHE='bale-app-v5-exchange';

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
      let html=await response.text();
      const scripts=[
        '<script src="/sale_patch.js?v=6"></script>',
        '<script src="/agent_sale_patch.js?v=7"></script>',
        '<script src="/agent_ops_patch.js?v=3"></script>'
      ];
      for(const script of scripts){
        const src=(script.match(/src="([^"]+)/)||[])[1]||'';
        const base=src.split('?')[0].split('/').pop();
        if(base && !html.includes(base)) html=html.replace('</body>',script+'</body>');
      }
      const headers=new Headers(response.headers);
      headers.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
      headers.set('Pragma','no-cache');
      headers.set('Expires','0');
      return new Response(html,{status:response.status,statusText:response.statusText,headers});
    })());
  }
});
