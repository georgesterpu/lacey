// Slots are calendar slots in Dublin, not a rolling 12-hour timeout. DST is handled
// by Intl and the scheduler's IANA timezone, with one digest identity per slot.
export function scheduleSlot(now=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(name:string)=>parts.find(p=>p.type===name)!.value;
 let date=`${get('year')}-${get('month')}-${get('day')}`;const hour=Number(get('hour'));
 if(hour<8){date=new Date(Date.parse(`${date}T12:00:00Z`)-86400000).toISOString().slice(0,10);return `${date}:20`;}
 return `${date}:${hour<20?'08':'20'}`;
}
export function nextCheck(now=new Date()) {
 for(let mins=1;mins<=13*60;mins++){const candidate=new Date(Math.floor(now.getTime()/60000)*60000+mins*60000);const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(candidate);if(parts==='08:07'||parts==='20:07')return candidate.toISOString();}return null;
}
