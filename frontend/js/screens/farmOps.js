import { t as tr, dateLocale } from '../i18n/index.js';
import { el } from '../dom.js';
import { farmOps, identity } from '../state.js';
import * as api from '../farmOps/farmOpsApi.js';
import { autoCap } from '../forum/forumUtils.js';
import { wmo } from './weather.js';

const STATUS = { scheduled:tr('□ Scheduled'),assigned:tr('→ Assigned'),accepted:tr('→ Accepted'),in_progress:tr('▶ In progress'),completed:tr('✓ Completed'),verified:tr('✓✓ Verified'),blocked:tr('× Blocked'),delayed:tr('– Delayed'),cancelled:tr('– Cancelled') };
const dateShift = (iso, days) => { const d=new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
const niceDate = (iso) => new Intl.DateTimeFormat(dateLocale, { day:'numeric', month:'short', timeZone:'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const requestId = () => globalThis.crypto?.randomUUID?.() || `farm-${Date.now()}-${Math.random()}`;
const message = (text, cls='ops-empty') => el(cls, tr(text));
// "Today" in the farm's timezone: Cloud Phone renders in CloudMosa's cloud, whose clock and zone are not the farmer's.
// Event times in the farm's own timezone: the cloud browser's clock is CloudMosa's, not the
// farmer's. Same locale as niceDate (the member's UI language).
const farmTime = (iso, tz) => new Intl.DateTimeFormat(dateLocale, { timeZone: tz || 'UTC', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(iso)).replace(',', '');
const farmToday = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
// Errors go to the shared toast bar; native alert() dialogs are not verified on Cloud Phone keypads.
let flashTimer=null;
const flash = (text) => { const t=document.getElementById('toast'); if(!t)return; t.textContent=`⚠ ${tr(text)}`; t.hidden=false; clearTimeout(flashTimer); flashTimer=setTimeout(()=>{t.hidden=true;},4000); };
function openFarm(ctx, f) { farmOps.activeFarmId=f.id; farmOps.activeFarm=f; farmOps.marketIndex=0; farmOps.activeDate=new URLSearchParams(location.search).get('demoDate')||farmToday(f.timezone); ctx.router.replace('TodayDashboard'); }
const taskRow = (t) => {
  const row=el(`item ops-task-row priority-${t.priority || 'normal'}`); row.dataset.id=t.id;
  const mark=el('ops-task-status', (STATUS[t.status] || t.status || '□').split(' ')[0]);
  // A task from an earlier day that is still running says since when.
  const since=t.status==='in_progress'&&farmOps.activeDate&&t.localDate<farmOps.activeDate?` · ${tr('from {date}',{date:niceDate(t.localDate)})}`:'';
  const body=el('ops-task-body'); body.append(el('ops-task-title',t.title),el('ops-task-meta',`${t.fieldName || tr('No field')} · ${t.assignments?.[0]?.name || tr('Unassigned')}${since}`));
  row.append(mark,body); return row;
};
const section = (root, title, items) => {
  if (!items?.length) return;
  root.append(el('ops-section-title', `${tr(title)} · ${items.length}`));
  items.forEach((t)=>root.append(taskRow(t)));
};
// Today: the conditions now. Another day in the coming week: its forecast. Otherwise it says so,
// instead of showing today's weather under another date.
const weatherRow = (data) => {
  if (!data.weather) return null;
  const day=data.weatherDay||{basis:'now'}, a=data.sprayAssessment, w=data.weather.current||{};
  let main;
  if (day.basis==='forecast') { const [ic]=wmo(day.code); main=`${ic} ${day.tmin}–${day.tmax}°C · ${tr('Rain')} ${day.rainProb}%${day.windMax!=null?` · ${tr('W')} ${Math.round(day.windMax)}km/h`:''}`; }
  else if (day.basis==='past') main=tr('Past day · no forecast');
  else if (day.basis==='beyond') main=tr('No forecast this far ahead');
  else { const [ic]=wmo(w.code??w.weatherCode); main=`${ic} ${Math.round(w.temperatureC??w.temp??0)}°C · ${tr('W')} ${Math.round(w.windSpeedKph??w.wind_speed??0)}km/h · ${tr('H')} ${Math.round(w.relativeHumidity??w.humidity??0)}%`; }
  const meta = a ? `${tr('SPRAY')}: ${tr(a.overall.toUpperCase())} · ${a.bestWindow?`${a.bestWindow.from}–${a.bestWindow.to}`:tr('no safe window')}`
    : ['past','beyond'].includes(day.basis) ? '' : tr('No spray task');
  const row=el(`ops-live-row ops-weather ops-${a?.overall||'unknown'}`);
  row.append(el('ops-live-main',main)); if(meta) row.append(el('ops-live-meta',meta));
  return row;
};
// One row per farm, for the crops it grows; with several, the row is selectable and Enter shows the next.
const marketRow = (list) => {
  if(!list?.length)return null; const i=(farmOps.marketIndex||0)%list.length, m=list[i], many=list.length>1;
  const arrow=String(m.trend7d).startsWith('-')?'▼':'▲';
  const row=el(`ops-live-row ops-market${many?' item':''}`); if(many) row.dataset.market='1';
  row.append(el('ops-live-main',`📊 ${tr(m.crop.charAt(0).toUpperCase()+m.crop.slice(1)).toUpperCase()} ₹${Math.round(m.localPrice)}/${tr('qt')} ${arrow}${m.trend7d}${many?` · ${i+1}/${list.length}`:''}`),
    el('ops-live-meta',m.bestNearbyMarket?`${m.bestNearbyMarket}: ${m.netGainPerUnit>=0?'+':''}₹${m.netGainPerUnit??'?'} /${tr('qt')} ${tr('net')} · ${m.source}`:`${tr('Source:')} ${m.provider} · ${m.source}`));
  return row;
};

function asyncScreen({ name, title=name, load, renderData, softLeft, onKey, onEnter, initialFocus, numericSelect=false }) {
  let state={ status:'idle', data:null, error:null };
  async function fetchData(ctx) { state={...state,status:'loading',error:null}; ctx.rerender(); try { state={status:'ready',data:await load(ctx),error:null}; } catch(e) { state={...state,status:'error',error:e.message}; } ctx.rerender(); }
  return { name,title,softLeft,numericSelect,softRight:{label:'Back',handler:(ctx)=>ctx.router.pop()},
    onShow(ctx){ if(state.status==='idle') fetchData(ctx); }, onHide(){ state={status:'idle',data:null,error:null}; },
    render(ctx){ if(state.status==='loading'&&!state.data)return message('Loading…'); if(state.status==='error')return el('ops-error',`${state.error ? tr(state.error) : tr('Unable to load')} · ${tr('Enter to retry')}`); return state.data?renderData(state.data,ctx):message('Loading…'); },
    initialFocus(ctx){ return initialFocus?.(ctx,state.data); },
    onKey(action,ctx){ if(state.status==='error'&&action==='ENTER'){fetchData(ctx);return true;} return onKey?.(action,ctx,state.data)===true; },
    onEnter(node,ctx,i){ return onEnter?.(node,ctx,i,state.data); }, refresh(ctx){fetchData(ctx);},
  };
}

// Every farm the member belongs to, plus "Add a farm": a farmer can run several (own plots, a
// family farm, a cooperative). Adding asks for a name, then a region (default: the profile's),
// which gives the farm its weather and nearby mandis.
export const FarmGate = asyncScreen({
  name:'FarmGate',title:"Today's Farm",load:()=>api.farms(),numericSelect:true,
  renderData(data){ const root=el('list'); if(!data.items.length) root.append(message('You have no farm yet. Add one to plan daily work.'));
    data.items.forEach((f,i)=>{const r=el('item ops-team-row');r.dataset.farm=f.id;const body=el('ops-task-body');body.append(el('ops-task-title',`${i+1}  ${f.name}`),el('ops-task-meta',tr(f.region_name||f.region_code)));r.append(body,el('ops-task-meta',`${tr(f.role)} · ${tr('{n} open',{n:f.open_tasks})}`));root.append(r);});
    const add=el('item ops-action',`${data.items.length+1}  ${tr('+ Add a farm')}`);add.dataset.create='1';root.append(add); return root; },
  async onEnter(node,ctx,_i,data){ if(node?.dataset.create) return addFarm(ctx); const f=data?.items.find((x)=>x.id===node?.dataset.farm); if(f) openFarm(ctx,f); },
});

// Reuses the shared keypad text box (MarketText) and numbered list (ForumPicker) screens.
function addFarm(ctx){
  ctx.router.push('MarketText',{title:'Farm name',initial:'',max:80,min:1,onDone:(name,c)=>pickRegion(c,autoCap(name))}); // stored as shown on screen
}
async function pickRegion(ctx,name){
  let regions;
  try{ regions=await api.regions(); }catch(e){ flash(e.message); return; }
  ctx.router.replace('ForumPicker',{title:'Farm region',selected:identity.profile?.regionCode,
    options:regions.map((r)=>({label:tr(r.name),value:r.code})),onPick:(o,c)=>createFarm(c,{name,regionCode:o.value})});
}
let creatingFarm=false;
async function createFarm(ctx,body){ if(creatingFarm)return; creatingFarm=true; try{ const out=await api.createFarm(body); const f=(await api.farms()).items.find((x)=>x.id===out.id); if(f) openFarm(ctx,f); }catch(e){ flash(e.message); }finally{ creatingFarm=false; } }
function ensureFarm(ctx){ if(!farmOps.activeFarmId){ctx.router.replace('FarmGate');return false;}return true; }
export const TodayDashboard = asyncScreen({
  name:'TodayDashboard',title:()=>"Today's Farm",softLeft:{label:'Add',handler:(ctx)=>ctx.router.push('FarmTaskCreate')},
  load(ctx){ if(!ensureFarm(ctx)) return Promise.reject(new Error(tr('Choose a farm'))); return api.today(farmOps.activeFarmId,farmOps.activeDate); },
  renderData(data){ const root=el('ops-page'); root.append(el('ops-date-switcher',`${data.farm.name} · ${niceDate(data.date)}`),el('ops-progress',tr('{done} / {total} complete · {active} active · {blocked} blocked',{done:data.summary.completed,total:data.summary.total,active:data.summary.inProgress,blocked:data.summary.blocked}))); const wr=weatherRow(data),mr=marketRow(data.marketSnapshots||(data.marketSnapshot?[data.marketSnapshot]:[]));if(wr)root.append(wr);if(mr)root.append(mr);if(data.alerts?.[0])root.append(el('ops-alert',data.alerts[0].message)); section(root,'OVERDUE',data.sections.overdue);section(root,'BLOCKED',data.sections.blocked);section(root,'IN PROGRESS',data.sections.inProgress);section(root,'DUE TODAY',data.sections.dueToday||data.sections.due);section(root,'UNASSIGNED',data.sections.unassigned);const c=data.communityActivity;if(c&&(c.unreadReplies||c.newPostsToday)){const row=el('item ops-community',tr('🌾 Circle: {replies} new replies · {posts} posts',{replies:c.unreadReplies,posts:c.newPostsToday}));row.dataset.route='FarmerCircleHome';root.append(row);}section(root,'COMPLETED',data.sections.completedToday||data.sections.completed); if(!root.querySelector('.ops-task-row'))root.append(message('No work scheduled. Press Add.')); root.append(el('ops-task-meta',tr('◄► day · 1 Farms · 2 Calendar · 3 Next 7 days · 4 Mine · 5 Records · 6 Team · 7 Fields'))); return root; },
  onKey(action,ctx){ if(action==='NUM_1'){ctx.router.replace('FarmGate');return true;} const map={NUM_2:'FarmCalendar',NUM_3:'FarmUpcoming',NUM_4:'MyFarmTasks',NUM_5:'FarmRecords',NUM_6:'FarmTeam',NUM_7:'FarmFields'}; if(map[action]){ctx.router.push(map[action]);return true;} if(action==='LEFT'||action==='RIGHT'){farmOps.activeDate=dateShift(farmOps.activeDate,action==='LEFT'?-1:1);ctx.router.replace('TodayDashboard');return true;} },
  onEnter(node,ctx){if(node?.dataset.market){farmOps.marketIndex=(farmOps.marketIndex||0)+1;return ctx.rerender();}if(node?.dataset.route)return ctx.router.push(node.dataset.route);const id=node?.dataset.id;if(id)ctx.router.push('FarmTaskDetail',{id});},
});

export const FarmUpcoming = asyncScreen({ name:'FarmUpcoming',title:'Upcoming',softLeft:{label:'Add',handler:(ctx)=>ctx.router.push('FarmTaskCreate')},
  load:()=>api.upcoming(farmOps.activeFarmId,farmOps.activeDate,7),
  renderData(data){const root=el('ops-page');let day='';for(const t of data.items){if(t.localDate!==day){day=t.localDate;root.append(el('ops-agenda-day',`${day===farmOps.activeDate?tr('TODAY'):niceDate(day)} · ${day}`));}root.append(taskRow(t));}return data.items.length?root:message('Nothing scheduled in the next 7 days.');},
  onEnter(node,ctx){if(node?.dataset.id)ctx.router.push('FarmTaskDetail',{id:node.dataset.id});},
});

export const MyFarmTasks = asyncScreen({ name:'MyFarmTasks',title:'My Tasks',load:()=>api.tasks(farmOps.activeFarmId,`mine=true&from=${dateShift(farmOps.activeDate,-30)}&to=${dateShift(farmOps.activeDate,30)}`),
  renderData(data){const root=el('list');data.items.forEach((t)=>root.append(taskRow(t)));return data.items.length?root:message('No tasks assigned to you.');},
  onEnter(node,ctx){if(node?.dataset.id)ctx.router.push('FarmTaskDetail',{id:node.dataset.id});},
});

function monthBounds(date){const d=new Date(`${date}T00:00:00Z`);const first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));return [first.toISOString().slice(0,10),last.toISOString().slice(0,10)];}
export const FarmCalendar = asyncScreen({ name:'FarmCalendar',title:'Calendar',
  load(){const [from,to]=monthBounds(farmOps.activeDate);return api.calendar(farmOps.activeFarmId,from,to);},
  renderData(data){const root=el('ops-page');const [from]=monthBounds(farmOps.activeDate);root.append(el('ops-date-switcher',new Intl.DateTimeFormat(dateLocale,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${from}T00:00:00Z`))));const grid=el('ops-calendar-grid');['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(x=>grid.append(el('ops-calendar-label',tr(x))));const firstDay=new Date(`${from}T00:00:00Z`).getUTCDay();for(let i=0;i<firstDay;i++)grid.append(el('ops-calendar-day blank',''));const by=new Map(data.days.map(x=>[x.date,x]));const [,to]=monthBounds(farmOps.activeDate);for(let d=from;d<=to;d=dateShift(d,1)){const s=by.get(d);const cell=el(`item ops-calendar-day${d===farmOps.activeDate?' selected':''}`);cell.dataset.date=d;cell.textContent=String(Number(d.slice(-2)));if(s)cell.append(el('ops-calendar-dots',s.blocked?'×':s.completed===s.total?'✓':'•'.repeat(Math.min(3,Math.ceil(s.total/2)))));grid.append(cell);}root.append(grid);const s=by.get(farmOps.activeDate);root.append(el('ops-calendar-summary',tr('{date} · {n} tasks · {min} min',{date:niceDate(farmOps.activeDate),n:s?.total||0,min:s?.estimated_minutes||0})));return root;},
  initialFocus:()=>Number(farmOps.activeDate.slice(-2))-1,
  onKey(action,ctx){if(['LEFT','RIGHT','UP','DOWN'].includes(action)){const n={LEFT:-1,RIGHT:1,UP:-7,DOWN:7}[action];farmOps.activeDate=dateShift(farmOps.activeDate,n);ctx.router.replace('FarmCalendar');return true;}if(action==='NUM_5'){farmOps.activeDate=farmToday(farmOps.activeFarm?.timezone);ctx.router.replace('FarmCalendar');return true;}if(action==='STAR'){ctx.router.push('FarmTaskCreate');return true;}},
  onEnter(node,ctx){if(node?.dataset.date){farmOps.activeDate=node.dataset.date;ctx.router.push('TodayDashboard');}},
});

// Why each reading matters, and when to spray: the best window is worked out from the hourly forecast.
function spraySection(root,spray){
  const when=spray.basis==='forecast'?tr('forecast {time}',{time:spray.at}):spray.at?tr('now {time}',{time:spray.at}):tr('now');
  root.append(el('ops-section-title',`${tr('SPRAY')} · ${tr(spray.overall.toUpperCase())} · ${when}`));
  const w=spray.bestWindow;
  // Older responses carry only the English `reason`; `watch` lets the words follow the UI language.
  const why=!w?'':w.watch?(w.watch.length?tr('No unsuitable hour; watch {list}.',{list:w.watch.map((p)=>tr(p)).join(', ')}):tr('All readings in the good range.')):tr(w.reason||'');
  root.append(el(`ops-spray-window ops-${w?.status||'unsuitable'}`, w?`${tr('Best window {from}–{to} ({hours} h).',{from:w.from,to:w.to,hours:w.hours})} ${why}`:spray.basis==='now'?tr('No safe spray window left today.'):tr('No safe spray window this day.')));
  for(const f of spray.factors){root.append(el(`ops-spray-factor ops-${f.status}`,`${tr(f.param)}: ${f.value??'–'}${f.value!=null?f.unit||'':''} · ${tr(f.status)}`));if(f.reason)root.append(el('ops-spray-reason',tr(f.reason)));}
  root.append(el('ops-description',tr(spray.disclaimer)));
}
let detailActionBusy=false;
const CLOSED=['completed','verified','cancelled','skipped'];
const isManager=(role)=>['owner','manager'].includes(role);
const isMine=(task)=>task.assignments?.some((a)=>a.userId===identity.profile?.id);
const weekday=(iso)=>new Intl.DateTimeFormat(dateLocale,{weekday:'short',timeZone:'UTC'}).format(new Date(`${iso}T00:00:00Z`));
const actionFor=(task,role)=> {
  if(task.status==='completed'&&isManager(role))return ['verify','Verify'];
  if(!isMine(task))return null;
  return task.status==='assigned'?['accept','Accept']:task.status==='accepted'?['start','Start']:task.status==='in_progress'?['complete','Complete']:null;
};
// Everything else this member may do with the task. The server enforces the same rules.
function optionsFor(task,role){
  const m=isManager(role), out=[];
  if(task.status==='blocked'&&m) out.push({label:'Unblock: back to work',value:'unblock'});
  if(!CLOSED.includes(task.status)&&m) out.push({label:'Assign to…',value:'assign'},{label:'Move to another day…',value:'move'});
  if(['assigned','accepted','in_progress'].includes(task.status)&&(m||isMine(task))) out.push({label:'Delay…',value:'delay'});
  if(['scheduled','assigned','blocked','delayed'].includes(task.status)&&m) out.push({label:'Cancel task…',value:'cancel'});
  return out;
}
const REASONS={
  block:['Weather not suitable','Equipment broken','Inputs not available','Field not accessible','Need help from manager'],
  delay:['Weather','Waiting for inputs','Equipment problem','Workers not available','Other work first'],
  cancel:['No longer needed','Done another way','Duplicate task','Crop changed'],
};
const REASON_TITLE={block:'What is the problem?',delay:'Why delay?',cancel:'Why cancel?'};
const REASON_LABEL={blocked:'Blocked',delayed:'Delayed',cancelled:'Cancelled'};

// Runs a change from a picker, then goes back to the task, which reloads.
async function act(ctx,fn){ if(detailActionBusy)return; detailActionBusy=true; try{ await fn(); ctx.router.pop(); }catch(e){ flash(e.message); }finally{ detailActionBusy=false; } }
function reasonPicker(ctx,id,action,replace){
  const params={title:REASON_TITLE[action],options:REASONS[action].map((r)=>({label:r,value:r})),onPick:(o,c)=>act(c,()=>api.transition(id,action,{reason:o.value}))};
  if(replace) ctx.router.replace('ForumPicker',params); else ctx.router.push('ForumPicker',params);
}
async function runOption(ctx,task,value){
  const id=task.id;
  if(value==='unblock') return act(ctx,()=>api.transition(id,'unblock'));
  if(value==='delay'||value==='cancel') return reasonPicker(ctx,id,value,true);
  if(value==='assign'){
    let people; try{ people=(await api.members(farmOps.activeFarmId)).items.filter((m)=>m.role!=='viewer'); }catch(e){ return flash(e.message); }
    return ctx.router.replace('ForumPicker',{title:'Assign to',selected:task.assignments?.[0]?.userId,
      options:people.map((m)=>({label:`${m.display_name} · ${tr(m.role)} · ${tr('{n} open',{n:m.open_tasks})}`,value:m.user_id})),onPick:(o,c)=>act(c,()=>api.assign(id,o.value))});
  }
  if(value==='move'){
    const today=farmToday(farmOps.activeFarm?.timezone);
    const days=Array.from({length:14},(_,i)=>dateShift(today,i)).filter((d)=>d!==task.localDate);
    return ctx.router.replace('ForumPicker',{title:'Move to',options:days.map((d)=>({label:`${d===today?tr('Today'):weekday(d)} · ${niceDate(d)}`,value:d})),
      onPick:(o,c)=>act(c,()=>api.reschedule(id,o.value))});
  }
}
// What happened, not just the status afterwards: a reassignment or a move keeps the status.
const historyLabel=(e)=>e.event_type==='assigned'?tr('Reassigned'):e.event_type==='rescheduled'?tr('Moved to {date}',{date:niceDate(e.data?.to)})
  :e.event_type==='created'?tr('Created'):STATUS[e.to_status]||tr(String(e.to_status||e.event_type));
function actionRows(root,t){
  const role=farmOps.activeFarm?.role, a=actionFor(t,role);
  if(a){const r=el('item ops-action',tr(`${a[1]} task`));r.dataset.action=a[0];root.append(r);}
  if(t.status==='in_progress'&&isMine(t)){const r=el('item ops-action',tr('Report problem…'));r.dataset.report='1';root.append(r);}
  if(optionsFor(t,role).length){const r=el('item ops-action',tr('Options…'));r.dataset.options='1';root.append(r);}
}
export const FarmTaskDetail = asyncScreen({ name:'FarmTaskDetail',title:'Task Detail',
  load:(ctx)=>api.detail(ctx.params.id),
  renderData(data){const t=data.item,root=el('ops-page');root.append(el(`ops-priority priority-${t.priority}`,`${tr(t.priority.toUpperCase())} · ${tr(t.type.toUpperCase())}`),el('ops-detail-title',t.title),el('ops-task-meta',`${t.fieldName||tr('No field')} · ${niceDate(t.localDate)}`),el('ops-task-meta',`${STATUS[t.status]||t.status}${t.assignments?.[0]?` · ${t.assignments[0].name}`:''}`));
    const why={blocked:t.blocked_reason,delayed:t.delayed_reason,cancelled:t.cancelled_reason}[t.status];if(why)root.append(el('ops-reason',`${tr(REASON_LABEL[t.status])}: ${tr(why)}`));
    if(t.description)root.append(el('ops-description',t.description));const spray=data.sprayAssessment;if(spray)spraySection(root,spray);if(data.checklist.length){root.append(el('ops-section-title',`${tr('CHECKLIST')} · ${data.checklist.filter(x=>x.completed_at).length}/${data.checklist.length}`));for(const c of data.checklist){const r=el('item ops-checklist');r.dataset.item=c.id;r.dataset.done=c.completed_at?'1':'';r.textContent=`${c.completed_at?'✓':'□'} ${c.label}`;root.append(r);}}
    actionRows(root,t);root.append(el('ops-section-title',tr('HISTORY')));data.events.slice(-4).reverse().forEach(e=>root.append(el('ops-history',`${farmTime(e.created_at,farmOps.activeFarm?.timezone)} · ${historyLabel(e)}`)));return root;},
  async onEnter(node,ctx,_i,data){if(detailActionBusy||!node)return;const id=ctx.params.id;
    if(node.dataset.options)return ctx.router.push('ForumPicker',{title:'Task options',options:optionsFor(data.item,farmOps.activeFarm?.role),onPick:(o,c)=>runOption(c,data.item,o.value)});
    if(node.dataset.report)return reasonPicker(ctx,id,'block',false);
    const run=node.dataset.item?()=>api.toggleChecklist(id,node.dataset.item,node.dataset.done!=='1'):node.dataset.action?()=>api.transition(id,node.dataset.action,node.dataset.action==='complete'?{resultCode:'done',result:{source:'keypad'},note:'Completed from Today’s Farm'}:{}):null;
    if(!run)return;detailActionBusy=true;try{await run();ctx.router.replace('FarmTaskDetail',{id});}catch(e){flash(e.message);}finally{detailActionBusy=false;}},
});

// Two steps on one screen: the kind of work, then the field (when the farm has fields).
const PRESETS=[['Field inspection','inspection','normal'],['Irrigation check','irrigation','high'],['Pump maintenance','machinery','high'],['Farm record','record','normal']];
let creatingTask=false;
async function createFromPreset(ctx,i,fieldId){
  if(creatingTask)return; creatingTask=true; const p=PRESETS[i];
  try{const out=await api.createTask(farmOps.activeFarmId,{requestId:requestId(),title:p[0],type:p[1],priority:p[2],localDate:farmOps.activeDate,isAllDay:true,fieldId,assignees:identity.profile?.id?[{userId:identity.profile.id}]:[]});ctx.router.replace('FarmTaskDetail',{id:out.id});}
  catch(e){flash(e.message);}finally{creatingTask=false;}
}
export const FarmTaskCreate = { name:'FarmTaskCreate',title:(ctx)=>ctx.params?.preset!=null?'Which field?':'Quick Add',numericSelect:true,softRight:{label:'Back',handler:(ctx)=>ctx.router.pop()},
  render(ctx){const p=ctx.params||{},root=el('list');
    if(p.preset==null){PRESETS.forEach((x,i)=>{const r=el('item');r.textContent=`${i+1}  ${tr(x[0])}`;root.append(r);});root.append(message('Creates for the selected farm date, assigned to you.'));return root;}
    [...p.fields.map((f)=>f.name),tr('No field')].forEach((n,i)=>{const r=el('item');r.textContent=`${i+1}  ${n}`;root.append(r);});
    root.append(el('ops-empty',`${tr(PRESETS[p.preset][0])} · ${niceDate(farmOps.activeDate)}`));return root;},
  async onEnter(_node,ctx,i){const p=ctx.params||{};
    if(p.preset==null){if(!PRESETS[i])return;let fields=[];try{fields=(await api.fields(farmOps.activeFarmId)).items;}catch{/* create without a field */}
      return fields.length?ctx.router.replace('FarmTaskCreate',{preset:i,fields}):createFromPreset(ctx,i,null);}
    if(i>p.fields.length)return;return createFromPreset(ctx,p.preset,p.fields[i]?.id||null);},
};

// ---- Records, team and fields: lists that open a detail ----
const words=(k)=>String(k).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,(c)=>c.toUpperCase());
// A record's data as "Label: value" lines; nested objects (a task result) become "Result · Label: value".
function dataLines(data,prefix=''){
  const out=[];
  for(const [k,v] of Object.entries(data||{})){
    if(k==='demo'||v==null||v==='')continue;
    if(typeof v==='object'&&!Array.isArray(v)) out.push(...dataLines(v,`${prefix}${tr(words(k))} · `));
    else out.push(`${prefix}${tr(words(k))}: ${Array.isArray(v)?v.join(', '):typeof v==='string'?tr(v.replace(/_/g,' ')):v}`);
  }
  return out;
}
// A task in a member's or a field's list: when, and where or who.
const datedRow=(t,meta)=>{const r=el(`item ops-task-row priority-${t.priority||'normal'}`);r.dataset.id=t.id;const b=el('ops-task-body');
  b.append(el('ops-task-title',t.title),el('ops-task-meta',`${niceDate(t.localDate)} · ${meta(t)} · ${(STATUS[t.status]||t.status).split(' ').slice(1).join(' ')}`));r.append(el('ops-task-status',(STATUS[t.status]||'□').split(' ')[0]),b);return r;};
const openTask=(node,ctx)=>{if(node?.dataset.id)ctx.router.push('FarmTaskDetail',{id:node.dataset.id});};

export const FarmRecords = asyncScreen({name:'FarmRecords',title:'Farm Records',load:()=>api.records(farmOps.activeFarmId),
  renderData(data){const root=el('list');data.items.forEach((r,i)=>{const x=el('item ops-record-row');x.dataset.i=i;x.append(el('',r.task_title||tr(words(r.record_type))),el('ops-task-meta',`${niceDate(String(r.local_date).slice(0,10))} · ${r.actor_name||tr('System')}`));root.append(x);});return data.items.length?root:message('No farm records yet. Completing work creates records.');},
  onEnter(node,ctx,_i,data){const r=data?.items[Number(node?.dataset.i)];if(r)ctx.router.push('FarmRecordDetail',{record:r});}});

export const FarmRecordDetail = { name:'FarmRecordDetail',title:'Record',softRight:{label:'Back',handler:(ctx)=>ctx.router.pop()},
  render(ctx){const r=ctx.params.record,root=el('ops-page');
    root.append(el('ops-priority',tr(words(r.record_type)).toUpperCase()),el('ops-detail-title',r.task_title||tr(words(r.record_type))),
      el('ops-task-meta',`${niceDate(String(r.local_date).slice(0,10))} · ${r.actor_name||tr('System')}`),el('ops-task-meta',r.field_name||tr('No field')));
    const lines=dataLines(r.data);root.append(el('ops-section-title',tr('DETAILS')));
    if(lines.length)lines.forEach((l)=>root.append(el('ops-description',l)));else root.append(el('ops-description',tr('No details recorded.')));
    if(r.task_id){const x=el('item ops-action',tr('Open the task'));x.dataset.id=r.task_id;root.append(x);}
    return root;},
  onEnter:openTask,
};

export const FarmTeam = asyncScreen({name:'FarmTeam',title:'Team',load:()=>api.members(farmOps.activeFarmId),
  renderData(data){const root=el('list');data.items.forEach((m,i)=>{const x=el('item ops-team-row');x.dataset.i=i;x.append(el('',m.display_name),el('ops-task-meta',`${tr(m.role)} · ${tr('{n} tasks',{n:m.open_tasks})} · ${m.workload_minutes} min`));root.append(x);});return root;},
  onEnter(node,ctx,_i,data){const m=data?.items[Number(node?.dataset.i)];if(m)ctx.router.push('FarmMemberDetail',{member:m});}});

export const FarmMemberDetail = asyncScreen({name:'FarmMemberDetail',title:(ctx)=>ctx.params?.member?.display_name||tr('Member'),
  load:(ctx)=>api.tasks(farmOps.activeFarmId,`assignee=${ctx.params.member.user_id}&open=true`),
  renderData(data,ctx){const m=ctx.params.member,root=el('ops-page');
    root.append(el('ops-detail-title',m.display_name),el('ops-task-meta',`${tr(m.role)}${m.village?` · ${m.village}`:''}`),el('ops-progress',tr('{n} open tasks · {min} min planned',{n:data.items.length,min:m.workload_minutes})));
    root.append(el('ops-section-title',tr('OPEN TASKS')));data.items.forEach((t)=>root.append(datedRow(t,(x)=>x.fieldName||tr('No field'))));
    if(!data.items.length)root.append(message('Nothing open for this member.'));return root;},
  onEnter:openTask});

export const FarmFields = asyncScreen({name:'FarmFields',title:'Fields & Crops',load:()=>api.fields(farmOps.activeFarmId),
  renderData(data){const root=el('list');data.items.forEach((f,i)=>{const x=el('item ops-field-row');x.dataset.i=i;x.append(el('',f.name),el('ops-task-meta',`${f.area_value||'?'} ${f.area_unit||''} · ${f.cycles.map(c=>`${c.cropCode} ${c.stage||''}`).join(', ')||tr('No active crop')}`));root.append(x);});return data.items.length?root:message('No fields yet.');},
  onEnter(node,ctx,_i,data){const f=data?.items[Number(node?.dataset.i)];if(f)ctx.router.push('FarmFieldDetail',{field:f});}});

const shortDate=(v)=>v?niceDate(String(v).slice(0,10)):'?';
export const FarmFieldDetail = asyncScreen({name:'FarmFieldDetail',title:(ctx)=>ctx.params?.field?.name||tr('Field'),
  load:(ctx)=>api.tasks(farmOps.activeFarmId,`field=${ctx.params.field.id}&open=true`),
  renderData(data,ctx){const f=ctx.params.field,root=el('ops-page');
    root.append(el('ops-detail-title',f.name),el('ops-task-meta',`${f.area_value?`${Number(f.area_value)} ${f.area_unit||''}`:tr('Area not set')}${f.irrigation_type?` · ${tr('{type} irrigation',{type:tr(f.irrigation_type)})}`:''}`));
    root.append(el('ops-section-title',tr('CROPS')));
    if(!f.cycles.length)root.append(el('ops-description',tr('No active crop.')));
    f.cycles.forEach((c)=>root.append(el('ops-description',`${tr(words(c.cropCode))}${c.variety?` ${c.variety}`:''} · ${tr(c.stage||c.status)}`),el('ops-task-meta',tr('Planted {planted} · harvest {harvest}',{planted:shortDate(c.plantingDate),harvest:shortDate(c.targetHarvestDate)}))));
    root.append(el('ops-section-title',tr('OPEN TASKS')));data.items.forEach((t)=>root.append(datedRow(t,(x)=>x.assignments?.[0]?.name||tr('Unassigned'))));
    if(!data.items.length)root.append(message('Nothing open on this field.'));return root;},
  onEnter:openTask});

export const farmOpsScreens={FarmGate,TodayDashboard,FarmUpcoming,MyFarmTasks,FarmCalendar,FarmTaskDetail,FarmTaskCreate,FarmRecords,FarmRecordDetail,FarmTeam,FarmMemberDetail,FarmFields,FarmFieldDetail};
