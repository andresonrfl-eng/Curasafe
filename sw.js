const CACHE='curasafe-shell-v1';
const BASE=new URL('./',self.location.href);
const FILES=['./','index.html','app.js','core.js','cloud.js','styles.css','manifest.json','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new URL(f,BASE).href)))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys()) if(key.startsWith('curasafe-shell-')&&key!==CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Never cache health data, Firebase traffic or unrelated sites on this origin.
  if(event.request.method!=='GET'||url.origin!==BASE.origin||!FILES.some(f=>new URL(f,BASE).href===url.href)) return;
  event.respondWith((async()=>{
    try {
      const response=await fetch(event.request);
      if(response.ok) { const cache=await caches.open(CACHE); await cache.put(event.request,response.clone()); }
      return response;
    } catch {
      return (await caches.match(event.request)) || new Response('Sem conexão',{status:503});
    }
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
  if(event.data?.type==='NOTIFY'&&typeof event.data.tag==='string') {
    event.waitUntil(self.registration.showNotification('CuraSafe — lembrete',{
      body:'Você tem um registro de dose pendente. Abra o CuraSafe para conferir.',
      tag:event.data.tag, requireInteraction:true, vibrate:[300,150,300,150,600,200,600],
      icon:new URL('icons/icon-192.png',BASE).href, data:{url:BASE.href}
    }));
  }
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=clients.find(c=>c.url.startsWith(BASE.href));
    if(existing) return existing.focus();
    return self.clients.openWindow(BASE.href);
  })());
});
