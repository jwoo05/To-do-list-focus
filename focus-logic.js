
// ════════════════════════════════════════════════════════════
//  DATA
// ════════════════════════════════════════════════════════════
const KEY = 'jay_hub_v3';
const AUTH_KEY = KEY + '_auth';
const LEGACY_KEY = KEY + '_legacy_imported';
const POMO_RUNTIME_KEY = KEY + '_pomo_runtime';
const DEF = {
  tasks:[], sessions:[], events:[], icalImports:[],
  nlpCorrections:{}, eoprLog:[], deleted:[], focusReports:[],
  dailySections:['Study'],
  lastModified: 0,
  settings:{
    theme:'dark', name:'Jay', activeStart:null, focusGoal:'', alarmSound:'chime',
    pomo:{ presetMode:'classic', focus:25, shortBreak:5, longBreak:15, cycles:4 }
  }
};

let activeUser = loadActiveUser();
let S = loadState();
let calViewDate = new Date();
let calSelectedDate = todayStr();
let calViewMode = 'both'; // 'tasks' | 'both' | 'events'
let bankFilter = 'all';
let nlpParsed = null;
let currentPomoTask = null;
let pomoState = { running:false, phase:'focus', elapsed:0, cycles:0, targetCycles:4, sessionStart:null, plannedFocus:0, plannedBreak:0, extendedElapsed:0, breakElapsed:0, sessionId:null };
let pomoTimer = null;
let pendingFocusReport = null;
let sessionTaskSnapshot = {};
let sessionDistractionLog = []; // {ts, phase, elapsed} per distraction event
let cloudReady = false;
let cloudSaveTimer = null;
let suppressCloudSave = false;
let editSelectedPri = 'medium';
let editSelectedDays = [];
let editModalSubtasks = [];
let editScheduledDates = [];
let schedulePickerDate = new Date();
let scheduleDragActive = false;
let scheduleDragMode = 'add';
let currentPage = 'dashboard';
let bankVisibleCount = 10;
let bankSort = 'due';
let dailySort = 'custom';
let calHoverTimer = null;
let draggedTaskId = null;
let draggedTaskDate = '';
let draggedTaskSection = '';
let nlpEditDraft = null;
const openTaskDetails = new Set();
const collapsedDailySections = new Set(['__due__']);
let calViewResizeObserver = null;

// ════════════════════════════════════════════════════════════
//  PERSISTENCE
// ════════════════════════════════════════════════════════════
function safeUserKey(value){
  return String(value||'guest').trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'_').slice(0,80) || 'guest';
}
function loadActiveUser(){
  try{
    const raw=JSON.parse(localStorage.getItem(AUTH_KEY)||'null');
    if(raw && raw.uid) return raw;
  }catch(e){}
  return {uid:'local', email:'', name:'Local user', mode:'local', signedIn:false};
}
function storageKeyForUser(user=activeUser){
  return user && user.uid && user.uid !== 'local' ? `${KEY}:user:${safeUserKey(user.uid)}` : KEY;
}
function currentStorageKey(){
  return storageKeyForUser(activeUser);
}
function loadState(){
  try{
    const raw = localStorage.getItem(currentStorageKey());
    if(raw){
      const normalized = normalizeState(Object.assign({},DEF, JSON.parse(raw)));
      localStorage.setItem(currentStorageKey(), JSON.stringify(normalized));
      return normalized;
    }
  }catch(e){}
  migrateLegacyStateToUser();
  // Migrate v1
  try{
    const v1 = JSON.parse(localStorage.getItem('jay_hub_v1'));
    if(v1){
      const normalized = normalizeState(migrateV1(v1));
      localStorage.setItem(currentStorageKey(), JSON.stringify(normalized));
      return normalized;
    }
  }catch(e){}
  return normalizeState(JSON.parse(JSON.stringify(DEF)));
}
function migrateLegacyStateToUser(){
  if(!activeUser?.uid || activeUser.uid==='local') return false;
  const target=currentStorageKey();
  if(localStorage.getItem(target)) return false;
  if(localStorage.getItem(`${LEGACY_KEY}:${safeUserKey(activeUser.uid)}`)) return false;
  const legacy=localStorage.getItem(KEY);
  if(!legacy) return false;
  try{
    localStorage.setItem(target, JSON.stringify(normalizeState(Object.assign({},DEF,JSON.parse(legacy)))));
    localStorage.setItem(`${LEGACY_KEY}:${safeUserKey(activeUser.uid)}`,'1');
    return true;
  }catch(e){}
  return false;
}
function normalizeState(state){
  state.dailySections = (Array.isArray(state.dailySections) && state.dailySections.length ? state.dailySections : ['Study']).filter(s=>s && s !== 'Admin');
  if(!state.dailySections.length) state.dailySections=['Study'];
  state.tasks = (state.tasks||[]).map(t=>Object.assign({
    type:'task', priority:'medium', due:'', scheduledDates:[], scheduledDays:[],
    dailySection:'Study', calendarSignal:'auto', subtasks:[], progress:0, customOrder:0,
    completedDates:{}, dueCompletedDates:{}, habitStart:'', habitEnd:'', archived:false, completed:false, completedDate:'', focusPoints:0
  }, t));
  state.tasks.forEach((t,i)=>{
    if(t.dailySection==='Admin') t.dailySection='Study';
    if(!Number.isFinite(Number(t.customOrder)) || Number(t.customOrder)<=0) t.customOrder = t.createdAt || ((i+1)*1000);
  });
  archiveCompletedOneOffTasks(state);
  state.events = (state.events||[]).map(e=>Object.assign({
    id:uid(), title:'', date:'', time:'', subject:'', type:'event', notes:''
  }, e));
  const remainingEvents=[];
  state.events.forEach(e=>{
    if(['test','event','class','deadline','personal'].includes(e.type||'event')){
      e.color=e.color||eventColorForType(e.type||'event');
      remainingEvents.push(e);
      return;
    }
    const alreadyTask=state.tasks.some(t=>
      (e.icsUid && t.icsUid===e.icsUid) ||
      (normalizeTitle(t.title)===normalizeTitle(e.title) && (t.due===e.date || (t.scheduledDates||[]).includes(e.date)))
    );
    if(!alreadyTask){
      state.tasks.push({
        id:uid(), icsUid:e.icsUid||'', createdAt:e.createdAt||Date.now(),
        archived:false, completed:false, completedAt:null, completedDates:{},
        title:e.title, subject:e.subject||'', type:'assignment', priority:'medium',
        due:e.date||'', scheduledDates:[], scheduledDays:[],
        scheduledTime:e.time||'', isHabit:false, notes:e.notes||'',
        focusPoints:0, subtasks:[], progress:0, dueCompletedDates:{}, customOrder:Date.now(),
        dailySection:'Study', calendarSignal:'due'
      });
    }
  });
  state.events=remainingEvents;
  state.settings = Object.assign({}, DEF.settings, state.settings||{});
  state.settings.pomo = Object.assign({}, DEF.settings.pomo, state.settings.pomo||{});
  state.nlpCorrections = state.nlpCorrections || {};
  state.deleted = state.deleted || [];
  state.focusReports = state.focusReports || [];
  state.events = (state.events||[]).map(e=>Object.assign({type:'event', color:eventColorForType(e.type||'event')}, e));
  return state;
}
function save(){
  S.lastModified = Date.now();
  localStorage.setItem(currentStorageKey(), JSON.stringify(S));
  scheduleCloudSave();
}
function scheduleCloudSave(){
  if(suppressCloudSave || !cloudReady || activeUser?.mode!=='firebase' || !window.JayFirebaseAuth?.enabled) return;
  if(!activeUser?.uid || activeUser.uid==='local') return;
  clearTimeout(cloudSaveTimer);
  const snapshotUid=activeUser.uid;
  cloudSaveTimer=setTimeout(async ()=>{
    if(!cloudReady || activeUser?.mode!=='firebase' || activeUser?.uid!==snapshotUid){
      return;
    }
    try{
      await window.JayFirebaseAuth.saveState(snapshotUid, S);
      setAuthStatus('Saved to cloud.');
    }catch(err){
      setAuthStatus('Cloud save failed. Check Realtime Database rules.');
    }
  },700);
}

function isArchivedForTodo(t){
  return !!(t && (t.archived || (!t.isHabit && t.completed)));
}

function archiveCompletedOneOffTasks(state=S){
  let changed=false;
  (state.tasks||[]).forEach(t=>{
    if(!t.isHabit && t.completed && !t.archived){
      t.archived=true;
      t.archivedAt=t.archivedAt || t.completedAt || Date.now();
      changed=true;
    }
  });
  return changed;
}

function exportBackup(){
  save();
  const stamp=todayStr();
  const blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`jay-hub-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Backup exported.');
}
function importBackupFile(input){
  const file=input.files && input.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const restored=normalizeState(Object.assign({},DEF, JSON.parse(String(reader.result||'{}'))));
      S=restored;
      save();
      render();
      showToast('Backup restored.');
    }catch(e){
      showToast('That backup file could not be read.');
    }finally{
      input.value='';
    }
  };
  reader.onerror=()=>{ showToast('That backup file could not be read.'); input.value=''; };
  reader.readAsText(file);
}
function migrateV1(v1){
  const s = JSON.parse(JSON.stringify(DEF));
  s.settings.name = v1.settings?.name || 'Jay';
  (v1.assignments||[]).forEach(a=>{
    const t = {
      id:'m'+a.id, title:a.title||'', subject:a.subject||'',
      type:a.type||'assignment',
      priority: a.pri==='high'?'high':a.pri==='urgent'?'MUST':'medium',
      due:a.due||'', scheduledDates:[], scheduledDays:a.days||[],
      scheduledTime:'', isHabit:!!(a.days&&a.days.length),
      completed:false, completedAt:null, archived:false,
      progress:0, subtasks:[], notes:a.notes||'', focusPoints:0, createdAt:a.id
    };
    s.tasks.push(t);
  });
  return s;
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function todayStr(){
  const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function pad(n){ return String(n).padStart(2,'0'); }
function fmtDate(s){
  if(!s) return ''; const d=new Date(s+'T00:00:00');
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function dateDaysBetween(a,b){
  if(!a || !b) return null;
  const da=new Date(a+'T00:00:00');
  const db=new Date(b+'T00:00:00');
  if(Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((da-db)/86400000);
}
function priorityRank(p){
  return ({MUST:0,high:1,medium:2,low:3}[p] ?? 4);
}
function taskDueKey(t){
  const scheduled=(t.scheduledDates||[]).filter(Boolean).sort()[0];
  return t.due || scheduled || '9999-12-31';
}
function taskCustomOrder(t){
  const n=Number(t?.customOrder);
  return Number.isFinite(n) && n>0 ? n : (Number(t?.createdAt)||0);
}
function sectionLabel(sec){
  return sec === 'Study' ? 'Task' : sec;
}
function taskNeedsStudyAssignment(t){
  return !!(t && !t.isHabit && !isArchivedForTodo(t) && !(t.scheduledDates||[]).filter(Boolean).length);
}
function sortTasks(tasks, mode='due'){
  const arr=[...tasks];
  if(mode==='priority'){
    arr.sort((a,b)=>priorityRank(a.priority)-priorityRank(b.priority) || taskDueKey(a).localeCompare(taskDueKey(b)) || String(a.title||'').localeCompare(String(b.title||'')));
  }else if(mode==='created'){
    arr.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0) || String(a.title||'').localeCompare(String(b.title||'')));
  }else if(mode==='title'){
    arr.sort((a,b)=>String(a.title||'').localeCompare(String(b.title||'')) || taskDueKey(a).localeCompare(taskDueKey(b)));
  }else if(mode==='custom'){
    arr.sort((a,b)=>taskCustomOrder(a)-taskCustomOrder(b) || taskDueKey(a).localeCompare(taskDueKey(b)) || String(a.title||'').localeCompare(String(b.title||'')));
  }else{
    arr.sort((a,b)=>taskDueKey(a).localeCompare(taskDueKey(b)) || priorityRank(a.priority)-priorityRank(b.priority) || String(a.title||'').localeCompare(String(b.title||'')));
  }
  return arr;
}
function dueChipHTML(t, compact=false){
  if(!t || !t.due) return '';
  const days=dateDaysBetween(t.due, todayStr());
  const labelPrefix=t.type==='exam'?'Test':'Due';
  let cls='chip chip-due';
  let label=`${labelPrefix} ${fmtDate(t.due)}`;
  if(days!==null && days>=0 && days<=7){
    cls += days<=2 ? ' due-soon-red' : days<=4 ? ' due-soon-yellow' : ' due-soon-green';
    const left = days===0 ? 'today' : `${days} day${days===1?'':'s'} left`;
    label=`${labelPrefix} ${fmtDate(t.due)}${compact?'':' - '+left}`;
  }else if(days!==null && days<0){
    cls += ' due-soon-red';
    label=`${labelPrefix} ${fmtDate(t.due)}${compact?'':' - overdue'}`;
  }
  return `<span class="${cls}">${esc(label)}</span>`;
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════
const DAY_NAMES=['Su','Mo','Tu','We','Th','Fr','Sa'];
function isHabitDueToday(t, dateStr){
  if(!t.isHabit) return false;
  if(t.habitStart && dateStr < t.habitStart) return false;
  if(t.habitEnd && dateStr > t.habitEnd) return false;
  if(Array.isArray(t.skippedDates) && t.skippedDates.includes(dateStr)) return false;
  const d = new Date(dateStr+'T00:00:00');
  const dow = d.getDay();
  return t.scheduledDays.includes(dow);
}
function isScheduledToday(t, dateStr){
  if(t.scheduledDates && t.scheduledDates.includes(dateStr)) return true;
  if(t.due === dateStr && !isDueSignalDone(t,dateStr)) return true;
  return false;
}
function isTodayTask(t){
  const today = todayStr();
  if(isArchivedForTodo(t)) return false;
  if(isHabitDueToday(t, today)) return true;
  if(isScheduledToday(t, today)) return true;
  return false;
}
function getTodayTasks(){ return S.tasks.filter(isTodayTask); }
function getTasksForDate(dateStr){ return S.tasks.filter(t=>!isArchivedForTodo(t) && (isHabitDueToday(t,dateStr)||isScheduledToday(t,dateStr))); }
function isTaskDone(t, dateStr=todayStr()){
  if(t.isHabit) return !!(t.completedDates && t.completedDates[dateStr]);
  return !!t.completed;
}
function isDueSignalDone(t,dateStr){
  return !!(t?.dueCompletedDates && t.dueCompletedDates[dateStr]);
}
function uniqueDates(dates){
  return [...new Set((dates||[]).filter(Boolean))].sort();
}
function removeCalendarDateFromTask(t,dateStr,opts={}){
  if(!t || !dateStr) return;
  if(Array.isArray(t.scheduledDates)){
    t.scheduledDates=t.scheduledDates.filter(ds=>ds!==dateStr);
  }
  if(opts.moveDue && t.due===dateStr){
    t.due='';
  }
}
function moveTaskWorkDate(t,targetDate,sourceDate){
  if(!t || !targetDate) return;
  if(!Array.isArray(t.scheduledDates)) t.scheduledDates=[];
  if(sourceDate && sourceDate!==targetDate){
    removeCalendarDateFromTask(t,sourceDate,{moveDue:true});
    if(t.completedDates) delete t.completedDates[sourceDate];
    if(t.dueCompletedDates) delete t.dueCompletedDates[sourceDate];
  }
  t.scheduledDates=uniqueDates([...t.scheduledDates,targetDate]);
  if(t.completedDates && targetDate) t.completedDates[targetDate]=false;
}
function moveTaskDueDate(t,targetDate,sourceDate){
  if(!t || !targetDate) return;
  if(!t.dueCompletedDates) t.dueCompletedDates={};
  if(sourceDate && sourceDate!==targetDate && t.dueCompletedDates[sourceDate]!==undefined){
    delete t.dueCompletedDates[sourceDate];
  }
  t.due=targetDate;
  t.calendarSignal='due';
}
function clearTaskFromCalendar(t){
  if(!t) return;
  t.scheduledDates=[];
  if(t.completedDates) t.completedDates={};
}
function dateFromTs(ts){
  if(!ts) return '';
  const d=new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : localISO(d);
}
function taskArchiveDate(t){
  return t?.completedDate || t?.archivedDate || dateFromTs(t?.completedAt) || dateFromTs(t?.archivedAt);
}
function isArchivedForDate(t,dateStr){
  if(!isArchivedForTodo(t)) return false;
  if(t?.completedDates && t.completedDates[dateStr]) return true;
  return taskArchiveDate(t)===dateStr;
}
function isComposingInput(event){
  return !!(event && (event.isComposing || event.keyCode===229 || event.which===229));
}
function shouldCommitTextInput(event){
  if(!event) return true;
  if(event.key && event.key!=='Enter') return false;
  if(isComposingInput(event)) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  return true;
}

// ════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════
function render(){
  if(archiveCompletedOneOffTasks(S)) save();
  updateBranding();
  mountInteractiveSurface();
  renderBank();
  renderCenter();
  renderCalendar();
  renderReview();
  renderDashboard();
  renderAnalyticsCharts();
  renderFocusToday();
  renderTodoCarryPrompt();
  renderNavBadges();
  updateWorkbenchCollapseUI();
  renderHudTaskPicker();
  renderFocusGoal();
  renderFocusReports();
  updatePersonalTimerUI();
  setupWorkbenchCollapseReopen();
  setupWorkbenchDragScroll();
  updateEOPR();
}

function mountInteractiveSurface(){
  const bank=document.getElementById('bankPanel');
  const bankSlot=document.getElementById('workbenchBank');
  if(bank && bankSlot && bank.parentElement!==bankSlot) bankSlot.appendChild(bank);

  const todaySlot=document.getElementById('workbenchToday');
  const must=document.getElementById('secMust');
  const gated=document.getElementById('gatedSections');
  const archive=document.getElementById('secArchive');
  if(todaySlot){
    if(must && must.parentElement!==todaySlot) todaySlot.appendChild(must);
    if(gated && gated.parentElement!==todaySlot) todaySlot.appendChild(gated);
    if(archive && archive.parentElement!==todaySlot) todaySlot.appendChild(archive);
  }

  const cal=document.getElementById('calPanel');
  const calTasks=document.getElementById('calDayTasks');
  const importSec=document.getElementById('icalImportSec');
  const calSlot=currentPage==='calendar' ? document.getElementById('calendarPageHost') : document.getElementById('workbenchCalendar');
  const importSlot=document.getElementById('icalModalBody');
  if(calSlot){
    if(cal && cal.parentElement!==calSlot) calSlot.appendChild(cal);
    if(calTasks && calTasks.parentElement!==calSlot) calSlot.appendChild(calTasks);
  }
  if(importSlot && importSec && importSec.parentElement!==importSlot){
    importSec.style.display='block';
    importSlot.appendChild(importSec);
  }
}

function renderReview(){
  const today=new Date(todayStr()+'T00:00:00');
  const weekStart=new Date(today); weekStart.setDate(today.getDate()-today.getDay());
  const monthStart=new Date(today.getFullYear(),today.getMonth(),1);
  const cards=[
    ['Today', completionForRange(today,today)],
    ['This Week', completionForRange(weekStart,today)],
    ['This Month', completionForRange(monthStart,today)]
  ];
  const wrap=document.getElementById('reviewStrip');
  if(!wrap) return;
  wrap.innerHTML=cards.map(([label,stats])=>`
    <div class="review-card">
      <div class="review-label">${label}</div>
      <div class="review-value">${stats.pct}%</div>
      <div class="review-bar"><span style="width:${stats.pct}%"></span></div>
    </div>`).join('');
}

function completionForRange(start,end){
  const days=[];
  for(const d=new Date(start); d<=end; d.setDate(d.getDate()+1)) days.push(localISO(d));
  let total=0, done=0;
  S.tasks.forEach(t=>{
    days.forEach(ds=>{
      const applies=taskAppliesOnDate(t,ds);
      if(!applies || t.archived && !t.completedAt) return;
      total++;
      if(taskDoneOnDate(t,ds)) done++;
    });
  });
  return {total,done,pct:total?Math.round(done/total*100):0};
}

function taskAppliesOnDate(t,ds){
  return (t.scheduledDates||[]).includes(ds) || (t.due===ds && !isDueSignalDone(t,ds)) || isHabitDueToday(t,ds);
}

function taskDoneOnDate(t,ds){
  if(t.isHabit) return !!t.completedDates?.[ds];
  if(!t.completed) return false;
  if(!t.completedAt) return true;
  return localISO(new Date(t.completedAt))===ds;
}

function renderDashboard(){
  const today=todayStr();
  const todayStats=completionForRange(new Date(today+'T00:00:00'), new Date(today+'T00:00:00'));
  const ring=document.getElementById('dashSuccessRing');
  const pct=document.getElementById('dashSuccessPct');
  const label=document.getElementById('dashSuccessLabel');
  if(ring){
    const circ=389.56;
    ring.style.strokeDashoffset=circ*(1-todayStats.pct/100);
    pct.textContent=todayStats.pct+'%';
    label.textContent=`${todayStats.done} of ${todayStats.total} done`;
  }
  renderDashboardHabits();
  renderDashboardFocus(todayStats);
  renderDashboardAdvice();
  renderMissedCarryList();
}

function renderDashboardHabits(){
  const today=todayStr();
  const habits=S.tasks.filter(t=>!t.archived && isHabitDueToday(t,today));
  const wrap=document.getElementById('dashHabits');
  if(!wrap) return;
  if(!habits.length){
    wrap.innerHTML='<div class="empty" style="padding:18px 0;text-align:left">No habits scheduled for today.</div>';
    return;
  }
  wrap.innerHTML='<div class="dash-list">'+habits.map(t=>`
    <div class="dash-row">
      <div class="task-cb" onclick="toggleTask('${t.id}')">${isTaskDone(t,today)?'✓':''}</div>
      <div class="dash-row-main">
        <div class="dash-row-title">${esc(t.title)}</div>
        <div class="dash-row-sub">${t.scheduledTime?esc(t.scheduledTime)+' · ':''}${(t.scheduledDays||[]).map(d=>DAY_NAMES[d]).join(', ')}</div>
      </div>
    </div>`).join('')+'</div>';
}

function renderDashboardFocus(todayStats){
  const today=todayStr();
  const habits=S.tasks.filter(t=>!t.archived && isHabitDueToday(t,today));
  const kept=habits.filter(t=>isTaskDone(t,today)).length;
  const habitPct=habits.length?Math.round(kept/habits.length*100):0;
  const sessions=S.sessions.filter(s=>s.date===today&&s.type==='focus'&&s.completed);
  const minutes=sessions.reduce((sum,s)=>sum+(s.dur||0),0);
  const wrap=document.getElementById('dashFocus');
  if(!wrap) return;
  wrap.innerHTML=`
    <div class="health-grid">
      <div class="health-cell">
        <strong>${calcEOPR()}%</strong>
        <span>Jay Score</span>
        <div class="review-bar"><span style="width:${calcEOPR()}%"></span></div>
      </div>
      <div class="health-cell">
        <strong>${habitPct}%</strong>
        <span>Habit keep</span>
        <div class="review-bar"><span style="width:${habitPct}%;background:var(--green)"></span></div>
      </div>
      <div class="health-cell">
        <strong>${minutes}</strong>
        <span>Focus minutes</span>
      </div>
    </div>`;
}

function renderDashboardAdvice(){
  const wrap=document.getElementById('dashAdvice');
  if(!wrap) return;
  const today=todayStr();
  const days=lastNDates(7);
  const missed=missedTasks();
  const overdueSubjects={};
  missed.forEach(t=>{
    const key=(t.subject||t.dailySection||'General').trim()||'General';
    overdueSubjects[key]=(overdueSubjects[key]||0)+1;
  });
  const heavyDays=days.map(ds=>({ds,count:getTasksForDate(ds).length})).sort((a,b)=>b.count-a.count);
  const habits=S.tasks.filter(t=>!t.archived && t.isHabit);
  const weakHabits=habits.map(t=>{
    const due=days.filter(ds=>isHabitDueToday(t,ds));
    const done=due.filter(ds=>isTaskDone(t,ds)).length;
    return {t,due:due.length,done,rate:due.length?done/due.length:1};
  }).filter(x=>x.due>=2 && x.rate<.7).sort((a,b)=>a.rate-b.rate);
  const completion=days.map(ds=>completionForRange(new Date(ds+'T00:00:00'),new Date(ds+'T00:00:00')).pct);
  const lowDays=completion.filter(p=>p>0 && p<60).length;
  const zeroDays=completion.filter(p=>p===0).length;
  const focusMinutes=days.map(ds=>S.sessions.filter(s=>s.date===ds&&s.type==='focus'&&s.completed).reduce((sum,s)=>sum+(s.dur||0),0));
  const lowFocusDays=focusMinutes.filter(m=>m<25).length;
  const completedTasks=S.tasks.filter(t=>t.completedAt).map(t=>new Date(t.completedAt).getHours());
  const lateCompletions=completedTasks.filter(h=>h>=21).length;
  const dueSoon=S.tasks.filter(t=>!t.archived && !t.completed && t.due && t.due>=today).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,3);
  const advice=[];
  if(weakHabits.length){
    const h=weakHabits[0];
    advice.push({
      title:`Protect ${h.t.title}`,
      body:`You kept it ${Math.round(h.rate*100)}% this week. Put it in a small fixed time block before adding extra work.`
    });
  }
  if(missed.length){
    const top=Object.entries(overdueSubjects).sort((a,b)=>b[1]-a[1])[0];
    advice.push({
      title:`Reduce carry-over`,
      body:`${top[0]} has the most missed items. Schedule one recovery block before taking on new optional tasks.`
    });
  }
  if(heavyDays[0]?.count>=5){
    advice.push({
      title:`Lighten ${fmtDate(heavyDays[0].ds)}`,
      body:`That day has ${heavyDays[0].count} items. Move one low-priority task to keep the day believable.`
    });
  }
  if(lowFocusDays>=5 && dueSoon.length){
    advice.push({
      title:'Attach work to a timer',
      body:'Your recent focus blocks are light. Start assignments with one 25/5 session before deciding whether to continue.'
    });
  }
  if(lateCompletions>=3){
    advice.push({
      title:'Move one task earlier',
      body:'Several completions happened late. Put the most important task before dinner so nighttime is not carrying the whole system.'
    });
  }
  if(zeroDays>=4 && S.tasks.length>=3){
    advice.push({
      title:'Lower the daily entry cost',
      body:'A lot of recent days have no logged completion. Use a two-minute starter task to keep the streak alive.'
    });
  }
  if(lowDays>=2){
    advice.push({
      title:'Use a smaller daily list',
      body:'Multiple days finished under 60%. Pick 1 must-do, 2 normal tasks, then habits. That keeps the app calm and executable.'
    });
  }
  if(!advice.length && dueSoon.length){
    advice.push({
      title:'Start with the nearest due date',
      body:`${dueSoon[0].title} is the next visible deadline. Make the first step tiny and start a 25/5 timer.`
    });
  }
  if(!advice.length){
    advice.push({
      title:'Keep the system quiet',
      body:'No strong issue pattern yet. Keep logging completions, focus sessions, and missed work so the advice becomes more personal.'
    });
  }
  wrap.innerHTML='<div class="advice-kicker">Based on your last 7 days plus study and habit design heuristics.</div><div class="advice-list">'+advice.slice(0,3).map(a=>`
    <div class="advice-item">
      <strong>${esc(a.title)}</strong>
      <span>${esc(a.body)}</span>
    </div>`).join('')+'</div>';
}

function lastNDates(n){
  const days=[];
  const base=new Date(todayStr()+'T00:00:00');
  for(let i=n-1;i>=0;i--){
    const d=new Date(base);
    d.setDate(base.getDate()-i);
    days.push(localISO(d));
  }
  return days;
}

function renderAnalyticsCharts(){
  const days=lastNDates(7);
  const completion=days.map(ds=>completionForRange(new Date(ds+'T00:00:00'),new Date(ds+'T00:00:00')).pct);
  const habit=days.map(ds=>habitRateForDate(ds));
  const focus=days.map(ds=>S.sessions.filter(s=>s.date===ds&&s.type==='focus'&&s.completed).reduce((sum,s)=>sum+(s.dur||0),0));
  drawLineChart('completionLineChart',days,completion,'%');
  drawLineChart('habitLineChart',days,habit,'%',true);
  drawBarChart('focusBarChart',days,focus,'m');
}

function habitRateForDate(ds){
  const habits=S.tasks.filter(t=>!t.archived && isHabitDueToday(t,ds));
  if(!habits.length) return 0;
  return Math.round(habits.filter(t=>taskDoneOnDate(t,ds)).length/habits.length*100);
}

function showChartTooltip(e, label, value, suffix){
  const tip = document.getElementById('chartTooltip');
  if(!tip) return;
  tip.textContent = `${label}: ${value}${suffix}`;
  tip.style.display = 'block';
  tip.style.left = (e.clientX + 12) + 'px';
  tip.style.top  = (e.clientY - 28) + 'px';
}
function hideChartTooltip(){
  const tip = document.getElementById('chartTooltip');
  if(tip) tip.style.display = 'none';
}

function drawLineChart(id,days,values,suffix='',green=false){
  const svg=document.getElementById(id);
  if(!svg) return;
  const w=420,h=160,p=36;
  const max=Math.max(100,...values,1);
  const pts=values.map((v,i)=>{
    const x=p+(i*(w-p*2)/(values.length-1||1));
    const y=h-p-(v/max)*(h-p*2);
    return [x,y,v];
  });
  const path=pts.map((pt,i)=>(i?'L':'M')+pt[0].toFixed(1)+' '+pt[1].toFixed(1)).join(' ');
  svg.innerHTML=`
    <line class="axis" x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}"></line>
    <line class="axis" x1="${p}" y1="${p}" x2="${p}" y2="${h-p}"></line>
    <path class="line ${green?'green':''}" d="${path}"></path>
    ${pts.map((pt,i)=>`
      <circle class="dot" cx="${pt[0]}" cy="${pt[1]}" r="5"
        onmouseenter="showChartTooltip(event,'${esc(fmtDate(days[i]))}',${pt[2]},'${suffix}')"
        onmouseleave="hideChartTooltip()" style="cursor:pointer"></circle>
      <circle r="12" cx="${pt[0]}" cy="${pt[1]}" fill="transparent"
        onmouseenter="showChartTooltip(event,'${esc(fmtDate(days[i]))}',${pt[2]},'${suffix}')"
        onmouseleave="hideChartTooltip()"></circle>
      ${pt[2]>0?`<text x="${pt[0]-6}" y="${pt[1]-10}" font-size="12" font-weight="600" fill="var(--text2)">${pt[2]}${suffix}</text>`:''}
    `).join('')}
    ${days.map((d,i)=>`<text x="${pts[i][0]-14}" y="${h-6}" font-size="12">${fmtDate(d)}</text>`).join('')}
    <text x="${w-p-42}" y="${p-10}" font-size="14" font-weight="700">${Math.max(...values,0)}${suffix}</text>`;
}

function drawBarChart(id,days,values,suffix=''){
  const svg=document.getElementById(id);
  if(!svg) return;
  const w=420,h=160,p=36;
  const max=Math.max(...values,1);
  const gap=8;
  const bw=(w-p*2-gap*(values.length-1))/values.length;
  svg.innerHTML=`
    <line class="axis" x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}"></line>
    ${values.map((v,i)=>{
      const bh=(v/max)*(h-p*2);
      const x=p+i*(bw+gap), y=h-p-bh;
      return `
        <rect class="bar" x="${x}" y="${y}" width="${bw}" height="${bh||2}" rx="3"
          onmouseenter="showChartTooltip(event,'${esc(fmtDate(days[i]))}',${v},'${suffix}')"
          onmouseleave="hideChartTooltip()" style="cursor:pointer"></rect>
        <text x="${x+bw/2-12}" y="${h-5}" font-size="12">${fmtDate(days[i])}</text>
        ${v>0?`<text x="${x+bw/2-10}" y="${y-6}" font-size="13" font-weight="700" fill="var(--text)">${v}${suffix}</text>`:''}
      `;
    }).join('')}
    <text x="${w-p-42}" y="${p-10}" font-size="14" font-weight="700">${Math.max(...values,0)}${suffix}</text>`;
}

function renderFocusToday(){
  const wrap=document.getElementById('focusTodayList');
  if(!wrap) return;
  const today=todayStr();
  const tasks=getTodayTasks().filter(t=>!t.archived);
  const remaining=tasks.filter(t=>!isTaskDone(t,today)).length;
  document.getElementById('focusTodayCount').textContent=remaining+'/'+tasks.length;
  if(!tasks.length){
    wrap.innerHTML=`<div class="empty" style="padding:14px;text-align:left;font-size:12px">
      No tasks scheduled for today. Add tasks from the Todo page or use Quick Add on the Dashboard.
    </div>`;
    return;
  }
  wrap.innerHTML=tasks.map(t=>{
    const done=isTaskDone(t,today);
    const isActive=currentPomoTask?.id===t.id;
    return `<div class="task-item ${done?'completed':''} ${t.priority==='MUST'?'must-item':''} ${isActive?'pomo-active-task':''}">
      <div class="task-cb" onclick="toggleTask('${t.id}')">${done?'✓':''}</div>
      <div class="task-content">
        <div class="task-title">${esc(t.title)}${isActive?' <span class="active-task-badge">Focusing</span>':''}</div>
        <div class="task-sub">
          ${t.subject?`<span class="chip chip-due">${esc(t.subject)}</span>`:''}
          ${t.due?`<span class="task-time">Due ${fmtDate(t.due)}</span>`:''}
          ${t.priority==='MUST'?`<span class="chip chip-must">MUST</span>`:''}
        </div>
      </div>
      <div class="task-actions" style="opacity:1">
        ${!done?`<button class="task-action play ${isActive?'active':''}" onclick="startPomoTask('${t.id}')" title="${isActive?'Focusing':'Start focusing'}">▶</button>`:''}
        <button class="task-action" onclick="editTask('${t.id}')" title="Edit">✎</button>
      </div>
    </div>`;
  }).join('');
}

function missedTasks(){
  const today=todayStr();
  return S.tasks.filter(t=>{
    if(t.archived || t.completed || t.isHabit || t.carryDismissedDate===today) return false;
    if((t.scheduledDates||[]).includes(today)) return false;
    const missedDates=[...(t.scheduledDates||[]), t.due].filter(Boolean).filter(ds=>ds<today);
    return missedDates.length>0;
  }).sort((a,b)=>{
    const ad=[...(a.scheduledDates||[]),a.due].filter(Boolean).sort()[0]||'';
    const bd=[...(b.scheduledDates||[]),b.due].filter(Boolean).sort()[0]||'';
    return ad.localeCompare(bd);
  });
}

function renderMissedCarryList(){
  const missed=missedTasks();
  const wrap=document.getElementById('missedCarryList');
  if(!wrap) return;
  const panel=document.getElementById('missedPanel');
  if(panel) panel.style.display=missed.length?'block':'none';
  if(!missed.length){
    wrap.innerHTML='';
    return;
  }
  wrap.innerHTML='<div class="dash-list">'+missed.map(t=>`
    <div class="dash-row">
      <div class="dash-row-main">
        <div class="dash-row-title">${esc(t.title)}</div>
        <div class="dash-row-sub">Missed ${fmtDate(([...(t.scheduledDates||[]),t.due].filter(Boolean).sort()[0]))}</div>
        <div class="missed-actions">
          <button class="btn-sm btn-primary" onclick="carryTaskToday('${t.id}')">Carry to today</button>
          <button class="btn-sm btn-ghost" onclick="completeCarryTask('${t.id}')">Completed</button>
          <button class="btn-sm btn-ghost" onclick="dismissCarry('${t.id}')">Not today</button>
          <button class="btn-sm btn-ghost" onclick="deleteCarryTask('${t.id}')">Delete</button>
        </div>
      </div>
    </div>`).join('')+'</div>';
}

function renderTodoCarryPrompt(){
  const wrap=document.getElementById('todoCarryPrompt');
  if(!wrap) return;
  const missed=missedTasks();
  if(!missed.length){ wrap.innerHTML=''; return; }
  const t=missed[0];
  const missedDate=[...(t.scheduledDates||[]),t.due].filter(Boolean).sort()[0]||'';
  wrap.innerHTML=`
    <div class="carry-mini">
      <div class="carry-mini-title">Missed work</div>
      <div class="carry-mini-task">${esc(t.title)}</div>
      <div class="carry-mini-sub">Missed ${fmtDate(missedDate)}. Carry this one into the selected date?</div>
      <div class="missed-actions">
        <button class="btn-sm btn-primary" onclick="carryTaskToday('${t.id}', calSelectedDate)">Carry here</button>
        <button class="btn-sm btn-ghost" onclick="completeCarryTask('${t.id}')">Completed</button>
        <button class="btn-sm btn-ghost" onclick="dismissCarry('${t.id}')">Skip</button>
        <button class="btn-sm btn-ghost" onclick="deleteCarryTask('${t.id}')">Delete</button>
      </div>
    </div>`;
}

function carryTaskToday(id, dateOverride){
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  const today=dateOverride || todayStr();
  if(!t.scheduledDates) t.scheduledDates=[];
  const carriedFrom=[...(t.scheduledDates||[]), t.due].filter(Boolean).filter(ds=>ds<today).sort()[0]||'';
  t.scheduledDates=uniqueDates(t.scheduledDates.filter(ds=>!ds || ds>=today).concat(today));
  t.carriedAt=Date.now();
  t.carryFromDate=carriedFrom;
  calSelectedDate=today;
  save(); render(); showPage('todo');
}

function dismissCarry(id){
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  t.carryDismissedDate=todayStr();
  save(); render();
}

function deleteCarryTask(id){
  softDeleteTask(id);
}

function completeCarryTask(id){
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  t.completed=true;
  t.completedAt=Date.now();
  t.completedDate=calSelectedDate || todayStr();
  if(!t.isHabit){
    t.archived=true;
    t.archivedAt=Date.now();
  }
  save(); render();
}

function renderNavBadges(){
  const today=todayStr();
  const todayOpen=getTodayTasks().filter(t=>!isTaskDone(t,today)).length;
  const missed=missedTasks().length;
  const navToday=document.getElementById('navToday');
  const navMissed=document.getElementById('navMissed');
  if(navToday) navToday.textContent=todayOpen;
  if(navMissed) navMissed.textContent=missed;
}

function renderBank(){
  const list = document.getElementById('bankList');
  if(list){
    list.ondragover=onBankPanelDragOver;
    list.ondragleave=onBankPanelDragLeave;
    list.ondrop=onBankPanelDrop;
  }
  setupBankFilterHandlers();
  syncBankFilterUI();
  syncSortControls();
  const tasks = sortTasks(S.tasks.filter(t=>{
    if(t.archived || t.completed) return false;
    return taskMatchesBankFilter(t, bankFilter);
  }), bankSort);
  if(!tasks.length){
    list.innerHTML=`<div class="empty"><div class="empty-icon">📭</div>No tasks here</div>`;
    return;
  }
  const visible=tasks.slice(0,bankVisibleCount);
  list.innerHTML = visible.map(t=>{
    const unassigned=taskNeedsStudyAssignment(t);
    return `
    <div class="bank-task fade-up ${unassigned?'unassigned':''}" draggable="true"
      ondragstart="onBankDragStart(event,'${t.id}')"
      ondragend="onTaskDragEnd(event)"
      ondragover="onBankTaskDragOver(event,'${t.id}')"
      ondragleave="onTaskRowDragLeave(event)"
      ondrop="onBankTaskDrop(event,'${t.id}')"
      onclick="editTask('${t.id}')">
      <div class="bank-task-top">
        <span class="drag-cue" title="Drag to a calendar day">⋮⋮</span>
        <div class="bank-task-title">${esc(t.title)}</div>
        <span class="drag-hint">Drag</span>
      </div>
      <div class="bank-task-meta">
        <span class="chip chip-${t.priority==='MUST'?'must':t.priority==='high'?'high':t.priority==='low'?'low':'medium'}">
          ${priLabel(t.priority)}
        </span>
        ${dueChipHTML(t)}
        ${t.isHabit?`<span class="chip chip-habit">Habit</span>`:''}
        ${unassigned?`<span class="chip chip-unassigned">Task not assigned yet</span>`:''}
        ${t.scheduledTime?`<span class="chip chip-due">${t.scheduledTime}</span>`:''}
      </div>
      <div class="bank-task-actions">
        <button class="task-action" onclick="event.stopPropagation(); duplicateTask('${t.id}')" title="Duplicate">⧉</button>
        <button class="task-action" onclick="event.stopPropagation(); editTask('${t.id}')" title="Edit">✎</button>
      </div>
    </div>`;
  }).join('') + (tasks.length>10 ? `
      <button class="bank-add" onclick="toggleBankLimit()">${bankVisibleCount>=tasks.length?'Show first 10':'Show all '+tasks.length}</button>
    ` : '');
}

function taskMatchesBankFilter(t, filter){
  const f=String(filter||'all').toLowerCase();
  const pri=String(t.priority||'medium').toLowerCase();
  if(f==='all') return true;
  if(f==='habit' || f==='habits') return !!t.isHabit;
  if(f==='must') return pri==='must';
  if(f==='high') return pri==='high';
  return pri===f;
}

function setupBankFilterHandlers(){
  const filters=document.getElementById('bankFilters');
  if(!filters || filters.dataset.filterReady) return;
  filters.dataset.filterReady='1';
  filters.addEventListener('pointerdown', e=>e.stopPropagation());
  filters.addEventListener('click', e=>{
    const chip=e.target.closest('.filter-chip');
    if(!chip) return;
    e.preventDefault();
    e.stopPropagation();
    setFilter(chip.dataset.f || 'all', chip);
  });
}

function syncSortControls(){
  const bankSel=document.getElementById('bankSort');
  if(bankSel) bankSel.value=bankSort;
  const dailySel=document.getElementById('dailySort');
  if(dailySel) dailySel.value=dailySort;
}

function setBankSort(mode){
  bankSort=mode||'due';
  renderBank();
}

function setDailySort(mode){
  dailySort=mode||'section';
  renderCenter();
}

function syncBankFilterUI(){
  document.querySelectorAll('.filter-chip').forEach(c=>{
    c.classList.toggle('active', String(c.dataset.f||'all').toLowerCase()===String(bankFilter||'all').toLowerCase());
  });
}

function toggleBankLimit(){
  const openCount=S.tasks.filter(t=>!isArchivedForTodo(t)).length;
  bankVisibleCount = bankVisibleCount>=openCount ? 10 : openCount;
  renderBank();
}

function priLabel(p){
  return {MUST:'⚡ MUST', high:'🔥 High', medium:'✅ Med', low:'💧 Low'}[p]||p;
}
function appOwnerName(){
  return String(S.settings?.name || activeUser?.name || 'Jay').trim() || 'Jay';
}
function appDisplayName(){
  const name=appOwnerName();
  return `${name}${name.endsWith('s') ? "'" : "'s"} Hub`;
}
function updateBranding(){
  const appName=appDisplayName();
  document.querySelectorAll('.logo-text,.auth-title').forEach(el=>{ el.textContent=appName; });
  const sub=document.querySelector('.logo-sub');
  if(sub) sub.textContent=activeUser?.signedIn ? 'Synced academic planner' : 'Academic planner';
  if(!pomoState?.running) document.title=appName;
}

function renderCenter(){
  const today = calSelectedDate || todayStr();
  const scheduledWork = S.tasks.filter(t=>!isArchivedForTodo(t) && (isHabitDueToday(t,today) || ((t.scheduledDates||[]).includes(today))));
  const dueSignals = S.tasks.filter(t=>!isArchivedForTodo(t) && !t.isHabit && t.due===today && !isTaskDone(t,today) && !isDueSignalDone(t,today));
  const must = sortTasks(scheduledWork.filter(t=>t.priority==='MUST' && !isArchivedForTodo(t)),'custom');
  const regularRaw = scheduledWork.filter(t=>t.priority!=='MUST' && !t.isHabit && !isArchivedForTodo(t));
  const regular = dailySort==='section' ? sortTasks(regularRaw,'custom') : sortTasks(regularRaw,dailySort);
  const habits = sortTasks(scheduledWork.filter(t=>t.isHabit && !isArchivedForTodo(t)),'custom');
  const archivedTasks = S.tasks.filter(t=>isArchivedForDate(t,today));
  const archivedDueSignals = completedDueSignals(today);
  syncSortControls();

  const mustIncomplete = must.some(t=>!isTaskDone(t,today));

  // Must gate
  const gated = document.getElementById('gatedSections');
  const banner = document.getElementById('mustBanner');
  if(mustIncomplete){
    gated.classList.add('gated-locked');
    gated.style.filter='';
    gated.style.pointerEvents='';
    banner.style.display='flex';
  } else {
    gated.classList.remove('gated-locked');
    gated.style.filter='';
    gated.style.pointerEvents='';
    banner.style.display='none';
  }

  // Counts
  document.getElementById('mustCount').textContent = must.filter(t=>!isTaskDone(t,today)).length || must.length;
  document.querySelector('#secDaily .sec-title').textContent = `${fmtDate(today)}'s Tasks`;
  document.getElementById('dailyCount').textContent = regular.filter(t=>!isTaskDone(t,today)).length + '/' + regular.length;
  document.getElementById('habitCount').textContent = habits.filter(t=>!isTaskDone(t,today)).length + '/' + habits.length;
  document.getElementById('archiveCount').textContent = archivedTasks.length + archivedDueSignals.length;

  // Progress
  const total = regular.length + habits.length;
  const done = regular.filter(t=>isTaskDone(t,today)).length + habits.filter(t=>isTaskDone(t,today)).length;
  const pct = total ? Math.round(done/total*100) : 0;
  document.getElementById('progressLabel').textContent = `${done} of ${total} complete`;
  document.getElementById('progressPct').textContent = pct+'%';
  document.getElementById('progressFill').style.width = pct+'%';
  const selectedLabel = new Date(today+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  document.getElementById('dailyDateLabel').textContent = selectedLabel;
  const head=document.getElementById('selectedTaskHeading');
  if(head) head.textContent = selectedLabel;

  // Must list
  const mustSec = document.getElementById('secMust');
  document.getElementById('mustList').innerHTML = must.length
    ? must.map(t=>taskItemHTML(t,'must',today)).join('')
    : `<div class="empty" style="padding:10px 14px;text-align:left;font-size:12px">No must-do tasks today.</div>`;

  // Collapse + reorder when empty; restore when tasks exist
  if (mustSec && gated) {
    if (!must.length) {
      mustSec.classList.add('collapsed');
      if (mustSec.previousElementSibling !== gated && gated.parentNode) {
        gated.parentNode.insertBefore(mustSec, gated.nextSibling);
      }
    } else {
      mustSec.classList.remove('collapsed');
      if (gated.parentNode && mustSec.nextElementSibling !== gated) {
        gated.parentNode.insertBefore(mustSec, gated);
      }
    }
  }

  // Daily list
  document.getElementById('dailyList').innerHTML = renderDueDateSection(dueSignals,today) + renderDailySections(regular,today);

  // Habit list
  document.getElementById('habitList').innerHTML = habits.length
    ? habits.map(t=>taskItemHTML(t,'habit',today)).join('')
    : `<div class="sec-drop-hint">No habits for today. Drop a task here to make a habit.</div>`;

  // Archive
  document.getElementById('archiveList').innerHTML = (archivedTasks.length || archivedDueSignals.length)
    ? `${archivedDueSignals.length ? `
        <div class="archive-subgroup">
          <div class="archive-subgroup-header">
            <span>Due Dates</span>
            <span>${archivedDueSignals.length}</span>
          </div>
          ${archivedDueSignals.map(({task,date})=>`
            <div class="archived-task due-archived-task">
              <div class="archived-check">✓</div>
              <div class="archived-title">${esc(task.title)}</div>
              <div class="archived-time">${fmtDate(date)}</div>
              <button class="task-action" onclick="restoreDueDate('${task.id}','${date}')" title="Restore due date">↩</button>
            </div>`).join('')}
        </div>` : ''}
      ${archivedTasks.length ? `
        <div class="archive-subgroup">
          <div class="archive-subgroup-header">
            <span>Completed Tasks</span>
            <span>${archivedTasks.length}</span>
          </div>
          ${archivedTasks.map(t=>`
        <div class="archived-task" draggable="true"
          ondragstart="onArchiveTaskDragStart(event,'${t.id}')"
          ondragend="onTaskDragEnd(event)">
          <div class="archived-check">✓</div>
          <div class="archived-title">${esc(t.title)}</div>
              <div class="archived-time">${fmtDate(taskArchiveDate(t)||today)}</div>
          <button class="task-action" onclick="unarchiveTask('${t.id}')" title="Restore">↩</button>
        </div>`).join('')}
        </div>` : ''}`
    : `<div class="empty">Archive is empty.</div>`;
}

function completedDueSignals(dateStr=''){
  const rows=[];
  (S.tasks||[]).forEach(task=>{
    Object.keys(task.dueCompletedDates||{}).forEach(date=>{
      if(task.dueCompletedDates[date] && (!dateStr || date===dateStr)) rows.push({task,date});
    });
  });
  return rows.sort((a,b)=>b.date.localeCompare(a.date) || String(a.task.title||'').localeCompare(String(b.task.title||'')));
}

function renderDueDateSection(tasks,dateStr=todayStr()){
  const key='__due__';
  const collapsed=collapsedDailySections.has(key);
  return `<div class="daily-section due-date-section ${collapsed?'collapsed':''}"
    ondragover="onSectionDragOver(event,'Due Dates')"
    ondragleave="onSectionDragLeave(event)"
    ondrop="onSectionDrop(event,'__due__','${esc(dateStr)}')">
    <div class="daily-section-header" onclick="toggleDailySection('${key}')">
      <span class="daily-section-name">Due Dates</span>
      <span class="daily-section-count">${tasks.length}</span>
      <span class="daily-section-chevron">›</span>
    </div>
    <div class="daily-section-body">
      ${tasks.length ? tasks.map(t=>dueSignalHTML(t,dateStr)).join('') : `<div class="sec-drop-hint">Drop a task here to set its due date for ${fmtDate(dateStr)}</div>`}
    </div>
  </div>`;
}

function dueSignalHTML(t,dateStr=todayStr()){
  const subjStr = t.subject ? `<span class="chip chip-due">${esc(t.subject)}</span>` : '';
  const scheduled = (t.scheduledDates||[]).includes(dateStr);
  const dateArg=escJs(dateStr);
  return `<div class="task-item due-signal-item" id="due-${t.id}" draggable="true"
    ondragstart="onTaskDragStart(event,'${t.id}','__due__','${dateArg}')"
    ondragend="onTaskDragEnd(event)"
    ondragover="onTaskRowDragOver(event,'${t.id}')"
    ondragleave="onTaskRowDragLeave(event)"
    ondrop="onTaskRowDrop(event,'${t.id}','__due__','${dateArg}')">
    <div class="due-signal-mark">DUE</div>
    <div class="task-content">
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-sub">
        ${subjStr}
        ${dueChipHTML(t,true)}
        ${scheduled?`<span class="chip chip-medium">Also in Task</span>`:''}
      </div>
    </div>
    <div class="task-actions">
      <button class="due-complete-pill" onclick="completeDueDate(event,'${t.id}','${dateArg}')" title="Mark this due date complete">Completed</button>
      <button class="task-action play" onclick="startPomoTask('${t.id}')" title="Focus">▶</button>
      <button class="task-action" onclick="duplicateTask('${t.id}')" title="Duplicate">⧉</button>
      <button class="task-action" onclick="editTask('${t.id}')" title="Edit">✎</button>
      <button class="task-action del" onclick="removeTaskFromDate('${t.id}','${dateArg}')" title="Remove from this day">×</button>
    </div>
  </div>`;
}

function completeDueDate(event,id,dateStr){
  event?.stopPropagation?.();
  const task=S.tasks.find(t=>t.id===id);
  if(!task) return;
  const before=JSON.parse(JSON.stringify(task));
  if(!task.dueCompletedDates) task.dueCompletedDates={};
  task.dueCompletedDates[dateStr]=true;
  if(!task.isHabit){
    task.completed=true;
    task.completedAt=Date.now();
    task.completedDate=dateStr;
    task.archived=true;
    task.archivedAt=Date.now();
    clearTaskFromCalendar(task);
  }
  save(); render();
  showToast(`Due date cleared for "${task.title}"`,'Undo',()=>{
    const live=S.tasks.find(t=>t.id===id);
    restoreTaskSnapshot(live,before);
    save(); render();
  });
}

function restoreDueDate(id,dateStr){
  const task=S.tasks.find(t=>t.id===id);
  if(!task?.dueCompletedDates) return;
  task.dueCompletedDates[dateStr]=false;
  save(); render();
  showToast(`Restored due date for "${task.title}"`);
}

function renderDailySections(tasks,dateStr=todayStr()){
  const sections = [...new Set([...(S.dailySections||[]), ...tasks.map(t=>t.dailySection||'Study')])];
  return sections.map(sec=>{
    const items = tasks.filter(t=>(t.dailySection||'Study')===sec);
    const isBuiltin = sec === 'Study';
    const secArg = escJs(sec);
    const dateArg = escJs(dateStr);
    const collapsed=collapsedDailySections.has(sec);
    return `<div class="daily-section ${collapsed?'collapsed':''}" 
      ondragover="onSectionDragOver(event,'${secArg}')" 
      ondragleave="onSectionDragLeave(event)"
      ondrop="onSectionDrop(event,'${secArg}','${dateArg}')">
      <div class="daily-section-header" onclick="if(!event.target.closest('button,[contenteditable=true]')) toggleDailySection('${secArg}')">
        <span class="daily-section-name"
          ${!isBuiltin ? `contenteditable="true" spellcheck="false" title="Click to rename" onblur="renameDailySection('${secArg}',this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"` : ''}>${esc(sectionLabel(sec))}</span>
        <span class="daily-section-count">${items.filter(t=>!isTaskDone(t,dateStr)).length}/${items.length}</span>
        ${!isBuiltin ? `<button class="daily-section-del" onclick="deleteSubsection('${secArg}')" title="Delete subsection">✕</button>` : ''}
        <span class="daily-section-chevron">›</span>
      </div>
      <div class="daily-section-body">
        ${items.length ? items.map(t=>taskItemHTML(t,'daily',dateStr)).join('') : `<div class="sec-drop-hint">Drop a task here</div>`}
      </div>
    </div>`;
  }).join('');
}

function toggleDailySection(key){
  if(collapsedDailySections.has(key)) collapsedDailySections.delete(key);
  else collapsedDailySections.add(key);
  renderCenter();
}

function taskItemHTML(t, section, dateStr=todayStr()){
  const timeStr = t.scheduledTime ? `<span class="task-time">⏰ ${t.scheduledTime}</span>` : '';
  const subjStr = t.subject ? `<span class="chip chip-due">${esc(t.subject)}</span>` : '';
  const pct = taskProgress(t);
  const tone = pct < 34 ? 'var(--red)' : pct < 67 ? 'var(--orange)' : 'var(--green)';
  const subCount = (t.subtasks||[]).length;
  const doneNow = isTaskDone(t,dateStr);
  const sectionArg=escJs(section);
  const dateArg=escJs(dateStr);
  return `<div class="task-item ${doneNow?'completed':''} ${section==='must'?'must-item':''} ${openTaskDetails.has(t.id)?'open':''}"
    id="ti-${t.id}"
    draggable="true"
    ondragstart="onTaskDragStart(event,'${t.id}','${sectionArg}','${dateArg}')"
    ondragend="onTaskDragEnd(event)"
    ondragover="onTaskRowDragOver(event,'${t.id}')"
    ondragleave="onTaskRowDragLeave(event)"
    ondrop="onTaskRowDrop(event,'${t.id}','${sectionArg}','${dateArg}')">
    <div class="task-cb" onclick="toggleTask('${t.id}','${dateStr}')">${doneNow?'✓':''}</div>
    <div class="task-content">
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-sub">
        ${subjStr}${timeStr}
        ${dueChipHTML(t,true)}
        ${subCount?`<span class="task-time">${subCount} subtasks</span>`:''}
      </div>
      <div class="task-progress-mini" title="${pct}% complete"><span style="width:${pct}%;background:${tone}"></span></div>
    </div>
    <div class="task-actions">
      <button class="task-action play" onclick="startPomoTask('${t.id}')" title="Focus">▶</button>
      <button class="task-action" onclick="toggleTaskDetails(event,'${t.id}')" title="Subtasks">▤</button>
      <button class="task-action" onclick="duplicateTask('${t.id}')" title="Duplicate">⧉</button>
      <button class="task-action" onclick="editTask('${t.id}')" title="Edit">✎</button>
      <button class="task-action del" onclick="removeTaskFromDate('${t.id}','${dateArg}')" title="Remove from this day">×</button>
    </div>
    <div class="task-details">
      <div class="task-detail-card">
        <div class="task-detail-grid">
          <div>
            ${(t.subtasks||[]).length ? t.subtasks.map((st,i)=>`
              <div class="subtask-line ${st.done?'done':''}">
                <div class="task-cb" style="width:16px;height:16px;margin:0;border-radius:5px" onclick="toggleSubtask('${t.id}',${i})">${st.done?'✓':''}</div>
                <span>${esc(st.text)}</span>
            </div>`).join('') : `<div class="empty" style="padding:6px 0;text-align:left">No subtasks yet.</div>`}
            <div class="subtask-add">
              <input id="subAdd-${t.id}" placeholder="Add a small next step" onkeydown="if(shouldCommitTextInput(event))addSubtask('${t.id}',event)">
              <button onclick="addSubtask('${t.id}',event)">Add</button>
            </div>
          </div>
          <div class="progress-editor">
            <label>Manual Progress</label>
            <input type="range" min="0" max="100" value="${t.progress||0}" oninput="setManualProgress('${t.id}',this.value,this)">
            <span class="pct-label">${pct}%</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function taskProgress(t){
  const subs = t.subtasks||[];
  if(subs.length) return Math.round(subs.filter(s=>s.done).length / subs.length * 100);
  return Math.max(0, Math.min(100, Number(t.progress||0)));
}

// ════════════════════════════════════════════════════════════
//  TASK ACTIONS
// ════════════════════════════════════════════════════════════
function toggleTask(id,dateStr){
  const t = S.tasks.find(t=>t.id===id);
  if(!t) return;
  const today=dateStr || calSelectedDate || todayStr();
  const wasDone = isTaskDone(t,today);
  if(t.isHabit){
    if(!t.completedDates) t.completedDates={};
    t.completedDates[today]=!t.completedDates[today];
    t.completed=!!t.completedDates[today];
  } else {
    t.completed = !t.completed;
  }
  const doneNow = isTaskDone(t,today);
  t.completedAt = doneNow ? Date.now() : null;
  t.completedDate = doneNow ? today : '';

  if(doneNow){
    playPop(t.priority==='MUST'?1100:880);
    const el = document.getElementById('ti-'+id);
    if(el){ el.classList.add('pop'); setTimeout(()=>el.classList.remove('pop'),400); }

    // Award focus points
    if(!wasDone) t.focusPoints = (t.focusPoints||0) + 1;

    // Completed one-off tasks leave the active Todo list immediately.
    if(!t.isHabit){
      t.archived = true;
      t.archivedAt = Date.now();
      showToast('Completed and moved to Archive','Undo',()=>{
        t.archived=false;
        t.completed=false;
        t.completedAt=null;
        t.completedDate='';
        save(); render();
      });
    }

    // Check if all MUST are done → archive them
    const mustToday = S.tasks.filter(x=>x.priority==='MUST' && !x.archived &&
      (isScheduledToday(x,today)||isHabitDueToday(x,today)));
    if(mustToday.length && mustToday.every(x=>isTaskDone(x,today))){
      setTimeout(()=>{
        mustToday.forEach(x=>{ if(!x.isHabit) x.archived = true; });
        playPop(1320);
        save(); render();
      }, 600);
      return;
    }
  }
  save(); render();
}

function toggleTaskDetails(event,id){
  event.stopPropagation();
  if(openTaskDetails.has(id)) openTaskDetails.delete(id);
  else openTaskDetails.add(id);
  const el=document.getElementById('ti-'+id);
  if(el) el.classList.toggle('open');
}

function toggleSubtask(id,index){
  const t=S.tasks.find(x=>x.id===id);
  if(!t || !t.subtasks || !t.subtasks[index]) return;
  openTaskDetails.add(id);
  t.subtasks[index].done=!t.subtasks[index].done;
  t.progress=taskProgress(t);
  save(); render();
}

function addSubtask(id,event){
  if(!shouldCommitTextInput(event)) return;
  const input=document.getElementById('subAdd-'+id);
  const text=input?.value.trim();
  if(!text) return;
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  openTaskDetails.add(id);
  if(!Array.isArray(t.subtasks)) t.subtasks=[];
  t.subtasks.push({text,done:false});
  input.value='';
  save(); render();
}

function setManualProgress(id,value,el){
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  t.progress=Math.max(0,Math.min(100,Number(value)||0));
  if(el?.nextElementSibling) el.nextElementSibling.textContent=t.progress+'%';
  save();
  renderBank();
  updateEOPR();
}

function removeTask(id){
  softDeleteTask(id);
}

function softDeleteTask(id){
  const idx=S.tasks.findIndex(t=>t.id===id);
  if(idx<0) return;
  const [task]=S.tasks.splice(idx,1);
  const entry={id:uid(), type:'task', deletedAt:Date.now(), item:task};
  S.deleted.unshift(entry);
  save(); render();
  showToast(`Deleted "${task.title}". You can retrieve it in Settings > Deleted Items.`, 'Undo', ()=>restoreDeleted(entry.id));
}

function removeTaskFromDate(id, dateStr){
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  if(!dateStr){ softDeleteTask(id); return; }
  if(t.isHabit){
    const prevSkipped=Array.isArray(t.skippedDates) ? t.skippedDates.slice() : null;
    const prevCompleted=t.completedDates ? Object.assign({},t.completedDates) : null;
    if(!Array.isArray(t.skippedDates)) t.skippedDates=[];
    if(!t.skippedDates.includes(dateStr)) t.skippedDates.push(dateStr);
    if(t.completedDates) delete t.completedDates[dateStr];
    save(); render();
    showToast(`Skipped "${t.title}" for ${fmtDate(dateStr)}.`, 'Undo', ()=>{
      t.skippedDates = prevSkipped ? prevSkipped : [];
      if(prevCompleted) t.completedDates=prevCompleted;
      save(); render();
    });
    return;
  }
  const hadScheduled=Array.isArray(t.scheduledDates) && t.scheduledDates.includes(dateStr);
  const hadDue=t.due===dateStr;
  if(!hadScheduled && !hadDue){ softDeleteTask(id); return; }
  if(hadScheduled) t.scheduledDates=t.scheduledDates.filter(d=>d!==dateStr);
  if(hadDue){ t.due=''; }
  const prevDueCompleted = t.dueCompletedDates ? t.dueCompletedDates[dateStr] : undefined;
  if(t.dueCompletedDates) delete t.dueCompletedDates[dateStr];
  const prevCompleted = t.completedDates ? t.completedDates[dateStr] : undefined;
  if(t.completedDates) delete t.completedDates[dateStr];
  save(); render();
  showToast(`Removed "${t.title}" from ${fmtDate(dateStr)}.`, 'Undo', ()=>{
    if(hadScheduled){
      if(!Array.isArray(t.scheduledDates)) t.scheduledDates=[];
      if(!t.scheduledDates.includes(dateStr)) t.scheduledDates.push(dateStr);
    }
    if(hadDue) t.due=dateStr;
    if(prevDueCompleted!==undefined){
      if(!t.dueCompletedDates) t.dueCompletedDates={};
      t.dueCompletedDates[dateStr]=prevDueCompleted;
    }
    if(prevCompleted!==undefined){
      if(!t.completedDates) t.completedDates={};
      t.completedDates[dateStr]=prevCompleted;
    }
    save(); render();
  });
}

function duplicateTask(id){
  const original=S.tasks.find(t=>t.id===id);
  if(!original) return;
  const copy=JSON.parse(JSON.stringify(original));
  copy.id=uid();
  copy.createdAt=Date.now();
  copy.title=`${original.title} copy`;
  copy.completed=false;
  copy.completedAt=null;
  copy.completedDate='';
  copy.completedDates={};
  copy.dueCompletedDates={};
  copy.archived=false;
  copy.customOrder=Date.now();
  copy.focusPoints=0;
  copy.subtasks=(copy.subtasks||[]).map(st=>Object.assign({},st,{done:false}));
  S.tasks.push(copy);
  save(); render();
  showToast(`Duplicated "${original.title}"`);
}

function restoreDeleted(id){
  const idx=S.deleted.findIndex(d=>d.id===id);
  if(idx<0) return;
  const [entry]=S.deleted.splice(idx,1);
  if(entry.type==='task') S.tasks.push(entry.item);
  if(entry.type==='event') S.events.push(entry.item);
  save(); render(); renderDeletedList();
}

function renderDeletedList(){
  const wrap=document.getElementById('deletedList');
  if(!wrap) return;
  const items=S.deleted||[];
  wrap.innerHTML=items.length ? items.map(d=>`
    <div class="deleted-row">
      <span>${esc(d.item?.title||'Deleted item')}</span>
      <button class="btn-sm btn-ghost" onclick="restoreDeleted('${d.id}')">Restore</button>
    </div>`).join('') : `<div class="empty" style="padding:14px;text-align:left">No deleted items.</div>`;
}

function showToast(message, actionLabel, action){
  const stack=document.getElementById('toastStack');
  if(!stack) return;
  const el=document.createElement('div');
  el.className='toast toast-msg';
  el.innerHTML=`<span>${esc(message)}</span>${actionLabel?`<button class="toast-action" type="button">${esc(actionLabel)}</button>`:''}`;
  if(actionLabel) el.querySelector('button').onclick=()=>{ action?.(); el.remove(); };
  stack.appendChild(el);
  setTimeout(()=>el.remove(),7000);
}

function ensureAppDialog(){
  let overlay=document.getElementById('appDialogOverlay');
  if(overlay) return overlay;
  overlay=document.createElement('div');
  overlay.id='appDialogOverlay';
  overlay.className='overlay app-dialog-overlay';
  overlay.innerHTML=`
    <div class="modal app-dialog" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span class="modal-title" id="appDialogTitle">Confirm</span>
        <button class="modal-close" id="appDialogClose">✕</button>
      </div>
      <div class="modal-body app-dialog-body">
        <div class="app-dialog-message" id="appDialogMessage"></div>
        <input class="app-dialog-input" id="appDialogInput" style="display:none">
        <div class="app-dialog-actions">
          <button class="btn-sm btn-ghost" id="appDialogCancel">Cancel</button>
          <button class="btn-sm btn-primary" id="appDialogConfirm">Confirm</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function appDialog({title='Confirm', message='', confirmLabel='Confirm', cancelLabel='Cancel', input=false, defaultValue='' }={}){
  const overlay=ensureAppDialog();
  const titleEl=overlay.querySelector('#appDialogTitle');
  const msgEl=overlay.querySelector('#appDialogMessage');
  const inputEl=overlay.querySelector('#appDialogInput');
  const confirmBtn=overlay.querySelector('#appDialogConfirm');
  const cancelBtn=overlay.querySelector('#appDialogCancel');
  const closeBtn=overlay.querySelector('#appDialogClose');
  titleEl.textContent=title;
  msgEl.textContent=message;
  confirmBtn.textContent=confirmLabel;
  cancelBtn.textContent=cancelLabel;
  inputEl.style.display=input?'block':'none';
  inputEl.value=defaultValue || '';
  overlay.classList.add('show');
  return new Promise(resolve=>{
    const cleanup=(value)=>{
      overlay.classList.remove('show');
      confirmBtn.onclick=null;
      cancelBtn.onclick=null;
      closeBtn.onclick=null;
      overlay.onclick=null;
      inputEl.onkeydown=null;
      resolve(value);
    };
    confirmBtn.onclick=()=>cleanup(input ? inputEl.value : true);
    cancelBtn.onclick=()=>cleanup(input ? null : false);
    closeBtn.onclick=()=>cleanup(input ? null : false);
    overlay.onclick=e=>{ if(e.target===overlay) cleanup(input ? null : false); };
    inputEl.onkeydown=e=>{ if(e.key==='Enter') cleanup(inputEl.value); if(e.key==='Escape') cleanup(null); };
    if(input) setTimeout(()=>{ inputEl.focus(); inputEl.select(); },0);
    else setTimeout(()=>confirmBtn.focus(),0);
  });
}

function designConfirm(title,message,confirmLabel='Yes',cancelLabel='Cancel'){
  return appDialog({title,message,confirmLabel,cancelLabel});
}

function designPrompt(title,message,defaultValue='',confirmLabel='Save',cancelLabel='Cancel'){
  return appDialog({title,message,defaultValue,confirmLabel,cancelLabel,input:true});
}

function unarchiveTask(id){
  const t = S.tasks.find(t=>t.id===id);
  if(!t) return;
  t.archived=false; t.completed=false; t.completedAt=null; t.completedDate='';
  save(); render();
}

function editTask(id){
  const t = S.tasks.find(t=>t.id===id);
  if(!t) return;
  document.getElementById('mAddTitle').textContent = 'Edit Task';
  document.getElementById('editId').value = id;
  document.getElementById('fTitle').value = t.title;
  document.getElementById('fSubject').value = t.subject||'';
  document.getElementById('fType').value = t.type||'task';
  document.getElementById('fDue').value = t.due||'';
  refreshDailySectionOptions(t.dailySection||'Study');
  document.getElementById('fCalendarSignal').value = t.calendarSignal||'auto';
  document.getElementById('fNotes').value = t.notes||'';
  editModalSubtasks = (t.subtasks||[]).map(s=>({text:s.text, done:!!s.done}));
  renderModalSubtasks();
  document.getElementById('fIsHabit').checked = t.isHabit;
  document.getElementById('fHabitStart').value = t.habitStart || '';
  document.getElementById('fHabitEnd').value = t.habitEnd || '';
  document.getElementById('deleteBtn').style.display = 'flex';
  document.getElementById('taskToEventBtn').style.display = 'flex';
  editSelectedDays = [...(t.scheduledDays||[])];
  editScheduledDates = [...(t.scheduledDates||[])];
  schedulePickerDate = editScheduledDates[0] ? new Date(editScheduledDates[0]+'T00:00:00') : (t.due ? new Date(t.due+'T00:00:00') : new Date(calSelectedDate+'T00:00:00'));
  renderScheduledDateChips();
  selectPri(t.priority, null);
  toggleHabitFields();
  document.querySelectorAll('.day-btn').forEach(b=>{
    b.classList.toggle('active', editSelectedDays.includes(+b.dataset.d));
  });
  openModal('mAddTask');
}

function saveTask(){
  const id = document.getElementById('editId').value;
  const title = document.getElementById('fTitle').value.trim();
  if(!title){ showToast('Task title required.'); return; }

  const task = id ? S.tasks.find(t=>t.id===id) : null;
  const isNew = !task;
  const t = task || { id:uid(), createdAt:Date.now(), archived:false, completed:false,
    completedAt:null, completedDate:'', progress:0, subtasks:[], focusPoints:0, scheduledDates:[], completedDates:{}, dueCompletedDates:{} };
  if(isNew && nlpEditDraft){
    t.nlpSource=nlpEditDraft.source||'';
    t.nlpParsedSnapshot=Object.assign({}, nlpEditDraft);
  }

  t.title = title;
  t.subject = document.getElementById('fSubject').value.trim();
  t.type = document.getElementById('fType').value;
  t.priority = editSelectedPri;
  t.due = document.getElementById('fDue').value;
  t.scheduledTime = '';
  t.dailySection = document.getElementById('fDailySection').value || 'Study';
  t.calendarSignal = document.getElementById('fCalendarSignal').value || 'auto';
  t.notes = document.getElementById('fNotes').value;
  t.isHabit = document.getElementById('fIsHabit').checked;
  t.scheduledDays = [...editSelectedDays];
  t.habitStart = t.isHabit ? (document.getElementById('fHabitStart')?.value || '') : '';
  t.habitEnd = t.isHabit ? (document.getElementById('fHabitEnd')?.value || '') : '';
  if(t.isHabit && t.habitStart && t.habitEnd && t.habitEnd < t.habitStart){
    showToast('Habit end date must be after the start date.');
    return;
  }
  t.scheduledDates = [...editScheduledDates];
  t.subtasks = editModalSubtasks.map(s=>({text:s.text, done:!!s.done}));
  t.progress = taskProgress(t);
  const learnedQuickAdd=learnFromManualCorrection(t);

  if(isNew) S.tasks.push(t);
  const taughtQuickAdd=!!nlpEditDraft;
  save(); render();
  closeModal('mAddTask');
  resetAddForm();
  if(taughtQuickAdd || learnedQuickAdd){
    showToast('Correction saved. Quick Add will use it next time.');
    nlpEditDraft=null;
  }
}

function deleteTask(){
  const id = document.getElementById('editId').value;
  if(!id) return;
  softDeleteTask(id);
  closeModal('mAddTask');
}

function convertTaskToEvent(){
  const id = document.getElementById('editId').value;
  const idx=S.tasks.findIndex(t=>t.id===id);
  if(idx<0) return;
  const task=S.tasks[idx];
  const date=task.due || (task.scheduledDates||[]).slice().sort()[0] || calSelectedDate || todayStr();
  const isTest=task.calendarSignal==='exam' || task.type==='exam' || /\b(exam|test|midterm|final)\b/i.test(task.title||'');
  const type=isTest?'test':'event';
  const ev={
    id:uid(),
    icsUid:task.icsUid||'',
    createdAt:task.createdAt||Date.now(),
    convertedFromTaskId:task.id,
    title:task.title||'Untitled event',
    date,
    endDate:date,
    noEndDate:false,
    time:task.scheduledTime||'',
    endTime:'',
    allDay:!task.scheduledTime,
    recurrence:task.isHabit?'weekly':'none',
    recurrenceDays:[...(task.scheduledDays||[])],
    subject:task.subject||'',
    location:'',
    notes:task.notes||'',
    reminder:'none',
    type,
    color:eventColorForType(type)
  };
  S.tasks.splice(idx,1);
  S.events.push(ev);
  calSelectedDate=date;
  save(); render();
  closeModal('mAddTask');
  resetAddForm();
  showToast(`Converted "${ev.title}" to an event.`);
}

function resetAddForm(){
  document.getElementById('mAddTitle').textContent='New Task';
  document.getElementById('editId').value='';
  document.getElementById('fTitle').value='';
  document.getElementById('fSubject').value='';
  document.getElementById('fType').value='task';
  document.getElementById('fDue').value='';
  refreshDailySectionOptions('Study');
  document.getElementById('fCalendarSignal').value='auto';
  document.getElementById('fNotes').value='';
  editModalSubtasks=[];
  renderModalSubtasks();
  document.getElementById('fIsHabit').checked=false;
  document.getElementById('fHabitStart').value='';
  document.getElementById('fHabitEnd').value='';
  document.getElementById('deleteBtn').style.display='none';
  document.getElementById('taskToEventBtn').style.display='none';
  editSelectedDays=[];
  editScheduledDates=[];
  schedulePickerDate = new Date((calSelectedDate||todayStr())+'T00:00:00');
  renderScheduledDateChips();
  editSelectedPri='medium';
  selectPri('medium',null);
  toggleHabitFields();
  document.querySelectorAll('.day-btn').forEach(b=>b.classList.remove('active'));
}

function renderModalSubtasks(){
  const list=document.getElementById('modalSubtaskList');
  if(!list) return;
  list.innerHTML=editModalSubtasks.length ? editModalSubtasks.map((s,i)=>`
    <div class="modal-subtask-row">
      <span>${esc(s.text)}</span>
      <button type="button" onclick="removeModalSubtask(${i})">×</button>
    </div>`).join('') : `<div class="empty" style="padding:8px 0;text-align:left">No subtasks yet. Add one at a time.</div>`;
}

function addModalSubtask(event){
  if(!shouldCommitTextInput(event)) return;
  const input=document.getElementById('modalSubtaskInput');
  const text=input?.value.trim();
  if(!text) return;
  editModalSubtasks.push({text,done:false});
  input.value='';
  renderModalSubtasks();
}

function removeModalSubtask(i){
  editModalSubtasks.splice(i,1);
  renderModalSubtasks();
}

function addScheduledDate(){
  const input = document.getElementById('fScheduleDate');
  const val = input?.value;
  if(!val) return;
  addScheduledDateValue(val);
  input.value = '';
}

function addScheduledDateValue(val){
  if(!val) return;
  if(!editScheduledDates.includes(val)) editScheduledDates.push(val);
  renderScheduledDateChips();
}

function removeScheduledDate(i){
  const sorted=[...editScheduledDates].sort();
  const date=sorted[i];
  editScheduledDates=editScheduledDates.filter(d=>d!==date);
  renderScheduledDateChips();
}

function renderScheduledDateChips(){
  const wrap = document.getElementById('scheduledDateChips');
  if(!wrap) return;
  renderSchedulePicker();
  if(!editScheduledDates.length){
    wrap.innerHTML = '<span style="font-size:11px;color:var(--text3)">No work days selected. Click or drag across dates above.</span>';
    return;
  }
  wrap.innerHTML = [...editScheduledDates].sort().map((d,i) =>
    `<span class="sched-chip">${esc(fmtDate(d))}<button type="button" onclick="removeScheduledDate(${i})">✕</button></span>`
  ).join('');
}

function renderSchedulePicker(){
  const grid=document.getElementById('schedulePickerGrid');
  const title=document.getElementById('schedulePickerTitle');
  if(!grid || !title) return;
  const y=schedulePickerDate.getFullYear();
  const m=schedulePickerDate.getMonth();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  title.textContent=`${months[m]} ${y}`;
  const firstDay=new Date(y,m,1).getDay();
  const daysInMonth=new Date(y,m+1,0).getDate();
  let html=['SU','MO','TU','WE','TH','FR','SA'].map(d=>`<div class="schedule-dow">${d}</div>`).join('');
  for(let i=0;i<firstDay;i++) html+=`<button type="button" class="schedule-day blank" tabindex="-1"></button>`;
  const today=todayStr();
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${y}-${pad(m+1)}-${pad(d)}`;
    html+=`<button type="button" class="schedule-day ${editScheduledDates.includes(ds)?'selected':''} ${ds===today?'today':''}"
      data-date="${ds}"
      onpointerdown="startScheduleDateDrag(event,'${ds}')"
      onpointerenter="continueScheduleDateDrag(event,'${ds}')">${d}</button>`;
  }
  grid.innerHTML=html;
}

function startScheduleDateDrag(e,ds){
  if(e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  scheduleDragActive=true;
  scheduleDragMode=editScheduledDates.includes(ds)?'remove':'add';
  applyScheduleDateDrag(ds);
  window.addEventListener('pointerup',stopScheduleDateDrag,{once:true});
  window.addEventListener('pointercancel',stopScheduleDateDrag,{once:true});
  window.addEventListener('blur',stopScheduleDateDrag,{once:true});
}

function continueScheduleDateDrag(e,ds){
  if(!scheduleDragActive) return;
  if(e.buttons !== 1){
    stopScheduleDateDrag();
    return;
  }
  e.preventDefault();
  applyScheduleDateDrag(ds);
}

function stopScheduleDateDrag(){
  scheduleDragActive=false;
}

function applyScheduleDateDrag(ds){
  if(scheduleDragMode==='add'){
    if(!editScheduledDates.includes(ds)) editScheduledDates.push(ds);
  }else{
    editScheduledDates=editScheduledDates.filter(d=>d!==ds);
  }
  renderScheduledDateChips();
}

function moveSchedulePickerMonth(delta){
  schedulePickerDate.setMonth(schedulePickerDate.getMonth()+delta);
  renderSchedulePicker();
}

function jumpSchedulePickerToCalendar(){
  schedulePickerDate=new Date(calViewDate.getFullYear(),calViewDate.getMonth(),1);
  renderSchedulePicker();
}

function refreshDailySectionOptions(selected='Study'){
  const sel=document.getElementById('fDailySection');
  if(!sel) return;
  const sections=[...new Set([...(S.dailySections||[]), selected||'Study'])];
  sel.innerHTML=sections.map(s=>`<option value="${esc(s)}">${esc(sectionLabel(s))}</option>`).join('');
  sel.value=sections.includes(selected)?selected:'Study';
}

function addDailySection(){
  let name='New section';
  let n=2;
  while(S.dailySections.includes(name)) name=`New section ${n++}`;
  S.dailySections.push(name);
  save();
  render();
  const daily=document.getElementById('secDaily');
  const body=daily?.querySelector(':scope > .sec-body');
  daily?.classList.remove('collapsed');
  if(body){ body.hidden=false; body.style.display=''; }
  setTimeout(()=>{
    const target=[...document.querySelectorAll('.daily-section-name')].find(el=>el.textContent.trim()===name);
    if(!target) return;
    target.focus();
    const range=document.createRange();
    range.selectNodeContents(target);
    const sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  },0);
  showToast(`Created "${name}". Type to rename it.`);
}

function renameDailySection(oldName, rawName){
  const clean=String(rawName||'').trim() || oldName;
  if(clean===oldName) return;
  if(S.dailySections.includes(clean)){
    showToast(`"${clean}" already exists.`);
    render();
    return;
  }
  S.dailySections=S.dailySections.map(s=>s===oldName?clean:s);
  S.tasks.forEach(t=>{ if(t.dailySection===oldName) t.dailySection=clean; });
  save();
  render();
}

async function deleteSubsection(sec){
  const ok=await designConfirm('Delete subsection', `"${sectionLabel(sec)}" will be removed. Tasks in it will move to Task.`, 'Delete', 'Cancel');
  if(!ok) return;
  S.dailySections = S.dailySections.filter(s=>s!==sec);
  S.tasks.forEach(t=>{ if(t.dailySection===sec) t.dailySection='Study'; });
  save(); render();
}

function getDraggedTaskId(e){
  return draggedTaskId || draggedBankId || e?.dataTransfer?.getData('text/task-id') || '';
}
function resetDraggedTask(){
  draggedTaskId=null;
  draggedTaskDate='';
  draggedTaskSection='';
  draggedBankId=null;
  document.querySelectorAll('.task-drag-over,.section-drag-over,.dragging').forEach(el=>el.classList.remove('task-drag-over','section-drag-over','dragging'));
}
function restoreTaskSnapshot(task,snapshot){
  if(!task || !snapshot) return;
  Object.keys(task).forEach(k=>delete task[k]);
  Object.assign(task,snapshot);
}
function parseHabitDays(text){
  const DAY_MAP={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
  const raw=String(text||'').trim();
  if(/daily|every day/i.test(raw)) return [0,1,2,3,4,5,6];
  const days=raw.split(/[\s,;/]+/).map(d=>DAY_MAP[d.toLowerCase()]).filter(d=>d!==undefined);
  return [...new Set(days)];
}
async function makeTaskHabit(t,dateStr,ask=true){
  if(!t || t.isHabit) return true;
  if(ask && !await designConfirm('Make this a habit?', `"${t.title}" will move into the habit section and repeat on selected days.`, 'Make habit', 'Cancel')) return false;
  const daysText=await designPrompt('Habit days', 'Use daily or days like Mon,Wed,Fri.', 'Mon,Wed,Fri', 'Use days');
  if(daysText===null) return false;
  let scheduledDays=parseHabitDays(daysText);
  if(!scheduledDays.length) scheduledDays=[1,2,3,4,5];
  t.isHabit=true;
  t.scheduledDays=scheduledDays;
  t.scheduledDates=[];
  t.habitStart=t.habitStart || dateStr || todayStr();
  t.habitEnd=t.habitEnd || '';
  t.completed=false;
  t.completedAt=null;
  t.completedDate='';
  t.archived=false;
  showToast(`"${t.title}" is now a habit`);
  return true;
}
async function makeHabitSingleTask(t,dateStr,sec='Study',ask=true){
  if(!t || !t.isHabit) return true;
  if(ask && !await designConfirm('Make this one task?', `"${t.title}" will stop repeating and become a single task for ${fmtDate(dateStr || todayStr())}.`, 'Make task', 'Cancel')) return false;
  const ds=dateStr || calSelectedDate || todayStr();
  t.isHabit=false;
  t.scheduledDays=[];
  t.habitStart='';
  t.habitEnd='';
  t.completedDates={};
  t.completed=false;
  t.completedAt=null;
  t.completedDate='';
  t.archived=false;
  t.dailySection = sec && sec !== '__due__' && sec !== '__habits__' && sec !== 'habit' && sec !== 'must' ? sec : 'Study';
  t.scheduledDates=[ds];
  showToast(`"${t.title}" is now a task`);
  return true;
}
function unarchiveForDrop(t,dateStr){
  if(!t || !isArchivedForTodo(t)) return false;
  t.archived=false;
  t.completed=false;
  t.completedAt=null;
  t.completedDate='';
  t.archivedAt=null;
  if(t.completedDates && dateStr) t.completedDates[dateStr]=false;
  return true;
}
function orderTaskIds(ids){
  ids.forEach((id,i)=>{
    const task=S.tasks.find(t=>t.id===id);
    if(task) task.customOrder=(i+1)*1000;
  });
}
function reorderTaskNear(sourceId,targetId,dateStr,targetSection=''){
  const source=S.tasks.find(t=>t.id===sourceId);
  const target=S.tasks.find(t=>t.id===targetId);
  if(!source || !target || source.id===target.id) return false;
  const ds=dateStr || calSelectedDate || todayStr();
  let list=[];
  if(targetSection==='__due__'){
    list=S.tasks.filter(t=>!isArchivedForTodo(t) && !t.isHabit && t.due===ds);
  }else if(targetSection==='must' || target.priority==='MUST'){
    list=S.tasks.filter(t=>!isArchivedForTodo(t) && !t.isHabit && t.priority==='MUST' && (t.scheduledDates||[]).includes(ds));
  }else if(target.isHabit){
    list=S.tasks.filter(t=>!isArchivedForTodo(t) && t.isHabit && isHabitDueToday(t,ds));
  }else{
    const sec=target.dailySection||'Study';
    list=S.tasks.filter(t=>!isArchivedForTodo(t) && !t.isHabit && (t.scheduledDates||[]).includes(ds) && (t.dailySection||'Study')===sec);
  }
  list=sortTasks(list,'custom');
  const ids=list.map(t=>t.id).filter(id=>id!==sourceId);
  const idx=ids.indexOf(targetId);
  ids.splice(idx<0 ? ids.length : idx,0,sourceId);
  orderTaskIds(ids);
  return true;
}
function setCustomSortForContext(kind='daily'){
  if(kind==='bank') bankSort='custom';
  else dailySort='custom';
  syncSortControls();
}

function onSectionDragOver(e, sec){
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('section-drag-over');
}
function onSectionDragLeave(e){
  e.currentTarget.classList.remove('section-drag-over');
}
async function onSectionDrop(e, sec, dateStr){
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('section-drag-over');
  const droppedId=getDraggedTaskId(e);
  if(!droppedId) return;
  const t = S.tasks.find(x=>x.id===droppedId);
  if(!t) return;
  const ds = dateStr || calSelectedDate || todayStr();
  const restored=unarchiveForDrop(t,ds);

  if(sec==='__habits__'){
    if(!await makeTaskHabit(t,ds,true)){ resetDraggedTask(); return; }
    setCustomSortForContext('daily');
  } else if(sec==='__due__'){
    if(t.isHabit && !await makeHabitSingleTask(t,ds,'Study',true)){ resetDraggedTask(); return; }
    moveTaskDueDate(t,ds,draggedTaskDate);
    showToast(`Due date set to ${fmtDate(ds)}`);
  } else {
    if(t.isHabit && !await makeHabitSingleTask(t,ds,sec,true)){ resetDraggedTask(); return; }
    // Move to this subsection and schedule for date
    t.dailySection = sec;
    moveTaskWorkDate(t,ds,draggedTaskSection==='bank' || draggedTaskSection==='archive' ? '' : draggedTaskDate);
    if(sec==='must') t.priority='MUST';
    showToast(restored ? `Restored "${t.title}" to ${sectionLabel(sec)}` : `Moved to "${sectionLabel(sec)}"`);
  }
  save(); render();
  resetDraggedTask();
}

function learnFromManualCorrection(t){
  if(!t.nlpSource || !t.nlpParsedSnapshot) return false;
  let learned=false;
  const fields=['priority','due','type','isHabit','scheduledTime','dailySection','calendarSignal'];
  fields.forEach(field=>{
    const before=t.nlpParsedSnapshot[field];
    const after=t[field];
    if(JSON.stringify(before)!==JSON.stringify(after)){
      const key=t.nlpSource.toLowerCase().slice(0,80)+'_'+field;
      S.nlpCorrections[key]={field, original:before, corrected:after, source:t.nlpSource, updatedAt:Date.now()};
      learned=true;
    }
  });
  return learned;
}

function selectPri(p, btn){
  editSelectedPri=p;
  document.querySelectorAll('.pri-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  else {
    const b = document.querySelector(`.pri-btn[data-p="${p}"]`);
    if(b) b.classList.add('active');
  }
}

function toggleDay(d, btn){
  if(editSelectedDays.includes(d)) editSelectedDays=editSelectedDays.filter(x=>x!==d);
  else editSelectedDays.push(d);
  btn.classList.toggle('active', editSelectedDays.includes(d));
}

function toggleHabitFields(){
  const v = document.getElementById('fIsHabit').checked;
  document.getElementById('habitFields').style.display = v?'block':'none';
}

// ════════════════════════════════════════════════════════════
//  NLP QUICK-ADD
// ════════════════════════════════════════════════════════════
function parseNLPInput(){
  const raw = document.getElementById('nlpInput').value.trim();
  if(!raw) return;
  nlpParsed = parseNLP(raw);
  showNLPPreview(nlpParsed);
}

function parseNLP(text){
  const result = {
    title: text,
    subject: '',
    type: 'task',
    priority: 'medium',
    due: '',
    scheduledTime: '',
    isHabit: false,
    scheduledDays: [],
    dailySection: 'Study',
    calendarSignal: 'auto',
    source: text
  };
  const lo = text.toLowerCase();
  const dayMap={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
  const shortDayMap={sun:0,mon:1,tue:2,tues:2,wed:3,thu:4,thur:4,thurs:4,fri:5,sat:6};
  const uniqueDays=[...new Set([...lo.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/g)]
    .map(m=>dayMap[m[1]] ?? shortDayMap[m[1]])).values()].filter(Number.isInteger);
  const hasMustNegation=/\b(not\s+a\s+must|not\s+must|not\s+must-do|not\s+a\s+must\s+do|isn'?t\s+a\s+must|isn'?t\s+must)\b/.test(lo);

  // Priority
  if(!hasMustNegation && /\bmust\b|\bcrucial\b|\burgent\b/.test(lo)) result.priority='MUST';
  else if(/\bhigh priority\b|\basap\b|\bimportant\b/.test(lo)) result.priority='high';
  else if(/\bmedium priority\b|\bmed priority\b/.test(lo)) result.priority='medium';
  else if(/\blow priority\b|\bwhenever\b/.test(lo)) result.priority='low';

  // Type
  if(/\bexam\b|\btest\b|\bquiz\b/.test(lo)) result.type='exam';
  else if(/\bhomework\b|\bhw\b|\bassignment\b/.test(lo)) result.type='assignment';
  else if(/\bproject\b/.test(lo)) result.type='project';
  else if(/\bread\b|\breading\b/.test(lo)) result.type='reading';
  else if(/\bchapter\b|\bchapters\b|\bch\.?\b/.test(lo)) result.type='reading';
  if(result.type==='exam') result.calendarSignal='exam';

  // Habit
  if(/\bhabit\b|\bdaily\b|\bevery day\b|\bweekdays\b|\bweekends\b|\brecurring\b|\broutine\b/.test(lo)){
    result.isHabit=true;
    if(uniqueDays.length) result.scheduledDays=uniqueDays;
    else if(/\bweekdays\b/.test(lo)) result.scheduledDays=[1,2,3,4,5];
    else if(/\bweekends\b/.test(lo)) result.scheduledDays=[0,6];
    else result.scheduledDays=[0,1,2,3,4,5,6];
  }

  // Time
  const timeM = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if(timeM){
    let h=parseInt(timeM[1]), m=parseInt(timeM[2]||0);
    const ap=(timeM[3]||'').toLowerCase();
    if(ap==='pm'&&h!==12) h+=12;
    if(ap==='am'&&h===12) h=0;
    result.scheduledTime = pad(h)+':'+pad(m);
  }

  // Subject (course code pattern)
  const courseM = text.match(/\b([A-Z]{2,6})\s*(\d{3}[A-Z]?)\b/);
  if(courseM) result.subject = courseM[1]+' '+courseM[2];

  // Date via compromise
  try{
    const today = new Date();
    if(/\btoday\b/.test(lo)){ result.due = todayStr(); }
    else if(/\btomorrow\b/.test(lo)){
      const t=new Date(today); t.setDate(t.getDate()+1);
      result.due = localISO(t);
    } else if(/\bnext week\b/.test(lo)){
      const t=new Date(today); t.setDate(t.getDate()+7);
      result.due = localISO(t);
    }

    const monthDay=text.match(/\b(?:due|by|on)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
    if(monthDay){
      const months={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
      const cand=new Date(today.getFullYear(),months[monthDay[1].toLowerCase()],+monthDay[2]);
      if(cand < new Date(today.getFullYear(),today.getMonth(),today.getDate())) cand.setFullYear(cand.getFullYear()+1);
      result.due=localISO(cand);
    }
    const bareDue=text.match(/\b(?:due|by|on)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/i);
    if(!result.due && bareDue){
      const cand=new Date(today.getFullYear(),today.getMonth(),+bareDue[1]);
      if(cand < new Date(today.getFullYear(),today.getMonth(),today.getDate())) cand.setMonth(cand.getMonth()+1);
      result.due=localISO(cand);
    }

    if(!result.isHabit && uniqueDays.length && !result.due){
      const target=uniqueDays[0], cur=today.getDay();
      let diff=target-cur; if(diff<=0) diff+=7;
      const t=new Date(today); t.setDate(t.getDate()+diff);
      result.due=localISO(t);
    }

    if(!result.due && typeof nlp==='function'){
      const doc = nlp(text);
      const dates = doc.dates().json();
      if(dates.length){
        const parsed = new Date(dates[0].text);
        if(!isNaN(parsed)) result.due = localISO(parsed);
      }
    }
  }catch(e){}

  // Apply learned corrections
  Object.values(S.nlpCorrections||{}).forEach(rule=>{
    const original=String(rule?.original ?? '').toLowerCase();
    const relatedSource=rule?.source ? titleSimilarity(text, rule.source) >= .55 : false;
    if(rule?.field in result && ((original && lo.includes(original)) || relatedSource)){
      result[rule.field]=rule.corrected;
    }
  });

  // Clean title: rewrite the intent into a task-like phrase instead of keeping the raw sentence.
  const called=text.match(/\bcalled\s+(.+?)(?:\s+(?:due|by|on|with|as|priority)\b|$)/i);
  const intentM=text.match(/\b(?:i\s+)?(?:have\s+to|need\s+to|want\s+to|should|gotta|must)?\s*(finish|complete|do|read|study|review|write|submit|work on)\s+(.+)$/i);
  let titleSource=called ? called[1] : (intentM ? intentM[2] : text);
  titleSource=titleSource
    .replace(/\([^)]*\bnot\s+[^)]*must[^)]*\)/gi,'')
    .replace(/\b(insert|add|create|make|new|task|todo|to-do|please|can you|must|habit|daily|weekdays|weekends|recurring|routine|urgent|important|high priority|medium priority|med priority|low priority|asap)\b/gi,'')
    .replace(/\b(?:due|by|on|for)\s+(?:the\s+)?(?:\d{1,2}(?:st|nd|rd|th)?|today|tomorrow|next week|sunday|monday|tuesday|wednesday|thursday|friday|saturday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:st|nd|rd|th)?)?/gi,'')
    .replace(/\b(today|tomorrow|next week)\b/gi,'')
    .replace(result.isHabit ? /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|and)\b/gi : /$a/g,'')
    .replace(/\b(information|info|class|course)\b/gi,'')
    .replace(timeM?timeM[0]:'__NONE__','')
    .replace(/\bwith\b/gi,'')
    .replace(/\s{2,}/g,' ').trim();
  const intent= intentM ? intentM[1].toLowerCase() : '';
  if(courseM && result.subject && !new RegExp('\\b'+result.subject.replace(/\s+/,'\\s*')+'\\b','i').test(titleSource)){
    titleSource = result.subject+' '+titleSource;
  }
  result.title = titleSource || text;
  if(intent && !/^(finish|complete|do|read|study|review|write|submit|work on)\b/i.test(result.title) && !result.subject){
    result.title = intent.charAt(0).toUpperCase()+intent.slice(1)+' '+result.title;
  }
  result.title = result.title.replace(/\s{2,}/g,' ').trim();

  return result;
}

function localISO(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }

function showNLPPreview(r){
  const fields = document.getElementById('nlpFields');
  fields.innerHTML = `
    <span class="nlp-field"><strong>${esc(r.title)}</strong></span>
    ${r.priority?`<span class="nlp-field">Priority: <strong>${r.priority}</strong></span>`:''}
    ${r.due?`<span class="nlp-field">Due: <strong>${fmtDate(r.due)}</strong></span>`:''}
    ${r.subject?`<span class="nlp-field">Subject: <strong>${esc(r.subject)}</strong></span>`:''}
    ${r.type!=='task'?`<span class="nlp-field">Type: <strong>${r.type}</strong></span>`:''}
    ${r.scheduledTime?`<span class="nlp-field">Time: <strong>${r.scheduledTime}</strong></span>`:''}
    ${r.isHabit?`<span class="nlp-field">Habit: <strong>${(r.scheduledDays||[]).map(d=>DAY_NAMES[d]).join(', ')||'Daily'}</strong></span>`:''}
    <span class="nlp-field nlp-help">Wrong? Fix & teach it.</span>
  `;
  document.getElementById('nlpPreview').classList.add('show');
}

function confirmNLP(){
  if(!nlpParsed) return;
  const t={
    id:uid(), createdAt:Date.now(), archived:false, completed:false,
    completedAt:null, completedDate:'', progress:0, subtasks:[], focusPoints:0,
    title:nlpParsed.title, subject:nlpParsed.subject, type:nlpParsed.type,
    priority:nlpParsed.priority, due:nlpParsed.due,
    scheduledTime:nlpParsed.scheduledTime, isHabit:nlpParsed.isHabit,
    scheduledDays:nlpParsed.scheduledDays, scheduledDates:[],
    dueCompletedDates:{}, customOrder:Date.now(),
    dailySection:nlpParsed.dailySection||'Study',
    calendarSignal:nlpParsed.calendarSignal||'auto',
    completedDates:{}, notes:'', nlpSource:nlpParsed.source||'', nlpParsedSnapshot:Object.assign({},nlpParsed)
  };
  if(!t.scheduledDates.length && !t.isHabit && !t.due) t.scheduledDates.push(todayStr());
  S.tasks.push(t);
  save(); render();
  dismissNLP();
  showToast(`Added "${t.title}"`, 'Fix & Teach', ()=>editTask(t.id));
}

function editNLP(){
  if(!nlpParsed) return;
  nlpEditDraft=Object.assign({}, nlpParsed);
  // Populate form with parsed data
  document.getElementById('editId').value = '';
  document.getElementById('mAddTitle').textContent = 'Fix Quick Add';
  document.getElementById('fTitle').value = nlpParsed.title;
  document.getElementById('fSubject').value = nlpParsed.subject||'';
  document.getElementById('fType').value = nlpParsed.type||'task';
  document.getElementById('fDue').value = nlpParsed.due||'';
  refreshDailySectionOptions(nlpParsed.dailySection||'Study');
  document.getElementById('fCalendarSignal').value = nlpParsed.calendarSignal||'auto';
  document.getElementById('fIsHabit').checked = !!nlpParsed.isHabit;
  editSelectedDays = [...(nlpParsed.scheduledDays||[])];
  editScheduledDates = [];
  renderScheduledDateChips();
  selectPri(nlpParsed.priority||'medium', null);
  toggleHabitFields();
  document.querySelectorAll('.day-btn').forEach(b=>{
    b.classList.toggle('active', editSelectedDays.includes(+b.dataset.d));
  });
  dismissNLP();
  openModal('mAddTask');
}

function dismissNLP(){
  document.getElementById('nlpPreview').classList.remove('show');
  document.getElementById('nlpInput').value='';
  nlpParsed=null;
}

// ════════════════════════════════════════════════════════════
//  POMODORO
// ════════════════════════════════════════════════════════════
const POMO_PRESETS={
  personal:{focus:25,short:5,long:15,cycles:4,name:'Personalized'},
  classic:{focus:25,short:5,long:15,cycles:4,name:'Classic 25/5'},
  flowdoro:{focus:50,short:10,long:20,cycles:3,name:'Flowdoro 50/10'},
  rule5217:{focus:52,short:17,long:34,cycles:3,name:'52/17 Rule'}
};

function getPersonalTimer(){
  // Use calibration session if available and user prefers it
  if(S.settings.useCalibration && S.settings.calibrationSession){
    const c=S.settings.calibrationSession;
    return {
      focus:Math.max(10,c.focusMin||25),
      short:Math.max(3, c.breakMin||5),
      long: Math.max(10,(c.breakMin||5)*2),
      cycles:c.cycles||4,
      name:'Calibrated Timer'
    };
  }
  const reports=(S.focusReports||[]);
  if(reports.length<2) return {focus:25,short:5,long:15,cycles:4,name:'Personal Timer'};
  // EMA with alpha=0.35 — more weight to recent sessions
  const alpha=0.35;
  let emaFocus=reports[0].actualFocusSec/60||25;
  let emaBreak=reports[0].actualBreakSec/60||5;
  let emaCycles=reports[0].cyclesCompleted||1;
  for(let i=1;i<reports.length;i++){
    const r=reports[i];
    emaFocus=alpha*(r.actualFocusSec/60||25)+(1-alpha)*emaFocus;
    emaBreak=alpha*(r.actualBreakSec/60||5)+(1-alpha)*emaBreak;
    emaCycles=alpha*(r.cyclesCompleted||1)+(1-alpha)*emaCycles;
  }
  // Distraction penalty: reduce focus time if avg distractions > 1/session
  const recentR=reports.slice(-10);
  const avgDistr=recentR.reduce((s,r)=>s+(r.distractions||0),0)/Math.max(1,recentR.length);
  const distrFactor=Math.max(0.6,1-avgDistr*0.08);
  // Early break penalty
  const earlyRatio=recentR.filter(r=>r.actualFocusSec<(r.plannedFocusSec||1)*0.85).length/Math.max(1,recentR.length);
  const earlyFactor=Math.max(0.7,1-earlyRatio*0.3);
  const focusMin=Math.max(10,Math.min(90,Math.round(emaFocus*distrFactor*earlyFactor)));
  const breakMin=Math.max(3, Math.min(30,Math.round(emaBreak)));
  const cycles=Math.max(1, Math.min(8, Math.round(emaCycles)));
  return {focus:focusMin,short:breakMin,long:breakMin*2,cycles,name:`Personal ${focusMin}/${breakMin}`};
}

function runCalibrationSession(){
  S.settings.calibrationMode=true;
  if(!S.settings.activeStart) S.settings.activeStart=Date.now();
  save();
  document.getElementById('mCalibration')?.classList.remove('show');
  showPage('focus');
  const pr=getPomoConfig();
  currentPomoTask = currentPomoTask || null;
  pomoState={
    running:true,
    phase:'calibrationFocus',
    elapsed:0,
    cycles:0,
    targetCycles:1,
    sessionStart:Date.now(),
    lastTickAt:Date.now(),
    sessionId:uid(),
    plannedFocus:0,
    plannedBreak:0,
    extendedElapsed:0,
    breakElapsed:0
  };
  pendingFocusReport=null;
  sessionTaskSnapshot={};
  sessionDistractionLog=[];
  S.tasks.forEach(t=>{ sessionTaskSnapshot[t.id]=isTaskDone(t,todayStr()); });
  clearInterval(pomoTimer);
  pomoTimer=setInterval(tickPomo,1000);
  savePomoRuntime();
  updateCycleDisplay();
  updateHUDDisplay(0, pr.focus*60);
  document.getElementById('hudPlay').textContent='⏸';
  document.getElementById('hudPlay').classList.add('active');
  toggleFocusFull(true);
  showToast('Calibration stopwatch started. Study until fatigue feels near 70%, then press Break now.');
}

function getPomoConfig(){
  const base=S.settings.pomo.presetMode==='personal' ? getPersonalTimer() : (POMO_PRESETS[S.settings.pomo.presetMode]||POMO_PRESETS.classic);
  return {
    focus:Number(S.settings.pomo.focus)||base.focus,
    short:Number(S.settings.pomo.shortBreak)||base.short,
    long:Number(S.settings.pomo.longBreak)||base.long,
    cycles:Number(S.settings.pomo.cycles)||base.cycles,
    name:base.name
  };
}
function pomoPhaseTotal(){
  const pr=getPomoConfig();
  if(pomoState.phase==='break' || pomoState.phase==='breakOver') return (pomoState.plannedBreak||pr.short*60);
  if(pomoState.phase==='calibrationFocus' || pomoState.phase==='calibrationBreak') return 0;
  return (pomoState.plannedFocus||pr.focus*60);
}
function savePomoRuntime(){
  try{
    const hasRuntime=pomoState.running || pomoState.sessionStart || pendingFocusReport;
    if(!hasRuntime){
      localStorage.removeItem(POMO_RUNTIME_KEY);
      return;
    }
    localStorage.setItem(POMO_RUNTIME_KEY, JSON.stringify({
      storageKey:currentStorageKey(),
      savedAt:Date.now(),
      taskId:currentPomoTask?.id||'',
      pomoState,
      pendingFocusReport,
      sessionTaskSnapshot,
      sessionDistractionLog
    }));
  }catch(e){}
}
function syncPomoClock(){
  if(!pomoState.running) return;
  const now=Date.now();
  const last=Number(pomoState.lastTickAt || now);
  const delta=Math.max(0, Math.floor((now-last)/1000));
  if(!delta) return;
  pomoState.lastTickAt=last + delta*1000;
  const ph=pomoState.phase;
  if(ph==='calibrationFocus' || ph==='calibrationBreak'){
    pomoState.elapsed=(pomoState.elapsed||0)+delta;
    return;
  }
  if(ph==='focusOver' || ph==='breakOver'){
    pomoState.extendedElapsed=(pomoState.extendedElapsed||0)+delta;
    return;
  }
  const total=pomoPhaseTotal();
  pomoState.elapsed=(pomoState.elapsed||0)+delta;
  if(total && pomoState.elapsed>=total){
    const over=pomoState.elapsed-total;
    pomoState.elapsed=total;
    pomoState.extendedElapsed=over;
    pomoState.phase=ph==='break' ? 'breakOver' : 'focusOver';
  }
}
function restorePomoRuntime(){
  try{
    const raw=JSON.parse(localStorage.getItem(POMO_RUNTIME_KEY)||'null');
    if(!raw || raw.storageKey!==currentStorageKey()) return;
    if(raw.savedAt && Date.now()-raw.savedAt>1000*60*60*36){
      localStorage.removeItem(POMO_RUNTIME_KEY);
      return;
    }
    pomoState=Object.assign({},pomoState,raw.pomoState||{});
    pendingFocusReport=raw.pendingFocusReport||null;
    sessionTaskSnapshot=raw.sessionTaskSnapshot||{};
    sessionDistractionLog=Array.isArray(raw.sessionDistractionLog) ? raw.sessionDistractionLog : [];
    currentPomoTask=raw.taskId ? S.tasks.find(t=>t.id===raw.taskId)||null : null;
    if(pomoState.running){
      pomoState.lastTickAt=raw.savedAt||pomoState.lastTickAt||Date.now();
      syncPomoClock();
      clearInterval(pomoTimer);
      pomoTimer=setInterval(tickPomo,1000);
    }
  }catch(e){}
}
function clearPomoRuntime(){
  try{ localStorage.removeItem(POMO_RUNTIME_KEY); }catch(e){}
}

function setPomoPreset(p){
  S.settings.pomo.presetMode=p;
  const pr=p==='personal'?getPersonalTimer():POMO_PRESETS[p];
  S.settings.pomo.focus=pr.focus; S.settings.pomo.shortBreak=pr.short; S.settings.pomo.longBreak=pr.long; S.settings.pomo.cycles=pr.cycles;
  document.querySelectorAll('.pomo-preset-btn').forEach(b=>b.classList.toggle('active',b.dataset.preset===p));
  document.querySelectorAll('.pomo-preset-card').forEach(b=>b.classList.toggle('active',b.dataset.preset===p));
  // Update description below buttons
  const descs = {
    classic:  '25 minutes of focused work, then 5 off. Good for starting when resistance is high.',
    flowdoro: '50 minutes of deep work, then 10 off. Good for readings, labs, and problem sets.',
    rule5217: '52 minutes on, 17 off. Use when the task is clear and you can stay with it.',
    personal: 'Calibrated to your last 5 sessions. Adapts to how you actually work.'
  };
  const descEl = document.getElementById('pomoDesc');
  if(descEl){
    const label = descEl.querySelector('.pomo-desc-label');
    descEl.textContent = descs[p] || descs.classic;
    if(label){ descEl.prepend(label); } else {
      const lbl = document.createElement('span');
      lbl.className = 'pomo-desc-label';
      lbl.textContent = 'Timer mode';
      descEl.prepend(lbl);
    }
  }
  resetPomo(); save();
  updatePersonalTimerUI();
  renderBreakDisplay(); // sync adjuster display to new preset
}

function updatePersonalTimerUI(){
  const pr=getPersonalTimer();
  const label=document.getElementById('personalPresetLabel');
  if(label) label.textContent=`${pr.focus} / ${pr.short}`;
  const advice=document.getElementById('timerAdvice');
  if(advice){
    const src=S.settings.useCalibration&&S.settings.calibrationSession?'calibrated baseline':'general trend';
    advice.textContent=`Personal timer (${src}): ${pr.focus} min focus, ${pr.short} min break, ${pr.cycles} cycles.`;
  }
  renderBreakDisplay();
}

function openCalibrationModal(){
  const modal=document.getElementById('mCalibration');
  if(!modal) return;
  const check=document.getElementById('useCalibCheck');
  if(check) check.checked=!!S.settings.useCalibration;
  const status=document.getElementById('calibStatus');
  if(status){
    if(S.settings.calibrationSession){
      const c=S.settings.calibrationSession;
      const d=new Date(c.ts||0).toLocaleDateString();
      status.textContent=`Last calibrated ${d}: ${c.focusMin} min focus / ${c.breakMin} min break / ${c.cycles} cycles`;
    } else {
      status.textContent='No calibration data yet — run one stopwatch calibration first.';
    }
  }
  modal.classList.add('show');
}

function startPomoTask(id){
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  currentPomoTask=t;
  document.getElementById('hudTask').textContent=t.title;
  updatePomoGoalBanner();
  toggleHudFocusPanel(false);
  renderHudTaskPicker();
  resetPomo();
  setTimeout(togglePomo, 100);
}

function selectPomoTask(id){
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  currentPomoTask=t;
  document.getElementById('hudTask').textContent=t.title;
  renderHudTaskPicker();
  resetPomo();
}

function toggleHudFocusPanel(force){
  const panel=document.getElementById('hudFocusPanel');
  if(!panel) return;
  const show=typeof force==='boolean' ? force : !panel.classList.contains('show');
  panel.classList.toggle('show', show);
  if(show) renderHudTaskPicker();
}

function renderHudTaskPicker(){
  const wrap=document.getElementById('hudTaskPicker');
  if(!wrap) return;
  const today=calSelectedDate || todayStr();
  const todays=sortTasks(getTasksForDate(today).filter(t=>!isTaskDone(t,today)),'custom');
  const bank=sortTasks(S.tasks.filter(t=>!t.archived && !t.completed && !todays.some(x=>x.id===t.id)),'custom').slice(0,8);
  const tasks=[...todays, ...bank].slice(0,14);
  if(!tasks.length){
    wrap.innerHTML='<div class="empty" style="padding:14px;text-align:left">No open tasks. Add or schedule a task to focus.</div>';
    return;
  }
  wrap.innerHTML=tasks.map(t=>`
    <button class="hud-task-option ${currentPomoTask?.id===t.id?'active':''}" onclick="selectPomoTask('${t.id}')">
      <span><strong>${esc(t.title)}</strong><span>${t.subject?esc(t.subject)+' · ':''}${t.due?'Due '+fmtDate(t.due):'Task bank'}</span></span>
      <em>${currentPomoTask?.id===t.id?'Selected':'Pick'}</em>
    </button>`).join('');
}

function saveFocusGoal(value){
  S.settings.focusGoal=value;
  save();
}

function renderFocusGoal(){
  const box=document.getElementById('focusGoal');
  if(box && box.value!==String(S.settings.focusGoal||'')) box.value=S.settings.focusGoal||'';
  renderBreakDisplay();
  updatePomoGoalBanner();
}

function setSessionBreakLength(value){
  S.settings.pomo.shortBreak=Math.max(1,Math.min(60,Number(value)||5));
  renderBreakDisplay();
  save();
  updatePersonalTimerUI();
}







function logDistraction(){
  const goal = S.settings.focusGoal || currentPomoTask?.title || 'your goal';
  const ts = Date.now();
  const elapsed = pomoState.elapsed || 0;
  // Store in session log
  S.sessions.push({ id:uid(), date:todayStr(), type:'distraction', ts, taskId:currentPomoTask?.id||'' });
  // Store timestamped event for this session
  sessionDistractionLog.push({
    ts,
    elapsed, // seconds into current focus block
    phase: pomoState.phase,
    cycleNum: pomoState.cycles + 1
  });
  save();
  savePomoRuntime();
  showToast(`Noted! Let's get back to "${goal}"…`);
}



function updatePomoGoalBanner(){
  const banner=document.getElementById('pomoGoalBanner');
  const nameEl=document.getElementById('pomoGoalTaskName');
  const taskEl=document.getElementById('pomoPanelTask');
  if(!banner || !nameEl) return;
  if(currentPomoTask){
    banner.style.display='block';
    nameEl.textContent=currentPomoTask.title;
    if(taskEl) taskEl.style.display='none';
  } else {
    banner.style.display='none';
    if(taskEl) taskEl.style.display='block';
  }
  renderFocusToday();
}

function deleteFocusReport(id){
  S.focusReports=(S.focusReports||[]).filter(r=>r.id!==id);
  save(); renderFocusReports(); updatePersonalTimerUI();
}

let focusReportsExpanded = false;

function renderFocusReports(){
  const wrap=document.getElementById('focusReportList');
  if(!wrap) return;
  const all=(S.focusReports||[]).slice().reverse();
  if(!all.length){
    wrap.innerHTML='<div class="empty" style="padding:14px;text-align:left">No focus reports yet. Complete a study cycle to create one.</div>';
    return;
  }
  const visible = focusReportsExpanded ? all : all.slice(0,5);
  const hidden = all.length - 5;
  wrap.innerHTML = visible.map(r=>`
    <div class="focus-report-row report-clickable" onclick="openSessionReport('${r.id}')">
      <div style="min-width:0;flex:1">
        <strong>${esc(r.taskTitle||'Focus session')}</strong>
        <div class="report-meta-row">
          <span>🕐 ${Math.round((r.actualFocusSec||0)/60)}m focus</span>
          <span>☕ ${Math.round((r.actualBreakSec||0)/60)}m break</span>
          <span>⟳ ${r.cyclesCompleted||1} cycle${(r.cyclesCompleted||1)!==1?'s':''}</span>
          ${r.distractions?`<span style="color:var(--orange)">⚡ ${r.distractions}</span>`:''}
          ${(r.completedTasks||[]).length?`<span style="color:var(--green)">✓ ${r.completedTasks.length} done</span>`:''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        <span style="font-size:10px;color:var(--text3)">${fmtDate(r.date)}</span>
        <button class="task-action del" onclick="event.stopPropagation();deleteFocusReport('${r.id}')" title="Delete" style="opacity:1;width:22px;height:22px;font-size:11px">✕</button>
      </div>
    </div>`).join('') +
    (hidden > 0 && !focusReportsExpanded
      ? `<button class="report-expand-btn" onclick="focusReportsExpanded=true;renderFocusReports()">Show ${hidden} older report${hidden!==1?'s':''} ▾</button>`
      : all.length > 5
        ? `<button class="report-expand-btn" onclick="focusReportsExpanded=false;renderFocusReports()">Show less ▴</button>`
        : '');
}

async function openSessionReport(id){
  const r = (S.focusReports||[]).find(x=>x.id===id);
  if(!r) return;
  const modal = document.getElementById('mSessionReport');
  if(!modal) return;

  // Fill basic stats
  document.getElementById('srTitle').textContent = r.taskTitle||'Focus session';
  document.getElementById('srDate').textContent = fmtDate(r.date);
  document.getElementById('srTotalFocus').textContent = Math.round((r.actualFocusSec||0)/60) + ' min';
  document.getElementById('srTotalBreak').textContent = Math.round((r.actualBreakSec||0)/60) + ' min';
  document.getElementById('srCycles').textContent = (r.cyclesCompleted||1) + ' cycle' + ((r.cyclesCompleted||1)!==1?'s':'');
  document.getElementById('srDistractions').textContent = (r.distractions||0) + ' distraction' + ((r.distractions||0)!==1?'s':'');

  // Tasks done
  const tasks = r.completedTasks||[];
  document.getElementById('srTasks').innerHTML = tasks.length
    ? tasks.map(t=>`<div class="sess-task-row">✓ ${esc(t)}</div>`).join('')
    : '<div style="color:var(--text3);font-size:11px">No tasks marked done this cycle.</div>';

  // Distraction events timeline
  const events = r.distractionEvents||[];
  document.getElementById('srDistEvents').innerHTML = events.length
    ? events.map(d=>`<div class="sr-event-row">
        <span class="sr-event-dot" style="background:var(--orange)"></span>
        <span>⚡ Distracted at ${Math.floor(d.elapsed/60)}:${String(d.elapsed%60).padStart(2,'0')} into cycle ${d.cycleNum}</span>
      </div>`).join('')
    : '<div style="color:var(--text3);font-size:11px">No distractions logged.</div>';

  // AI summary
  const aiWrap = document.getElementById('srAiSummary');
  aiWrap.innerHTML = '<span style="color:var(--text3);font-size:11px">Analyzing session…</span>';
  modal.classList.add('show');

  try {
    const focusMin = Math.round((r.actualFocusSec||0)/60);
    const breakMin = Math.round((r.actualBreakSec||0)/60);
    const efficiency = r.plannedFocusSec ? Math.round((r.actualFocusSec/r.plannedFocusSec)*100) : 100;
    const prompt = `You are an academic study coach analyzing a Pomodoro study session. Be concise (2-3 sentences), encouraging, and specific. 
Session data:
- Task: ${r.taskTitle||'Free focus session'}
- Focus time: ${focusMin} min (planned: ${Math.round((r.plannedFocusSec||1500)/60)} min)
- Break time: ${breakMin} min
- Cycles completed: ${r.cyclesCompleted||1}
- Distractions logged: ${r.distractions||0}
- Tasks completed: ${(r.completedTasks||[]).join(', ')||'none logged'}
- Efficiency: ${efficiency}%

Write a brief, personal analysis of this study session. Note what went well, flag any concerns (high distractions, very short focus etc), and give one specific suggestion for next session.`;

    const summary = await window.claude.complete(prompt);
    aiWrap.innerHTML = `<p style="font-size:12px;color:var(--text2);line-height:1.65">${esc(summary)}</p>`;
  } catch(e) {
    aiWrap.innerHTML = '<span style="color:var(--text3);font-size:11px">AI summary unavailable.</span>';
  }
}

function toggleFocusFull(force){
  const panel=document.querySelector('.pomo-expanded');
  if(!panel) return;
  const show=typeof force==='boolean'?force:!panel.classList.contains('focus-full');
  panel.classList.toggle('focus-full', show);
  // Move session tasks into/out of expanded panel
  const sessionTasks=document.getElementById('focusSessionTasksWrap');
  const insideSlot=document.getElementById('pomoExpandedTaskSlot');
  const outsideSlot=document.getElementById('focusTasksOutside');
  if(sessionTasks && insideSlot && outsideSlot){
    if(show){
      insideSlot.appendChild(sessionTasks);
    } else {
      outsideSlot.appendChild(sessionTasks);
    }
  }
  // Update expand button label
  const btn=document.getElementById('expandBtn');
  if(btn) btn.textContent=show?'⤡ Collapse':'⤢ Expand';
}

function togglePomo(){
  if(pomoState.phase==='focusOver'){ startBreakPhase(); return; }
  if(pomoState.phase==='breakOver'){ startNextFocusPhase(); return; }
  if(!currentPomoTask){
    document.getElementById('hudTask').textContent = 'Free Focus Session';
  }
  pomoState.running=!pomoState.running;
  document.getElementById('hudPlay').textContent=pomoState.running?'⏸':'▶';
  document.getElementById('hudPlay').classList.toggle('active',pomoState.running);
  if(pomoState.running){
    if(!S.settings.activeStart) { S.settings.activeStart=Date.now(); save(); }
    if(!pomoState.sessionStart) {
      const pr=getPomoConfig();
      pomoState.sessionStart=Date.now();
      pomoState.sessionId=pomoState.sessionId||uid();
      pomoState.plannedFocus=pr.focus*60;
      pomoState.plannedBreak=pr.short*60;
      pomoState.targetCycles=pr.cycles||4;
      // Snapshot task completion state at session start
      S.tasks.forEach(t=>{ sessionTaskSnapshot[t.id]=isTaskDone(t,todayStr()); });
      updateCycleDisplay();
    }
    pomoState.lastTickAt=Date.now();
    if(currentPage==='focus') toggleFocusFull(true);
    clearInterval(pomoTimer);
    pomoTimer=setInterval(tickPomo,1000);
  } else {
    syncPomoClock();
    pomoState.lastTickAt=null;
    clearInterval(pomoTimer);
  }
  savePomoRuntime();
}



function tickPomo(){
  const before=pomoState.phase;
  syncPomoClock();
  const total=pomoPhaseTotal() || getPomoConfig().focus*60;
  if(before!==pomoState.phase && (pomoState.phase==='focusOver' || pomoState.phase==='breakOver')){
    playAlarm();
    if(pomoState.phase==='focusOver'){
      showToast('Focus time is done. Extended focus is now tracking until you start break.', 'Start break', startBreakPhase);
    } else {
      showToast('Break time is done. Extended break is tracking until you return to study.', 'Study now', startNextFocusPhase);
    }
  }
  if(pomoState.phase==='calibrationFocus' || pomoState.phase==='calibrationBreak'){
    updateHUDDisplay(-pomoState.elapsed, total);
  } else if(pomoState.phase==='focusOver' || pomoState.phase==='breakOver'){
    updateHUDDisplay(-pomoState.extendedElapsed, total);
  } else {
    updateHUDDisplay(total-pomoState.elapsed, total);
  }
  savePomoRuntime();
}

function endPomoPhase(){
  clearInterval(pomoTimer); pomoState.running=true;
  syncPomoClock();
  playAlarm();
  const pr=getPomoConfig();
  if(pomoState.phase==='focus'){
    pomoState.phase='focusOver';
    pomoState.extendedElapsed=0;
    showToast('Focus time is done. Extended focus is now tracking until you start break.', 'Start break', startBreakPhase);
  } else {
    pomoState.phase='breakOver';
    pomoState.extendedElapsed=0;
    showToast('Break time is done. Extended break is tracking until you return to study.', 'Study now', startNextFocusPhase);
  }
  pomoState.lastTickAt=Date.now();
  pomoTimer=setInterval(tickPomo,1000);
  updateHUDDisplay(0, pr.focus*60);
  savePomoRuntime();
}

function resetPomo(){
  clearInterval(pomoTimer);
  const pr=getPomoConfig();
  pomoState={running:false,phase:'focus',elapsed:0,cycles:0,targetCycles:pr.cycles||4,sessionStart:null,lastTickAt:null,sessionId:uid(),plannedFocus:pr.focus*60,plannedBreak:pr.short*60,extendedElapsed:0,breakElapsed:0};
  pendingFocusReport=null;
  sessionTaskSnapshot={};
  sessionDistractionLog=[];
  clearPomoRuntime();
  updateHUDDisplay(pr.focus*60, pr.focus*60);
  document.getElementById('hudPlay').textContent='▶';
  document.getElementById('hudPlay').classList.remove('active');
  updateCycleDisplay();
}

function skipPomo(){
  if(pomoState.phase==='focus' || pomoState.phase==='focusOver') goBreakNow();
  else if(pomoState.phase==='calibrationFocus') goBreakNow();
  else startNextFocusPhase();
}

async function goBreakNow(){
  if(!(pomoState.phase==='focus' || pomoState.phase==='focusOver' || pomoState.phase==='calibrationFocus')) return;
  if(!await designConfirm('Go into break now?', 'This stops the current study block and starts break tracking.', 'Start break', 'Keep studying')) return;
  startBreakPhase();
}

function startBreakPhase(){
  clearInterval(pomoTimer);
  syncPomoClock();
  const pr=getPomoConfig();
  const actualFocusSec=(pomoState.phase==='focusOver'?pomoState.plannedFocus+pomoState.extendedElapsed:pomoState.elapsed);

  // Detect tasks completed since session start
  const completedNow=S.tasks.filter(t=>{
    const wasNotDone=!sessionTaskSnapshot[t.id];
    const isDoneNow=isTaskDone(t,todayStr());
    return wasNotDone && isDoneNow;
  }).map(t=>t.title);

  const isCalibration=S.settings.calibrationMode || pomoState.phase==='calibrationFocus';
  pendingFocusReport={
    id:uid(), date:todayStr(),
    sessionId:pomoState.sessionId||uid(),
    taskId:currentPomoTask?.id||'', taskTitle:currentPomoTask?.title||'Free Focus',
    goal:S.settings.focusGoal||'',
    completedTasks:completedNow,
    goalMet:completedNow.length>0||!!S.settings.focusGoal,
    plannedFocusSec:pomoState.plannedFocus||pr.focus*60, actualFocusSec,
    plannedBreakSec:isCalibration?0:pr.short*60, actualBreakSec:0,
    distractions:sessionDistractionLog.filter(d=>d.cycleNum===pomoState.cycles+1).length,
    distractionEvents:[...sessionDistractionLog.filter(d=>d.cycleNum===pomoState.cycles+1)],
    startTs:pomoState.sessionStart||Date.now(),
    cyclesCompleted:pomoState.cycles+1
  };
  S.sessions.push({id:uid(),taskId:currentPomoTask?.id,date:todayStr(),type:'focus',dur:Math.round(actualFocusSec/60),completed:true,ts:Date.now()});
  if(currentPomoTask) currentPomoTask.focusPoints=(currentPomoTask.focusPoints||0)+Math.round(actualFocusSec/60);
  pomoState.phase=isCalibration?'calibrationBreak':'break';
  pomoState.elapsed=0; pomoState.extendedElapsed=0; pomoState.running=true; pomoState.lastTickAt=Date.now(); pomoState.plannedBreak=isCalibration?0:pr.short*60;
  save(); renderFocusReports(); updateEOPR();
  updateCycleDisplay();
  pomoTimer=setInterval(tickPomo,1000);
  updateHUDDisplay(isCalibration?0:pr.short*60, pr.short*60);
  savePomoRuntime();
  if(isCalibration) showToast('Break stopwatch started. Return when you feel recovered near 30%, then press Study Now.');
}

function startNextFocusPhase(){
  clearInterval(pomoTimer);
  syncPomoClock();
  const actualBreakSec=(pomoState.phase==='breakOver'?pomoState.plannedBreak+pomoState.extendedElapsed:pomoState.elapsed);
  if(pendingFocusReport){
    pendingFocusReport.actualBreakSec=actualBreakSec;
    pendingFocusReport.endTs=Date.now();
    S.focusReports=(S.focusReports||[]).concat(pendingFocusReport).slice(-120);
    pendingFocusReport=null;
  }
  if(S.settings.calibrationMode){
    const last=(S.focusReports||[])[(S.focusReports||[]).length-1];
    if(last){
      S.settings.calibrationSession={
        focusMin:Math.max(5,Math.round((last.actualFocusSec||0)/60)),
        breakMin:Math.max(1,Math.round((last.actualBreakSec||0)/60)),
        cycles:1,
        ts:Date.now()
      };
      S.settings.useCalibration=true;
      S.settings.calibrationMode=false;
      save(); renderFocusReports(); updatePersonalTimerUI();
      showToast('Calibration saved. Personal timer now uses this stopwatch baseline.');
      resetPomo();
      return;
    }
    S.settings.calibrationMode=false;
  }
  const pr=getPomoConfig();
  const newCycles=pomoState.cycles+1;
  // Auto end-session if target cycles reached
  if(newCycles>=pomoState.targetCycles){
    save();
    endSession(true);
    return;
  }
  pomoState={running:false,phase:'focus',elapsed:0,cycles:newCycles,targetCycles:pomoState.targetCycles,sessionStart:pomoState.sessionStart,lastTickAt:null,sessionId:pomoState.sessionId,plannedFocus:pr.focus*60,plannedBreak:pr.short*60,extendedElapsed:0,breakElapsed:0};
  save(); renderFocusReports(); updatePersonalTimerUI();
  updateCycleDisplay();
  updateHUDDisplay(pr.focus*60, pr.focus*60);
  document.getElementById('hudPlay').textContent='▶';
  document.getElementById('hudPlay').classList.remove('active');
  savePomoRuntime();
}

function endSession(auto){
  clearInterval(pomoTimer);
  syncPomoClock();
  if(pendingFocusReport){
    if(pomoState.phase==='break' || pomoState.phase==='calibrationBreak') pendingFocusReport.actualBreakSec=pomoState.elapsed;
    if(pomoState.phase==='breakOver') pendingFocusReport.actualBreakSec=(pomoState.plannedBreak||0)+pomoState.extendedElapsed;
    pendingFocusReport.endTs=Date.now();
    S.focusReports=(S.focusReports||[]).concat(pendingFocusReport).slice(-120);
    pendingFocusReport=null;
  }
  // Save calibration data if in calibration mode
  if(S.settings.calibrationMode){
    const recentReports=(S.focusReports||[]).slice(-3);
    if(recentReports.length){
      const avgF=recentReports.reduce((s,r)=>s+(r.actualFocusSec||0),0)/recentReports.length;
      const avgB=recentReports.reduce((s,r)=>s+(r.actualBreakSec||0),0)/recentReports.length;
      const avgC=recentReports.reduce((s,r)=>s+(r.cyclesCompleted||1),0)/recentReports.length;
      S.settings.calibrationSession={
        focusMin:Math.max(5,Math.round(avgF/60)),
        breakMin:Math.max(1,Math.round(avgB/60)),
        cycles:Math.max(1,Math.round(avgC)),
        ts:Date.now()
      };
      S.settings.useCalibration=true;
      showToast('Calibration saved! Personal timer now uses your baseline.');
    }
    S.settings.calibrationMode=false;
  }
  // Final snapshot of tasks completed
  const completedInSession=S.tasks.filter(t=>{
    return !sessionTaskSnapshot[t.id] && isTaskDone(t,todayStr());
  });
  const totalFocusMins=Math.round((Date.now()-(pomoState.sessionStart||Date.now()))/60000);
  const distractions=S.sessions.filter(s=>s.type==='distraction'&&s.date===todayStr()&&s.ts>=(pomoState.sessionStart||0)).length;

  showSessionSummary({
    cycles:pomoState.cycles, targetCycles:pomoState.targetCycles,
    focusMins:totalFocusMins, completedTasks:completedInSession,
    distractions, auto
  });
  save(); renderFocusReports(); updatePersonalTimerUI();
  resetPomo();
}

function showSessionSummary({cycles,targetCycles,focusMins,completedTasks,distractions,auto}){
  const modal=document.getElementById('mSessionSummary');
  if(!modal){ resetPomo(); return; }
  document.getElementById('sessCycles').textContent=`${cycles} / ${targetCycles} cycles`;
  document.getElementById('sessFocusMins').textContent=`${focusMins} min total`;
  document.getElementById('sessDistractions').textContent=`${distractions} distraction${distractions!==1?'s':''}`;
  const list=document.getElementById('sessTaskList');
  list.innerHTML=completedTasks.length
    ? completedTasks.map(t=>`<div class="sess-task-row">✓ ${esc(t.title)}</div>`).join('')
    : '<div style="color:var(--text3);font-size:12px">No tasks marked done this session.</div>';
  modal.classList.add('show');
}

function updateHUDDisplay(remaining, total){
  const over=remaining<0;
  const shown=Math.abs(remaining);
  const m=Math.floor(shown/60), s=shown%60;
  const ph=pomoState.phase;
  const isCalibration=ph==='calibrationFocus' || ph==='calibrationBreak';
  const prefix=(over && !isCalibration)?'+':'';
  document.getElementById('hudTime').textContent=prefix+pad(m)+':'+pad(s);
  const circ=100.53;
  const pct=over?1:(total?1-(Math.max(0,remaining)/total):1);
  document.getElementById('hudRingFill').style.strokeDashoffset=circ*pct;
  const pr=getPomoConfig();
  const phaseLabel=ph==='focus'?'Focus':ph==='focusOver'?'Extended Focus':ph==='break'?'Break':ph==='calibrationFocus'?'Calibration Focus':ph==='calibrationBreak'?'Calibration Break':'Extended Break';
  document.getElementById('hudMode').textContent=pr.name+' · '+phaseLabel;
  document.getElementById('pomoPanelTask').textContent=currentPomoTask?.title||'No task selected';
  document.getElementById('pomoBigTime').textContent=prefix+pad(m)+':'+pad(s);
  document.getElementById('pomoBigPhase').textContent=phaseLabel;
  const bigCirc=527.79;
  document.getElementById('pomoBigFill').style.strokeDashoffset=bigCirc*pct;
  document.getElementById('pomoPanelPlay').textContent=ph==='focusOver'?'Start Break':ph==='breakOver'?'Study Now':isCalibration?(pomoState.running?'Pause Stopwatch':'Resume Stopwatch'):(pomoState.running?'Pause':'Start');
  document.title=`${pad(m)}:${pad(s)} — ${currentPomoTask?.title||'Focus Engine'}`;
}

function openPomoPanel(){
  showPage('focus');
  const pr=getPomoConfig();
  const total=(pomoState.phase==='focus'?pr.focus:pomoState.phase==='break'?pr.short:pr.focus)*60;
  updateHUDDisplay(total-pomoState.elapsed,total);
}

// ════════════════════════════════════════════════════════════
//  EOPR
// ════════════════════════════════════════════════════════════
function calcEOPR(){
  const today=todayStr();
  const sessions=S.sessions.filter(s=>s.date===today&&s.type==='focus'&&s.completed);
  const totalFP=sessions.reduce((sum,s)=>sum+(s.dur||0),0);
  if(!S.settings.activeStart) return 0;
  const hoursActive=(Date.now()-new Date(S.settings.activeStart))/3600000;
  if(hoursActive<=0) return 0;
  return Math.min(100,Math.round((totalFP/(hoursActive*5))*100));
}
function updateEOPR(){
  const score=calcEOPR();
  document.getElementById('eoprVal').textContent=score+'%';
  const today=todayStr();
  S.eoprLog=(S.eoprLog||[]).filter(x=>x.date!==today).concat({date:today,score,ts:Date.now()}).slice(-31);
  save();
}

// ════════════════════════════════════════════════════════════
//  ICAL IMPORT
// ════════════════════════════════════════════════════════════
function switchIcalTab(mode, btn){
  document.querySelectorAll('.ical-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('icalUrlWrap').classList.toggle('show', mode==='url');
  document.getElementById('icalPasteWrap').classList.toggle('show', mode==='paste');
}

async function fetchIcal(){
  const url=document.getElementById('icalUrl').value.trim();
  if(!url){ showToast('Enter a calendar URL first.'); return; }
  const status=document.getElementById('icalStatus');
  status.textContent='Fetching...';
  const attempts=[
    url,
    'https://api.allorigins.win/raw?url='+encodeURIComponent(url),
    'https://corsproxy.io/?'+encodeURIComponent(url),
    'https://thingproxy.freeboard.io/fetch/'+url
  ];
  try{
    let text='', lastErr=null;
    for(const target of attempts){
      try{
        const resp=await fetch(target);
        if(!resp.ok) throw new Error(resp.status+' '+resp.statusText);
        text=await resp.text();
        if(/BEGIN:VCALENDAR|BEGIN:VEVENT/.test(text)) break;
        throw new Error('Response was not ICS data');
      }catch(err){ lastErr=err; text=''; }
    }
    if(!text) throw lastErr || new Error('Could not fetch calendar');
    const events=parseICS(text);
    const result=importEvents(events);
    status.textContent=`Imported ${result.added} item${result.added===1?'':'s'}${result.skipped?`, skipped ${result.skipped} duplicate${result.skipped===1?'':'s'}`:''}`;
  }catch(e){
    status.textContent='URL import failed: '+e.message+' — paste the ICS text in the Paste Data tab.';
  }
}

function importIcalPaste(){
  const text=document.getElementById('icalPaste').value.trim();
  if(!text){ showToast('Paste ICS data first.'); return; }
  const events=parseICS(text);
  const result=importEvents(events);
  document.getElementById('icalStatus').textContent=`Imported ${result.added} item${result.added===1?'':'s'}${result.skipped?`, skipped ${result.skipped} duplicate${result.skipped===1?'':'s'}`:''}`;
}

function onIcsDragOver(e){
  e.preventDefault();
  document.getElementById('icsDropZone')?.classList.add('drag-over');
}
function onIcsDragLeave(e){
  e.preventDefault();
  document.getElementById('icsDropZone')?.classList.remove('drag-over');
}
function onIcsDrop(e){
  e.preventDefault();
  document.getElementById('icsDropZone')?.classList.remove('drag-over');
  const file=[...(e.dataTransfer?.files||[])].find(f=>/\.ics$/i.test(f.name) || /calendar|ics/i.test(f.type));
  if(!file){
    document.getElementById('icalStatus').textContent='Drop an .ics calendar file.';
    return;
  }
  const reader=new FileReader();
  reader.onload=()=>{
    const events=parseICS(String(reader.result||''));
    const result=importEvents(events);
    document.getElementById('icalStatus').textContent=`Imported ${result.added} item${result.added===1?'':'s'} from ${file.name}${result.skipped?`, skipped ${result.skipped} duplicate${result.skipped===1?'':'s'}`:''}`;
  };
  reader.onerror=()=>{ document.getElementById('icalStatus').textContent='Could not read that ICS file.'; };
  reader.readAsText(file);
}

function importEvents(events){
  let added=0, skipped=0;
  for(const ev of events){
    if(!ev.summary) continue;
    if(ev.uid && (S.events.find(e=>e.icsUid===ev.uid) || S.tasks.find(t=>t.icsUid===ev.uid))){
      skipped++;
      continue;
    }
    const importType=classifyImportedItem(ev);
    const date=ev.due||ev.dtstart||'';
    if(importType.kind==='event'){
      const type=importType.type || 'event';
      const candidate={
        id:uid(), icsUid:ev.uid||uid(), createdAt:Date.now(),
        title:ev.summary, subject:'', type,
        date, time:'', location:ev.location||'', notes:ev.description||'', color:eventColorForType(type)
      };
      if(findPossibleDuplicate(candidate,'event')){ skipped++; continue; }
      S.events.push(candidate);
    }else{
      const candidate={
        id:uid(), icsUid:ev.uid||uid(), createdAt:Date.now(),
        archived:false, completed:false, completedAt:null, completedDates:{},
        title:ev.summary, subject:'', type:'assignment',
        priority:'medium', due:date, scheduledDates:[],
        scheduledDays:[], scheduledTime:'', isHabit:false,
        notes:ev.description||'', focusPoints:0, subtasks:[], progress:0,
        dueCompletedDates:{}, customOrder:Date.now()+added,
        calendarSignal:'due', dailySection:'Study'
      };
      if(findPossibleDuplicate(candidate,'task')){ skipped++; continue; }
      S.tasks.push(candidate);
    }
    added++;
  }
  save(); render();
  return {added, skipped};
}

function classifyImportedItem(ev){
  const title=String(ev.summary||'');
  const headline=[ev.summary,ev.categories,ev.location].filter(Boolean).join(' ').toLowerCase();
  const text=[ev.summary,ev.description,ev.categories,ev.url,ev.location].filter(Boolean).join(' ').toLowerCase();
  if(/\b(exam|test|midterm|final)\b/.test(text)) return {kind:'event', type:'test'};
  const canvasLike=/canvas|instructure|assignment_group|assignment|assignments\/|submissions?/.test(text);
  const taskWords=/\b(homework|hw|problem set|pset|worksheet|lab report|essay|paper|project|reading|response|rq|quiz|submit|submission|due)\b/.test(text);
  const deadlineOnly=/\b(deadline|due date|due)\b/.test(text);
  if(canvasLike || taskWords || ev.due) return {kind:'task'};
  if(/\b(class|lecture|lab section|seminar|office hours|meeting|appointment|practice|event)\b/.test(headline)) return {kind:'event', type:/office hours/.test(headline)?'office_hours':/class|lecture|lab section|seminar/.test(headline)?'class':'event'};
  if(deadlineOnly && !/\bcalendar|event|meeting|appointment\b/.test(text)) return {kind:'task'};
  return {kind:'event', type:'event'};
}

function normalizeTitle(title){
  return String(title||'')
    .toLowerCase()
    .replace(/\b(canvas|assignment|homework|hw|due|available|until|calendar)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .trim()
    .replace(/\s+/g,' ');
}

function titleSimilarity(a,b){
  const A=normalizeTitle(a), B=normalizeTitle(b);
  if(!A || !B) return 0;
  if(A===B) return 1;
  if(A.includes(B) || B.includes(A)) return Math.min(A.length,B.length)/Math.max(A.length,B.length);
  const as=new Set(A.split(' ')), bs=new Set(B.split(' '));
  const inter=[...as].filter(x=>bs.has(x)).length;
  const union=new Set([...as,...bs]).size || 1;
  return inter/union;
}

function itemDate(item){
  return item.date || item.due || (item.scheduledDates&&item.scheduledDates[0]) || '';
}

function daysApart(a,b){
  if(!a || !b) return Infinity;
  return Math.abs((new Date(a+'T00:00:00')-new Date(b+'T00:00:00'))/86400000);
}

function findPossibleDuplicate(candidate,kind){
  const pool=[
    ...S.tasks.map(t=>({kind:'task',item:t})),
    ...S.events.map(e=>({kind:'event',item:e}))
  ];
  const cDate=itemDate(candidate);
  let best=null;
  for(const entry of pool){
    const sim=titleSimilarity(candidate.title,entry.item.title);
    const near=daysApart(cDate,itemDate(entry.item));
    const sameUid=candidate.icsUid && entry.item.icsUid && candidate.icsUid===entry.item.icsUid;
    const possible=sameUid || (sim>=0.82 && near<=2) || (sim>=0.94 && near<=14);
    if(possible && (!best || sim>best.score)) best={...entry,score:sim};
  }
  return best;
}

function describeImportItem(item,kind){
  const label=kind==='event' ? (item.type==='test'?'Test date':'Calendar date') : 'Assignment task';
  const date=itemDate(item) ? fmtDate(itemDate(item)) : 'No date';
  return `${label}: ${item.title}\nDate: ${date}`;
}

function confirmDuplicate(candidate,duplicate){
  return designConfirm(
    'Possible duplicate',
    `Incoming: ${describeImportItem(candidate, candidate.type==='test'?'event':'task')} Existing: ${describeImportItem(duplicate.item, duplicate.kind)}. Is this a duplicate?`,
    'Skip incoming',
    'Keep both'
  );
}

function parseICS(text){
  const events=[];
  const lines=text.replace(/\r\n|\r/g,'\n').split('\n');
  const unfolded=[];
  for(const line of lines){
    if(/^[ \t]/.test(line)) unfolded[unfolded.length-1]+=line.slice(1);
    else unfolded.push(line);
  }
  let ev=null;
  for(const line of unfolded){
    if(line==='BEGIN:VEVENT'){ev={};continue;}
    if(line==='END:VEVENT'){if(ev)events.push(ev);ev=null;continue;}
    if(!ev) continue;
    const col=line.indexOf(':');
    if(col<0) continue;
    const key=line.slice(0,col), val=line.slice(col+1);
    if(key.startsWith('DTSTART')) ev.dtstart=parseICSDate(val);
    else if(key.startsWith('DTEND')) ev.dtend=parseICSDate(val);
    else if(key.startsWith('SUMMARY')) ev.summary=unescapeICS(val);
    else if(key.startsWith('DESCRIPTION')) ev.description=unescapeICS(val);
    else if(key.startsWith('DUE')) ev.due=parseICSDate(val);
    else if(key.startsWith('LOCATION')) ev.location=unescapeICS(val);
    else if(key.startsWith('CATEGORIES')) ev.categories=unescapeICS(val);
    else if(key.startsWith('URL')) ev.url=unescapeICS(val);
    else if(key.startsWith('UID')) ev.uid=val;
  }
  return events;
}
function parseICSDate(s){
  const m=s.replace(/[TZ]/g,'');
  return m.slice(0,4)+'-'+m.slice(4,6)+'-'+m.slice(6,8);
}
function unescapeICS(s){ return String(s||'').replace(/\\n/gi,' ').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\'); }

// ════════════════════════════════════════════════════════════
//  MINI CALENDAR
// ════════════════════════════════════════════════════════════
function renderCalendar(){
  const y=calViewDate.getFullYear(), mo=calViewDate.getMonth();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calMonthLabel').textContent=months[mo]+' '+y;
  const firstDay=new Date(y,mo,1).getDay();
  const daysInMonth=new Date(y,mo+1,0).getDate();
  const today=todayStr();
  let html='';
  DAY_NAMES.forEach(d=>{ html+=`<div class="cal-day-name">${d}</div>`; });
  for(let i=0;i<firstDay;i++) html+=`<div class="cal-cell other-month"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const ds=y+'-'+pad(mo+1)+'-'+pad(d);
    const allDayTasks=S.tasks.filter(t=>!t.archived&&(t.scheduledDates?.includes(ds)||(t.due===ds&&!isDueSignalDone(t,ds))||isHabitDueToday(t,ds)));
    const allDayEvents=S.events.filter(e=>e.date===ds);
    const dayTasks = calViewMode==='events' ? [] : allDayTasks;
    const dayEvents = calViewMode==='tasks' ? [] : allDayEvents;
    const hasTasks=dayTasks.length>0 || dayEvents.length>0;
    const hasExam=dayEvents.some(e=>e.type==='test');
    const isToday=ds===today;
    const isSel=ds===calSelectedDate;
    const chips=[
      ...dayEvents.map(e=>`<span class="cal-mini-chip ${e.type==='test'?'exam':e.type||'event'}" style="border-left-color:${esc(e.color||eventColorForType(e.type))}">${e.type==='test'?'TEST ':'EVENT '}${esc(e.title)}</span>`),
      ...dayTasks.map(t=>{
      const sig=calendarSignalForTask(t,ds);
      return `<span class="cal-mini-chip ${sig}">${sig==='exam'?'TEST ':sig==='due'?'DUE ':sig==='habit'?'HABIT ':''}${esc(t.title)}</span>`;
      })
    ].slice(0,3).join('');
    html+=`<div class="cal-cell ${isToday?'today':''} ${isSel?'selected':''} ${hasTasks?'has-tasks':''} ${hasExam?'has-exam':''}"
      data-date="${ds}"
      role="button"
      tabindex="0"
      onclick="selectCalDate(event,'${ds}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){selectCalDate(event,'${ds}')}"
      onpointerenter="startCalHover(event,'${ds}')"
      onpointermove="moveCalHover(event)"
      onpointerleave="hideCalHover()"
      ondragover="onCalDragOver(event)"
      ondrop="onCalDrop(event,'${ds}')"
      ondragleave="onCalDragLeave(event)"
    ><div class="cal-num">${d}</div><div class="cal-mini-list">${chips}</div></div>`;
  }
  const calGrid=document.getElementById('calGrid');
  calGrid.innerHTML=html;
  setupCalendarDateHandlers();
  // Sync toggle knob position after grid renders
  setupCalViewResizeSync();
  syncCalViewToggle();
  document.querySelectorAll('.cvt-opt').forEach(b=>b.classList.toggle('active',b.dataset.mode===calViewMode));
  renderCalDayTasks();
}
function calendarItemsForDate(ds){
  const allDayTasks=S.tasks.filter(t=>!t.archived&&(t.scheduledDates?.includes(ds)||(t.due===ds&&!isDueSignalDone(t,ds))||isHabitDueToday(t,ds)));
  const allDayEvents=S.events.filter(e=>e.date===ds);
  return {
    tasks: calViewMode==='events' ? [] : allDayTasks,
    events: calViewMode==='tasks' ? [] : allDayEvents
  };
}
function startCalHover(e,ds){
  moveCalHover(e);
  clearTimeout(calHoverTimer);
  calHoverTimer=setTimeout(()=>showCalHover(ds,e),850);
}
function moveCalHover(e){
  const card=document.getElementById('calendarHoverCard');
  if(!card) return;
  const pad=14;
  const width=260;
  const left=Math.min(window.innerWidth-width-pad, e.clientX+14);
  const top=Math.min(window.innerHeight-180-pad, e.clientY+14);
  card.style.left=Math.max(pad,left)+'px';
  card.style.top=Math.max(pad,top)+'px';
}
function hideCalHover(){
  clearTimeout(calHoverTimer);
  const card=document.getElementById('calendarHoverCard');
  if(card){
    card.classList.remove('show');
    card.setAttribute('aria-hidden','true');
  }
}
function showCalHover(ds,e){
  const card=document.getElementById('calendarHoverCard');
  if(!card) return;
  const {tasks,events}=calendarItemsForDate(ds);
  const rows=[
    ...events.map(ev=>({
      cls:ev.type==='test'?'test':(ev.type||'event'),
      title:ev.title,
      meta:`${ev.type==='test'?'Test':(ev.type||'Event').replace('_',' ')}${ev.time?' · '+ev.time:''}`
    })),
    ...tasks.map(t=>{
      const sig=calendarSignalForTask(t,ds);
      return {
        cls:sig,
        title:t.title,
        meta:sig==='due'?'Due date':sig==='habit'?'Habit':sig==='exam'?'Test date':'Assigned work'
      };
    })
  ];
  card.innerHTML=`<div class="cal-hover-title">${fmtDate(ds)}</div>`+
    (rows.length ? `<div class="cal-hover-list">${rows.slice(0,8).map(r=>`
      <div class="cal-hover-item ${esc(r.cls)}">
        <span class="cal-hover-dot"></span>
        <span><strong>${esc(r.title)}</strong><span class="cal-hover-meta">${esc(r.meta)}</span></span>
      </div>`).join('')}${rows.length>8?`<div class="cal-hover-meta">+ ${rows.length-8} more</div>`:''}</div>` :
      `<div class="empty" style="font-size:11px;padding:4px 0;text-align:left">Nothing scheduled.</div>`);
  card.classList.add('show');
  card.setAttribute('aria-hidden','false');
  moveCalHover(e);
}
function setupCalendarDateHandlers(){
  const grid=document.getElementById('calGrid');
  if(!grid || grid.dataset.dateClickReady) return;
  grid.dataset.dateClickReady='1';
  grid.addEventListener('pointerdown', e=>{
    if(e.target.closest('.cal-cell[data-date]')) e.stopPropagation();
  });
  grid.addEventListener('click', e=>{
    const cell=e.target.closest('.cal-cell[data-date]');
    if(!cell) return;
    e.preventDefault();
    e.stopPropagation();
    selectCalDate(cell.dataset.date);
  });
  grid.addEventListener('keydown', e=>{
    if(e.key!=='Enter' && e.key!==' ') return;
    const cell=e.target.closest('.cal-cell[data-date]');
    if(!cell) return;
    e.preventDefault();
    e.stopPropagation();
    selectCalDate(cell.dataset.date);
  });
}
function calMove(dir){
  calViewDate.setMonth(calViewDate.getMonth()+dir);
  renderCalendar();
}
function goToToday(){
  calViewDate = new Date();
  calSelectedDate = todayStr();
  render();
}
function openMonthPicker(){
  const modal=document.getElementById('mMonthPicker');
  if(!modal) return;
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthSel=document.getElementById('mpMonth');
  const yearInput=document.getElementById('mpYear');
  const grid=document.getElementById('mpMonthGrid');
  const currentMonth=calViewDate.getMonth();
  if(monthSel){
    monthSel.innerHTML=months.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
    monthSel.value=currentMonth;
  }
  if(yearInput) yearInput.value=calViewDate.getFullYear();
  if(grid){
    grid.innerHTML=months.map((m,i)=>`
      <button class="month-choice ${i===currentMonth?'active':''}" type="button" onclick="pickMonthChoice(${i})">${m.slice(0,3)}</button>
    `).join('');
  }
  modal.classList.add('show');
}
function pickMonthChoice(monthIndex){
  const monthSel=document.getElementById('mpMonth');
  if(monthSel) monthSel.value=monthIndex;
  document.querySelectorAll('.month-choice').forEach((b,i)=>b.classList.toggle('active',i===monthIndex));
}
function applyMonthPicker(){
  const month=Number(document.getElementById('mpMonth')?.value);
  const year=Number(document.getElementById('mpYear')?.value);
  if(!Number.isFinite(month) || !Number.isFinite(year)) return;
  const cleanYear=Math.max(1970,Math.min(2100,Math.round(year)));
  calViewDate = new Date(cleanYear, month, 1);
  closeModal('mMonthPicker');
  renderCalendar();
}
function selectCalDate(evtOrDate, maybeDate){
  const evt = maybeDate ? evtOrDate : null;
  const ds = maybeDate || evtOrDate;
  if(evt){
    evt.preventDefault?.();
    evt.stopPropagation?.();
  }
  hideCalHover();
  calSelectedDate=ds;
  if(currentPage==='calendar'){
    renderCalendar();
    renderCalDayTasks();
  }else{
    renderCenter();
    renderCalendar();
    renderTodoCarryPrompt();
    renderFocusToday();
    updateWorkbenchCollapseUI();
  }
}
function setCalViewMode(mode){
  calViewMode=mode;
  // Update toggle UI
  document.querySelectorAll('.cvt-opt').forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));
  syncCalViewToggle();
  renderCalendar();
}

function syncCalViewToggle(){
  const slider=document.getElementById('cvtSlider');
  if(slider){
    const idx={tasks:0,both:1,events:2}[calViewMode]||0;
    const track=slider.parentElement;
    const trackWidth=track?.getBoundingClientRect().width || 0;
    if(trackWidth<=4) return;
    const w=(trackWidth-4)/3;
    slider.style.left=(2+idx*w)+'px';
    slider.style.width=w+'px';
  }
}

function setupCalViewResizeSync(){
  const track=document.getElementById('calViewToggle');
  if(!track || track.dataset.resizeSyncReady) return;
  track.dataset.resizeSyncReady='1';
  if('ResizeObserver' in window){
    calViewResizeObserver?.disconnect?.();
    calViewResizeObserver=new ResizeObserver(()=>requestAnimationFrame(syncCalViewToggle));
    calViewResizeObserver.observe(track);
  }
}
function renderCalDayTasks(){
  const ds=calSelectedDate;
  const tasks = calViewMode==='events' ? [] : S.tasks.filter(t=>!t.archived&&(t.scheduledDates?.includes(ds)||(t.due===ds&&!isDueSignalDone(t,ds))||isHabitDueToday(t,ds)));
  const events = calViewMode==='tasks' ? [] : S.events.filter(e=>e.date===ds);
  const wrap=document.getElementById('calDayTasks');
  if(!tasks.length && !events.length){ wrap.innerHTML=`<div class="cal-day-title">${fmtDate(ds)}</div><div class="empty" style="font-size:11px;padding:12px 0">No ${currentPage==='calendar'?'events':'tasks or tests'}</div>`; return; }
  wrap.innerHTML=`<div class="cal-day-title">${fmtDate(ds)}</div>`+
    events.map(e=>`
      <div class="cal-task-item ${e.type==='test'?'exam':e.type||'event'}" 
        style="border-left-color:${esc(e.color||eventColorForType(e.type))};cursor:pointer"
        onclick="editEvent('${e.id}')">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:6px">
          <span>${esc(e.title)}</span>
          ${e.location?`<span style="font-size:9px;color:var(--text3);white-space:nowrap">📍 ${esc(e.location)}</span>`:''}
        </div>
        <div class="cal-task-meta">
          <span>${e.type==='test'?'Test date':(e.type||'Event').replace('_',' ')}</span>
          ${e.subject?`<span>${esc(e.subject)}</span>`:''}
          ${e.time?`<span>${e.time}${e.endTime?' – '+e.endTime:''}</span>`:''}
          ${e.recurrence&&e.recurrence!=='none'?`<span>↻ ${e.recurrence}</span>`:''}
        </div>
      </div>`).join('')+
    tasks.map(t=>{
      const sig=calendarSignalForTask(t,ds);
      const label=sig==='exam'?'Test date':sig==='due'?'Due date':sig==='habit'?'Habit':'Assigned work';
      return `<div class="cal-task-item ${sig}" onclick="editTask('${t.id}')">
        ${esc(t.title)}
        <div class="cal-task-meta"><span>${label}</span>${t.subject?`<span>${esc(t.subject)}</span>`:''}${t.scheduledTime?`<span>${t.scheduledTime}</span>`:''}</div>
      </div>`;
    }).join('');
}

function calendarSignalForTask(t,ds){
  if(t.calendarSignal==='exam' || t.type==='exam') return 'exam';
  if((t.calendarSignal==='due' || t.due===ds) && !isDueSignalDone(t,ds)) return 'due';
  if(t.isHabit && isHabitDueToday(t,ds)) return 'habit';
  return 'work';
}

// ── DRAG & DROP ──
let draggedBankId=null;
function onTaskDragStart(e,id,section='',dateStr=''){
  draggedTaskId=id;
  draggedBankId=null;
  draggedTaskSection=section;
  draggedTaskDate=dateStr || calSelectedDate || todayStr();
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/task-id', id);
  e.currentTarget.classList.add('dragging');
}
function onArchiveTaskDragStart(e,id){
  onTaskDragStart(e,id,'archive',calSelectedDate || todayStr());
}
function onTaskDragEnd(e){
  e.currentTarget?.classList.remove('dragging');
  resetDraggedTask();
}
function onBankDragStart(e,id){
  draggedBankId=id;
  draggedTaskId=id;
  draggedTaskSection='bank';
  draggedTaskDate=calSelectedDate || todayStr();
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/task-id', id);
  const t=S.tasks.find(x=>x.id===id);
  const ghost=document.createElement('div');
  ghost.textContent=(t?.type==='exam'?'Test: ':'Task: ')+(t?.title||'Schedule task');
  ghost.style.cssText='position:fixed;top:-1000px;left:-1000px;max-width:180px;padding:6px 10px;border-radius:7px;background:#111;color:#fff;font:600 12px Inter,Arial;box-shadow:0 8px 24px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost,12,12);
  setTimeout(()=>ghost.remove(),0);
}
function onTaskRowDragOver(e,targetId){
  const sourceId=getDraggedTaskId(e);
  if(!sourceId || sourceId===targetId) return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('task-drag-over');
}
function onBankTaskDragOver(e,targetId){
  const sourceId=getDraggedTaskId(e);
  if(!sourceId || sourceId===targetId) return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('task-drag-over');
}
function onTaskRowDragLeave(e){
  e.currentTarget.classList.remove('task-drag-over');
}
async function onTaskRowDrop(e,targetId,section='',dateStr=''){
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('task-drag-over');
  const sourceId=getDraggedTaskId(e);
  if(!sourceId || sourceId===targetId){ resetDraggedTask(); return; }
  const source=S.tasks.find(t=>t.id===sourceId);
  const target=S.tasks.find(t=>t.id===targetId);
  if(!source || !target){ resetDraggedTask(); return; }
  const ds=dateStr || draggedTaskDate || calSelectedDate || todayStr();
  unarchiveForDrop(source,ds);
  let targetSection=section;
  if(targetSection==='daily') targetSection=target.dailySection || 'Study';
  if(targetSection==='habit') targetSection='__habits__';
  if(targetSection==='__habits__' || target.isHabit){
    if(!await makeTaskHabit(source,ds,true)){ resetDraggedTask(); return; }
  }else if(targetSection==='__due__'){
    if(source.isHabit && !await makeHabitSingleTask(source,ds,'Study',true)){ resetDraggedTask(); return; }
    moveTaskDueDate(source,ds,draggedTaskDate);
  }else{
    if(source.isHabit && !await makeHabitSingleTask(source,ds,targetSection,true)){ resetDraggedTask(); return; }
    moveTaskWorkDate(source,ds,draggedTaskSection==='bank' || draggedTaskSection==='archive' ? '' : draggedTaskDate);
    source.dailySection=targetSection==='must' ? (target.dailySection||'Study') : (targetSection||target.dailySection||'Study');
    if(targetSection==='must' || target.priority==='MUST') source.priority='MUST';
  }
  reorderTaskNear(sourceId,targetId,ds,targetSection);
  setCustomSortForContext('daily');
  save(); render();
  resetDraggedTask();
}
function onBankTaskDrop(e,targetId){
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('task-drag-over');
  const sourceId=getDraggedTaskId(e);
  if(!sourceId || sourceId===targetId){ resetDraggedTask(); return; }
  const source=S.tasks.find(t=>t.id===sourceId);
  if(!source){ resetDraggedTask(); return; }
  unarchiveForDrop(source,calSelectedDate || todayStr());
  const visible=sortTasks(S.tasks.filter(t=>!isArchivedForTodo(t) && taskMatchesBankFilter(t,bankFilter)), bankSort);
  const ids=visible.map(t=>t.id).filter(id=>id!==sourceId);
  const idx=ids.indexOf(targetId);
  ids.splice(idx<0 ? ids.length : idx,0,sourceId);
  orderTaskIds(ids);
  setCustomSortForContext('bank');
  save(); render();
  resetDraggedTask();
}
function onBankPanelDragOver(e){
  const sourceId=getDraggedTaskId(e);
  const source=S.tasks.find(t=>t.id===sourceId);
  if(!source || !isArchivedForTodo(source)) return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('section-drag-over');
}
function onBankPanelDragLeave(e){
  e.currentTarget.classList.remove('section-drag-over');
}
function onBankPanelDrop(e){
  const sourceId=getDraggedTaskId(e);
  const source=S.tasks.find(t=>t.id===sourceId);
  if(!source || !isArchivedForTodo(source)) return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('section-drag-over');
  unarchiveForDrop(source,calSelectedDate || todayStr());
  save(); render();
  showToast(`Restored "${source.title}" to Task Bank`);
  resetDraggedTask();
}
function onArchiveDragOver(e){
  const sourceId=getDraggedTaskId(e);
  if(!sourceId) return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('section-drag-over');
}
function onArchiveDragLeave(e){
  e.currentTarget.classList.remove('section-drag-over');
}
function onArchiveDrop(e){
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('section-drag-over');
  const sourceId=getDraggedTaskId(e);
  if(!sourceId){ resetDraggedTask(); return; }
  const t=S.tasks.find(x=>x.id===sourceId);
  if(!t){ resetDraggedTask(); return; }
  const before=JSON.parse(JSON.stringify(t));
  const ds=draggedTaskDate || calSelectedDate || todayStr();
  if(draggedTaskSection==='__due__'){
    if(!t.dueCompletedDates) t.dueCompletedDates={};
    t.dueCompletedDates[ds]=true;
    save(); render();
    showToast(`Due date cleared for "${t.title}"`,'Undo',()=>{
      const live=S.tasks.find(x=>x.id===sourceId);
      restoreTaskSnapshot(live,before);
      save(); render();
    });
    resetDraggedTask();
    return;
  }
  if(t.isHabit){
    if(!t.completedDates) t.completedDates={};
    t.completedDates[ds]=true;
  }
  t.completed=true;
  t.completedAt=Date.now();
  t.completedDate=ds;
  t.archived=true;
  t.archivedAt=Date.now();
  save(); render();
  showToast(`Marked "${t.title}" complete and moved to Archive`,'Undo',()=>{
    const live=S.tasks.find(x=>x.id===sourceId);
    restoreTaskSnapshot(live,before);
    save(); render();
  });
  resetDraggedTask();
}
function onCalDragOver(e){ e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function onCalDragLeave(e){ e.currentTarget.classList.remove('drag-over'); }
async function onCalDrop(e,ds){
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  const file=[...(e.dataTransfer?.files||[])].find(f=>/\.ics$/i.test(f.name) || /calendar|ics/i.test(f.type));
  if(file){
    const reader=new FileReader();
    reader.onload=()=>{ importEvents(parseICS(String(reader.result||''))); render(); };
    reader.readAsText(file);
    return;
  }
  const droppedId=getDraggedTaskId(e);
  if(!droppedId) return;
  const t=S.tasks.find(x=>x.id===droppedId);
  if(!t){ resetDraggedTask(); return; }
  unarchiveForDrop(t,ds);

  // Ask: schedule as task or add as event?
  const choice = await designConfirm('Add to calendar', `Add "${t.title}" to ${fmtDate(ds)} as a task or as a calendar event?`, 'Task', 'Event');
  if(choice){
    if(t.isHabit && !await makeHabitSingleTask(t,ds,'Study',true)){ resetDraggedTask(); return; }
    // Schedule as task
    if(draggedTaskSection==='__due__'){
      moveTaskDueDate(t,ds,draggedTaskDate);
    } else {
      moveTaskWorkDate(t,ds,draggedTaskSection==='bank' || draggedTaskSection==='archive' ? '' : draggedTaskDate);
    }
    showToast(`Scheduled "${t.title}" for ${fmtDate(ds)}`);
  } else {
    // Add as event
    S.events.push({
      id:uid(), createdAt:Date.now(),
      title:t.title, date:ds, time:'',
      subject:t.subject||'', type:'event',
      notes:t.notes||'', color:eventColorForType('event')
    });
    showToast(`Added "${t.title}" as event on ${fmtDate(ds)}`);
  }
  calSelectedDate=ds;
  save(); render();
  resetDraggedTask();
}

function toggleEventNoEndDate(){
  const noEnd = document.getElementById('testNoEndDate')?.checked;
  const endInput = document.getElementById('testEndDate');
  if(endInput){
    endInput.disabled = !!noEnd;
    endInput.style.opacity = noEnd ? '0.35' : '1';
    if(noEnd) endInput.value = '';
  }
}

let editEventDays = [];

function toggleEventDay(d, btn){
  if(editEventDays.includes(d)) editEventDays = editEventDays.filter(x=>x!==d);
  else editEventDays.push(d);
  btn.classList.toggle('active', editEventDays.includes(d));
}

function toggleEventAllDay(){
  const allDay=document.getElementById('testAllDay')?.checked;
  document.getElementById('eventTimeRow').style.display=allDay?'none':'grid';
}

function toggleEventRecurrenceDays(){
  const val = document.getElementById('testRecurrence')?.value;
  const row = document.getElementById('eventRecurrenceDaysRow');
  if(!row) return;
  const show = val === 'weekly' || val === 'custom';
  row.style.display = show ? 'block' : 'none';
  // Pre-select the start date's day of week for weekly
  if(val === 'weekly' && editEventDays.length === 0){
    const dateVal = document.getElementById('testDate')?.value;
    if(dateVal){
      const dow = new Date(dateVal + 'T00:00:00').getDay();
      editEventDays = [dow];
      document.querySelectorAll('#eventDaysPicker .day-btn').forEach(b=>{
        b.classList.toggle('active', +b.dataset.d === dow);
      });
    }
  }
}

function saveTestDate(){
  const title=document.getElementById('testTitle').value.trim();
  const date=document.getElementById('testDate').value;
  if(!title || !date){ showToast('Event title and start date are required.'); return; }
  const type=document.getElementById('eventType').value||'event';
  const editId=document.getElementById('editEventId')?.value;
  const existing=editId?S.events.find(e=>e.id===editId):null;
  const ev={
    id:existing?existing.id:uid(),
    icsUid:existing?existing.icsUid:'',
    createdAt:existing?existing.createdAt:Date.now(),
    title,
    date,
    endDate:document.getElementById('testNoEndDate')?.checked ? null : (document.getElementById('testEndDate')?.value||date),
    noEndDate:!!document.getElementById('testNoEndDate')?.checked,
    time:document.getElementById('testTime')?.value||'',
    endTime:document.getElementById('testEndTime')?.value||'',
    allDay:document.getElementById('testAllDay')?.checked!==false,
    recurrence:document.getElementById('testRecurrence')?.value||'none',
    recurrenceDays:[...editEventDays],
    subject:document.getElementById('testSubject').value.trim(),
    location:document.getElementById('testLocation')?.value.trim()||'',
    notes:document.getElementById('testNotes').value,
    reminder:document.getElementById('testReminder')?.value||'none',
    type,
    color:document.getElementById('eventColor').value||eventColorForType(type)
  };
  if(existing){
    const idx=S.events.findIndex(e=>e.id===editId);
    if(idx>=0) S.events[idx]=ev;
  } else {
    S.events.push(ev);
  }
  calSelectedDate=date;
  save(); render(); closeModal('mAddTest'); resetTestForm();
}

function deleteEvent(){
  const id=document.getElementById('editEventId')?.value;
  if(!id) return;
  S.events=S.events.filter(e=>e.id!==id);
  save(); render(); closeModal('mAddTest'); resetTestForm();
}

function convertEventToTask(){
  const id=document.getElementById('editEventId')?.value;
  const idx=S.events.findIndex(e=>e.id===id);
  if(idx<0) return;
  const ev=S.events[idx];
  const due=ev.date || calSelectedDate || todayStr();
  const task={
    id:uid(),
    icsUid:ev.icsUid||'',
    createdAt:ev.createdAt||Date.now(),
    convertedFromEventId:ev.id,
    archived:false,
    completed:false,
    completedAt:null,
    completedDate:'',
    completedDates:{},
    title:ev.title||'Untitled task',
    subject:ev.subject||'',
    type:ev.type==='test'?'exam':'assignment',
    priority:ev.type==='test'?'high':'medium',
    due,
    scheduledDates:[],
    scheduledDays:[...(ev.recurrenceDays||[])],
    scheduledTime:ev.time||'',
    isHabit:!!(ev.recurrence && ev.recurrence!=='none'),
    notes:[ev.notes||'', ev.location?`Location: ${ev.location}`:''].filter(Boolean).join('\n'),
    focusPoints:0,
    subtasks:[],
    progress:0,
    calendarSignal:ev.type==='test'?'exam':'due',
    dailySection:'Study'
  };
  S.events.splice(idx,1);
  S.tasks.push(task);
  calSelectedDate=due;
  save(); render();
  closeModal('mAddTest');
  resetTestForm();
  showToast(`Converted "${task.title}" to a task.`);
}

function editEvent(id){
  const e=S.events.find(x=>x.id===id);
  if(!e) return;
  document.getElementById('mAddTestTitle').textContent='Edit Event';
  document.getElementById('editEventId').value=e.id;
  document.getElementById('testTitle').value=e.title||'';
  document.getElementById('testDate').value=e.date||'';
  const noEndCheck = document.getElementById('testNoEndDate');
  if(noEndCheck){ noEndCheck.checked=!!e.noEndDate; toggleEventNoEndDate(); }
  document.getElementById('testEndDate').value=e.noEndDate?'':(e.endDate||e.date||'');
  document.getElementById('testTime').value=e.time||'';
  document.getElementById('testEndTime').value=e.endTime||'';
  const allDay=e.allDay!==false;
  document.getElementById('testAllDay').checked=allDay;
  toggleEventAllDay();
  const recSel=document.getElementById('testRecurrence');
  if(recSel){ recSel.value=e.recurrence||'none'; }
  editEventDays=[...(e.recurrenceDays||[])];
  document.querySelectorAll('#eventDaysPicker .day-btn').forEach(b=>{
    b.classList.toggle('active', editEventDays.includes(+b.dataset.d));
  });
  toggleEventRecurrenceDays();
  document.getElementById('eventType').value=e.type||'event';
  document.getElementById('testSubject').value=e.subject||'';
  document.getElementById('testLocation').value=e.location||'';
  document.getElementById('testNotes').value=e.notes||'';
  document.getElementById('testReminder').value=e.reminder||'none';
  document.getElementById('eventColor').value=e.color||eventColorForType(e.type||'event');
  document.getElementById('deleteEventBtn').style.display='flex';
  document.getElementById('eventToTaskBtn').style.display='flex';
  document.getElementById('mAddTest').classList.add('show');
}

function resetTestForm(){
  ['testTitle','testDate','testEndDate','testTime','testEndTime','testSubject','testLocation','testNotes'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.value=''; el.disabled=false; el.style.opacity='1'; }
  });
  const eid=document.getElementById('editEventId');
  if(eid) eid.value='';
  const mTitle=document.getElementById('mAddTestTitle');
  if(mTitle) mTitle.textContent='Add Event';
  const type=document.getElementById('eventType');
  const color=document.getElementById('eventColor');
  const recurrence=document.getElementById('testRecurrence');
  const reminder=document.getElementById('testReminder');
  const allDay=document.getElementById('testAllDay');
  const noEnd=document.getElementById('testNoEndDate');
  if(type) type.value='event';
  if(color) color.value=eventColorForType('event');
  if(recurrence){ recurrence.value='none'; toggleEventRecurrenceDays(); }
  if(reminder) reminder.value='none';
  if(allDay){ allDay.checked=true; toggleEventAllDay(); }
  if(noEnd) noEnd.checked=false;
  editEventDays=[];
  document.querySelectorAll('#eventDaysPicker .day-btn').forEach(b=>b.classList.remove('active'));
  const delBtn=document.getElementById('deleteEventBtn');
  if(delBtn) delBtn.style.display='none';
  const convertBtn=document.getElementById('eventToTaskBtn');
  if(convertBtn) convertBtn.style.display='none';
}

function eventColorForType(type){
  return ({test:'#B83030',deadline:'#A85418',class:'#5A4A88',personal:'#2A6B44',meeting:'#4A7A8B',office_hours:'#6B6B2A',event:'#2C4A8B'}[type]||'#2C4A8B');
}

function toggleWorkbenchCol(col){
  const idMap={bank:'workbenchBank',today:'workbenchToday',cal:'workbenchCalendar'};
  const el=document.getElementById(idMap[col]);
  if(!el) return;
  const cols=['workbenchBank','workbenchToday','workbenchCalendar'];
  const collapsedCount=cols.filter(id=>document.getElementById(id)?.classList.contains('collapsed')).length;
  if(!el.classList.contains('collapsed') && collapsedCount>=2){
    showToast('Keep at least one panel open.');
    return;
  }
  el.classList.toggle('collapsed');
  updateWorkbenchCollapseUI();
}

function updateWorkbenchCollapseUI(){
  const defs=[
    {id:'workbenchBank',   openArrow:'‹', closedArrow:'›'},
    {id:'workbenchToday',  openArrow:'‹', closedArrow:'›'},
    {id:'workbenchCalendar',openArrow:'›',closedArrow:'‹'}
  ];
  defs.forEach(({id,openArrow,closedArrow})=>{
    const el=document.getElementById(id);
    if(!el) return;
    const collapsed=el.classList.contains('collapsed');
    const btn=el.querySelector('.collapse-toggle');
    if(btn) btn.textContent=collapsed?closedArrow:openArrow;
  });
}

function setupWorkbenchCollapseReopen(){
  const wb=document.getElementById('todoWorkbench');
  if(!wb || wb.dataset.collapseReopenReady) return;
  wb.dataset.collapseReopenReady='1';
  const colMap={workbenchBank:'bank',workbenchToday:'today',workbenchCalendar:'cal'};
  wb.addEventListener('pointerdown',e=>{
    if(e.target.closest('.col-strip,.workbench-col.collapsed')){
      e.stopPropagation();
    }
  },true);
  wb.addEventListener('click',e=>{
    const colEl=e.target.closest('.workbench-col.collapsed');
    if(!colEl) return;
    const col=colMap[colEl.id];
    if(!col) return;
    e.preventDefault();
    e.stopPropagation();
    toggleWorkbenchCol(col);
  },true);
}

function toggleTaskBankBody(){
  toggleBankLimit();
}

let resizeState=null;
function startWorkbenchResize(e,which){
  e.preventDefault();
  const bankEl=document.getElementById('workbenchBank');
  const todayEl=document.getElementById('workbenchToday');
  const calEl=document.getElementById('workbenchCalendar');
  resizeState={which,startX:e.clientX,
    bank:bankEl.getBoundingClientRect().width,
    today:todayEl.getBoundingClientRect().width,
    cal:calEl.getBoundingClientRect().width};
  e.currentTarget.classList.add('dragging');
  window.addEventListener('pointermove',resizeWorkbench);
  window.addEventListener('pointerup',stopWorkbenchResize,{once:true});
}

function resizeWorkbench(e){
  if(!resizeState) return;
  const dx=e.clientX-resizeState.startX;
  const bankEl=document.getElementById('workbenchBank');
  const todayEl=document.getElementById('workbenchToday');
  const calEl=document.getElementById('workbenchCalendar');
  if(resizeState.which==='bank'){
    const newBank=Math.max(180,resizeState.bank+dx);
    const newToday=Math.max(220,resizeState.today-dx);
    bankEl.style.flex=`0 0 ${newBank}px`;
    todayEl.style.flex=`0 0 ${newToday}px`;
  }else{
    const newToday=Math.max(220,resizeState.today+dx);
    const newCal=Math.max(200,resizeState.cal-dx);
    todayEl.style.flex=`0 0 ${newToday}px`;
    calEl.style.flex=`0 0 ${newCal}px`;
  }
  requestAnimationFrame(syncCalViewToggle);
}

function stopWorkbenchResize(){
  document.querySelectorAll('.resize-grip').forEach(g=>g.classList.remove('dragging'));
  window.removeEventListener('pointermove',resizeWorkbench);
  resizeState=null;
  syncCalViewToggle();
}

// ════════════════════════════════════════════════════════════
//  UI HELPERS
// ════════════════════════════════════════════════════════════
function toggleSec(header){
  const sec=header.closest('.sec');
  if(!sec) return;
  const collapsed=sec.classList.toggle('collapsed');
  const body=sec.querySelector(':scope > .sec-body');
  if(body){
    body.hidden=collapsed;
    body.style.display=collapsed?'none':'';
  }
  header.setAttribute('role','button');
  header.setAttribute('tabindex','0');
  header.setAttribute('aria-expanded', collapsed?'false':'true');
}
function toggleSubSec(header){
  const sub=header.closest('.sub-sec');
  sub.classList.toggle('collapsed');
}

function setupWorkbenchDragScroll(){
  document.querySelectorAll('.workbench-col').forEach(col=>{
    if(col.dataset.dragScrollReady) return;
    col.dataset.dragScrollReady='1';
    let active=false,startY=0,startTop=0;
    col.addEventListener('pointerdown',e=>{
      if(e.target.closest('button,input,textarea,select,a,.col-strip,.sec-header,.sub-sec-header,.daily-toolbar,.daily-section-header,.task-cb,.bank-task,.bank-filters,.bank-sort-row,.filter-chip,.cal-nav,.cal-month,.cal-nav-btn,.cal-today-btn,.cal-cell,.cal-grid,.cal-task-item,.cvt-opt,[draggable="true"]')) return;
      active=true; startY=e.clientY; startTop=col.scrollTop;
      col.classList.add('drag-scroll');
      col.setPointerCapture?.(e.pointerId);
    });
    col.addEventListener('pointermove',e=>{
      if(!active) return;
      col.scrollTop=startTop-(e.clientY-startY);
    });
    const stop=e=>{ active=false; col.classList.remove('drag-scroll'); };
    col.addEventListener('pointerup',stop);
    col.addEventListener('pointercancel',stop);
  });
}
function toggleBank(){
  showPage('bank');
}
function toggleCal(){
  showPage('calendar');
}
function showPage(page, el){
  if(['today','bank','archive'].includes(page)){
    const target = {
      today:'workbenchToday',
      bank:'workbenchBank',
      archive:'secArchive'
    }[page];
    page='todo';
    setTimeout(()=>document.getElementById(target)?.scrollIntoView({behavior:'smooth',block:'start'}),50);
  }
  currentPage=page;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+page));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n===el || (!el && n.dataset.page===page)));
  document.querySelector('.workspace')?.scrollTo({top:0,behavior:'smooth'});
  mountInteractiveSurface();
  render();
}
function setFilter(f, el){
  bankFilter=f;
  // Re-query to handle DOM moves (bankPanel gets relocated by mountInteractiveSurface)
  syncBankFilterUI();
  renderBank();
}

function openModal(id){
  if(id==='mAddTask') refreshDailySectionOptions(document.getElementById('fDailySection')?.value || 'Study');
  if(id==='mSettings') openSettings();
  if(id==='mAddTest') resetTestForm();
  document.getElementById(id).classList.add('show');
}
function closeModal(id){ document.getElementById(id).classList.remove('show');
  if(id==='mAddTask'){
    resetAddForm();
    nlpEditDraft=null;
  }
  if(id==='mAddTest') resetTestForm();
}
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{
  if(e.target===o) closeModal(o.id);
}));

function toggleTheme(){
  const isDark=document.documentElement.dataset.theme==='dark';
  document.documentElement.dataset.theme=isDark?'light':'dark';
  S.settings.theme=isDark?'light':'dark';
  document.getElementById('themeBtn').textContent=isDark?'Dark':'Light';
  save();
}

function applyTheme(){
  document.documentElement.dataset.theme=S.settings.theme||'dark';
  const themeBtn=document.getElementById('themeBtn');
  if(themeBtn) themeBtn.textContent=S.settings.theme==='dark'?'Light':'Dark';
  // Restore accent color
  if(S.settings.accentColor) document.documentElement.style.setProperty('--accent',S.settings.accentColor);
  // Sync swatch UI
  document.querySelectorAll('.accent-swatch').forEach(b=>b.classList.toggle('active',b.dataset.color===(S.settings.accentColor||'#2C4A8B')));
  // Restore density
  setDensity(S.settings.density||'compact', true);
}

function setAccentColor(color, btn){
  S.settings.accentColor=color;
  document.documentElement.style.setProperty('--accent',color);
  save();
  document.querySelectorAll('.accent-swatch').forEach(b=>b.classList.toggle('active',b.dataset.color===color));
}

function setDensity(d, silent){
  S.settings.density = d;
  if(!silent) save();
  const root = document.documentElement;
  const cfgs = {
    compact:{pad:'7px 10px', bank:'7px 9px', daily:'5px 12px', sub:'6px 12px', cal:'44px', font:'12px'},
    normal:{pad:'11px 15px', bank:'9px 11px', daily:'7px 14px', sub:'8px 14px', cal:'55px', font:'13px'},
    spacious:{pad:'16px 22px', bank:'13px 15px', daily:'11px 18px', sub:'12px 18px', cal:'68px', font:'15px'}
  };
  const cfg = cfgs[d] || cfgs.compact;
  root.dataset.density=d;
  root.style.setProperty('--density-pad', cfg.pad);
  root.style.setProperty('--bank-task-pad', cfg.bank);
  root.style.setProperty('--daily-section-pad', cfg.daily);
  root.style.setProperty('--sub-section-pad', cfg.sub);
  root.style.setProperty('--cal-cell-h', cfg.cal);
  root.style.setProperty('--density-font', cfg.font);
  // Apply directly to overcome any inline-style overrides from tweaks panel.
  document.body.style.fontSize=cfg.font;
  document.querySelectorAll('.task-item').forEach(el => { el.style.padding = cfg.pad; });
  document.querySelectorAll('.sec-header').forEach(el => { el.style.padding = cfg.pad; });
  document.querySelectorAll('.bank-task').forEach(el => { el.style.padding = cfg.bank; });
  document.querySelectorAll('.daily-section-header').forEach(el => { el.style.padding = cfg.daily; });
  document.querySelectorAll('.sub-sec-header').forEach(el => { el.style.padding = cfg.sub; });
  // Sync all density toggle buttons
  document.querySelectorAll('.density-btn').forEach(b=>b.classList.toggle('active', b.dataset.d===d));
  syncCalViewToggle();
}

function adjustStudy(delta, directValue){
  const current = S.settings.pomo.focus || 25;
  const next = directValue !== undefined
    ? Math.max(5, Math.min(120, directValue))
    : Math.max(5, Math.min(120, current + delta));
  S.settings.pomo.focus = next;
  renderBreakDisplay();
  resetPomo(); save();
}

function adjustBreak(delta, directValue){
  const current = S.settings.pomo.shortBreak || 5;
  const next = directValue !== undefined
    ? Math.max(1, Math.min(60, directValue))
    : Math.max(1, Math.min(60, current + delta));
  setSessionBreakLength(next);
}

function adjustTargetCycles(delta, directValue){
  const next = directValue !== undefined
    ? Math.max(1, Math.min(12, directValue))
    : Math.max(1, Math.min(12, (pomoState.targetCycles || 4) + delta));
  pomoState.targetCycles = next;
  updateCycleDisplay();
}

function renderBreakDisplay(){
  const brEl = document.getElementById('breakLengthDisplay');
  if(brEl){ if(brEl.tagName==='INPUT'){ brEl.value = S.settings.pomo.shortBreak||5; } else { brEl.textContent=(S.settings.pomo.shortBreak||5)+' min'; } }
  const stEl = document.getElementById('studyLengthDisplay');
  if(stEl){ if(stEl.tagName==='INPUT'){ stEl.value = S.settings.pomo.focus||25; } else { stEl.textContent=(S.settings.pomo.focus||25)+' min'; } }
}

function updateCycleDisplay(){
  const el = document.getElementById('cycleDisplay');
  if(el) el.textContent = (pomoState.phase==='calibrationFocus' || pomoState.phase==='calibrationBreak')
    ? 'Stopwatch calibration'
    : `Cycle ${pomoState.cycles+1} / ${pomoState.targetCycles}`;
  const adj = document.getElementById('cycleTargetDisplay');
  if(adj){ if(adj.tagName==='INPUT'){ adj.value = pomoState.targetCycles; } else { adj.textContent = pomoState.targetCycles; } }
}

function openSettings(){
  document.getElementById('sName').value=S.settings.name||'Jay';
  document.getElementById('sDark').checked=S.settings.theme==='dark';
  document.getElementById('sPomoFocus').value=S.settings.pomo.focus;
  document.getElementById('sPomoShort').value=S.settings.pomo.shortBreak;
  document.getElementById('sPomoLong').value=S.settings.pomo.longBreak;
  document.getElementById('sPomoCycles').value=S.settings.pomo.cycles;
  document.getElementById('sAlarmSound').value=S.settings.alarmSound||'chime';
  setupAuthUI();
  renderDeletedList();
}
function saveSettings(){
  S.settings.name=document.getElementById('sName').value.trim()||'Jay';
  if(activeUser?.signedIn && activeUser.name!==S.settings.name){
    activeUser.name=S.settings.name;
    localStorage.setItem(AUTH_KEY, JSON.stringify(activeUser));
  }
  S.settings.theme=document.getElementById('sDark').checked?'dark':'light';
  S.settings.pomo.focus=+document.getElementById('sPomoFocus').value||25;
  S.settings.pomo.shortBreak=+document.getElementById('sPomoShort').value||5;
  S.settings.pomo.longBreak=+document.getElementById('sPomoLong').value||15;
  S.settings.pomo.cycles=+document.getElementById('sPomoCycles').value||4;
  S.settings.alarmSound=document.getElementById('sAlarmSound').value||'chime';
  applyTheme(); save(); updateBranding(); closeModal('mSettings'); resetPomo();
}

// ════════════════════════════════════════════════════════════
//  ACCOUNT GATE
// ════════════════════════════════════════════════════════════
function setupAuthUI(){
  const gate=document.getElementById('authGate');
  const name=document.getElementById('authName');
  const email=document.getElementById('authEmail');
  const label=document.getElementById('accountLabel');
  const firebaseUser=window.JayFirebaseAuth?.currentUser;
  if(firebaseUser && activeUser?.uid!==firebaseUser.uid) applyAuthenticatedUser(firebaseUser,false);
  if(name) name.value=activeUser?.name && activeUser.name!=='Local user' ? activeUser.name : (S.settings.name||'');
  if(email) email.value=activeUser?.email||'';
  if(label) label.textContent=activeUser?.signedIn ? `${activeUser.email||activeUser.name||'Signed in'}${activeUser.mode==='firebase'?' (Firebase)':''}` : 'Local browser data';
  updateBranding();
  setAuthStatus(window.JayFirebaseAuth?.enabled
    ? 'Firebase Auth ready. Use your email and password.'
    : 'Firebase is not configured yet. Fill firebase-config.js, then refresh.');
  if(gate) gate.classList.toggle('show', !activeUser?.signedIn && !localStorage.getItem(KEY+'_auth_dismissed'));
  if(!window.__authGateEscapeReady){
    window.__authGateEscapeReady=true;
    document.addEventListener('keydown', e=>{
      if(e.key==='Escape' && document.getElementById('authGate')?.classList.contains('show')) useLocalMode();
    });
    document.addEventListener('jay-auth-state', e=>{
      if(e.detail) applyAuthenticatedUser(e.detail,true);
      else if(activeUser?.mode==='firebase') signOutLocalAccount(false);
    });
    document.addEventListener('jay-auth-unconfigured', ()=>{
      setAuthStatus('Firebase is not configured yet. Fill firebase-config.js, then refresh.');
    });
  }
}
function setAuthStatus(message){
  const el=document.getElementById('authStatus');
  if(el) el.textContent=message;
}
function useLocalMode(){
  localStorage.setItem(KEY+'_auth_dismissed','1');
  document.getElementById('authGate')?.classList.remove('show');
  showToast('Using local browser data. You can link an account from Settings.');
}
async function applyAuthenticatedUser(user,shouldRender=true){
  if(!user?.uid) return;
  const previousState=JSON.parse(JSON.stringify(S));
  const nextUser={
    uid:user.uid,
    email:user.email||'',
    name:user.name||user.email?.split('@')[0]||'User',
    mode:user.mode||'firebase',
    signedIn:true,
    linkedAt:Date.now()
  };
  activeUser=nextUser;
  localStorage.setItem(AUTH_KEY, JSON.stringify(activeUser));
  localStorage.setItem(KEY+'_auth_dismissed','1');
  const targetKey=storageKeyForUser(nextUser);
  suppressCloudSave=true;
  let remoteState=null;
  try{
    if(window.JayFirebaseAuth?.enabled) remoteState=await window.JayFirebaseAuth.loadState(activeUser.uid);
  }catch(err){
    setAuthStatus('Cloud load failed. Using this browser data.');
  }
  const localRaw=localStorage.getItem(targetKey);
  const localParsed=localRaw ? (() => { try{ return JSON.parse(localRaw); }catch(e){ return null; } })() : null;
  const stateIsEmpty=(s)=>!s || ((s.tasks||[]).length===0 && (s.events||[]).length===0 && (s.sessions||[]).length===0);
  let shouldPushLocal=false;
  if(remoteState && localParsed){
    const remoteTime=remoteState.lastModified||0;
    const localTime=localParsed.lastModified||0;
    if(localTime>remoteTime && !stateIsEmpty(localParsed)){
      S=normalizeState(Object.assign({},DEF,localParsed));
      setAuthStatus('Synced. (Local data was up to date.)');
      shouldPushLocal=true;
    }else{
      S=normalizeState(Object.assign({},DEF,remoteState));
      localStorage.setItem(targetKey, JSON.stringify(S));
      setAuthStatus('Loaded your cloud data.');
    }
  }else if(remoteState){
    S=normalizeState(Object.assign({},DEF,remoteState));
    localStorage.setItem(targetKey, JSON.stringify(S));
    setAuthStatus('Loaded your cloud data.');
  }else{
    S=normalizeState(Object.assign({},DEF,previousState));
    if(activeUser.name && (!S.settings.name || S.settings.name==='Jay')) S.settings.name=activeUser.name;
    localStorage.setItem(targetKey, JSON.stringify(S));
    if(stateIsEmpty(S)){
      setAuthStatus('No cloud data yet. Add tasks to start syncing.');
    }else{
      setAuthStatus('No cloud data yet. Seeded this account from this browser.');
      shouldPushLocal=true;
    }
  }
  suppressCloudSave=false;
  cloudReady=true;
  if(shouldPushLocal) scheduleCloudSave();
  document.getElementById('authGate')?.classList.remove('show');
  if(shouldRender){
    setupAuthUI();
    render();
    showToast(`Signed in as ${activeUser.email || activeUser.name}.`);
  }
}
async function signInLocalAccount(event){
  event?.preventDefault?.();
  const action=event?.submitter?.dataset?.authAction || 'login';
  const email=(document.getElementById('authEmail')?.value||'').trim().toLowerCase();
  const name=(document.getElementById('authName')?.value||'').trim() || email.split('@')[0] || 'User';
  const password=document.getElementById('authPassword')?.value||'';
  if(!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    showToast('Enter a valid email to create or open an account.');
    return;
  }
  if(!window.JayFirebaseAuth?.enabled){
    setAuthStatus('Firebase is not configured yet. Fill firebase-config.js with your Firebase web app config.');
    showToast('Firebase is not configured yet.');
    return;
  }
  try{
    setAuthStatus(action==='signup' ? 'Creating account...' : action==='reset' ? 'Sending reset email...' : 'Logging in...');
    if(action==='reset'){
      await window.JayFirebaseAuth.resetPassword(email);
      setAuthStatus('Password reset email sent.');
      showToast('Password reset email sent.');
      return;
    }
    if(password.length<8){
      setAuthStatus('Password must be at least 8 characters.');
      showToast('Password must be at least 8 characters.');
      return;
    }
    action==='signup'
      ? await window.JayFirebaseAuth.signUp(email,password,name)
      : await window.JayFirebaseAuth.signIn(email,password);
    // onAuthStateChanged fires jay-auth-state which calls applyAuthenticatedUser
  }catch(err){
    const msg=String(err?.message||err||'Authentication failed.').replace(/^Firebase:\s*/,'');
    setAuthStatus(msg);
    showToast(msg);
  }
}
async function signOutLocalAccount(callFirebase=true){
  save();
  cloudReady=false;
  clearTimeout(cloudSaveTimer);
  const wasFirebase=activeUser?.mode==='firebase';
  activeUser={uid:'local', email:'', name:'Local user', mode:'local', signedIn:false};
  if(callFirebase && window.JayFirebaseAuth?.enabled && wasFirebase){
    try{ await window.JayFirebaseAuth.signOut(); }catch(e){}
  }
  localStorage.setItem(AUTH_KEY, JSON.stringify(activeUser));
  S=loadState();
  setupAuthUI();
  render();
  showToast('Signed out. Showing local browser data.');
}
function openAuthGate(){
  localStorage.removeItem(KEY+'_auth_dismissed');
  setupAuthUI();
  document.getElementById('authGate')?.classList.add('show');
}

function playPop(freq=880){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(); const gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(freq,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq/2,ctx.currentTime+.15);
    gain.gain.setValueAtTime(.25,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.35);
    osc.start(); osc.stop(ctx.currentTime+.35);
  }catch(e){}
}

function playAlarm(){
  if(S.settings.alarmSound==='none') return;
  const base=S.settings.alarmSound==='bell'?1040:S.settings.alarmSound==='soft'?520:780;
  playPop(base);
  setTimeout(()=>playPop(base*1.25),180);
}

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escJs(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' '); }

function checkThursdayReview(){
  if(new Date().getDay()===4){
    const shown=localStorage.getItem('jay_thu_review');
    if(shown!==todayStr()){
      localStorage.setItem('jay_thu_review',todayStr());
      document.getElementById('thuCard').style.display='flex';
    }
  }
}

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
(function init(){
  // Start active time tracking
  if(S.settings.activeDate!==todayStr()){
    S.settings.activeStart=Date.now();
    S.settings.activeDate=todayStr();
  }
  if(!S.settings.activeStart) S.settings.activeStart=Date.now();
  save();
  applyTheme();
  openSettings(); // pre-fill settings form
  document.querySelectorAll('.pomo-preset-btn,.pomo-preset-card').forEach(b=>b.classList.toggle('active',b.dataset.preset===S.settings.pomo.presetMode));
  setupAuthUI();
  restorePomoRuntime();
  const pr=getPomoConfig();
  if(pomoState.phase==='calibrationFocus' || pomoState.phase==='calibrationBreak') updateHUDDisplay(-pomoState.elapsed, pr.focus*60);
  else if(pomoState.phase==='focusOver' || pomoState.phase==='breakOver') updateHUDDisplay(-pomoState.extendedElapsed, pomoPhaseTotal() || pr.focus*60);
  else updateHUDDisplay((pomoPhaseTotal() || pr.focus*60)-pomoState.elapsed, pomoPhaseTotal() || pr.focus*60);
  document.getElementById('hudPlay').textContent=pomoState.running?'⏸':'▶';
  document.getElementById('hudPlay').classList.toggle('active',!!pomoState.running);
  render();
  checkThursdayReview();

  // Refresh EOPR every minute
  setInterval(updateEOPR, 60000);

  // Re-render at midnight for habit reset
  const msToMidnight=()=>{
    const now=new Date(), next=new Date(now);
    next.setHours(24,0,0,0);
    return next-now;
  };
  setTimeout(()=>{ render(); setInterval(render,86400000); }, msToMidnight());
})();
