import test from 'node:test';
import assert from 'node:assert/strict';
import {dateKey,localDay,startTimestamp,quadrant,getCalculatedDosesForDate,doseId,findLog,applyOperation,escaped,familyCode,snoozeUntil,validState} from '../core.js';
process.env.TZ='America/Manaus';
const med={id:'med_test',startAt:startTimestamp('2026-10-03','22:00'),intervalHours:8,stock:10};
test('22h + 8h becomes 06h on the next day, then 14h and 22h',()=>{
  assert.deepEqual(getCalculatedDosesForDate(med,'2026-10-03').map(d=>d.time),['22:00']);
  const next=getCalculatedDosesForDate(med,'2026-10-04');
  assert.deepEqual(next.map(d=>d.time),['06:00','14:00','22:00']);
  assert.equal(next[0].quadrant,'morning');assert.equal(next[0].scheduledAt-med.startAt,8*3600000);
});
test('no doses before treatment begins',()=>assert.deepEqual(getCalculatedDosesForDate(med,'2026-10-02'),[]));
test('local date remains Oct 3 at 23:30 Manaus although UTC is Oct 4',()=>assert.equal(dateKey(new Date('2026-10-04T03:30:00Z')),'2026-10-03'));
test('midnight belongs to the new day exactly once',()=>{
  const m={...med,startAt:startTimestamp('2026-10-03','16:00')};
  assert.deepEqual(getCalculatedDosesForDate(m,'2026-10-03').map(d=>d.time),['16:00']);
  assert.deepEqual(getCalculatedDosesForDate(m,'2026-10-04').map(d=>d.time),['00:00','08:00','16:00']);
});
test('quadrant boundaries',()=>assert.deepEqual(['05:59','06:00','11:59','12:00','17:59','18:00','22:59','23:00'].map(quadrant),['bedtime','morning','morning','afternoon','afternoon','evening','evening','bedtime']));
test('bad dates and times are rejected',()=>{for(const value of ['2026-02-30','','2026-13-01']) assert.throws(()=>localDay(value));for(const time of ['24:00','8:00','10:61','']) assert.throws(()=>startTimestamp('2026-10-03',time));});
test('legacy fixed schedules are preserved without inventing a start date',()=>assert.deepEqual(getCalculatedDosesForDate({id:'old',times:['22:00','06:00','14:00']},'2026-10-03').map(d=>d.time),['06:00','14:00','22:00']));
test('daily dose IDs differ across dates',()=>assert.notEqual(doseId(getCalculatedDosesForDate(med,'2026-10-03')[0]),doseId(getCalculatedDosesForDate(med,'2026-10-04')[2])));
test('legacy logs can still mark the corresponding dose',()=>{const dose=getCalculatedDosesForDate(med,'2026-10-03')[0];assert.equal(findLog([{id:'old',medId:med.id,date:dose.date,timeScheduled:dose.time,action:'taken'}],dose).action,'taken');});
test('repeated taken operations decrement stock just once',()=>{
  const s={meds:[{...med}],logs:[]},op={kind:'dose',log:{id:'dose1',medId:med.id,action:'taken'}};
  applyOperation(s,op);applyOperation(s,op);assert.equal(s.meds[0].stock,9);assert.equal(s.logs.length,1);
});
test('snooze and skip do not decrement stock; a terminal dose cannot be changed',()=>{
  const s={meds:[{...med}],logs:[]};
  for(const action of ['snoozed','snoozed','skipped','taken']) applyOperation(s,{kind:'dose',log:{id:'dose1',medId:med.id,action}});
  assert.equal(s.meds[0].stock,10);assert.equal(s.logs[0].action,'skipped');
});
test('taken after snooze decrements only once; zero stock never becomes negative',()=>{
  const s={meds:[{...med,stock:0}],logs:[]};
  for(const action of ['snoozed','taken','taken']) applyOperation(s,{kind:'dose',log:{id:'dose1',medId:med.id,action}});
  assert.equal(s.meds[0].stock,0);assert.equal(s.logs[0].action,'taken');
});
test('deleting a medication preserves history',()=>{const s={meds:[{...med}],logs:[{id:'old'}]};applyOperation(s,{kind:'delete',id:med.id});assert.equal(s.meds.length,0);assert.equal(s.logs.length,1);});
test('user-provided HTML is escaped; legacy and new family codes are accepted',()=>{
  assert.equal(escaped('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.ok(familyCode('CURA_ABC123'));assert.ok(familyCode('CURA_ABC123ABC123ABC123ABC123'));assert.ok(!familyCode('../secret'));
});
test('continuous intervals remain 8h across a daylight-saving change',()=>{
  process.env.TZ='America/New_York';
  try {const start=startTimestamp('2026-10-31','22:00'),m={...med,startAt:start};const d=getCalculatedDosesForDate(m,'2026-11-01');assert.equal(d[0].scheduledAt-start,8*3600000);assert.equal(d[0].time,'05:00');}
  finally {process.env.TZ='America/Manaus';}
});
test('invalid intervals do not produce loops',()=>{for(const intervalHours of [0,-1,NaN,Infinity]) assert.deepEqual(getCalculatedDosesForDate({...med,intervalHours},'2026-10-04'),[]);});
test('snoozing a future dose uses its scheduled time, not an earlier current time',()=>{
  const scheduledAt=startTimestamp('2026-10-03','14:00');
  assert.equal(snoozeUntil({scheduledAt},null,startTimestamp('2026-10-03','11:00')),startTimestamp('2026-10-03','14:15'));
});
test('snoozing an overdue dose uses now and safely crosses midnight',()=>{
  const scheduledAt=startTimestamp('2026-10-03','22:00');
  assert.equal(snoozeUntil({scheduledAt},null,startTimestamp('2026-10-03','23:55')),startTimestamp('2026-10-04','00:10'));
});
test('corrupt stored state is rejected before rendering',()=>{
  assert.ok(validState({meds:[],logs:[],outbox:[]}));
  for(const data of [{meds:[null],logs:[]},{meds:[],logs:[{}]},{meds:'bad',logs:[]},{meds:[{...med,name:'A',dosage:'B',minStock:1,intervalHours:.0000001}],logs:[]}]) assert.ok(!validState(data));
});
test('pending legacy-history import survives an empty remote snapshot without consuming stock',()=>{
  const s={meds:[{...med}],logs:[]};
  applyOperation(s,{kind:'importLog',log:{id:'old',medId:med.id,action:'taken'}});
  assert.equal(s.logs.length,1);assert.equal(s.meds[0].stock,10);
});
