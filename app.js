import {dateKey,localDay,startTimestamp,getCalculatedDosesForDate,doseId,findLog,applyOperation,escaped,familyCode,snoozeUntil,validState} from './core.js';

const $=id=>document.getElementById(id);
const SHAPES={
  pill:'<circle cx="12" cy="12" r="8" fill="currentColor" opacity=".3"/><path d="M12 4a8 8 0 000 16z" fill="currentColor"/>',
  capsule:'<rect x="6" y="4" width="12" height="16" rx="6" fill="currentColor" opacity=".3"/><path d="M6 10a6 6 0 0112 0v4H6z" fill="currentColor"/>',
  drops:'<path d="M12 3s-6 6-6 10a6 6 0 1012 0c0-4-6-10-6-10z" fill="currentColor"/>',
  syrup:'<path d="M8 3h8v3h-2v4h3v11H7V10h3V6H8z" fill="currentColor"/>',
  injection:'<path d="M14 2H10v2h1v3L9 9v11h6V9l-2-2V4h1z" fill="currentColor"/>'
};
let storageOK=true,cloud=null,stopCloud=null,cloudGeneration=0,flushRunning=false,modalFocus=null,audio=null,selectedDay=dateKey(),followToday=true;
function read(key,fallback) {
  try { const raw=localStorage.getItem(key); return raw===null?fallback:JSON.parse(raw); }
  catch { storageOK=false; return fallback; }
}
function write(key,value) {
  if(!storageOK) return false;
  try {localStorage.setItem(key,JSON.stringify(value));return true;}
  catch {storageOK=false;showToast('Não foi possível salvar neste navegador. Seus dados anteriores foram preservados.','error');renderStorage();return false;}
}
function raw(key,fallback='') {
  try {return localStorage.getItem(key)||fallback;}
  catch {storageOK=false;return fallback;}
}
function rawWrite(key,value) {
  if(!storageOK) return false;
  try {localStorage.setItem(key,value);return true;}
  catch {storageOK=false;renderStorage();return false;}
}
let uid=raw('curasafe_uid');
if(!familyCode(uid)) {uid='CURA_'+crypto.randomUUID().replaceAll('-','').slice(0,24).toUpperCase();rawWrite('curasafe_uid',uid);}
let config=read('curasafe_firebase_config',null);
const appState={uid,familyId:raw('curasafe_familyId',uid),isOwnFamily:true,meds:[],logs:[],outbox:[],notified:{},isFirebaseReady:false};
if(!familyCode(appState.familyId)) appState.familyId=uid;
appState.isOwnFamily=appState.familyId===uid;
let scope='';
function scopeFor(family=appState.familyId) { return `curasafe_v1_${config?.projectId||'local'}_${family}`; }
function loadScope() {
  scope=scopeFor();
  let data=read(scope,null);
  // Copy legacy data once, only to the owner's own profile. Keep the source intact.
  if(!data&&appState.familyId===uid) {
    data=read(`curasafe_v1_local_${uid}`,null) || {
      meds:read('curasafe_meds',[]),logs:read('curasafe_logs',[]),outbox:[],notified:{}
    };
    data=structuredClone(data);
    if(config) {
      // Import existing stock and logs as a baseline, never replay historical doses.
      data.outbox=[...data.meds.map(m=>({kind:'save',med:m})),...data.logs.map(l=>({kind:'importLog',log:l}))];
    }
  }
  data ||= {meds:[],logs:[],outbox:[],notified:{}};
  if(!validState(data)) {storageOK=false;data={meds:[],logs:[],outbox:[],notified:{}};}
  appState.meds=data.meds;appState.logs=data.logs;appState.outbox=(data.outbox||[]).map(op=>({...op,opId:op.opId||crypto.randomUUID()}));appState.notified=data.notified||{};
  persist();
}
function persist() {return write(scope,{meds:appState.meds,logs:appState.logs,outbox:appState.outbox,notified:appState.notified});}
let bc=null;
try {bc=new BroadcastChannel('curasafe-v1');} catch {}
function announce() {bc?.postMessage({scope});}
function reloadLocal() {loadScope();renderAll();void flush();}
bc?.addEventListener('message',event=>{if(event.data.scope===scope) reloadLocal();});
window.addEventListener('storage',event=>{if(event.key===scope) reloadLocal();});

function renderStorage() { $('storageWarning').classList.toggle('hidden',storageOK); }
function status(text,ok=false) {
  $('connectionText').textContent=text;
  $('connectionStatus').className=`w-2 h-2 rounded-full ${ok?'bg-emerald-500':'bg-amber-400'}`;
}
function showToast(message,type='info') {
  const div=document.createElement('div');
  div.className=`${type==='error'?'bg-red-600':type==='success'?'bg-emerald-600':'bg-slate-800'} text-white px-4 py-3 rounded-2xl shadow-xl text-sm font-bold animate-pop`;
  div.textContent=message;$('toastContainer').appendChild(div);setTimeout(()=>div.remove(),5000);
}
function editAllowed() {
  if(!storageOK) {showToast('O armazenamento está indisponível. Não vou alterar seus registros.','error');return false;}
  if(!appState.isOwnFamily) {showToast('O acesso do cuidador é somente para acompanhamento.');return false;}
  return true;
}
function commitOperation(op) {
  const before=structuredClone({meds:appState.meds,logs:appState.logs,outbox:appState.outbox});
  applyOperation(appState,op);
  appState.outbox.push({...op,opId:crypto.randomUUID()});
  if(!persist()) {Object.assign(appState,before);return false;}
  announce();renderAll();void flush();return true;
}
async function flush() {
  if(flushRunning||!cloud||!appState.isFirebaseReady||!navigator.onLine||!appState.isOwnFamily||!storageOK) return;
  flushRunning=true;
  const generation=cloudGeneration, family=appState.familyId;
  try {
    while(generation===cloudGeneration&&appState.outbox.length) {
      const op=appState.outbox[0];
      await cloud.send(family,op);
      if(generation!==cloudGeneration) return;
      appState.outbox=appState.outbox.filter(x=>x.opId!==op.opId);persist();
    }
    if(generation===cloudGeneration) status('Nuvem sincronizada',true);
  } catch {if(generation===cloudGeneration) status('Pendente na nuvem');}
  finally {flushRunning=false;}
}
function disconnectListeners() {cloudGeneration++;stopCloud?.();stopCloud=null;appState.isFirebaseReady=false;}
function startListening() {
  const generation=cloudGeneration;
  stopCloud=cloud.listen(appState.familyId,data=>{
    if(generation!==cloudGeneration) return;
    if(!validState(data)) {status('Dados da nuvem inválidos');showToast('A nuvem retornou dados inválidos. Seus registros locais foram preservados.','error');return;}
    const next=structuredClone(data);
    for(const op of appState.outbox) applyOperation(next,op);
    appState.meds=next.meds;appState.logs=next.logs;persist();announce();renderAll();
    status(appState.outbox.length?'Pendente na nuvem':'Nuvem sincronizada',!appState.outbox.length);
  },()=>{if(generation===cloudGeneration) {appState.isFirebaseReady=false;status('Nuvem sem acesso');showToast('Confira a conexão e as regras do Firebase. Registros locais preservados.','error');}});
}
async function initFirebase() {
  if(!config) {status('Somente neste aparelho');return;}
  disconnectListeners();const generation=cloudGeneration;
  status('Conectando à nuvem');
  try {
    const {connectCloud}=await import('./cloud.js');
    const connection=await connectCloud(config);
    const owner=await connection.access(appState.familyId,appState.familyId===uid);
    if(generation!==cloudGeneration) return;
    cloud=connection;appState.isOwnFamily=owner;appState.isFirebaseReady=true;
    $('deviceId').textContent=cloud.userId;
    startListening();renderAll();void flush();
  } catch {if(generation===cloudGeneration) {status('Nuvem indisponível');showToast('A nuvem ainda não conectou. Confira a configuração, a autenticação anônima e as regras de acesso.','error');}}
}

function icon(med) {
  const color=/^#[0-9a-f]{6}$/i.test(med.color)?med.color:'#3b82f6';
  return `<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="color:${color};background:${color}15"><svg aria-hidden="true" class="w-5 h-5" viewBox="0 0 24 24">${SHAPES[med.shape]||SHAPES.pill}</svg></div>`;
}
function allDoses(day) {return appState.meds.flatMap(m=>getCalculatedDosesForDate(m,day)).sort((a,b)=>a.scheduledAt-b.scheduledAt);}
function renderToday() {
  const doses=allDoses(selectedDay),quads={morning:'',afternoon:'',evening:'',bedtime:''};let taken=0;
  for(const dose of doses) {
    const med=appState.meds.find(m=>m.id===dose.medId),log=findLog(appState.logs,dose);
    if(log?.action==='taken') taken++;
    let controls='';
    if(log?.action==='taken') controls='<div class="text-xs font-bold text-brand-600 py-1">Tomado ✅</div>';
    else if(log?.action==='skipped') controls='<div class="text-xs font-bold text-slate-500 py-1">Pulado</div>';
    else if(appState.isOwnFamily&&selectedDay<=dateKey()) {
      controls=`<button data-dose="${dose.scheduledAt}" data-med="${escaped(med.id)}" data-action="taken" class="flex-1 bg-brand-500 text-white font-bold text-xs py-3 rounded-xl">Tomar</button><button data-dose="${dose.scheduledAt}" data-med="${escaped(med.id)}" data-action="snoozed" class="px-3 py-3 bg-brand-50 text-brand-700 rounded-xl text-xs font-bold">Adiar 15 min</button><button data-dose="${dose.scheduledAt}" data-med="${escaped(med.id)}" data-action="skipped" class="px-3 py-3 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold">Pular</button>`;
    } else controls='<span class="text-xs text-slate-500">Previsto</span>';
    const snooze=log?.action==='snoozed'?`<p class="text-xs text-slate-500 mb-2">Adiado até ${new Date(log.snoozedUntil).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>`:'';
    quads[dose.quadrant]+=`<div class="rounded-2xl border bg-white p-3 shadow-sm mb-2"><div class="flex items-center gap-3 mb-2">${icon(med)}<div class="min-w-0"><h5 class="font-bold text-slate-800 text-sm leading-tight break-words">${escaped(med.name)}</h5><p class="text-xs text-slate-500 break-words">${escaped(med.dosage)}</p><span class="text-xs text-brand-600 font-bold">${dose.time}</span></div></div>${snooze}<div class="flex gap-2 flex-wrap">${controls}</div></div>`;
  }
  for(const q of Object.keys(quads)) $(`quad-${q}`).innerHTML=quads[q]||'<div class="text-xs text-slate-400 text-center py-2 font-bold uppercase">Livre</div>';
  const pct=doses.length?Math.round(taken/doses.length*100):0;
  $('adherencePct').textContent=`${pct}%`;$('adherenceCircle').style.strokeDashoffset=213.6*(1-pct/100);
  $('adherenceText').textContent=doses.length?`${taken} de ${doses.length} doses registradas como tomadas.`:'Nenhum remédio previsto para este dia.';
  $('headerDate').textContent=localDay(selectedDay).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
  $('selectedDate').value=selectedDay;
  document.querySelectorAll('[data-day-offset]').forEach(b=>{const d=new Date();d.setDate(d.getDate()+Number(b.dataset.dayOffset));b.setAttribute('aria-pressed',String(dateKey(d)===selectedDay));});
}
function renderMeds() {
  $('medsListGrid').innerHTML=appState.meds.map(m=>`<div class="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm"><div class="flex gap-3 mb-3">${icon(m)}<div class="min-w-0"><h4 class="font-black text-slate-800 break-words">${escaped(m.name)}</h4><p class="text-xs text-slate-500 break-words">${escaped(m.dosage)} · ${m.intervalHours?`A cada ${m.intervalHours} horas`:escaped((m.times||[]).join(', '))}</p></div></div><div class="bg-slate-50 rounded-xl p-2 flex justify-between items-center text-xs font-bold"><span>Estoque: ${escaped(m.stock)}</span>${appState.isOwnFamily?`<button data-delete="${escaped(m.id)}" class="text-red-600 px-3 py-2">Excluir</button>`:''}</div></div>`).join('')||'<p class="text-slate-500 py-8">Sem medicamentos.</p>';
}
function renderHistory() {
  $('logsContainer').innerHTML=[...appState.logs].sort((a,b)=>b.timestamp-a.timestamp).slice(0,100).map(l=>{
    const m=appState.meds.find(x=>x.id===l.medId);
    const label={taken:'Tomado',skipped:'Pulado',snoozed:'Adiado'}[l.action]||'Registro';
    return `<div class="p-4 flex justify-between gap-3 border-b border-slate-100"><div class="min-w-0"><p class="font-bold text-sm break-words">${escaped(m?.name||l.medName||'Medicamento excluído')}</p><p class="text-xs text-slate-500">${escaped(l.date)} às ${escaped(l.timeScheduled)}</p></div><span class="text-xs font-bold ${l.action==='taken'?'text-brand-700':'text-slate-500'}">${label}</span></div>`;
  }).join('')||'<p class="p-6 text-center text-slate-500">Sem histórico.</p>';
}
function renderAll() {
  renderToday();renderMeds();renderHistory();renderStorage();
  const low=appState.meds.filter(m=>m.stock<=m.minStock);
  $('stockAlertsContainer').innerHTML=low.map(m=>`<div class="bg-amber-100 border border-amber-200 text-amber-800 rounded-2xl p-3 text-xs font-bold">⚠️ Estoque de ${escaped(m.name)} baixo: ${escaped(m.stock)}.</div>`).join('');
  $('stockAlertsContainer').classList.toggle('hidden',!low.length);
  $('myFamilyCode').textContent=uid;$('currentFamilyLabel').textContent=appState.isOwnFamily?'Sua Conta Pessoal':`Acompanhando: ${appState.familyId}`;
  $('btnResetFamily').classList.toggle('hidden',appState.familyId===uid);
  $('authorizePanel').classList.toggle('hidden',!appState.isOwnFamily||!cloud);
  $('cloudNotice').textContent=cloud?'Compartilhe seu ID de dispositivo com o titular. Ele precisa autorizar o acesso.':'Configure o mesmo projeto Firebase nos aparelhos para usar o Medfriend.';
  document.querySelectorAll('[onclick="openAddMedModal()"] ').forEach(b=>b.disabled=!appState.isOwnFamily||!storageOK);
}

async function unlockAudio() {
  try {
    audio ||= new (window.AudioContext||window.webkitAudioContext)();
    await audio.resume();
    const warm=audio.createBufferSource();warm.buffer=audio.createBuffer(1,1,audio.sampleRate);warm.connect(audio.destination);warm.start();
    $('audioStatus').textContent='Som ativado nesta sessão';
  } catch {$('audioStatus').textContent='Som indisponível neste navegador';}
}
function playPillSound() {
  if(!audio||audio.state!=='running') return;
  for(let i=0;i<4;i++) {
    const osc=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+i*.055;
    osc.type='triangle';osc.frequency.value=900+Math.random()*900;
    gain.gain.setValueAtTime(.055,at);gain.gain.exponentialRampToValueAtTime(.001,at+.05);
    osc.connect(gain);gain.connect(audio.destination);osc.start(at);osc.stop(at+.06);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
}
async function activateReminders() {
  const audioPromise=unlockAudio();
  const notificationPromise='Notification' in window?Notification.requestPermission():Promise.resolve('unsupported');
  await audioPromise;
  const permission=await notificationPromise;
  $('notificationStatus').textContent=permission==='granted'?'Notificações permitidas':permission==='denied'?'Notificações bloqueadas nas configurações do navegador':'Notificações não ativadas';
  showToast('Os lembretes funcionam enquanto o app estiver ativo.');
}
async function unlockAudioAndStart() {
  void activateReminders();rawWrite('curasafe_has_onboarded','true');$('welcomeScreen').classList.add('hidden');setBackgroundInert(false);
}
async function checkReminders() {
  const today=dateKey();
  if(followToday&&selectedDay!==today) {selectedDay=today;renderToday();}
  if(!storageOK||!appState.isOwnFamily) return;
  const now=Date.now();let beep=false;
  const doses=allDoses(today);
  for(const log of appState.logs) {
    if(log.action==='snoozed'&&log.date!==today&&appState.meds.some(m=>m.id===log.medId)) {
      doses.push({medId:log.medId,date:log.date,time:log.timeScheduled,scheduledAt:log.scheduledAt});
    }
  }
  for(const dose of doses) {
    const log=findLog(appState.logs,dose);
    if(['taken','skipped'].includes(log?.action)) continue;
    const due=log?.action==='snoozed'?log.snoozedUntil:dose.scheduledAt;
    const tag=`${doseId(dose)}_${due}`;
    if(due>now||appState.notified[tag]) continue;
    appState.notified[tag]=now;
    showToast('Você tem uma dose pendente. Confira sua caixa de remédios.');beep=true;
    if('Notification' in window&&Notification.permission==='granted'&&'serviceWorker' in navigator) {
      const registration=await navigator.serviceWorker.getRegistration();
      registration?.active?.postMessage({type:'NOTIFY',tag});
    }
  }
  // Keep just the recent notification ledger; dose logs are never pruned.
  for(const [key,at] of Object.entries(appState.notified)) if(at<now-7*86400000) delete appState.notified[key];
  persist();if(beep) playPillSound();
}

function saveMedication() {
  if(!editAllowed()) return;
  const name=$('inputName').value.trim(),dosage=$('inputDosage').value.trim(),freq=Number($('inputFrequency').value);
  const stock=Number($('inputStock').value),minStock=Number($('inputMinStock').value);
  if(!name||!dosage||name.length>120||dosage.length>120) return showToast('Preencha nome e dose (até 120 caracteres).','error');
  if(![1,2,3,4].includes(freq)||!$('inputStock').value||!$('inputMinStock').value||![stock,minStock].every(x=>Number.isInteger(x)&&x>=0&&x<=1000000)) return showToast('Preencha o estoque com números inteiros, a partir de zero.','error');
  try {
    const startAt=startTimestamp($('inputStartDate').value,$('inputInitialTime').value);
    const med={id:`med_${crypto.randomUUID()}`,name,dosage,startAt,intervalHours:24/freq,freq,initialTime:$('inputInitialTime').value,shape:$('inputShape').value,color:$('inputColor').value,stock,minStock,updatedAt:Date.now()};
    if(commitOperation({kind:'save',med})) {closeModal();showToast('Medicamento salvo neste aparelho.','success');}
  } catch(e) {showToast(e.message,'error');}
}
async function handleDose(medId,scheduledAt,action) {
  if(!editAllowed()) return;
  const dose=allDoses(selectedDay).find(d=>d.medId===medId&&d.scheduledAt===Number(scheduledAt));
  if(!dose||selectedDay>dateKey()||!['taken','skipped','snoozed'].includes(action)) return;
  const old=findLog(appState.logs,dose);
  if(['taken','skipped'].includes(old?.action)) return;
  const med=appState.meds.find(m=>m.id===medId);
  const log={id:old?.id||doseId(dose),medId,medName:med.name,date:dose.date,timeScheduled:dose.time,scheduledAt:dose.scheduledAt,action,timestamp:Date.now()};
  if(action==='snoozed') log.snoozedUntil=snoozeUntil(dose,old);
  if(commitOperation({kind:'dose',log})&&action==='taken') {await unlockAudio();playPillSound();}
}
function deleteMed(id) {
  if(!editAllowed()) return;
  const med=appState.meds.find(m=>m.id===id);
  if(med&&confirm(`Excluir ${med.name} da caixa? O histórico será mantido.`)) {
    if(commitOperation({kind:'delete',id})) showToast('Medicamento excluído. Histórico preservado.');
  }
}
async function joinFamily(fromWelcome=false) {
  if(!cloud||!appState.isFirebaseReady) return showToast('Configure e conecte o Firebase antes de acessar outra família.','error');
  const id=$(fromWelcome?'welcomeInputCode':'inputJoinCode').value.trim().toUpperCase();
  if(!familyCode(id)) return showToast('Código de família inválido.','error');
  try {
    const owner=await cloud.access(id,id===uid);
    disconnectListeners();appState.familyId=id;appState.isOwnFamily=owner;rawWrite('curasafe_familyId',id);loadScope();
    appState.isFirebaseReady=true;startListening();renderAll();void flush();
    if(fromWelcome) void unlockAudioAndStart();showToast('Família conectada.','success');
  } catch(e) {showToast(e.message||'Acesso não autorizado.','error');}
}
async function resetToOwnFamily() {
  disconnectListeners();appState.familyId=uid;appState.isOwnFamily=true;rawWrite('curasafe_familyId',uid);loadScope();renderAll();
  if(config) await initFirebase();else status('Somente neste aparelho');
}
async function authorize(revoke=false) {
  const user=$('caregiverUid').value.trim();
  if(!cloud||!appState.isOwnFamily||!/^[A-Za-z0-9_-]{10,128}$/.test(user)) return showToast('Informe o ID de dispositivo do cuidador.','error');
  if(revoke&&!confirm('Revogar o acesso deste cuidador? Cópias já vistas no aparelho dele não podem ser apagadas remotamente.')) return;
  try {await cloud[revoke?'revoke':'authorize'](appState.familyId,user);showToast(revoke?'Acesso revogado.':'Cuidador autorizado para leitura.','success');}
  catch {showToast('Não foi possível alterar a autorização. Confira as regras do Firebase.','error');}
}
function saveFirebaseConfig() {
  if(!storageOK) return;
  try {
    const parsed=JSON.parse($('firebaseConfig').value),clean={};
    for(const key of ['apiKey','authDomain','projectId','appId','storageBucket','messagingSenderId']) if(typeof parsed[key]==='string') clean[key]=parsed[key];
    if(!['apiKey','projectId','appId','authDomain'].every(k=>clean[k]?.trim())||!/^[a-z0-9-]+$/.test(clean.projectId)||!clean.authDomain.endsWith('.firebaseapp.com')) throw new Error('Cole o JSON da configuração Web do Firebase, incluindo apiKey, projectId, appId e authDomain.');
    if(config&&config.projectId!==clean.projectId&&!confirm('Trocar o projeto Firebase? Os dados de cada projeto ficam guardados separadamente neste aparelho.')) return;
    if(!write('curasafe_firebase_config',clean)) return;
    disconnectListeners();config=clean;cloud=null;loadScope();closeSettings();renderAll();void initFirebase();
  } catch(e) {showToast(e instanceof SyntaxError?'JSON inválido. Use aspas duplas nas chaves e nos valores.':e.message,'error');}
}
function setBackgroundInert(value) {document.querySelectorAll('main,header,body > nav').forEach(el=>el.inert=value);}
function openModal(id) {
  modalFocus=document.activeElement;$(id).classList.remove('hidden','opacity-0');$(id).classList.add('flex');setBackgroundInert(true);
  $(id).querySelector('input,textarea,button')?.focus();
}
function closeModal(id='medModal') {$(id).classList.add('hidden');$(id).classList.remove('flex');setBackgroundInert(false);modalFocus?.focus();}
function openAddMedModal() {
  if(!editAllowed()) return;
  $('inputName').value='';$('inputDosage').value='';$('inputFrequency').value='1';$('inputInitialTime').value='08:00';$('inputStartDate').value=dateKey();
  $('inputStock').value='30';$('inputMinStock').value='5';$('inputShape').value='pill';$('inputColor').value='#3b82f6';
  document.querySelectorAll('.color-btn').forEach(b=>b.classList.toggle('ring-2',b.dataset.color==='#3b82f6'));
  openModal('medModal');
}
function openSettings() {$('firebaseConfig').value=config?JSON.stringify(config,null,2):'';openModal('settingsModal');}
function closeSettings() {closeModal('settingsModal');}
function switchTab(tab) {
  for(const t of ['today','meds','history','medfriend']) {
    $(`section-${t}`).classList.toggle('hidden',t!==tab);
    for(const prefix of ['tab-btn-','mobile-tab-']) $(prefix+t)?.setAttribute('aria-current',t===tab?'page':'false');
  }
}
async function copyFamilyCode() {try {await navigator.clipboard.writeText(uid);showToast('Código copiado.');}catch {showToast('Selecione e copie o código exibido.');}}
function changeDay(offset) {const d=new Date();d.setDate(d.getDate()+offset);selectedDay=dateKey(d);followToday=offset===0;renderToday();}
Object.assign(window,{saveMedication,handleDose,deleteMed,openAddMedModal,closeModal,openSettings,closeSettings,saveFirebaseConfig,switchTab,copyFamilyCode,joinFamily,joinFromWelcome:()=>joinFamily(true),resetToOwnFamily,authorize,activateReminders,unlockAudioAndStart,startFresh:unlockAudioAndStart,
  showJoinInput:()=>{$('welcomeOptions').classList.add('hidden');$('welcomeJoin').classList.remove('hidden');$('welcomeJoin').classList.add('flex');$('welcomeInputCode').focus();},
  hideJoinInput:()=>{$('welcomeOptions').classList.remove('hidden');$('welcomeJoin').classList.add('hidden');},
  selectColor:(color,button)=>{$('inputColor').value=color;document.querySelectorAll('.color-btn').forEach(b=>b.classList.remove('ring-2'));button.classList.add('ring-2');}
});
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b) return;
  if(b.dataset.action) void handleDose(b.dataset.med,b.dataset.dose,b.dataset.action);
  if(b.dataset.delete) deleteMed(b.dataset.delete);
  if(b.dataset.dayOffset!==undefined) changeDay(Number(b.dataset.dayOffset));
});
$('selectedDate').addEventListener('change',event=>{try {localDay(event.target.value);selectedDay=event.target.value;followToday=selectedDay===dateKey();renderToday();}catch {showToast('Selecione uma data válida.','error');}});
document.addEventListener('keydown',event=>{
  const active=['medModal','settingsModal','welcomeScreen'].map($).find(el=>!el.classList.contains('hidden'));
  if(!active) return;
  if(event.key==='Escape'&&active.id!=='welcomeScreen') closeModal(active.id);
  if(event.key==='Tab') {
    const controls=[...active.querySelectorAll('button,input,select,textarea,a[href]')].filter(el=>el.getClientRects().length&&!el.disabled),first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first) {event.preventDefault();last.focus();}
    if(!event.shiftKey&&document.activeElement===last) {event.preventDefault();first.focus();}
  }
});
window.addEventListener('online',()=>{if(config&&!appState.isFirebaseReady) void initFirebase();else void flush();});
window.addEventListener('offline',()=>status(config?'Offline · salvo neste aparelho':'Somente neste aparelho'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden) {void checkReminders();void flush();}});
document.addEventListener('pointerdown',()=>{if(audio?.state==='suspended') void audio.resume();});
loadScope();renderAll();
if(raw('curasafe_has_onboarded')==='true') $('welcomeScreen').classList.add('hidden');
else {setBackgroundInert(true);$('welcomeScreen').querySelector('button')?.focus();}
if('Notification' in window) $('notificationStatus').textContent=Notification.permission==='granted'?'Notificações permitidas':'Notificações não ativadas';
const hadWorker=raw('curasafe_has_onboarded')==='true'&&'serviceWorker' in navigator&&!!navigator.serviceWorker.controller;
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(reg=>{
  const showUpdate=()=>{if(reg.waiting&&hadWorker) $('updateApp').classList.remove('hidden');};
  showUpdate();
  reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',showUpdate));
}).catch(()=>showToast('Não foi possível preparar o uso offline. Confira a conexão.','error'));
$('updateApp').addEventListener('click',async()=>{const reg=await navigator.serviceWorker.getRegistration();$('updateApp').dataset.requested='true';reg?.waiting?.postMessage({type:'SKIP_WAITING'});});
let reloading=false;navigator.serviceWorker?.addEventListener('controllerchange',()=>{if(!reloading&&$('updateApp').dataset.requested==='true') {reloading=true;location.reload();}});
void initFirebase();setInterval(()=>{void checkReminders();void flush();},10000);
