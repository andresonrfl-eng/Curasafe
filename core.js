// Dates always use the device's local calendar; intervals use continuous timestamps.
export function dateKey(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function localDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Data inválida.');
  const [y,m,d] = key.split('-').map(Number);
  const value = new Date(y,m-1,d);
  if (dateKey(value) !== key) throw new Error('Data inválida.');
  return value;
}
export function startTimestamp(day, time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Horário inválido.');
  const d = localDay(day), [h,m] = time.split(':').map(Number);
  d.setHours(h,m,0,0);
  return d.getTime();
}
export function quadrant(time) {
  const h = Number(time.slice(0,2));
  return h>=6&&h<12?'morning':h>=12&&h<18?'afternoon':h>=18&&h<23?'evening':'bedtime';
}
export function getCalculatedDosesForDate(med, day) {
  const start = localDay(day), end = new Date(start);
  end.setDate(end.getDate()+1);
  // Preserve legacy fixed schedules: the old data has no treatment start date.
  if (!Number.isFinite(med.startAt)) return (med.times || []).map(time => ({
    medId: med.id, time, date: day, scheduledAt: startTimestamp(day,time), quadrant:quadrant(time)
  })).sort((a,b)=>a.scheduledAt-b.scheduledAt);
  const interval = med.intervalHours*3600000;
  if (!(interval>=3600000) || !Number.isFinite(interval)) return [];
  let at = med.startAt + Math.max(0,Math.ceil((start.getTime()-med.startAt)/interval))*interval;
  const doses=[];
  for (;at<end.getTime();at+=interval) {
    const d=new Date(at), time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    doses.push({medId:med.id,time,date:day,scheduledAt:at,quadrant:quadrant(time)});
  }
  return doses;
}
export function doseId(dose) { return `${dose.medId}_${dose.scheduledAt}`; }
export function findLog(logs,dose) {
  return logs.find(l=>l.id===doseId(dose)) || logs.find(l=>l.medId===dose.medId&&l.date===dose.date&&l.timeScheduled===dose.time);
}
export function nextStock(stock, previousAction, nextAction) {
  return Math.max(0,Number(stock)||0) + (previousAction==='taken'?1:0) - (nextAction==='taken'?1:0);
}
export function applyOperation(state, op) {
  if (op.kind==='save') {
    const i=state.meds.findIndex(m=>m.id===op.med.id);
    if(i<0) state.meds.push({...op.med}); else state.meds[i]={...op.med};
  } else if(op.kind==='delete') state.meds=state.meds.filter(m=>m.id!==op.id);
  else if(op.kind==='importLog') {
    if(!state.logs.some(l=>l.id===op.log.id)) state.logs.push({...op.log});
  } else if(op.kind==='dose') {
    const previous=state.logs.find(l=>l.id===op.log.id);
    const med=state.meds.find(m=>m.id===op.log.medId);
    if(previous && ['taken','skipped'].includes(previous.action)) return;
    if(med) med.stock=Math.max(0,nextStock(med.stock,previous?.action,op.log.action));
    const i=state.logs.findIndex(l=>l.id===op.log.id);
    if(i<0) state.logs.push({...op.log}); else state.logs[i]={...op.log};
  }
}
export function escaped(value) {
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function familyCode(value) { return /^CURA_[A-Z0-9]{6,32}$/.test(value); }
export function snoozeUntil(dose,log,now=Date.now()) {
  return Math.max(now,log?.snoozedUntil||dose.scheduledAt)+15*60000;
}
export function validState(data) {
  return data && Array.isArray(data.meds) && Array.isArray(data.logs) && Array.isArray(data.outbox||[])
    && data.meds.every(m=>m && typeof m.id==='string' && typeof m.name==='string' && typeof m.dosage==='string'
      && Number.isFinite(m.stock) && Number.isFinite(m.minStock)
      && (Number.isFinite(m.startAt) && Number.isFinite(m.intervalHours) && m.intervalHours>=1
        || Array.isArray(m.times) && m.times.every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t))))
    && data.logs.every(l=>l && typeof l.id==='string' && typeof l.medId==='string' && /^\d{4}-\d{2}-\d{2}$/.test(l.date)
      && typeof l.timeScheduled==='string' && Number.isFinite(l.timestamp) && ['taken','skipped','snoozed'].includes(l.action)
      && (l.action!=='snoozed'||Number.isFinite(l.snoozedUntil)))
    && (data.outbox||[]).every(op=>op && ['save','delete','dose','importLog'].includes(op.kind));
}
