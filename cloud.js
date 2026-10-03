import { nextStock } from './core.js';

export async function connectCloud(config) {
  // Loaded only on demand; the local app starts even with no internet.
  const [appSDK,authSDK,storeSDK]=await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js')
  ]);
  const app=appSDK.getApps().find(a=>a.name===config.projectId) || appSDK.initializeApp(config,config.projectId);
  const auth=authSDK.getAuth(app);
  await auth.authStateReady();
  const user=auth.currentUser || (await authSDK.signInAnonymously(auth)).user;
  const db=storeSDK.getFirestore(app);
  return createCloudClient(storeSDK,db,user);
}

export function createCloudClient(storeSDK,db,user) {
  const {doc,collection,getDoc,setDoc,deleteDoc,runTransaction,onSnapshot}=storeSDK;
  const root=id=>doc(db,'families',id);
  return {
    userId:user.uid,
    async access(id,create=false) {
      const ref=root(id), snap=await getDoc(ref);
      if(!snap.exists()) {
        if(!create) throw new Error('Família não encontrada.');
        // Create only: rules deny updates of an existing owner.
        await setDoc(ref,{ownerUid:user.uid});
        return true;
      }
      if(snap.data().ownerUid===user.uid) return true;
      if(!(await getDoc(doc(db,'families',id,'members',user.uid))).exists()) throw new Error('Peça ao titular para autorizar seu ID de dispositivo.');
      return false;
    },
    listen(id,onData,onError) {
      const meds=[],logs=[];
      let gotMeds=false,gotLogs=false;
      const publish=()=>{if(gotMeds&&gotLogs) onData({meds:[...meds],logs:[...logs]});};
      const stopMeds=onSnapshot(collection(db,'families',id,'meds'),{includeMetadataChanges:true},snap=>{
        if(snap.metadata.fromCache) return;
        meds.splice(0,meds.length,...snap.docs.map(d=>({...d.data(),id:d.id})));
        gotMeds=true; publish();
      },onError);
      const stopLogs=onSnapshot(collection(db,'families',id,'logs'),{includeMetadataChanges:true},snap=>{
        if(snap.metadata.fromCache) return;
        logs.splice(0,logs.length,...snap.docs.map(d=>({...d.data(),id:d.id})));
        gotLogs=true; publish();
      },onError);
      return ()=>{stopMeds();stopLogs();};
    },
    async send(id,op) {
      if(op.kind==='save') return setDoc(doc(db,'families',id,'meds',op.med.id),op.med);
      if(op.kind==='delete') return deleteDoc(doc(db,'families',id,'meds',op.id));
      if(op.kind==='importLog') return runTransaction(db,async tx=>{
        const ref=doc(db,'families',id,'logs',op.log.id);
        if(!(await tx.get(ref)).exists()) tx.set(ref,op.log);
      });
      if(op.kind==='dose') return runTransaction(db,async tx=>{
        const logRef=doc(db,'families',id,'logs',op.log.id);
        const medRef=doc(db,'families',id,'meds',op.log.medId);
        const old=await tx.get(logRef), med=await tx.get(medRef);
        if(old.exists()&&['taken','skipped'].includes(old.data().action)) return;
        if(!med.exists()) return;
        const stock=Math.max(0,nextStock(med.data().stock,old.exists()?old.data().action:null,op.log.action));
        tx.update(medRef,{stock});
        tx.set(logRef,op.log);
      });
    },
    async authorize(id,uid) { await setDoc(doc(db,'families',id,'members',uid),{role:'viewer'}); },
    async revoke(id,uid) { await deleteDoc(doc(db,'families',id,'members',uid)); }
  };
}
