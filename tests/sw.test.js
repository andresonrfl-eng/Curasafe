import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function worker() {
  const listeners={},cached=new Map();let notification,networkUp=true;
  const context={URL,Response,
    fetch:async request=>{if(!networkUp) throw new Error('offline');return new Response('shell',{status:200});},
    caches:{open:async()=>({addAll:async urls=>urls.forEach(u=>cached.set(u,new Response('cached shell'))),put:async(req,res)=>cached.set(req.url,res)}),match:async req=>cached.get(typeof req==='string'?req:req.url),keys:async()=>[]},
    self:{location:{href:'https://example.test/Curasafe/sw.js'},addEventListener:(name,handler)=>listeners[name]=handler,clients:{claim:async()=>{}},registration:{showNotification:async(title,options)=>notification={title,options}}}
  };
  vm.runInNewContext(source,context);
  return {listeners,cached,offline:()=>networkUp=false,getNotification:()=>notification};
}
test('offline shell respects the GitHub Pages subdirectory',async()=>{
  const w=worker();let pending;
  w.listeners.install({waitUntil:p=>pending=p});await pending;
  assert.ok(w.cached.has('https://example.test/Curasafe/index.html'));
  w.offline();w.listeners.fetch({request:{method:'GET',url:'https://example.test/Curasafe/app.js'},respondWith:p=>pending=p});
  assert.equal(await (await pending).text(),'cached shell');
});
test('health data and external requests are never intercepted for caching',()=>{
  const w=worker();let called=false;
  for(const url of ['https://firestore.googleapis.com/anything','https://example.test/Curasafe/patient-data','https://example.test/other/index.html']) w.listeners.fetch({request:{method:'GET',url},respondWith:()=>called=true});
  assert.equal(called,false);
});
test('notification text does not expose the medication or dose on the lock screen',async()=>{
  const w=worker();let pending;
  w.listeners.message({data:{type:'NOTIFY',tag:'test'},waitUntil:p=>pending=p});await pending;
  assert.equal(w.getNotification().options.requireInteraction,true);
  assert.equal(w.getNotification().options.body,'Você tem um registro de dose pendente. Abra o CuraSafe para conferir.');
});
