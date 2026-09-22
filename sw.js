const CACHE="eal-progress-hub-v15-detailed-assessment";
const ASSETS=["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&new URL(event.request.url).origin===self.location.origin){
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    }
    return response;
  }).catch(()=>caches.match(event.request).then(async cached=>{
    if(cached)return cached;
    if(event.request.mode==="navigate")return (await caches.match("./index.html"))||Response.error();
    return new Response("Offline",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  })));
});
