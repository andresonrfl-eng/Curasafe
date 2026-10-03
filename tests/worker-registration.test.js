import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const registration=source.slice(source.indexOf('const hadWorker='),source.indexOf("$('updateApp').addEventListener"));
async function setup(controller,waiting=null,onboarded=true) {
  const handlers={},stateHandlers={};let shown=false;
  const reg={waiting,installing:{addEventListener:(name,handler)=>stateHandlers[name]=handler},addEventListener:(name,handler)=>handlers[name]=handler};
  const worker={controller,register:async()=>reg};
  vm.runInNewContext(registration,{navigator:{serviceWorker:worker},raw:()=>onboarded?'true':'',$:()=>({classList:{remove:()=>shown=true}}),showToast:()=>{}});
  await new Promise(resolve=>setImmediate(resolve));
  return {worker,reg,handlers,stateHandlers,shown:()=>shown};
}
test('first installation stays quiet even if control arrives before the state callback',async()=>{
  const app=await setup(null);app.handlers.updatefound();
  app.worker.controller={};app.reg.waiting={};app.stateHandlers.statechange();
  assert.equal(app.shown(),false);
});
test('a new user is not prompted to update during onboarding',async()=>{
  const app=await setup({},{},false);assert.equal(app.shown(),false);
});
test('an existing installation shows an update already waiting',async()=>{
  const app=await setup({},{});assert.equal(app.shown(),true);
});
test('an existing installation shows a newly installed update',async()=>{
  const app=await setup({});assert.equal(app.shown(),false);
  app.handlers.updatefound();app.reg.waiting={};app.stateHandlers.statechange();
  assert.equal(app.shown(),true);
});
