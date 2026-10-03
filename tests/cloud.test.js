import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudClient} from '../cloud.js';
function mockedCloud() {
  const data=new Map(), listeners=new Map();let lock=Promise.resolve();
  const snapshot=key=>({exists:()=>data.has(key),data:()=>structuredClone(data.get(key))});
  const sdk={
    doc:(_, ...parts)=>parts.join('/'),collection:(_, ...parts)=>parts.join('/'),
    getDoc:async key=>snapshot(key),setDoc:async(key,value)=>data.set(key,structuredClone(value)),deleteDoc:async key=>data.delete(key),
    runTransaction:(_,fn)=>{const pending=lock.then(()=>fn({get:async key=>snapshot(key),update:(key,value)=>data.set(key,{...data.get(key),...value}),set:(key,value)=>data.set(key,structuredClone(value))}));lock=pending.catch(()=>{});return pending;},
    onSnapshot:(key,_options,callback,error)=>{listeners.set(key,{callback,error});return ()=>listeners.delete(key);}
  };
  return {data,listeners,client:createCloudClient(sdk,{}, {uid:'owner-device'})};
}
test('two concurrent attempts at the same dose decrement stock only once',async()=>{
  const {data,client}=mockedCloud();data.set('families/CURA_ABC123/meds/m',{id:'m',stock:10});
  const op={kind:'dose',log:{id:'dose',medId:'m',action:'taken'}};
  await Promise.all([client.send('CURA_ABC123',op),client.send('CURA_ABC123',op)]);
  assert.equal(data.get('families/CURA_ABC123/meds/m').stock,9);
});
test('importing history preserves existing stock',async()=>{
  const {data,client}=mockedCloud();data.set('families/CURA_ABC123/meds/m',{id:'m',stock:9});
  await client.send('CURA_ABC123',{kind:'importLog',log:{id:'dose',medId:'m',action:'taken'}});
  assert.equal(data.get('families/CURA_ABC123/meds/m').stock,9);
});
test('another family requires a membership record in the client flow',async()=>{
  const {data,client}=mockedCloud();data.set('families/CURA_ABC123',{ownerUid:'another-owner'});
  await assert.rejects(client.access('CURA_ABC123'),/autorizar/);
  data.set('families/CURA_ABC123/members/owner-device',{role:'viewer'});
  assert.equal(await client.access('CURA_ABC123'),false);
});
test('listeners are not published until both server collections arrive; stop unsubscribes both',()=>{
  const {client,listeners}=mockedCloud(),received=[];
  const stop=client.listen('CURA_ABC123',d=>received.push(d),()=>{});
  const snap=fromCache=>({metadata:{fromCache},docs:[]});
  listeners.get('families/CURA_ABC123/meds').callback(snap(true));
  listeners.get('families/CURA_ABC123/logs').callback(snap(false));assert.equal(received.length,0);
  listeners.get('families/CURA_ABC123/meds').callback(snap(false));assert.equal(received.length,1);
  stop();assert.equal(listeners.size,0);
});
