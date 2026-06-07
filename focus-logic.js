
// ════════════════════════════════════════════════════════════
//  FIREBASE INITIALIZATION
// ════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyCZ-Xt-2_PLT0CIOJbqcTCUxt28Zf8S6-k",
  authDomain: "to-do-focus-list.firebaseapp.com",
  databaseURL: "https://to-do-focus-list-default-rtdb.firebaseio.com",
  projectId: "to-do-focus-list",
  storageBucket: "to-do-focus-list.firebasestorage.app",
  messagingSenderId: "910455481238",
  appId: "1:910455481238:web:0622e08f73fc1cb1e5f3b7",
  measurementId: "G-JSYD5Y3H40"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();
let currentUser = null;

// ════════════════════════════════════════════════════════════
//  DATA
// ════════════════════════════════════════════════════════════
const KEY = 'jay_hub_v3';
const DEF = {
  tasks:[], sessions:[], events:[], icalImports:[],
  nlpCorrections:{}, eoprLog:[], deleted:[], focusReports:[],
  mustOverrides:[],  // [{date:'YYYY-MM-DD', reason:'…', mustTaskIds:[…], overriddenAt:ts}]
  icalSources:[],    // [{id, name, color, fileName, importedAt}] — one per imported calendar
  dailySections:['Study'],
  settings:{
    theme:'dark', name:'Jay', appName:'Focus Hub', appSubtitle:'Productivity planner',
    welcomeSeen:false, activeStart:null, focusGoal:'', alarmSound:'chime',
    pomo:{ presetMode:'classic', focus:25, shortBreak:5, longBreak:15, cycles:4 },
    // How many all-day items to show per week-view column before
    // collapsing into "+N more". User-adjustable via the all-day gutter.
    alldayCap: 3,
    // Calendar zoom level (1.0 = default). Scales month-cell height,
    // week-view hourPx, and how many chips fit per month cell.
    // Adjust via Cmd/Ctrl+scroll, pinch on trackpad, or Cmd/Ctrl + = / -.
    calZoom: 1.0,
    // ── COGNITIVE SCAFFOLDS ──
    // Five features for ADHD/ENTJ executive-function support.
    scaffolds: {
      firstStep: true,      // show "first 5-second move" on task cards
      quickCapture: true,   // Cmd+K global brain-dump
      dopamineGate: true,   // visually dim planning tasks until execute work
      domainModes: true,    // assign tasks to domains (Active / KTLO)
      timeAnchor: true      // intrusive toast every focus interval
    },
    dopamineGate: {
      minExecuteMinutes: 15,
      enforce: 'soft'
    }
  },
  // Brain-dump inbox — captured ideas waiting to be processed
  brainDump: [],
  // Domains the user is running. { [name]: { mode, color, createdAt } }
  domains: {}
};

// Calendar source palette — aesthetic-matching set used to color imported
// calendars. Rotates through these when assigning a new source.
const CAL_SOURCE_PALETTE = [
  '#7aa2ff', // accent blue
  '#4dd49a', // mint green
  '#f59040', // orange
  '#b07fff', // purple
  '#ff7faa', // pink
  '#f26060', // red
  '#e9c46a', // yellow
  '#7fc7ff', // sky
  '#9fe0c7', // teal
  '#9aa0ac'  // grey
];

let S = loadState();
let calViewDate = new Date();
let calSelectedDate = todayStr();
let calViewMode = 'both'; // 'tasks' | 'both' | 'events'
let calLayout = (() => {
  try { return localStorage.getItem('focus_cal_layout') === 'week' ? 'week' : 'month'; }
  catch(_) { return 'month'; }
})();   // 'month' | 'week' — Google-Calendar style hour grid

// Week hour grid constants
const WEEK_START_HOUR = 6;   // 6 AM
const WEEK_END_HOUR   = 24;  // midnight
const WEEK_HOUR_PX    = 56;  // height of one hour row in the week view
let bankFilter = 'all';
let bankSearchQuery = '';
let bankMode = (() => {
  try { return localStorage.getItem('focus_bank_mode') === 'events' ? 'events' : 'tasks'; }
  catch(_) { return 'tasks'; }
})();
let nlpParsed = null;
let currentPomoTask = null;
let pomoState = { running:false, phase:'focus', elapsed:0, cycles:0, targetCycles:4, sessionStart:null, plannedFocus:0, plannedBreak:0, extendedElapsed:0, breakElapsed:0, sessionId:null };
let pomoTimer = null;
let pendingFocusReport = null;
let sessionTaskSnapshot = {};
let sessionDistractionLog = []; // {ts, phase, elapsed} per distraction event
let editSelectedPri = 'medium';
let editSelectedDays = [];
let editModalSubtasks = [];
let editScheduledDates = [];
let schedulePickerDate = new Date();
let duePickerDate = new Date();
let scheduleDragActive = false;
let scheduleDragMode = 'add';
let currentPage = 'dashboard';
let bankVisibleCount = 8;
let bankSort = 'due';
let dailySort = 'section';
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
function loadState(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const normalized = normalizeState(Object.assign({},DEF, JSON.parse(raw)));
      localStorage.setItem(KEY, JSON.stringify(normalized));
      return normalized;
    }
  }catch(e){}
  // Migrate v1
  try{
    const v1 = JSON.parse(localStorage.getItem('jay_hub_v1'));
    if(v1){
      const normalized = normalizeState(migrateV1(v1));
      localStorage.setItem(KEY, JSON.stringify(normalized));
      return normalized;
    }
  }catch(e){}
  return normalizeState(JSON.parse(JSON.stringify(DEF)));
}
function normalizeState(state){
  state.dailySections = (Array.isArray(state.dailySections) && state.dailySections.length ? state.dailySections : ['Study']).filter(s=>s && s !== 'Admin');
  if(!state.dailySections.length) state.dailySections=['Study'];
  state.tasks = (state.tasks||[]).map(t=>Object.assign({
    type:'task', priority:'medium', due:'', scheduledDates:[], scheduledDays:[],
    dailySection:'Study', calendarSignal:'auto', subtasks:[], progress:0, customOrder:0,
    completedDates:{}, dueCompletedDates:{}, skippedDates:{}, habitStart:'', habitEnd:'', archived:false, completed:false, focusPoints:0,
    // ── Cognitive-scaffold fields ──
    firstStep:'',     // the 5-second move ("put left shoe on")
    taskKind:'',      // 'execute' | 'plan' | ''
    domain:''         // free-text domain name, looked up in S.domains
  }, t));
  state.tasks.forEach((t,i)=>{
    if(t.dailySection==='Admin') t.dailySection='Study';
    if(!Number.isFinite(Number(t.customOrder)) || Number(t.customOrder)<=0) t.customOrder = t.createdAt || ((i+1)*1000);
    if(!t.skippedDates || typeof t.skippedDates !== 'object') t.skippedDates = {};
    (t.subtasks||[]).forEach(st=>{
      if(!st.doneDates || typeof st.doneDates !== 'object') st.doneDates = {};
      if(!Array.isArray(st.scheduledDates)) st.scheduledDates = [];
    });
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
  if(typeof state.settings.askOnCalendarDrop !== 'boolean') state.settings.askOnCalendarDrop = false;
  state.nlpCorrections = state.nlpCorrections || {};
  state.deleted = state.deleted || [];
  state.focusReports = state.focusReports || [];
  state.mustOverrides = Array.isArray(state.mustOverrides) ? state.mustOverrides : [];
  state.icalSources = Array.isArray(state.icalSources) ? state.icalSources : [];
  state.events = (state.events||[]).map(e=>Object.assign({type:'event', color:eventColorForType(e.type||'event')}, e));
  // ── Cognitive scaffold defaults for existing users ──
  state.brainDump = Array.isArray(state.brainDump) ? state.brainDump : [];
  state.domains = (state.domains && typeof state.domains === 'object') ? state.domains : {};
  if(!state.settings.scaffolds || typeof state.settings.scaffolds !== 'object'){
    state.settings.scaffolds = { firstStep:true, quickCapture:true, dopamineGate:true, domainModes:true, timeAnchor:true };
  }
  if(!state.settings.dopamineGate || typeof state.settings.dopamineGate !== 'object'){
    state.settings.dopamineGate = { minExecuteMinutes:15, enforce:'soft' };
  }
  return state;
}
function save(){ saveUserDataToFirebase(); }

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
// True when a timestamp (ms epoch) falls on the given YYYY-MM-DD local date.
function isSameDay(ts, dateStr){
  if(!ts || !dateStr) return false;
  // Accept either a numeric timestamp or a date string (ISO or 'YYYY-MM-DD').
  // Number('2026-05-22T…') is NaN, so coerce intelligently.
  const d = typeof ts === 'number'
    ? new Date(ts)
    : (typeof ts === 'string' ? new Date(ts) : new Date(Number(ts)));
  if(Number.isNaN(d.getTime())) return false;
  return (d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())) === dateStr;
}

// True when an event "occurs" on the given YYYY-MM-DD — direct match OR
// matches a recurring event (weekly/daily/monthly) honoring EXDATE skips
// and recurrenceUntil. Lets iCal RRULE events render on every matching day.
function eventOccursOn(e, ds){
  if(!e || !ds) return false;
  if(e.date === ds) return true;
  if(e.exdates && e.exdates.includes(ds)) return false;
  const rec = (e.recurrence||'').toLowerCase();
  if(!rec || rec==='none') return false;
  if(!e.date || ds < e.date) return false;
  if(e.recurrenceUntil && ds > e.recurrenceUntil) return false;
  const days = Array.isArray(e.recurrenceDays) ? e.recurrenceDays : [];
  const targetDow = new Date(ds+'T00:00:00').getDay();
  if(rec === 'daily') return true;
  if(rec === 'weekly'){
    if(days.length) return days.includes(targetDow);
    // Fall back to same-DOW as the original start
    return new Date(e.date+'T00:00:00').getDay() === targetDow;
  }
  if(rec === 'monthly'){
    return new Date(e.date+'T00:00:00').getDate() === new Date(ds+'T00:00:00').getDate();
  }
  if(rec === 'yearly'){
    const orig = new Date(e.date+'T00:00:00');
    const t = new Date(ds+'T00:00:00');
    return orig.getMonth()===t.getMonth() && orig.getDate()===t.getDate();
  }
  return false;
}
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
// Task bank + daily list sort. Always groups items with a date (due or
// scheduledDates) AHEAD of items with no date at all — so the bottom of any
// sorted list is the "no date set" pile, regardless of which mode is picked.
function sortTasks(tasks, mode='due'){
  const arr=[...tasks];
  const hasAnyDate = t => !!(t && (t.due || (t.scheduledDates||[]).filter(Boolean).length));
  // 0 for has-date, 1 for no-date — sort ascending so has-date wins.
  const dateGroup = t => hasAnyDate(t) ? 0 : 1;
  const primary = (a,b) => dateGroup(a) - dateGroup(b);
  if(mode==='priority'){
    arr.sort((a,b)=>primary(a,b) || priorityRank(a.priority)-priorityRank(b.priority) || taskDueKey(a).localeCompare(taskDueKey(b)) || String(a.title||'').localeCompare(String(b.title||'')));
  }else if(mode==='created'){
    arr.sort((a,b)=>primary(a,b) || (b.createdAt||0)-(a.createdAt||0) || String(a.title||'').localeCompare(String(b.title||'')));
  }else if(mode==='title'){
    arr.sort((a,b)=>primary(a,b) || String(a.title||'').localeCompare(String(b.title||'')) || taskDueKey(a).localeCompare(taskDueKey(b)));
  }else if(mode==='custom'){
    arr.sort((a,b)=>primary(a,b) || taskCustomOrder(a)-taskCustomOrder(b) || taskDueKey(a).localeCompare(taskDueKey(b)) || String(a.title||'').localeCompare(String(b.title||'')));
  }else{
    arr.sort((a,b)=>primary(a,b) || taskDueKey(a).localeCompare(taskDueKey(b)) || priorityRank(a.priority)-priorityRank(b.priority) || String(a.title||'').localeCompare(String(b.title||'')));
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
function isSkipped(t, dateStr){
  return !!(t && t.skippedDates && t.skippedDates[dateStr]);
}
function isHabitDueToday(t, dateStr){
  if(!t.isHabit) return false;
  if(isSkipped(t,dateStr)) return false;
  if(t.habitStart && dateStr < t.habitStart) return false;
  if(t.habitEnd && dateStr > t.habitEnd) return false;
  const d = new Date(dateStr+'T00:00:00');
  const dow = d.getDay();
  return t.scheduledDays.includes(dow);
}
function isScheduledToday(t, dateStr){
  if(isSkipped(t,dateStr)) return false;
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

// ════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════
// render() coalesces multiple calls within a single animation frame so
// rapid completion-button clicks don't redo the entire UI 5× in a row.
// This was the root cause of "completion lags after a couple of uses".
let _renderRaf = 0;
function render(){
  if(_renderRaf) return;
  _renderRaf = requestAnimationFrame(() => {
    _renderRaf = 0;
    _renderImmediate();
  });
}
function _renderImmediate(){
  if(archiveCompletedOneOffTasks(S)) save();
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
  const calSplit=document.getElementById('calSplitResize');
  const importSec=document.getElementById('icalImportSec');
  const calSlot=currentPage==='calendar' ? document.getElementById('calendarPageHost') : document.getElementById('workbenchCalendar');
  const importSlot=document.getElementById('icalModalBody');
  if(calSlot){
    if(cal && cal.parentElement!==calSlot) calSlot.appendChild(cal);
    // Insert the split handle between the calendar panel and the day-tasks
    // card so it's a sibling in the flex column.
    if(calSplit && calSplit.parentElement!==calSlot) calSlot.appendChild(calSplit);
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
  renderHomeHero();
  bindHomeDisclosures();
  renderDashboardTodayTasks(today);
  renderDashboardHabits();
  // Cognitive scaffolds dashboard widgets — guarded so absence of DOM
  // elements (older builds) just no-ops.
  renderGateBadge();
  renderDomainPanel();
  // Focus & Habit Health and Advice panels were removed from the dashboard
  // markup — guard the renders so they no-op cleanly if the DOM elements
  // are absent.
  if (document.getElementById('dashFocus'))  renderDashboardFocus(todayStats);
  if (document.getElementById('dashAdvice')) renderDashboardAdvice();
  renderMissedCarryList();
}

// Today's Tasks card on the dashboard — a compact, clickable list of what's
// due/scheduled today. Mirrors the Todo page's data but renders inline so the
// user can see and tick things off without leaving the dashboard.
function renderDashboardTodayTasks(today){
  const wrap = document.getElementById('dashTodayTasks');
  const counter = document.getElementById('dashTodayCounter');
  if(!wrap) return;
  const all = S.tasks.filter(t => !isArchivedForTodo(t)
    && (isHabitDueToday(t, today)
        || (t.scheduledDates||[]).includes(today)
        || (t.due===today && !isDueSignalDone(t, today))));
  const must = all.filter(t => t.priority === 'MUST');
  const habits = all.filter(t => t.priority !== 'MUST' && t.isHabit);
  const regular = all.filter(t => t.priority !== 'MUST' && !t.isHabit);
  const sorted = [
    ...sortTasks(must, 'priority'),
    ...sortTasks(regular, dailySort === 'section' ? 'due' : dailySort),
    ...sortTasks(habits, 'title')
  ];

  const done = sorted.filter(t => isTaskDone(t, today)).length;
  const total = sorted.length;
  if(counter) counter.textContent = total ? `${done} of ${total} done` : 'Nothing scheduled today';

  if(!total){
    wrap.innerHTML = `<div class="empty" style="padding:20px 8px;text-align:left">
      Nothing scheduled for today. Add tasks from the Todo page or use Quick Add above.
    </div>`;
    return;
  }

  wrap.innerHTML = sorted.map(t => renderDashTaskRow(t, today)).join('');
}

function renderDashTaskRow(t, today){
  const done = isTaskDone(t, today);
  const priClass = t.priority === 'MUST' ? 'must'
                 : t.priority === 'high' ? 'high'
                 : t.priority === 'low'  ? 'low' : 'medium';
  const subjectChip = t.subject ? `<span class="dash-task-subject">${esc(t.subject)}</span>` : '';
  const timeChip = t.scheduledTime ? `<span class="dash-task-time">⏰ ${esc(t.scheduledTime)}</span>` : '';
  const dueChip = (t.due && t.due!==today) ? `<span class="dash-task-due">Due ${esc(fmtDate(t.due))}</span>` : '';
  const habitChip = t.isHabit ? `<span class="dash-task-habit">↻</span>` : '';
  return `<div class="dash-task-row ${done?'done':''} pri-${priClass}">
    <button type="button" class="dash-task-cb" onclick="toggleTask('${t.id}','${today}')" aria-label="Toggle done">${done?'✓':''}</button>
    <button type="button" class="dash-task-main" onclick="editTask('${t.id}')">
      <span class="dash-task-title">${esc(t.title)}</span>
      <span class="dash-task-meta">${habitChip}${subjectChip}${timeChip}${dueChip}</span>
    </button>
  </div>`;
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

// ── MUST overrides ──
// User can bypass the MUST gate for one day by writing down WHY. The reason
// is captured so future versions can mine the pattern (e.g. "always overridden
// on Fridays because of class" → recommend rescheduling those MUSTs).
function hasMustOverrideToday(){
  const today = todayStr();
  return (S.mustOverrides || []).some(o => o && o.date === today);
}
function getMustOverrideToday(){
  const today = todayStr();
  return (S.mustOverrides || []).find(o => o && o.date === today) || null;
}
async function requestMustOverride(){
  if (hasMustOverrideToday()) return; // already overridden today
  const today = todayStr();
  const reason = await designPrompt(
    'Override MUST gate',
    'Why are you skipping past your MUST tasks today? Be honest — this helps the app suggest better habits and reschedules over time.',
    '',
    'Override today',
    'Cancel'
  );
  if (reason === null) return; // user cancelled
  const text = String(reason || '').trim();
  if (!text) {
    showToast('Override needs a reason. Try again.');
    return;
  }
  const incompleteIds = S.tasks
    .filter(t => t.priority === 'MUST' && !isArchivedForTodo(t)
              && (isHabitDueToday(t, today) || (t.scheduledDates || []).includes(today))
              && !isTaskDone(t, today))
    .map(t => t.id);
  if (!Array.isArray(S.mustOverrides)) S.mustOverrides = [];
  S.mustOverrides.push({
    date: today,
    reason: text.slice(0, 600),
    mustTaskIds: incompleteIds,
    overriddenAt: Date.now()
  });
  save(); render();
  showToast('Override saved. Reason logged for future suggestions.');
}
function cancelMustOverrideToday(){
  const today = todayStr();
  if (!Array.isArray(S.mustOverrides)) return;
  S.mustOverrides = S.mustOverrides.filter(o => !o || o.date !== today);
  save(); render();
}
function renderMustBanner(banner, must, today){
  const incomplete = must.filter(t => !isTaskDone(t, today)).length;
  banner.innerHTML = `
    <span class="must-banner-msg">${incomplete} MUST task${incomplete===1?'':'s'} left — finish to unlock today.</span>
    <button class="btn-sm must-override-btn" onclick="requestMustOverride()">Override…</button>
  `;
}
function renderMustOverrideBanner(banner, today){
  const o = getMustOverrideToday();
  const why = o && o.reason ? `: "${esc(o.reason)}"` : '';
  banner.innerHTML = `
    <span class="must-banner-msg">⚠ MUST gate overridden today${why}</span>
    <button class="btn-sm must-override-btn" onclick="cancelMustOverrideToday()">Re-lock</button>
  `;
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
  const target = dateOverride || todayStr();
  // Carrying over should remove the task from its missed day(s), not leave it
  // lingering there. Drop any scheduled dates earlier than the target.
  if(Array.isArray(t.scheduledDates)){
    t.scheduledDates = t.scheduledDates.filter(d => d && d >= target);
  } else {
    t.scheduledDates = [];
  }
  // If the original due date is now in the past, clear it — the user has
  // explicitly chosen to work on this task today, so the missed deadline
  // is no longer a relevant signal.
  if(t.due && t.due < target) t.due = '';
  if(!t.scheduledDates.includes(target)) t.scheduledDates.push(target);
  t.carriedAt=Date.now();
  calSelectedDate=target;
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

// Normalize text for fuzzy/space-insensitive search.
// "To do list!" → "todolist". "Wash dishes" → "washdishes".
function normalizeForSearch(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Urgency helpers (used to color and label bank items by time-to-due) ──
// Returns a category string used both for CSS coloring and chip class.
//   overdue · urgent (≤24h) · soon (≤48h) · week (≤7d) · far · no-due
function itemDeadline(item){
  // For events: end of event window (or start if no end time)
  if(item && item.date){
    const dateOnly = item.date;
    if(item.allDay !== false && !item.time) return new Date(dateOnly + 'T23:59:59');
    const t = item.endTime || item.time || '23:59';
    return new Date(dateOnly + 'T' + (t.length === 5 ? t : '23:59') + ':00');
  }
  // For tasks: due date (or earliest scheduledDate)
  if(item){
    const ds = item.due || (Array.isArray(item.scheduledDates) ? [...item.scheduledDates].sort()[0] : '');
    if(!ds) return null;
    const t = item.scheduledTime || '23:59';
    return new Date(ds + 'T' + (t.length === 5 ? t : '23:59') + ':00');
  }
  return null;
}
function urgencyClassFor(item){
  const dl = itemDeadline(item);
  if(!dl || isNaN(dl)) return 'no-due';
  const ms = dl.getTime() - Date.now();
  if(ms < 0) return 'overdue';
  const h = ms / 3600000;
  if(h <= 24) return 'urgent';
  if(h <= 48) return 'soon';
  if(h <= 168) return 'week';
  return 'far';
}
function timeLeftLabel(item){
  const dl = itemDeadline(item);
  if(!dl || isNaN(dl)) return '';
  const ms = dl.getTime() - Date.now();
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const weeks = Math.round(abs / (86400000 * 7));
  let label;
  if(mins < 60) label = `${mins}m`;
  else if(hours < 48) label = `${hours}h`;
  else if(days < 14) label = `${days}d`;
  else if(weeks < 9) label = `${weeks}w`;
  else label = `${Math.round(days / 30)}mo`;
  return overdue ? `${label} overdue` : `${label} left`;
}
function timeRangeLabel(ev){
  if(!ev) return '';
  if(ev.allDay !== false && !ev.time) return 'All day';
  const start = ev.time || '';
  const end = ev.endTime || '';
  if(start && end) return `${start} – ${end}`;
  if(start) return start;
  if(end) return `until ${end}`;
  return '';
}
function setBankMode(mode){
  bankMode = mode === 'events' ? 'events' : 'tasks';
  try { localStorage.setItem('focus_bank_mode', bankMode); } catch(_) {}
  document.querySelectorAll('.bmt-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === bankMode));
  // Filter chips are only meaningful for tasks; hide for events
  const filters = document.getElementById('bankFilters');
  if(filters) filters.style.display = bankMode === 'events' ? 'none' : '';
  renderBank();
}
function taskMatchesSearch(t, query){
  if(!query) return true;
  const q = normalizeForSearch(query);
  if(!q) return true;
  const haystack = normalizeForSearch(
    `${t.title || ''} ${t.subject || ''} ${t.notes || ''} ${(t.subtasks||[]).map(s=>s.text).join(' ')}`
  );
  return haystack.includes(q);
}
function setBankSearch(value){
  bankSearchQuery = String(value || '');
  // Update the clear button visibility
  const clearBtn = document.getElementById('bankSearchClear');
  if(clearBtn) clearBtn.style.display = bankSearchQuery.trim() ? 'flex' : 'none';
  renderBank();
}
function clearBankSearch(){
  bankSearchQuery = '';
  const input = document.getElementById('bankSearchInput');
  if(input) input.value = '';
  const clearBtn = document.getElementById('bankSearchClear');
  if(clearBtn) clearBtn.style.display = 'none';
  renderBank();
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
  // Sync the search input value (in case state changed elsewhere)
  const searchInput = document.getElementById('bankSearchInput');
  if(searchInput && searchInput.value !== bankSearchQuery){
    searchInput.value = bankSearchQuery;
  }
  const clearBtn = document.getElementById('bankSearchClear');
  if(clearBtn) clearBtn.style.display = bankSearchQuery.trim() ? 'flex' : 'none';
  // Sync the mode-toggle UI
  document.querySelectorAll('.bmt-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === bankMode));
  const filtersWrap = document.getElementById('bankFilters');
  if(filtersWrap) filtersWrap.style.display = bankMode === 'events' ? 'none' : '';

  if(bankMode === 'events'){
    renderEventBank(list);
    return;
  }

  const tasks = sortTasks(S.tasks.filter(t=>{
    if(t.archived || t.completed) return false;
    if(!taskMatchesBankFilter(t, bankFilter)) return false;
    if(!taskMatchesSearch(t, bankSearchQuery)) return false;
    return true;
  }), bankSort);
  if(!tasks.length){
    const msg = bankSearchQuery.trim()
      ? `<div class="empty"><div class="empty-icon">🔎</div>No tasks match "${esc(bankSearchQuery)}"</div>`
      : `<div class="empty"><div class="empty-icon">📭</div>No tasks here</div>`;
    list.innerHTML = msg;
    return;
  }
  const visible=tasks.slice(0,bankVisibleCount);
  if(!window._bankExpanded) window._bankExpanded = new Set();
  list.innerHTML = visible.map(t=>{
    const unassigned=taskNeedsStudyAssignment(t);
    const urgency = urgencyClassFor(t);
    const timeLeft = timeLeftLabel(t);
    const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
    const hasSubs = subtasks.length > 0;
    const expanded = window._bankExpanded.has(t.id);
    const doneCount = subtasks.filter(s => s.done).length;
    // Cognitive-scaffold visual state
    const ktlo = typeof isKtloTask === 'function' && isKtloTask(t);
    const gated = typeof isPlanTaskGated === 'function' && isPlanTaskGated(t);
    const domainColor = (t.domain && S.domains?.[t.domain]?.color) || '';
    const showFirstStep = !!(t.firstStep && S.settings?.scaffolds?.firstStep);
    return `
    <div class="bank-task fade-up ${unassigned?'unassigned':''} ${ktlo?'ktlo':''} ${gated?'plan-gated':''}" draggable="true"
      data-urgency="${urgency}"
      ${domainColor?`style="--domain-color:${esc(domainColor)}"`:''}
      ondragstart="onBankDragStart(event,'${t.id}')"
      ondragend="onTaskDragEnd(event)"
      ondragover="onBankTaskDragOver(event,'${t.id}')"
      ondragleave="onTaskRowDragLeave(event)"
      ondrop="onBankTaskDrop(event,'${t.id}')"
      onclick="editTask('${t.id}')">
      <button class="bank-task-x" type="button" title="Delete task" aria-label="Delete"
        onclick="event.stopPropagation(); deleteBankTask('${t.id}')">✕</button>
      <div class="bank-task-top">
        <button class="bank-task-cb" type="button" title="Mark complete" aria-label="Complete"
          onclick="event.stopPropagation(); completeBankTask('${t.id}', event.currentTarget)">✓</button>
        <span class="drag-cue" title="Drag to a calendar day">⋮⋮</span>
        <div class="bank-task-title">${esc(t.title)}</div>
        ${timeLeft ? `<span class="chip chip-time-left u-${urgency}">${esc(timeLeft)}</span>` : '<span class="drag-hint">Drag</span>'}
      </div>
      ${showFirstStep ? `<div class="bank-first-step">▸ <em>first move:</em> ${esc(t.firstStep)}</div>` : ''}
      <div class="bank-task-meta">
        <span class="chip chip-${t.priority==='MUST'?'must':t.priority==='high'?'high':t.priority==='low'?'low':'medium'}">
          ${priLabel(t.priority)}
        </span>
        ${dueChipHTML(t)}
        ${t.isHabit?`<span class="chip chip-habit">Habit</span>`:''}
        ${t.domain ? `<span class="chip chip-domain" style="background:${esc(domainColor)}22;color:${esc(domainColor)}">${esc(t.domain)}${ktlo?' · KTLO':''}</span>`:''}
        ${t.taskKind==='execute' ? `<span class="chip chip-execute">⚡ execute</span>` : ''}
        ${t.taskKind==='plan' ? `<span class="chip chip-plan">🧠 plan</span>` : ''}
        ${gated ? `<span class="chip chip-gated">🔒 ${dopamineGateStatus().remaining}m to unlock</span>` : ''}
        ${hasSubs?`<button class="chip chip-subtasks" onclick="event.stopPropagation(); toggleBankSubtasks('${t.id}')" title="${expanded?'Hide':'Show'} subtasks">${expanded?'▾':'▸'} ${doneCount}/${subtasks.length} steps</button>`:''}
        ${unassigned?`<span class="chip chip-unassigned">Task not assigned yet</span>`:''}
        ${t.scheduledTime?`<span class="chip chip-due">⏰ ${t.scheduledTime}</span>`:''}
      </div>
      ${expanded && hasSubs ? renderBankSubtasks(t) : ''}
      <div class="bank-task-actions">
        <button class="task-action" onclick="event.stopPropagation(); duplicateTask('${t.id}')" title="Duplicate">⧉</button>
        <button class="task-action" onclick="event.stopPropagation(); editTask('${t.id}')" title="Edit">✎</button>
      </div>
    </div>`;
  }).join('') + (tasks.length>8 ? `
      <button class="bank-add" onclick="toggleBankLimit()">${bankVisibleCount>=tasks.length?'Show first 8':'Show all '+tasks.length}</button>
    ` : '');
}

// ── Bank subtasks: inline expand + per-subtask scheduling ──
// Each subtask gets a checkbox, the text, a tiny "schedule" calendar icon,
// and its own list of scheduled-date chips. Toggling the chip schedules
// that subtask onto the calendar for that day.
function toggleBankSubtasks(taskId){
  if(!window._bankExpanded) window._bankExpanded = new Set();
  if(window._bankExpanded.has(taskId)) window._bankExpanded.delete(taskId);
  else window._bankExpanded.add(taskId);
  renderBank();
}
function renderBankSubtasks(t){
  if(!Array.isArray(t.subtasks) || !t.subtasks.length) return '';
  const today = todayStr();
  return `<div class="bank-subtasks" onclick="event.stopPropagation()">
    ${t.subtasks.map((s, i) => {
      const dates = Array.isArray(s.scheduledDates) ? s.scheduledDates : [];
      const isDone = !!s.done || !!(s.doneDates && s.doneDates[today]);
      return `<div class="bank-sub-row ${isDone?'done':''}">
        <button class="bank-sub-cb" title="Toggle done"
          onclick="event.stopPropagation(); toggleBankSubDone('${t.id}', ${i})">${isDone?'✓':''}</button>
        <span class="bank-sub-text">${esc(s.text)}</span>
        ${dates.length ? dates.map(ds => `<span class="chip chip-sub-date" title="Scheduled for ${esc(ds)}">${esc(formatShortDate(ds))} <button class="chip-x" onclick="event.stopPropagation(); unscheduleBankSub('${t.id}',${i},'${ds}')" aria-label="Unschedule">×</button></span>`).join('') : ''}
        <button class="bank-sub-cal" title="Schedule this step on a day"
          onclick="event.stopPropagation(); promptBankSubSchedule('${t.id}', ${i})">📅</button>
      </div>`;
    }).join('')}
    <div class="bank-sub-add">
      <input class="bank-sub-input" placeholder="+ Add a step…"
        onclick="event.stopPropagation()"
        onkeydown="if(event.key==='Enter'){event.stopPropagation(); addBankSubFromInput('${t.id}', this);}">
    </div>
  </div>`;
}
function toggleBankSubDone(taskId, idx){
  const t = S.tasks.find(x => x.id === taskId);
  if(!t || !t.subtasks?.[idx]) return;
  const s = t.subtasks[idx];
  if(!s.doneDates) s.doneDates = {};
  const today = todayStr();
  if(s.doneDates[today]) delete s.doneDates[today];
  else s.doneDates[today] = true;
  s.done = Object.keys(s.doneDates).length > 0; // legacy flag
  save();
  renderBank();
}
function promptBankSubSchedule(taskId, idx){
  const ds = prompt('Schedule this step on which day? (YYYY-MM-DD)', todayStr());
  if(!ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  const t = S.tasks.find(x => x.id === taskId);
  if(!t || !t.subtasks?.[idx]) return;
  const s = t.subtasks[idx];
  if(!Array.isArray(s.scheduledDates)) s.scheduledDates = [];
  if(!s.scheduledDates.includes(ds)) s.scheduledDates.push(ds);
  // Also schedule the parent task on that day so the calendar/today list pick it up
  if(!Array.isArray(t.scheduledDates)) t.scheduledDates = [];
  if(!t.scheduledDates.includes(ds)) t.scheduledDates.push(ds);
  save();
  renderBank(); renderCalendar();
}
function unscheduleBankSub(taskId, idx, ds){
  const t = S.tasks.find(x => x.id === taskId);
  if(!t || !t.subtasks?.[idx]) return;
  const s = t.subtasks[idx];
  s.scheduledDates = (s.scheduledDates||[]).filter(x => x !== ds);
  save();
  renderBank();
}
function addBankSubFromInput(taskId, inputEl){
  const text = (inputEl.value || '').trim();
  if(!text) return;
  const t = S.tasks.find(x => x.id === taskId);
  if(!t) return;
  if(!Array.isArray(t.subtasks)) t.subtasks = [];
  t.subtasks.push({ text, done: false, doneDates: {}, scheduledDates: [] });
  save();
  renderBank();
}
function formatShortDate(ds){
  if(!ds) return '';
  const d = new Date(ds + 'T00:00:00');
  if(Number.isNaN(d.getTime())) return ds;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Event-mode bank: shows upcoming events sorted by their start time, each with
// a start–end time chip, urgency-colored time-left chip, source color stripe.
function renderEventBank(list){
  const now = Date.now();
  const items = (S.events || []).filter(e => {
    if(!e || !e.date) return false;
    if(!taskMatchesSearch(e, bankSearchQuery)) return false;
    // Show today and future events. Drop past events from the bank
    // (they live on the calendar history; the bank is forward-looking).
    const dl = itemDeadline(e);
    if(!dl) return false;
    return dl.getTime() >= now - 86400000; // include today even if past time
  });
  items.sort((a, b) => {
    const da = itemDeadline(a)?.getTime() || 0;
    const db = itemDeadline(b)?.getTime() || 0;
    return da - db;
  });
  if(!items.length){
    const msg = bankSearchQuery.trim()
      ? `<div class="empty"><div class="empty-icon">🔎</div>No events match "${esc(bankSearchQuery)}"</div>`
      : `<div class="empty"><div class="empty-icon">📅</div>No upcoming events. Drop an .ics file in the Calendar import to add some.</div>`;
    list.innerHTML = msg;
    return;
  }
  const visible = items.slice(0, bankVisibleCount);
  list.innerHTML = visible.map(e => {
    const urgency = urgencyClassFor(e);
    const left = timeLeftLabel(e);
    const range = timeRangeLabel(e);
    const sourceLabel = e.sourceId ? (S.icalSources.find(s => s.id === e.sourceId)?.name || '') : '';
    const colorBar = e.color ? `style="--event-accent:${esc(e.color)}"` : '';
    return `
    <div class="bank-task bank-event fade-up" draggable="true"
      data-urgency="${urgency}"
      ${colorBar}
      onclick="editEvent('${e.id}')">
      <div class="bank-task-top">
        <span class="bank-event-dot" aria-hidden="true"></span>
        <div class="bank-task-title">${esc(e.title)}</div>
        ${left ? `<span class="chip chip-time-left u-${urgency}">${esc(left)}</span>` : ''}
      </div>
      <div class="bank-task-meta">
        <span class="chip chip-event-date">${esc(fmtDate(e.date))}</span>
        ${range ? `<span class="chip chip-event-time">⏰ ${esc(range)}</span>` : ''}
        ${e.location ? `<span class="chip chip-event-loc">📍 ${esc(e.location)}</span>` : ''}
        ${sourceLabel ? `<span class="chip chip-event-source">${esc(sourceLabel)}</span>` : ''}
      </div>
    </div>`;
  }).join('') + (items.length > 8 ? `
    <button class="bank-add" onclick="toggleBankLimit()">${bankVisibleCount>=items.length?'Show first 8':'Show all '+items.length}</button>
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
  bankVisibleCount = bankVisibleCount>=openCount ? 8 : openCount;
  renderBank();
}

// Quick × delete from the task bank — soft-delete (recoverable from
// Settings → Deleted Items, identical to the modal Delete button).
function deleteBankTask(id){
  const t = S.tasks.find(x=>x.id===id);
  if(!t) return;
  softDeleteTask(id);
}

// Quick ✓ complete from the task bank — for one-off tasks this archives
// (existing toggleTask behavior); for habits it marks today's date done
// and, if the habit window is over, archives the habit so the bank clears.
function completeBankTask(id, btnEl){
  const t = S.tasks.find(x=>x.id===id);
  if(!t) return;
  if(btnEl){
    const row = btnEl.closest('.bank-task');
    if(row) row.classList.add('completed-flash');
  }
  // Defer just enough for the check animation to render.
  setTimeout(()=>{
    if(t.isHabit){
      const today = todayStr();
      if(!t.completedDates) t.completedDates = {};
      t.completedDates[today] = true;
      t.completedAt = Date.now();
      // If the habit window has ended (or all scheduled days through habitEnd
      // are complete), archive the habit so it leaves the bank into archive.
      if(habitFullyCompleted(t)){
        t.archived = true;
        t.archivedAt = Date.now();
        showToast(`Habit "${t.title}" completed → Archive`,'Undo',()=>{
          t.archived = false;
          if(t.completedDates) t.completedDates[today] = false;
          save(); render();
        });
      } else {
        showToast(`Habit "${t.title}" checked for today`,'Undo',()=>{
          if(t.completedDates) t.completedDates[today] = false;
          save(); render();
        });
      }
    } else {
      t.completed = true;
      t.completedAt = Date.now();
      t.archived = true;
      t.archivedAt = Date.now();
      showToast(`Completed "${t.title}" → Archive`,'Undo',()=>{
        t.completed = false;
        t.completedAt = null;
        t.archived = false;
        save(); render();
      });
    }
    save(); render();
  }, 120);
}

// A habit is "fully completed" once we've passed its habitEnd AND every
// scheduled day inside [habitStart..habitEnd] is checked.
function habitFullyCompleted(t){
  if(!t || !t.isHabit) return false;
  if(!t.habitEnd) return false;
  const today = todayStr();
  if(today < t.habitEnd) return false;
  const start = t.habitStart || todayStr();
  const days = Array.isArray(t.scheduledDays) ? t.scheduledDays : [];
  if(!days.length) return true;
  const cd = t.completedDates || {};
  const d = new Date(start+'T00:00:00');
  const end = new Date(t.habitEnd+'T00:00:00');
  while(d <= end){
    const dow = d.getDay();
    if(days.includes(dow)){
      const ds = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
      if(!cd[ds]) return false;
    }
    d.setDate(d.getDate()+1);
  }
  return true;
}

function priLabel(p){
  return {MUST:'⚡ MUST', high:'🔥 High', medium:'✅ Med', low:'💧 Low'}[p]||p;
}

function renderCenter(){
  const today = calSelectedDate || todayStr();
  const scheduledWork = S.tasks.filter(t=>!isArchivedForTodo(t) && (isHabitDueToday(t,today) || ((t.scheduledDates||[]).includes(today))));
  const dueSignals = S.tasks.filter(t=>!isArchivedForTodo(t) && !t.isHabit && t.due===today && !isTaskDone(t,today) && !isDueSignalDone(t,today));
  const must = scheduledWork.filter(t=>t.priority==='MUST' && !isArchivedForTodo(t));
  const regularRaw = scheduledWork.filter(t=>t.priority!=='MUST' && !t.isHabit && !isArchivedForTodo(t));
  const regular = dailySort==='section' ? regularRaw : sortTasks(regularRaw,dailySort);
  // Don't show a habit in the Habits sub-section if it's already taking the
  // top spot in MUST — avoids the same row appearing twice.
  const habits = scheduledWork.filter(t=>t.isHabit && t.priority!=='MUST' && !isArchivedForTodo(t));
  // Archive only shows TODAY's archived items — yesterday's stay in storage
  // (recoverable via Settings → Deleted Items) but the day's archive is a
  // fresh slate each morning. Keeps the panel small and ceremonious.
  const _todayStr = todayStr();
  const archivedTasks = S.tasks.filter(t => isArchivedForTodo(t) && isSameDay(t.archivedAt || t.completedAt, _todayStr));
  const archivedDueSignals = completedDueSignals().filter(({date}) => date === _todayStr);
  syncSortControls();

  const mustIncomplete = must.some(t=>!isTaskDone(t,today));
  const overridden = hasMustOverrideToday();

  // Must gate
  const gated = document.getElementById('gatedSections');
  const banner = document.getElementById('mustBanner');
  if(mustIncomplete && !overridden){
    gated.classList.add('gated-locked');
    gated.style.filter='';
    gated.style.pointerEvents='';
    renderMustBanner(banner, must, today);
    banner.style.display='flex';
  } else {
    gated.classList.remove('gated-locked');
    gated.style.filter='';
    gated.style.pointerEvents='';
    if(overridden && mustIncomplete){
      renderMustOverrideBanner(banner, today);
      banner.style.display='flex';
    } else {
      banner.style.display='none';
    }
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

  // Must list — incomplete first, completed pushed to bottom
  const mustSec = document.getElementById('secMust');
  const mustSorted = [...must].sort((a,b)=>{
    const da = isTaskDone(a,today) ? 1 : 0;
    const db = isTaskDone(b,today) ? 1 : 0;
    return da - db;
  });
  document.getElementById('mustList').innerHTML = mustSorted.length
    ? mustSorted.map(t=>taskItemHTML(t,'must',today)).join('')
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

  // Archive — today's archive only. Yesterday's items are retained in
  // storage (recoverable via Settings) but the panel shows only the
  // current day's completions to keep the surface light.
  document.getElementById('archiveList').innerHTML = (archivedTasks.length || archivedDueSignals.length)
    ? `${archivedDueSignals.length ? `
        <div class="archive-subgroup">
          <div class="archive-subgroup-header">
            <span>Due Dates · today</span>
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
            <span>Completed Today</span>
            <span>${archivedTasks.length}</span>
          </div>
          ${archivedTasks.map(t=>`
        <div class="archived-task" draggable="true"
          ondragstart="onArchiveTaskDragStart(event,'${t.id}')"
          ondragend="onTaskDragEnd(event)">
          <div class="archived-check">✓</div>
          <div class="archived-title">${esc(t.title)}</div>
          <div class="archived-time">${t.completedAt?new Date(t.completedAt).toLocaleDateString():''}</div>
          <button class="task-action" onclick="unarchiveTask('${t.id}')" title="Restore">↩</button>
        </div>`).join('')}
        </div>` : ''}`
    : `<div class="empty">Archive is empty.</div>`;
}

function completedDueSignals(){
  const rows=[];
  (S.tasks||[]).forEach(task=>{
    Object.keys(task.dueCompletedDates||{}).forEach(date=>{
      if(task.dueCompletedDates[date]) rows.push({task,date});
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
      <button class="task-action del" onclick="removeTask('${t.id}')" title="Delete">×</button>
    </div>
  </div>`;
}

function completeDueDate(event,id,dateStr){
  event?.stopPropagation?.();
  const task=S.tasks.find(t=>t.id===id);
  if(!task) return;
  if(!task.dueCompletedDates) task.dueCompletedDates={};
  const wasDone=!!task.dueCompletedDates[dateStr];
  task.dueCompletedDates[dateStr]=true;
  save(); render();
  showToast(`Due date cleared for "${task.title}"`,'Undo',()=>{
    const live=S.tasks.find(t=>t.id===id);
    if(live?.dueCompletedDates) live.dueCompletedDates[dateStr]=wasDone;
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
  const pct = taskProgress(t,dateStr);
  const tone = pct < 34 ? 'var(--red)' : pct < 67 ? 'var(--orange)' : 'var(--green)';
  const subCount = (t.subtasks||[]).length;
  const doneNow = isTaskDone(t,dateStr);
  const sectionArg=escJs(section);
  const dateArg=escJs(dateStr);
  const otherDays = (Array.isArray(t.scheduledDates)?t.scheduledDates:[]).filter(d=>d!==dateStr).length;
  const removeTitle = t.isHabit ? 'Skip just this day' : ((otherDays>0 || (t.due && t.due!==dateStr)) ? 'Remove from this day' : 'Delete');
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
      <button class="task-action del" onclick="removeTask('${t.id}','${dateArg}')" title="${removeTitle}">×</button>
    </div>
    <div class="task-details">
      <div class="task-detail-card">
        <div class="task-detail-grid">
          <div>
            ${(t.subtasks||[]).length ? t.subtasks.map((st,i)=>{
              const subDone = isSubDone(st,dateStr);
              return `
              <div class="subtask-line ${subDone?'done':''}">
                <div class="task-cb" style="width:16px;height:16px;margin:0;border-radius:5px" onclick="toggleSubtask('${t.id}',${i},'${dateArg}')">${subDone?'✓':''}</div>
                <span>${esc(st.text)}</span>
              </div>`;
            }).join('') : `<div class="empty" style="padding:6px 0;text-align:left">No subtasks yet.</div>`}
            <div class="subtask-add">
              <input id="subAdd-${t.id}" placeholder="Add a small next step" onkeydown="if(event.key==='Enter')addSubtask('${t.id}')">
              <button onclick="addSubtask('${t.id}')">Add</button>
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

function isSubDone(st, dateStr){
  if(!st) return false;
  if(st.doneDates && Object.prototype.hasOwnProperty.call(st.doneDates, dateStr)) return !!st.doneDates[dateStr];
  return !!st.done;
}
function allSubtasksDone(t, dateStr){
  const subs = t.subtasks||[];
  if(!subs.length) return false;
  return subs.every(st=>isSubDone(st,dateStr));
}
function taskProgress(t, dateStr=todayStr()){
  const subs = t.subtasks||[];
  if(subs.length) return Math.round(subs.filter(s=>isSubDone(s,dateStr)).length / subs.length * 100);
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
        save(); render();
      });
    }

    // Chime when ALL MUSTs for the day are done (gate unlocks via render)
    const mustToday = S.tasks.filter(x=>x.priority==='MUST' && !x.archived &&
      (isScheduledToday(x,today)||isHabitDueToday(x,today)));
    if(mustToday.length && mustToday.every(x=>isTaskDone(x,today))){
      setTimeout(()=>playPop(1320), 250);
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

function toggleSubtask(id,index,dateStr){
  const t=S.tasks.find(x=>x.id===id);
  if(!t || !t.subtasks || !t.subtasks[index]) return;
  const ds = dateStr || calSelectedDate || todayStr();
  const st = t.subtasks[index];
  if(!st.doneDates || typeof st.doneDates !== 'object') st.doneDates = {};
  const wasDone = isSubDone(st, ds);
  st.doneDates[ds] = !wasDone;
  if(ds === todayStr()) st.done = !!st.doneDates[ds];
  openTaskDetails.add(id);
  t.progress = taskProgress(t, ds);

  // Auto-complete parent if all subtasks are done for this date
  if(allSubtasksDone(t, ds)){
    if(t.isHabit){
      if(!t.completedDates) t.completedDates = {};
      t.completedDates[ds] = true;
      if(ds === todayStr()) t.completed = true;
    } else {
      t.completed = true;
    }
    t.completedAt = Date.now();
    playPop(t.priority==='MUST'?1100:880);
  } else {
    if(t.isHabit){
      if(t.completedDates) t.completedDates[ds] = false;
      if(ds === todayStr()) t.completed = false;
    } else {
      t.completed = false;
    }
    t.completedAt = null;
  }
  save(); render();
}

function addSubtask(id){
  const input=document.getElementById('subAdd-'+id);
  const text=input?.value.trim();
  if(!text) return;
  const t=S.tasks.find(x=>x.id===id);
  if(!t) return;
  openTaskDetails.add(id);
  if(!Array.isArray(t.subtasks)) t.subtasks=[];
  t.subtasks.push({text,done:false,doneDates:{}});
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

function removeTask(id, dateStr){
  const t = S.tasks.find(x=>x.id===id);
  if(!t){ softDeleteTask(id); return; }
  const ds = dateStr || calSelectedDate || todayStr();

  // Habit: just skip this date
  if(t.isHabit){
    if(!t.skippedDates) t.skippedDates = {};
    t.skippedDates[ds] = true;
    save(); render();
    showToast(`Skipped "${t.title}" for ${fmtDate(ds)}.`, 'Undo', ()=>{
      delete t.skippedDates[ds];
      save(); render();
    });
    return;
  }

  // Non-habit scheduled on multiple dates: drop only this date
  const scheduled = Array.isArray(t.scheduledDates) ? t.scheduledDates : [];
  const otherDates = scheduled.filter(d=>d!==ds);
  const stillHasDue = t.due && t.due !== ds;
  if(otherDates.length > 0 || stillHasDue){
    t.scheduledDates = otherDates;
    if(t.due === ds) t.due = '';
    if(!t.skippedDates) t.skippedDates = {};
    t.skippedDates[ds] = true;
    save(); render();
    showToast(`Removed "${t.title}" from ${fmtDate(ds)}.`, 'Undo', ()=>{
      if(!t.scheduledDates.includes(ds)) t.scheduledDates.push(ds);
      delete t.skippedDates[ds];
      save(); render();
    });
    return;
  }

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

function duplicateTask(id){
  const original=S.tasks.find(t=>t.id===id);
  if(!original) return;
  const copy=JSON.parse(JSON.stringify(original));
  copy.id=uid();
  copy.createdAt=Date.now();
  copy.title=`${original.title} copy`;
  copy.completed=false;
  copy.completedAt=null;
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

// Paginated deleted-items view — shows 10 at a time with "Show 10 more"
// and "Show less" controls. State lives on window so it persists while
// the modal is open. Resets to 10 when the modal closes.
let _deletedShown = 10;
function renderDeletedList(){
  const wrap=document.getElementById('deletedList');
  // Always update the count badge on the Settings button
  const badge = document.getElementById('deletedCountBadge');
  const items=S.deleted||[];
  if(badge) badge.textContent = String(items.length);
  if(!wrap) return;
  // Update modal sub-label and Restore-all button visibility
  const sub = document.getElementById('deletedModalSub');
  if(sub) sub.textContent = items.length === 1 ? '1 item' : `${items.length} items`;
  const restoreAllBtn = document.getElementById('deletedRestoreAllBtn');
  if(restoreAllBtn) restoreAllBtn.style.display = items.length ? '' : 'none';

  if(!items.length){
    wrap.innerHTML = `
      <div class="deleted-empty">
        <div class="deleted-empty-icon">🗂️</div>
        <div class="deleted-empty-title">No deleted items</div>
        <div class="deleted-empty-body">Tasks you delete will show up here so you can restore them.</div>
      </div>`;
    document.getElementById('deletedShowMore').style.display = 'none';
    document.getElementById('deletedShowLess').style.display = 'none';
    return;
  }

  const shown = Math.min(_deletedShown, items.length);
  const slice = items.slice(0, shown);

  wrap.innerHTML = slice.map(d => {
    const title = esc(d.item?.title || 'Deleted item');
    const subject = d.item?.subject ? esc(d.item.subject) : '';
    const when = d.deletedAt
      ? new Date(d.deletedAt).toLocaleDateString(undefined, {month:'short', day:'numeric'})
      : '';
    return `
      <div class="deleted-row-v2">
        <div class="del-row-main">
          <div class="del-row-title" title="${title}">${title}</div>
          <div class="del-row-meta">
            ${subject ? `<span class="del-row-subject">${subject}</span>` : ''}
            ${when    ? `<span class="del-row-when">deleted ${when}</span>` : ''}
          </div>
        </div>
        <button class="del-row-restore" type="button"
                onclick="restoreDeleted('${d.id}')"
                aria-label="Restore ${title}">
          <span class="del-row-restore-icon">↩</span>
          <span class="del-row-restore-label">Restore</span>
        </button>
      </div>`;
  }).join('');

  // Pagination buttons
  const more = document.getElementById('deletedShowMore');
  const less = document.getElementById('deletedShowLess');
  const hidden = items.length - shown;
  if(more){
    if(hidden > 0){
      more.style.display = '';
      more.textContent = `Show ${Math.min(10, hidden)} more · ${hidden} hidden`;
    } else {
      more.style.display = 'none';
    }
  }
  if(less){
    less.style.display = (shown > 10) ? '' : 'none';
  }
}
function openDeletedModal(){
  _deletedShown = 10;
  if(typeof openModal === 'function') openModal('mDeleted');
  renderDeletedList();
}
function showMoreDeleted(){
  _deletedShown += 10;
  renderDeletedList();
}
function showLessDeleted(){
  _deletedShown = 10;
  renderDeletedList();
  // Scroll the modal back to top so the user sees the start of the list
  document.getElementById('deletedList')?.scrollIntoView({behavior:'smooth', block:'start'});
}
function restoreAllDeleted(){
  const items = (S.deleted || []).slice();
  if(!items.length) return;
  if(!confirm(`Restore all ${items.length} deleted items?`)) return;
  items.forEach(d => restoreDeleted(d.id));
}

function showToast(message, actionLabel, action){
  const stack=document.getElementById('toastStack');
  if(!stack) return;
  const el=document.createElement('div');
  el.className='toast toast-msg';
  el.innerHTML=`<span>${esc(message)}</span>${actionLabel?`<button class="toast-action" type="button">${esc(actionLabel)}</button>`:''}`;
  if(actionLabel) el.querySelector('button').onclick=()=>{ action?.(); el.remove(); };
  stack.appendChild(el);
  // Cap visible toasts at 3 — drop the OLDEST (top of stack) when a new one arrives.
  while(stack.children.length > 3) stack.firstElementChild?.remove();
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

// Day-of-week picker dialog (uses buttons instead of typing)
function designDayPicker(title='Pick days', message='Choose which days this should repeat:', defaultDays=[1,2,3,4,5]){
  return new Promise(resolve=>{
    let overlay=document.getElementById('dayPickerOverlay');
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='dayPickerOverlay';
      overlay.className='overlay app-dialog-overlay';
      overlay.innerHTML=`
        <div class="modal app-dialog" role="dialog" aria-modal="true" style="max-width:380px;">
          <div class="modal-header">
            <span class="modal-title" id="dayPickerTitle">Pick days</span>
            <button class="modal-close" id="dayPickerClose">✕</button>
          </div>
          <div class="modal-body app-dialog-body">
            <div class="app-dialog-message" id="dayPickerMessage" style="margin-bottom:14px;"></div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">
              <button type="button" class="btn-sm btn-ghost" data-quick="weekdays" id="dpQuickWeekdays">Weekdays</button>
              <button type="button" class="btn-sm btn-ghost" data-quick="weekend" id="dpQuickWeekend">Weekend</button>
              <button type="button" class="btn-sm btn-ghost" data-quick="daily" id="dpQuickDaily">Every day</button>
            </div>
            <div id="dayPickerButtons" style="display:flex;gap:4px;margin-bottom:16px;">
              <button type="button" class="day-btn" data-d="0">Sun</button>
              <button type="button" class="day-btn" data-d="1">Mon</button>
              <button type="button" class="day-btn" data-d="2">Tue</button>
              <button type="button" class="day-btn" data-d="3">Wed</button>
              <button type="button" class="day-btn" data-d="4">Thu</button>
              <button type="button" class="day-btn" data-d="5">Fri</button>
              <button type="button" class="day-btn" data-d="6">Sat</button>
            </div>
            <div class="app-dialog-actions">
              <button class="btn-sm btn-ghost" id="dayPickerCancel">Cancel</button>
              <button class="btn-sm btn-primary" id="dayPickerConfirm">Save</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    }
    overlay.querySelector('#dayPickerTitle').textContent=title;
    overlay.querySelector('#dayPickerMessage').textContent=message;
    let selected=new Set(defaultDays);
    const updateBtns=()=>{
      overlay.querySelectorAll('#dayPickerButtons .day-btn').forEach(b=>{
        b.classList.toggle('active', selected.has(+b.dataset.d));
      });
    };
    updateBtns();
    overlay.querySelectorAll('#dayPickerButtons .day-btn').forEach(b=>{
      b.onclick=()=>{
        const d=+b.dataset.d;
        if(selected.has(d)) selected.delete(d); else selected.add(d);
        updateBtns();
      };
    });
    overlay.querySelector('#dpQuickWeekdays').onclick=()=>{ selected=new Set([1,2,3,4,5]); updateBtns(); };
    overlay.querySelector('#dpQuickWeekend').onclick=()=>{ selected=new Set([0,6]); updateBtns(); };
    overlay.querySelector('#dpQuickDaily').onclick=()=>{ selected=new Set([0,1,2,3,4,5,6]); updateBtns(); };
    overlay.classList.add('show');
    const cleanup=(val)=>{
      overlay.classList.remove('show');
      resolve(val);
    };
    overlay.querySelector('#dayPickerConfirm').onclick=()=>{
      if(selected.size===0){ showToast('Pick at least one day'); return; }
      cleanup([...selected].sort());
    };
    overlay.querySelector('#dayPickerCancel').onclick=()=>cleanup(null);
    overlay.querySelector('#dayPickerClose').onclick=()=>cleanup(null);
    overlay.onclick=e=>{ if(e.target===overlay) cleanup(null); };
  });
}

function unarchiveTask(id){
  const t = S.tasks.find(t=>t.id===id);
  if(!t) return;
  t.archived=false; t.completed=false; t.completedAt=null;
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
  // Sync the typable date bar so the compact UI reflects the loaded value
  const _dueBar = document.getElementById('fDueInput');
  if(_dueBar) _dueBar.value = t.due || '';
  refreshDailySectionOptions(t.dailySection||'Study');
  document.getElementById('fCalendarSignal').value = t.calendarSignal||'auto';
  document.getElementById('fNotes').value = t.notes||'';
  // Cognitive scaffold fields (guarded — older builds may lack these inputs)
  const _fs = document.getElementById('fFirstStep'); if(_fs) _fs.value = t.firstStep || '';
  const _tk = document.getElementById('fTaskKind');  if(_tk) _tk.value = t.taskKind || '';
  const _fd = document.getElementById('fDomain');    if(_fd) _fd.value = t.domain   || '';
  if(typeof refreshDomainSuggestions === 'function') refreshDomainSuggestions();
  editModalSubtasks = (t.subtasks||[]).map(s=>({text:s.text, done:!!s.done, doneDates:Object.assign({}, s.doneDates||{})}));
  renderModalSubtasks();
  document.getElementById('fIsHabit').checked = t.isHabit;
  document.getElementById('fHabitStart').value = t.habitStart || '';
  document.getElementById('fHabitEnd').value = t.habitEnd || '';
  document.getElementById('deleteBtn').style.display = 'flex';
  document.getElementById('taskToEventBtn').style.display = 'flex';
  editSelectedDays = [...(t.scheduledDays||[])];
  editScheduledDates = [...(t.scheduledDates||[])];
  schedulePickerDate = editScheduledDates[0] ? new Date(editScheduledDates[0]+'T00:00:00') : (t.due ? new Date(t.due+'T00:00:00') : new Date(calSelectedDate+'T00:00:00'));
  duePickerDate = t.due ? new Date(t.due+'T00:00:00') : new Date(calSelectedDate+'T00:00:00');
  renderScheduledDateChips();
  // Always render both calendar grids so they're visible from the start.
  renderDuePicker();
  renderSchedulePicker();
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
    completedAt:null, progress:0, subtasks:[], focusPoints:0, scheduledDates:[], completedDates:{}, dueCompletedDates:{} };
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
  // Cognitive scaffolds — persist and lazily create the domain
  t.firstStep = (document.getElementById('fFirstStep')?.value || '').trim().slice(0,80);
  t.taskKind  = document.getElementById('fTaskKind')?.value || '';
  t.domain    = (document.getElementById('fDomain')?.value || '').trim().slice(0,40);
  if(t.domain && typeof ensureDomain === 'function') ensureDomain(t.domain);
  t.isHabit = document.getElementById('fIsHabit').checked;
  t.scheduledDays = [...editSelectedDays];
  t.habitStart = t.isHabit ? (document.getElementById('fHabitStart')?.value || '') : '';
  t.habitEnd = t.isHabit ? (document.getElementById('fHabitEnd')?.value || '') : '';
  // If marking as habit but no days picked: default to every day, AND anchor
  // the start so the habit doesn't retroactively appear on past dates. Anchor
  // is the explicit habitStart, else today's selected date, else today.
  if(t.isHabit && (!Array.isArray(t.scheduledDays) || t.scheduledDays.length === 0)){
    t.scheduledDays = [0,1,2,3,4,5,6];
    if(!t.habitStart) t.habitStart = calSelectedDate || todayStr();
  }
  if(t.isHabit && t.habitStart && t.habitEnd && t.habitEnd < t.habitStart){
    showToast('Habit end date must be after the start date.');
    return;
  }
  t.scheduledDates = [...editScheduledDates];
  t.subtasks = editModalSubtasks.map(s=>({text:s.text, done:!!s.done, doneDates:Object.assign({}, s.doneDates||{})}));
  t.progress = taskProgress(t);
  const learnedQuickAdd=learnFromManualCorrection(t);

  if(isNew) S.tasks.push(t);
  const taughtQuickAdd=!!nlpEditDraft;
  save();
  // Defensive: if a downstream renderer throws, we still want the modal to
  // close and the form to reset — otherwise the Save button looks broken
  // even though the data was saved.
  try { render(); } catch(err) { console.warn('[saveTask] render failed:', err); }
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
  const _dueBarReset = document.getElementById('fDueInput');
  if(_dueBarReset) _dueBarReset.value = '';
  // Collapse the expandable calendar grids back to default (compact bar only)
  document.getElementById('duePickerWrap')?.setAttribute('hidden','');
  document.getElementById('schedulePickerWrap')?.setAttribute('hidden','');
  document.getElementById('dueExpandBtn')?.classList.remove('active');
  document.getElementById('scheduleExpandBtn')?.classList.remove('active');
  refreshDailySectionOptions('Study');
  document.getElementById('fCalendarSignal').value='auto';
  document.getElementById('fNotes').value='';
  // Reset cognitive scaffold fields
  const _fs = document.getElementById('fFirstStep'); if(_fs) _fs.value='';
  const _tk = document.getElementById('fTaskKind');  if(_tk) _tk.value='';
  const _fd = document.getElementById('fDomain');    if(_fd) _fd.value='';
  if(typeof refreshDomainSuggestions === 'function') refreshDomainSuggestions();
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
  duePickerDate = new Date((calSelectedDate||todayStr())+'T00:00:00');
  renderScheduledDateChips();
  // Render BOTH calendar grids so they're visible on first open. Previously
  // only renderDuePicker() ran, so the Work Days grid was blank until the
  // user clicked a month arrow.
  renderDuePicker();
  renderSchedulePicker();
  editSelectedPri='medium';
  selectPri('medium',null);
  toggleHabitFields();
  document.querySelectorAll('.day-btn').forEach(b=>b.classList.remove('active'));
}

// Open the Add Task modal with a pre-selected date (used by double-click on calendar)
function openAddTaskForDate(ds){
  if(!ds) ds = calSelectedDate || todayStr();
  resetAddForm();
  calSelectedDate = ds;
  editScheduledDates = [ds];
  schedulePickerDate = new Date(ds+'T00:00:00');
  renderScheduledDateChips();
  // Focus title input shortly after opening
  setTimeout(()=>{ const el=document.getElementById('fTitle'); if(el) el.focus(); }, 100);
  openModal('mAddTask');
}

// ── Google-Calendar-style quick-add popover ─────────────────────────────
// Spawned by double-clicking any calendar cell. Floats near the click,
// captures a title + start/end time + kind (event/task), creates the item
// inline, and offers a "More options…" escape hatch into the full modal.
let _quickAddEl = null;
function openQuickAdd(evt, ds){
  if(evt){ evt.preventDefault?.(); evt.stopPropagation?.(); }
  if(!ds) ds = calSelectedDate || todayStr();
  // Single instance — close any previous
  closeQuickAdd();
  const el = document.createElement('div');
  el.className = 'cal-quick-add show';
  el.innerHTML = `
    <div class="cqa-date">${esc(fmtDate(ds))}</div>
    <input type="text" class="cqa-title" id="cqaTitle" placeholder="Add title (Enter to save)" autocomplete="off">
    <div class="cqa-row">
      <label>Kind</label>
      <select id="cqaKind">
        <option value="event">Event</option>
        <option value="task">Task</option>
      </select>
    </div>
    <div class="cqa-row">
      <label>Time</label>
      <input type="time" id="cqaStart" value="09:00">
      <span style="font-size:10px;color:var(--text3)">–</span>
      <input type="time" id="cqaEnd" value="10:00">
    </div>
    <div class="cqa-actions">
      <button type="button" class="cqa-more" onclick="quickAddMoreOptions('${ds}')">More options…</button>
      <button type="button" class="cqa-btn" onclick="closeQuickAdd()">Cancel</button>
      <button type="button" class="cqa-btn primary" onclick="quickAddSave('${ds}')">Save</button>
    </div>`;
  document.body.appendChild(el);
  _quickAddEl = el;
  // Position near the click; clamp to viewport
  const w = 300, h = 230;
  const x = evt ? evt.clientX : (window.innerWidth/2 - w/2);
  const y = evt ? evt.clientY : (window.innerHeight/2 - h/2);
  const left = Math.min(window.innerWidth - w - 14, Math.max(14, x + 12));
  const top  = Math.min(window.innerHeight - h - 14, Math.max(14, y + 12));
  el.style.left = left + 'px';
  el.style.top  = top  + 'px';
  // Focus title; save on Enter, close on Esc
  const input = el.querySelector('#cqaTitle');
  setTimeout(()=>input?.focus(), 30);
  el.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); quickAddSave(ds); }
    else if(e.key==='Escape'){ e.preventDefault(); closeQuickAdd(); }
  });
  // Close when clicking outside
  setTimeout(()=>{
    document.addEventListener('pointerdown', _quickAddOutside, true);
  }, 0);
}
function _quickAddOutside(e){
  if(!_quickAddEl) return;
  if(_quickAddEl.contains(e.target)) return;
  closeQuickAdd();
}
function closeQuickAdd(){
  if(_quickAddEl){ _quickAddEl.remove(); _quickAddEl = null; }
  document.removeEventListener('pointerdown', _quickAddOutside, true);
}
function quickAddMoreOptions(ds){
  const titleVal = _quickAddEl?.querySelector('#cqaTitle')?.value || '';
  closeQuickAdd();
  openAddTaskForDate(ds);
  setTimeout(()=>{ const t=document.getElementById('fTitle'); if(t && titleVal){ t.value = titleVal; } }, 120);
}
function quickAddSave(ds){
  if(!_quickAddEl) return;
  const title = (_quickAddEl.querySelector('#cqaTitle')?.value || '').trim();
  const kind  = _quickAddEl.querySelector('#cqaKind')?.value || 'event';
  const start = _quickAddEl.querySelector('#cqaStart')?.value || '';
  const end   = _quickAddEl.querySelector('#cqaEnd')?.value || '';
  if(!title){ _quickAddEl.querySelector('#cqaTitle')?.focus(); return; }
  if(kind === 'event'){
    const ev = {
      id: uid(),
      icsUid: '',
      createdAt: Date.now(),
      title,
      subject: '',
      date: ds, endDate: ds, noEndDate: false,
      time: start, endTime: end,
      allDay: !start,
      recurrence: 'none', recurrenceDays: [],
      location: '', notes: '',
      reminder: 'none',
      type: 'event',
      color: eventColorForType('event')
    };
    S.events.push(ev);
    showToast(`Added event "${title}" on ${fmtDate(ds)}`);
  } else {
    const t = {
      id: uid(), createdAt: Date.now(),
      title, subject: '', type: 'task',
      priority: 'medium',
      due: ds, scheduledDates: [ds], scheduledDays: [],
      scheduledTime: start || '',
      isHabit: false, notes: '', focusPoints: 0,
      subtasks: [], progress: 0,
      completedDates: {}, dueCompletedDates: {}, skippedDates: {},
      habitStart: '', habitEnd: '',
      archived: false, completed: false,
      calendarSignal: 'due', dailySection: 'Study',
      customOrder: Date.now()
    };
    S.tasks.push(t);
    showToast(`Added task "${title}" for ${fmtDate(ds)}`);
  }
  closeQuickAdd();
  save(); render();
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

function addModalSubtask(){
  const input=document.getElementById('modalSubtaskInput');
  const text=input?.value.trim();
  if(!text) return;
  editModalSubtasks.push({text,done:false,doneDates:{}});
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
  openPickerMonthYear('schedule', event && event.currentTarget);
}

// Month/year picker popover for the date-picker title in the Add Task
// modal. Target = 'due' or 'schedule'. Anchors to the clicked title
// button, lets the user pick any month + any year, then re-renders
// the appropriate picker on that month.
function openPickerMonthYear(target, anchor){
  // Dismiss any existing popover first
  const existing = document.getElementById('pickerMonthYearPop');
  if(existing){ existing.remove(); return; }
  if(!anchor) anchor = document.getElementById(target === 'due' ? 'duePickerTitle' : 'schedulePickerTitle');
  if(!anchor) return;
  const refDate = target === 'due' ? duePickerDate : schedulePickerDate;
  const curMonth = refDate.getMonth();
  const curYear  = refDate.getFullYear();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pop = document.createElement('div');
  pop.id = 'pickerMonthYearPop';
  pop.className = 'picker-my-pop';
  pop.innerHTML = `
    <div class="pmy-year-row">
      <button type="button" class="pmy-year-btn" onclick="event.stopPropagation(); shiftPickerMonthYear('${target}',-1,0)" aria-label="Previous year">‹</button>
      <span class="pmy-year-label" id="pmyYearLabel">${curYear}</span>
      <button type="button" class="pmy-year-btn" onclick="event.stopPropagation(); shiftPickerMonthYear('${target}',1,0)" aria-label="Next year">›</button>
    </div>
    <div class="pmy-month-grid">
      ${months.map((mo,i) => `<button type="button" class="pmy-month ${i===curMonth?'active':''}"
        data-m="${i}" onclick="event.stopPropagation(); applyPickerMonthYear('${target}',${i})">${mo}</button>`).join('')}
    </div>`;
  document.body.appendChild(pop);
  // Position below the anchor
  const r = anchor.getBoundingClientRect();
  pop.style.top  = (r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, r.left) + 'px';
  // Click-outside dismisses
  setTimeout(() => {
    document.addEventListener('pointerdown', _pmyOutside, true);
  }, 0);
}
function _pmyOutside(ev){
  const pop = document.getElementById('pickerMonthYearPop');
  if(!pop){ document.removeEventListener('pointerdown', _pmyOutside, true); return; }
  if(pop.contains(ev.target)) return;
  pop.remove();
  document.removeEventListener('pointerdown', _pmyOutside, true);
}
function shiftPickerMonthYear(target, dy, dm){
  // Adjust the popover's reference year (no re-render of the actual date
  // picker until the user picks a month).
  const label = document.getElementById('pmyYearLabel');
  if(!label) return;
  const newYear = Math.max(1970, Math.min(2100, Number(label.textContent) + dy));
  label.textContent = newYear;
}
function applyPickerMonthYear(target, monthIdx){
  const label = document.getElementById('pmyYearLabel');
  const year = label ? Number(label.textContent) : (target === 'due' ? duePickerDate : schedulePickerDate).getFullYear();
  if(target === 'due'){
    duePickerDate = new Date(year, monthIdx, 1);
    renderDuePicker();
  } else {
    schedulePickerDate = new Date(year, monthIdx, 1);
    renderSchedulePicker();
  }
  const pop = document.getElementById('pickerMonthYearPop');
  if(pop) pop.remove();
  document.removeEventListener('pointerdown', _pmyOutside, true);
}

// ── DUE DATE picker (single-select, same look as schedule picker) ──
function renderDuePicker(){
  const grid=document.getElementById('duePickerGrid');
  const title=document.getElementById('duePickerTitle');
  if(!grid || !title) return;
  const y=duePickerDate.getFullYear();
  const m=duePickerDate.getMonth();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  title.textContent=`${months[m]} ${y}`;
  const firstDay=new Date(y,m,1).getDay();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const current = (document.getElementById('fDue')?.value || '').trim();
  const today=todayStr();
  let html=['SU','MO','TU','WE','TH','FR','SA'].map(d=>`<div class="schedule-dow">${d}</div>`).join('');
  for(let i=0;i<firstDay;i++) html+=`<button type="button" class="schedule-day blank" tabindex="-1"></button>`;
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${y}-${pad(m+1)}-${pad(d)}`;
    html+=`<button type="button" class="schedule-day ${current===ds?'selected':''} ${ds===today?'today':''}"
      data-date="${ds}"
      onclick="setDueDate('${ds}')">${d}</button>`;
  }
  grid.innerHTML=html;
  renderDueDateChip();
}
function setDueDate(ds){
  const input=document.getElementById('fDue');
  if(!input) return;
  // Clicking the already-selected date clears it (toggle behaviour)
  input.value = input.value === ds ? '' : ds;
  // Make sure the picker is on the same month as the new selection
  if(input.value){
    duePickerDate = new Date(input.value+'T00:00:00');
  }
  // Mirror the value into the typable input bar so they stay in sync
  const bar = document.getElementById('fDueInput');
  if(bar) bar.value = input.value || '';
  renderDuePicker();
}

// Toggle the expandable calendar grid for the date pickers in Add Task.
// 'due' or 'schedule'. The compact <input type="date"> bar is the default;
// the full month grid only renders when the user explicitly asks for it.
function toggleDatePickerExpand(which){
  const wrapId = which === 'due' ? 'duePickerWrap' : 'schedulePickerWrap';
  const btnId  = which === 'due' ? 'dueExpandBtn'   : 'scheduleExpandBtn';
  const wrap = document.getElementById(wrapId);
  const btn  = document.getElementById(btnId);
  if(!wrap) return;
  const opening = wrap.hasAttribute('hidden');
  if(opening){
    wrap.removeAttribute('hidden');
    btn?.setAttribute('aria-expanded', 'true');
    btn?.classList.add('active');
    // Render the grid now that it's visible
    if(which === 'due') renderDuePicker();
    else renderSchedulePicker();
  } else {
    wrap.setAttribute('hidden', '');
    btn?.setAttribute('aria-expanded', 'false');
    btn?.classList.remove('active');
  }
}
function setDueToToday(){ setDueDate(todayStr()); }
function clearDueDate(){
  const input=document.getElementById('fDue');
  if(input) input.value = '';
  const bar = document.getElementById('fDueInput');
  if(bar) bar.value = '';
  renderDuePicker();
}
function moveDuePickerMonth(delta){
  duePickerDate.setMonth(duePickerDate.getMonth()+delta);
  renderDuePicker();
}
function jumpDuePickerToCalendar(){
  openPickerMonthYear('due', event && event.currentTarget);
}
function renderDueDateChip(){
  const wrap=document.getElementById('dueDateChips');
  if(!wrap) return;
  const due = (document.getElementById('fDue')?.value || '').trim();
  if(!due){
    wrap.innerHTML = '<span style="font-size:11px;color:var(--text3)">No due date set.</span>';
    return;
  }
  wrap.innerHTML = `<span class="sched-chip">${esc(fmtDate(due))}<button type="button" onclick="clearDueDate()">✕</button></span>`;
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
  if(ask && !await designConfirm('Make this a habit?', `"${t.title}" will repeat on the days you pick.`, 'Continue', 'Cancel')) return false;
  const days=await designDayPicker('Habit Days', `Which days should "${t.title}" repeat?`, [1,2,3,4,5]);
  if(days===null) return false;
  let scheduledDays=days;
  if(!scheduledDays.length) scheduledDays=[1,2,3,4,5];
  t.isHabit=true;
  t.scheduledDays=scheduledDays;
  t.scheduledDates=[];
  t.habitStart=t.habitStart || dateStr || todayStr();
  t.habitEnd=t.habitEnd || '';
  t.completed=false;
  t.completedAt=null;
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
    t.due = ds;
    t.calendarSignal = 'due';
    showToast(`Due date set to ${fmtDate(ds)}`);
  } else {
    if(t.isHabit && !await makeHabitSingleTask(t,ds,sec,true)){ resetDraggedTask(); return; }
    // Move to this subsection and schedule for date
    t.dailySection = sec;
    if(!t.scheduledDates) t.scheduledDates=[];
    if(!t.scheduledDates.includes(ds)) t.scheduledDates.push(ds);
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
    completedAt:null, progress:0, subtasks:[], focusPoints:0,
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
  const todays=getTasksForDate(today).filter(t=>!isTaskDone(t,today));
  const bank=S.tasks.filter(t=>!t.archived && !t.completed && !todays.some(x=>x.id===t.id)).slice(0,8);
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
    if(currentPage==='focus') toggleFocusFull(true);
    pomoTimer=setInterval(tickPomo,1000);
  } else {
    clearInterval(pomoTimer);
  }
}



function tickPomo(){
  const pr=getPomoConfig();
  const total=(pomoState.phase==='focus'?pr.focus:pomoState.phase==='break'?pr.short:pr.focus)*60;
  if(pomoState.phase==='calibrationFocus' || pomoState.phase==='calibrationBreak'){
    pomoState.elapsed++;
    updateHUDDisplay(-pomoState.elapsed, total);
    return;
  }
  if(pomoState.phase==='focusOver' || pomoState.phase==='breakOver'){
    pomoState.extendedElapsed++;
    updateHUDDisplay(-pomoState.extendedElapsed, total);
    return;
  }
  pomoState.elapsed++;
  updateHUDDisplay(total-pomoState.elapsed, total);
  if(pomoState.elapsed>=total) endPomoPhase();
}

function endPomoPhase(){
  clearInterval(pomoTimer); pomoState.running=true;
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
  pomoTimer=setInterval(tickPomo,1000);
  updateHUDDisplay(0, pr.focus*60);
}

function resetPomo(){
  clearInterval(pomoTimer);
  const pr=getPomoConfig();
  pomoState={running:false,phase:'focus',elapsed:0,cycles:0,targetCycles:pr.cycles||4,sessionStart:null,sessionId:uid(),plannedFocus:pr.focus*60,plannedBreak:pr.short*60,extendedElapsed:0,breakElapsed:0};
  pendingFocusReport=null;
  sessionTaskSnapshot={};
  sessionDistractionLog=[];
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
  pomoState.elapsed=0; pomoState.extendedElapsed=0; pomoState.running=true; pomoState.plannedBreak=isCalibration?0:pr.short*60;
  save(); renderFocusReports(); updateEOPR();
  updateCycleDisplay();
  pomoTimer=setInterval(tickPomo,1000);
  updateHUDDisplay(isCalibration?0:pr.short*60, pr.short*60);
  if(isCalibration) showToast('Break stopwatch started. Return when you feel recovered near 30%, then press Study Now.');
}

function startNextFocusPhase(){
  clearInterval(pomoTimer);
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
  pomoState={running:false,phase:'focus',elapsed:0,cycles:newCycles,targetCycles:pomoState.targetCycles,sessionStart:pomoState.sessionStart,sessionId:pomoState.sessionId,plannedFocus:pr.focus*60,plannedBreak:pr.short*60,extendedElapsed:0,breakElapsed:0};
  save(); renderFocusReports(); updatePersonalTimerUI();
  updateCycleDisplay();
  updateHUDDisplay(pr.focus*60, pr.focus*60);
  document.getElementById('hudPlay').textContent='▶';
  document.getElementById('hudPlay').classList.remove('active');
}

function endSession(auto){
  clearInterval(pomoTimer);
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
  localStorage.setItem(KEY, JSON.stringify(S));
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
    const { name, events } = parseICS(text);
    const niceName = (name && name.trim()) || 'URL Import';
    const source = ensureIcalSource(niceName, url);
    const result = await importEvents(events, source);
    status.textContent = `✓ ${source.name} — ${result.added} imported${result.skipped?`, skipped ${result.skipped}`:''}`;
    renderIcalSourceList();
  }catch(e){
    status.textContent='URL import failed: '+e.message+' — paste the ICS text in the Paste Data tab.';
  }
}

async function importIcalPaste(){
  const text=document.getElementById('icalPaste').value.trim();
  if(!text){ showToast('Paste ICS data first.'); return; }
  const { name, events } = parseICS(text);
  const niceName = (name && name.trim()) || 'Pasted calendar';
  const source = ensureIcalSource(niceName);
  const result = await importEvents(events, source);
  setIcalStatus(`✓ ${source.name} — ${result.added} imported${result.skipped?`, skipped ${result.skipped}`:''}`);
  renderIcalSourceList();
}

function onIcsDragOver(e){
  e.preventDefault();
  document.getElementById('icsDropZone')?.classList.add('drag-over');
}
function onIcsDragLeave(e){
  e.preventDefault();
  document.getElementById('icsDropZone')?.classList.remove('drag-over');
}
async function onIcsDrop(e){
  e.preventDefault();
  document.getElementById('icsDropZone')?.classList.remove('drag-over');
  const files = [...(e.dataTransfer?.files||[])].filter(f => /\.ics$/i.test(f.name) || /calendar|ics/i.test(f.type));
  if(!files.length){
    setIcalStatus('Drop one or more .ics files.');
    return;
  }
  await importIcsFiles(files);
}
async function onIcsFileInput(input){
  const files = [...(input?.files || [])].filter(f => /\.ics$/i.test(f.name) || /calendar|ics/i.test(f.type));
  if(!files.length){
    setIcalStatus('Pick one or more .ics files.');
    return;
  }
  await importIcsFiles(files);
  input.value = '';
}
async function importIcsFiles(files){
  const results = [];
  for(const file of files){
    try {
      const text = await file.text();
      const { name, events } = parseICS(text);
      const niceName = (name && name.trim()) || file.name.replace(/\.ics$/i, '');
      const source = ensureIcalSource(niceName, file.name);
      const r = await importEvents(events, source);
      results.push({ file: file.name, source: source.name, color: source.color, ...r });
    } catch (err) {
      results.push({ file: file.name, error: String(err && err.message || err) });
    }
  }
  const lines = results.map(r => {
    if(r.error) return `❌ ${r.file}: ${r.error}`;
    const dupes = r.skipped ? `, skipped ${r.skipped}` : '';
    return `✓ ${r.source} — ${r.added} imported${dupes}`;
  });
  setIcalStatus(lines.join('  ·  '));
  renderIcalSourceList();
}
function setIcalStatus(text){
  const el = document.getElementById('icalStatus');
  if(el) el.textContent = text;
}

// Render the list of imported calendar sources with a color palette per row.
function renderIcalSourceList(){
  const wrap = document.getElementById('icalSourceList');
  if(!wrap) return;
  const sources = Array.isArray(S.icalSources) ? S.icalSources : [];
  if(!sources.length){
    wrap.innerHTML = `<div class="ical-sources-empty">No calendars imported yet.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="ical-sources-title">Imported calendars</div>
    ${sources.map(src => {
      const eventCount = S.events.filter(e => e.sourceId === src.id).length;
      const taskCount = S.tasks.filter(t => t.sourceId === src.id).length;
      return `
      <div class="ical-source-row">
        <button type="button" class="ical-source-swatch" style="background:${esc(src.color || '#7aa2ff')}"
          onclick="togglePalettePopover('${src.id}', this)"
          aria-label="Change color"></button>
        <input type="text" class="ical-source-name" value="${esc(src.name)}"
          onblur="renameIcalSource('${src.id}', this.value)"
          onkeydown="if(event.key==='Enter')this.blur()">
        <span class="ical-source-count">${eventCount+taskCount} items</span>
        <button type="button" class="ical-source-delete" onclick="deleteIcalSource('${src.id}')" title="Delete this calendar and its items">✕</button>
        <div class="ical-palette-pop" id="palettePop-${src.id}" hidden>
          ${CAL_SOURCE_PALETTE.map(c =>
            `<button type="button" class="ical-palette-swatch ${c.toLowerCase() === String(src.color||'').toLowerCase() ? 'selected' : ''}" style="background:${c}"
              onclick="setIcalSourceColor('${src.id}', '${c}'); togglePalettePopover('${src.id}')"
              aria-label="${c}"></button>`).join('')}
          <label class="ical-palette-custom">
            <input type="color" value="${esc(src.color || '#7aa2ff')}"
              onchange="setIcalSourceColor('${src.id}', this.value); togglePalettePopover('${src.id}')">
            <span>Custom</span>
          </label>
        </div>
      </div>`;
    }).join('')}
  `;
}
function togglePalettePopover(sourceId, anchorEl){
  // Close all other popovers
  document.querySelectorAll('.ical-palette-pop').forEach(p => {
    if(p.id !== 'palettePop-' + sourceId) p.hidden = true;
  });
  const pop = document.getElementById('palettePop-' + sourceId);
  if(pop) pop.hidden = !pop.hidden;
}

// Ensure a calendar source exists. Reuses one with the same (normalized) name
// if it's already in the list — so re-importing the same Google Calendar
// updates the same source rather than duplicating it.
function ensureIcalSource(name, fileName){
  const norm = (name || fileName || 'Calendar').trim() || 'Calendar';
  const existing = S.icalSources.find(s => s && s.name && s.name.toLowerCase() === norm.toLowerCase());
  if(existing) return existing;
  const color = CAL_SOURCE_PALETTE[S.icalSources.length % CAL_SOURCE_PALETTE.length];
  const src = {
    id: uid(),
    name: norm,
    color,
    fileName: fileName || '',
    importedAt: Date.now()
  };
  S.icalSources.push(src);
  return src;
}

async function importEvents(events, sourceMeta){
  const sm = sourceMeta || {};
  let added=0, skipped=0;
  for(const ev of events){
    if(!ev.summary) continue;
    if(ev.uid && (S.events.find(e=>e.icsUid===ev.uid) || S.tasks.find(t=>t.icsUid===ev.uid))){
      skipped++;
      continue;
    }
    const importType=classifyImportedItem(ev);
    const date=ev.due||ev.dtstart||'';
    // Per-source color wins; fall back to per-event COLOR; finally type default.
    const inferredColor = sm.color || ev.color || eventColorForType(importType.type || 'event');
    // Build a clean description that preserves Google-Calendar features
    // (organizer, attendees, conference URL, status) inside the notes field.
    const noteExtras = [];
    if(ev.organizer?.name || ev.organizer?.email) noteExtras.push(`Organizer: ${ev.organizer.name || ev.organizer.email}`);
    if(ev.attendees?.length) noteExtras.push(`Attendees: ${ev.attendees.map(a=>a.name||a.email).filter(Boolean).join(', ')}`);
    if(ev.conferenceUrl) noteExtras.push(`Meet: ${ev.conferenceUrl}`);
    if(ev.url) noteExtras.push(`Link: ${ev.url}`);
    if(ev.status && ev.status!=='CONFIRMED') noteExtras.push(`Status: ${ev.status.toLowerCase()}`);
    const combinedNotes = [ev.description||'', noteExtras.join('\n')].filter(Boolean).join('\n\n').trim();

    // Detect a weekly recurrence — these become habit tasks (with scheduledDays)
    // or recurring events (recurrence/recurrenceDays) so they show on every
    // matching day of the calendar, not just the first.
    const weeklyDays = rruleToScheduledDays(ev.rrule, ev.dtstart || date);

    if(importType.kind==='event'){
      const type=importType.type || 'event';
      const candidate={
        id:uid(), icsUid:ev.uid||uid(), createdAt:Date.now(),
        title:ev.summary, subject:'', type,
        date, endDate: ev.dtend || '',
        time: ev.startTime || '',
        endTime: ev.endTime || '',
        allDay: ev.allDay !== false && !ev.startTime,
        location:ev.location||'', notes: combinedNotes,
        color: inferredColor,
        sourceId: sm.id || '',
        // Google Calendar feature preservation
        organizer: ev.organizer || null,
        attendees: ev.attendees || [],
        conferenceUrl: ev.conferenceUrl || '',
        url: ev.url || '',
        status: ev.status || '',
        visibility: ev.visibility || '',
        recurrence: ev.rrule ? (ev.rrule.FREQ||'').toLowerCase() : 'none',
        recurrenceDays: weeklyDays || [],
        recurrenceUntil: ev.rrule?.UNTIL || '',
        recurrenceCount: ev.rrule?.COUNT || 0,
        exdates: ev.exdates || []
      };
      const dupe=findPossibleDuplicate(candidate,'event');
      if(dupe && await confirmDuplicate(candidate,dupe)){ skipped++; continue; }
      S.events.push(candidate);
    }else{
      const isWeeklyRecurring = !!(weeklyDays && weeklyDays.length);
      const candidate={
        id:uid(), icsUid:ev.uid||uid(), createdAt:Date.now(),
        archived:false, completed:false, completedAt:null, completedDates:{},
        title:ev.summary, subject:'', type:'assignment',
        priority:'medium', due:isWeeklyRecurring?'':date, scheduledDates:[],
        scheduledDays: isWeeklyRecurring ? weeklyDays : [],
        habitStart: isWeeklyRecurring ? (ev.dtstart || date || '') : '',
        habitEnd:   isWeeklyRecurring ? (ev.rrule?.UNTIL || '') : '',
        scheduledTime: ev.startTime || ev.dueTime || '',
        isHabit: isWeeklyRecurring,
        notes: combinedNotes, focusPoints:0, subtasks:[], progress:0,
        dueCompletedDates:{}, customOrder:Date.now()+added,
        calendarSignal: isWeeklyRecurring ? 'habit' : 'due', dailySection:'Study',
        sourceId: sm.id || '',
        organizer: ev.organizer || null,
        attendees: ev.attendees || [],
        conferenceUrl: ev.conferenceUrl || '',
        url: ev.url || ''
      };
      const dupe=findPossibleDuplicate(candidate,'task');
      if(dupe && await confirmDuplicate(candidate,dupe)){ skipped++; continue; }
      S.tasks.push(candidate);
    }
    added++;
  }
  save(); render();
  return {added, skipped};
}

// Update a source's color and propagate to its events.
function setIcalSourceColor(sourceId, color){
  const src = S.icalSources.find(s => s.id === sourceId);
  if(!src) return;
  src.color = color;
  // Propagate to attached events (only re-color those that haven't been
  // manually overridden)
  S.events.forEach(e => { if(e.sourceId === sourceId) e.color = color; });
  save(); render();
  renderIcalSourceList();
}

// Rename a source.
function renameIcalSource(sourceId, name){
  const src = S.icalSources.find(s => s.id === sourceId);
  if(!src) return;
  src.name = String(name || '').trim() || src.name;
  save();
  renderIcalSourceList();
}

// Delete a source AND optionally its events.
async function deleteIcalSource(sourceId){
  const src = S.icalSources.find(s => s.id === sourceId);
  if(!src) return;
  const eventCount = S.events.filter(e => e.sourceId === sourceId).length;
  const taskCount = S.tasks.filter(t => t.sourceId === sourceId).length;
  const total = eventCount + taskCount;
  const ok = await designConfirm(
    `Delete "${src.name}"?`,
    total > 0
      ? `This will also delete ${total} item${total===1?'':'s'} imported from this calendar.`
      : 'Remove this calendar source?',
    'Delete', 'Cancel'
  );
  if(!ok) return;
  S.events = S.events.filter(e => e.sourceId !== sourceId);
  S.tasks  = S.tasks.filter(t => t.sourceId !== sourceId);
  S.icalSources = S.icalSources.filter(s => s.id !== sourceId);
  save(); render();
  renderIcalSourceList();
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

// Parse an ICS payload. Returns { name, events } where `name` is taken from
// the X-WR-CALNAME property (used by Google Calendar / Outlook to label the
// calendar) and `events` is the list of VEVENT objects with both date AND
// time information extracted.
function parseICS(text){
  const events=[];
  let calendarName='';
  let calendarColor='';
  const lines=text.replace(/\r\n|\r/g,'\n').split('\n');
  const unfolded=[];
  for(const line of lines){
    if(/^[ \t]/.test(line)) unfolded[unfolded.length-1]+=line.slice(1);
    else unfolded.push(line);
  }
  let ev=null;
  let inCalendar=false;
  let inAlarm=false;
  // Skip non-event blocks (VTIMEZONE, VFREEBUSY, VJOURNAL) so their nested
  // SUMMARY/DTSTART lines don't bleed into the previous event. (Google
  // exports include VTIMEZONE blocks that would otherwise corrupt parsing.)
  let inOtherBlock=null;
  for(const rawLine of unfolded){
    const line=rawLine.trim();
    if(!line) continue;
    if(line==='BEGIN:VCALENDAR'){ inCalendar=true; continue; }
    if(line==='END:VCALENDAR'){ inCalendar=false; continue; }
    if(line==='BEGIN:VALARM'){ inAlarm=true; continue; }
    if(line==='END:VALARM'){ inAlarm=false; continue; }
    if(line==='BEGIN:VTIMEZONE' || line==='BEGIN:STANDARD' || line==='BEGIN:DAYLIGHT' ||
       line==='BEGIN:VFREEBUSY' || line==='BEGIN:VJOURNAL'){
      inOtherBlock = line.replace('BEGIN:','');
      continue;
    }
    if(inOtherBlock && line==='END:'+inOtherBlock){ inOtherBlock=null; continue; }
    if(inOtherBlock) continue;
    if(line==='BEGIN:VEVENT' || line==='BEGIN:VTODO'){ ev={ _isTodo: line==='BEGIN:VTODO' }; continue; }
    if(line==='END:VEVENT' || line==='END:VTODO'){ if(ev) events.push(ev); ev=null; continue; }
    if(inAlarm) continue;
    const col=line.indexOf(':');
    if(col<0) continue;
    const key=line.slice(0,col), val=line.slice(col+1);
    const bareKey = key.split(';')[0].toUpperCase();
    // Calendar-level properties (only valid outside a VEVENT)
    if(!ev && inCalendar){
      if(bareKey==='X-WR-CALNAME') calendarName = unescapeICS(val).trim();
      else if(bareKey==='X-APPLE-CALENDAR-COLOR' || bareKey==='COLOR' || bareKey==='X-WR-CALCOLOR') calendarColor = val.trim();
      continue;
    }
    if(!ev) continue;
    switch(bareKey){
      case 'DTSTART': {
        const parsed = parseICSDateTime(val);
        ev.dtstart = parsed.date;
        ev.startTime = parsed.time;
        ev.allDay = parsed.allDay;
        break;
      }
      case 'DTEND': {
        const parsed = parseICSDateTime(val);
        ev.dtend = parsed.date;
        ev.endTime = parsed.time;
        break;
      }
      case 'DUE': {
        const parsed = parseICSDateTime(val);
        ev.due = parsed.date;
        if(parsed.time) ev.dueTime = parsed.time;
        break;
      }
      case 'SUMMARY':       ev.summary     = unescapeICS(val); break;
      case 'DESCRIPTION':   ev.description = unescapeICS(val); break;
      case 'LOCATION':      ev.location    = unescapeICS(val); break;
      case 'CATEGORIES':    ev.categories  = unescapeICS(val); break;
      case 'URL':           ev.url         = val.trim(); break;
      case 'UID':           ev.uid         = val.trim(); break;
      case 'STATUS':        ev.status      = val.trim().toUpperCase(); break;
      case 'TRANSP':        ev.transp      = val.trim().toUpperCase(); break;
      case 'CLASS':         ev.visibility  = val.trim().toUpperCase(); break;
      case 'ORGANIZER':     ev.organizer   = parseIcsPerson(key, val); break;
      case 'ATTENDEE': {
        const a = parseIcsPerson(key, val);
        if(a){ (ev.attendees = ev.attendees || []).push(a); }
        break;
      }
      case 'CONFERENCE':
      case 'X-GOOGLE-CONFERENCE': ev.conferenceUrl = val.trim(); break;
      case 'RRULE':         ev.rrule       = parseRRule(val); break;
      case 'EXDATE':        (ev.exdates = ev.exdates || []).push(parseICSDateTime(val).date); break;
      case 'RDATE':         (ev.rdates  = ev.rdates  || []).push(parseICSDateTime(val).date); break;
      case 'RECURRENCE-ID': ev.recurrenceId = parseICSDateTime(val).date; break;
      case 'COLOR':
      case 'X-APPLE-CALENDAR-COLOR': ev.color = val.trim(); break;
      case 'PRIORITY':      ev.priority    = Number(val); break;
      case 'X-MICROSOFT-CDO-BUSYSTATUS': ev.busy = val.trim(); break;
      default: break;
    }
  }
  return { name: calendarName, color: calendarColor, events };
}

// Extract CN=Display Name and mailto: from an ATTENDEE / ORGANIZER line.
// Example: ORGANIZER;CN=Jay W:mailto:jay@example.com
function parseIcsPerson(key, val){
  const cnMatch = key.match(/CN=([^;:]+)/i);
  const email = String(val||'').replace(/^mailto:/i,'').trim();
  if(!cnMatch && !email) return null;
  return { name: cnMatch ? cnMatch[1].trim() : '', email };
}

// Parse an RRULE value (e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10") into
// a struct usable by importEvents to build a recurring habit/event.
function parseRRule(val){
  const out = {};
  String(val||'').split(';').forEach(seg=>{
    const [k,v] = seg.split('=');
    if(!k || v == null) return;
    out[k.trim().toUpperCase()] = v.trim();
  });
  if(out.BYDAY) out.BYDAY = out.BYDAY.split(',').map(s=>s.trim().toUpperCase());
  if(out.UNTIL) out.UNTIL = parseICSDateTime(out.UNTIL).date;
  if(out.COUNT) out.COUNT = Number(out.COUNT);
  if(out.INTERVAL) out.INTERVAL = Number(out.INTERVAL);
  return out;
}

// RRULE BYDAY → JS day-of-week index (Sun=0)
const ICAL_BYDAY_TO_DOW = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };
function rruleToScheduledDays(rrule, dtstart){
  if(!rrule || rrule.FREQ !== 'WEEKLY') return null;
  if(Array.isArray(rrule.BYDAY) && rrule.BYDAY.length){
    return rrule.BYDAY.map(d => ICAL_BYDAY_TO_DOW[d]).filter(n=>Number.isFinite(n));
  }
  if(dtstart){
    const dow = new Date(dtstart+'T00:00:00').getDay();
    return Number.isFinite(dow) ? [dow] : null;
  }
  return null;
}

// Parse the value portion of DTSTART / DTEND / DUE. Returns {date, time, allDay}.
// Examples:
//   "20260521T093000Z"           → date:"2026-05-21" time:"09:30" allDay:false
//   "20260521T093000"            → date:"2026-05-21" time:"09:30" allDay:false
//   "20260521"                   → date:"2026-05-21" time:""      allDay:true
function parseICSDateTime(val){
  const s = String(val || '').trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(?:\d{2})?(Z?))?$/);
  if(!m) return { date:'', time:'', allDay:true };
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if(!m[4]) return { date, time:'', allDay:true };
  // Note: we treat the time as local-clock-time even when Z is present. Full
  // tz conversion is a rabbit hole; most personal calendars import cleanly
  // with this assumption because the user views in the same tz they exported.
  return { date, time: `${m[4]}:${m[5]}`, allDay:false };
}

// Back-compat shim — some callers still expect date-only.
function parseICSDate(s){
  return parseICSDateTime(s).date;
}
function unescapeICS(s){ return String(s||'').replace(/\\n/gi,' ').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\'); }

// ════════════════════════════════════════════════════════════
//  MINI CALENDAR
// ════════════════════════════════════════════════════════════
function renderCalendar(){
  applyCalSplit();
  applyCalZoomCss();
  bindCalZoomListeners();
  const y=calViewDate.getFullYear(), mo=calViewDate.getMonth();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  // Header label depends on layout
  if(calLayout === 'week'){
    const start = getWeekStartDate(calViewDate);
    const end = new Date(start); end.setDate(end.getDate()+6);
    const startLabel = `${months[start.getMonth()].slice(0,3)} ${start.getDate()}`;
    const endLabel = start.getMonth() === end.getMonth()
      ? `${end.getDate()}`
      : `${months[end.getMonth()].slice(0,3)} ${end.getDate()}`;
    document.getElementById('calMonthLabel').textContent = `${startLabel} – ${endLabel}, ${end.getFullYear()}`;
  } else if(calLayout === 'day'){
    const d = calViewDate;
    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    document.getElementById('calMonthLabel').textContent = `${dow}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  } else {
    document.getElementById('calMonthLabel').textContent=months[mo]+' '+y;
  }
  const firstDay=new Date(y,mo,1).getDay();
  const daysInMonth=new Date(y,mo+1,0).getDate();
  const today=todayStr();
  let html='';
  DAY_NAMES.forEach(d=>{ html+=`<div class="cal-day-name">${d}</div>`; });
  for(let i=0;i<firstDay;i++) html+=`<div class="cal-cell other-month"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const ds=y+'-'+pad(mo+1)+'-'+pad(d);
    const allDayTasks=S.tasks.filter(t=>!t.archived&&(t.scheduledDates?.includes(ds)||(t.due===ds&&!isDueSignalDone(t,ds))||isHabitDueToday(t,ds)));
    const allDayEvents=S.events.filter(e=>eventOccursOn(e,ds));
    const dayTasks = calViewMode==='events' ? [] : allDayTasks;
    const dayEvents = calViewMode==='tasks' ? [] : allDayEvents;
    const hasTasks=dayTasks.length>0 || dayEvents.length>0;
    const hasExam=dayEvents.some(e=>e.type==='test');
    const isToday=ds===today;
    const isSel=ds===calSelectedDate;
    // Chip text shows just the title — the color stripe already encodes
    // the category. How many chips fit scales with calZoom: at 1.0 → 3,
    // at 1.5 → 5, at 0.7 → 2. Anything beyond shows "+N more".
    const zoomChipCap = Math.max(2, Math.round(3 * (Number(S.settings?.calZoom) || 1)));
    const allChips = [
      ...dayEvents.map(e=>`<span class="cal-mini-chip ${e.type==='test'?'exam':e.type||'event'}" style="border-left-color:${esc(e.color||eventColorForType(e.type))}" title="${esc(e.title)}">${esc(e.title)}</span>`),
      ...dayTasks.map(t=>{
        const sig=calendarSignalForTask(t,ds);
        return `<span class="cal-mini-chip ${sig}" draggable="true" title="${esc(t.title)}" ondragstart="onDayTaskDragStart(event,'${t.id}','${ds}')">${esc(t.title)}</span>`;
      })
    ];
    const overflow = allChips.length - zoomChipCap;
    const chips = (overflow > 0
      ? allChips.slice(0, zoomChipCap).concat([`<span class="cal-mini-chip cal-mini-more" title="+${overflow} more on this day">+${overflow}</span>`])
      : allChips
    ).join('');
    html+=`<div class="cal-cell ${isToday?'today':''} ${isSel?'selected':''} ${hasTasks?'has-tasks':''} ${hasExam?'has-exam':''}"
      data-date="${ds}"
      role="button"
      tabindex="0"
      onclick="selectCalDate(event,'${ds}')"
      ondblclick="openQuickAdd(event,'${ds}')"
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
  document.querySelectorAll('.clt-opt').forEach(b=>b.classList.toggle('active',b.dataset.layout===calLayout));
  // Show ONLY the layout selected. The `hidden` attribute loses to explicit
  // display rules on .cal-grid / .cal-week-wrap, so use display directly.
  const weekWrap = document.getElementById('calWeekWrap');
  if(calLayout === 'week' || calLayout === 'day'){
    calGrid.style.display = 'none';
    if(weekWrap){ weekWrap.style.display = ''; weekWrap.hidden = false; }
    renderWeekView();
  } else {
    calGrid.style.display = '';
    if(weekWrap){ weekWrap.style.display = 'none'; weekWrap.hidden = true; }
  }
  renderCalDayTasks();
}
function calendarItemsForDate(ds){
  const allDayTasks=S.tasks.filter(t=>!t.archived&&(t.scheduledDates?.includes(ds)||(t.due===ds&&!isDueSignalDone(t,ds))||isHabitDueToday(t,ds)));
  const allDayEvents=S.events.filter(e=>eventOccursOn(e,ds));
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
  if(calLayout === 'day'){
    calViewDate.setDate(calViewDate.getDate() + dir);
    calSelectedDate = `${calViewDate.getFullYear()}-${pad(calViewDate.getMonth()+1)}-${pad(calViewDate.getDate())}`;
  } else if(calLayout === 'week'){
    calViewDate.setDate(calViewDate.getDate() + dir*7);
  } else {
    calViewDate.setMonth(calViewDate.getMonth()+dir);
  }
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
// ── FOCUS BLOCK ──
// A focus block is a time-bounded event that contains a list of task IDs
// to work on during that window. Stored as an event with type='focus_block'
// and a taskIds array. Renders as a special block in the hour grid.
let focusBlockSelection = new Set();
function openFocusBlockModal(prefill){
  focusBlockSelection = new Set();
  const ds = (prefill && prefill.date) || calSelectedDate || todayStr();
  document.getElementById('fbTitle').value = 'Focus block';
  document.getElementById('fbDate').value = ds;
  document.getElementById('fbStart').value = (prefill && prefill.start) || '09:00';
  document.getElementById('fbEnd').value = (prefill && prefill.end) || '10:00';
  document.getElementById('fbTaskSearch').value = '';
  renderFocusBlockTaskList();
  openModal('mFocusBlock');
}
function fbCandidateTasks(){
  // Surface the most relevant tasks first; avoid overwhelming the user with
  // every todo. Order: MUST → today's scheduled → this week → recent unscheduled.
  const today = todayStr();
  const weekStart = getWeekStartDate(new Date(today+'T00:00:00'));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
  const weekEndStr = `${weekEnd.getFullYear()}-${pad(weekEnd.getMonth()+1)}-${pad(weekEnd.getDate())}`;
  const open = S.tasks.filter(t => !isArchivedForTodo(t) && !t.completed);
  const isThisWeek = (t) => {
    const dates = [t.due, ...(t.scheduledDates||[])].filter(Boolean);
    return dates.some(d => d >= weekStart.toISOString().slice(0,10) && d <= weekEndStr);
  };
  const must = open.filter(t => t.priority === 'MUST');
  const todayTasks = open.filter(t => t.priority !== 'MUST'
    && (isHabitDueToday(t,today) || (t.scheduledDates||[]).includes(today) || t.due===today));
  const weekTasks = open.filter(t => t.priority !== 'MUST'
    && !todayTasks.includes(t) && isThisWeek(t));
  const recent = open.filter(t => !must.includes(t) && !todayTasks.includes(t) && !weekTasks.includes(t))
    .sort((a,b) => (b.createdAt||0) - (a.createdAt||0))
    .slice(0, 4);
  return { must, todayTasks, weekTasks, recent };
}
function renderFocusBlockTaskList(){
  const wrap = document.getElementById('fbTaskList');
  if(!wrap) return;
  const q = (document.getElementById('fbTaskSearch')?.value || '').trim().toLowerCase();
  const groups = fbCandidateTasks();
  const filter = (arr) => q ? arr.filter(t => (t.title||'').toLowerCase().includes(q) || (t.subject||'').toLowerCase().includes(q)) : arr;
  const sections = [
    { name: 'MUST', tasks: filter(groups.must) },
    { name: 'Today', tasks: filter(groups.todayTasks) },
    { name: 'This week', tasks: filter(groups.weekTasks) },
    { name: 'Recently added', tasks: filter(groups.recent) }
  ].filter(s => s.tasks.length);
  if(!sections.length){
    wrap.innerHTML = `<div class="fb-empty">No matching tasks.</div>`;
    updateFbSelectedCount();
    return;
  }
  wrap.innerHTML = sections.map(sec => `
    <div class="fb-group">
      <div class="fb-group-head">${esc(sec.name)} <span class="fb-group-count">${sec.tasks.length}</span></div>
      ${sec.tasks.slice(0, 8).map(t => {
        const checked = focusBlockSelection.has(t.id) ? 'checked' : '';
        const priClass = t.priority === 'MUST' ? 'must' : t.priority === 'high' ? 'high' : '';
        return `
          <label class="fb-task ${priClass}">
            <input type="checkbox" data-id="${t.id}" ${checked} onchange="toggleFbTask('${t.id}', this.checked)">
            <span class="fb-task-title">${esc(t.title)}</span>
            ${t.subject ? `<span class="fb-task-sub">${esc(t.subject)}</span>` : ''}
          </label>
        `;
      }).join('')}
    </div>
  `).join('');
  updateFbSelectedCount();
}
function toggleFbTask(id, checked){
  if(checked) focusBlockSelection.add(id);
  else focusBlockSelection.delete(id);
  updateFbSelectedCount();
}
function updateFbSelectedCount(){
  const n = focusBlockSelection.size;
  const el = document.getElementById('fbSelectedCount');
  if(el) el.textContent = n === 0 ? 'No tasks selected' : `${n} task${n===1?'':'s'} in this block`;
}
function saveFocusBlock(){
  const title = (document.getElementById('fbTitle').value || 'Focus block').trim();
  const date = document.getElementById('fbDate').value;
  const start = document.getElementById('fbStart').value;
  const end = document.getElementById('fbEnd').value;
  if(!date){ showToast('Pick a date for the focus block.'); return; }
  if(!start || !end){ showToast('Pick a start and end time.'); return; }
  if(end <= start){ showToast('End time must be after start.'); return; }
  const ev = {
    id: uid(),
    createdAt: Date.now(),
    type: 'focus_block',
    title,
    date,
    time: start,
    endTime: end,
    allDay: false,
    color: '#7aa2ff',
    taskIds: Array.from(focusBlockSelection),
    notes: ''
  };
  S.events.push(ev);
  focusBlockSelection = new Set();
  save();
  try { render(); } catch(_) {}
  closeModal('mFocusBlock');
  showToast(`Focus block added · ${ev.taskIds.length} task${ev.taskIds.length===1?'':'s'}`);
}

function setCalLayout(layout){
  calLayout = (layout === 'week' || layout === 'day') ? layout : 'month';
  try { localStorage.setItem('focus_cal_layout', calLayout); } catch(_) {}
  document.querySelectorAll('.clt-opt').forEach(b=>b.classList.toggle('active', b.dataset.layout===calLayout));
  renderCalendar();
}

// ── Calendar zoom ─────────────────────────────────────────────
// Adjusts how dense the calendar is. Scales month cell height,
// week-view hourPx, and how many chips fit per month cell.
// Triggered by:
//   - Cmd/Ctrl + scroll wheel on the calendar
//   - Pinch-to-zoom on trackpad (browser fires wheel + ctrlKey=true)
//   - Cmd/Ctrl + = / - / 0 keys
const CAL_ZOOM_MIN = 0.5;
const CAL_ZOOM_MAX = 2.5;
const CAL_ZOOM_STEP = 0.10;
let _zoomToastT = null;
function setCalZoom(z, opts){
  const newZoom = Math.max(CAL_ZOOM_MIN, Math.min(CAL_ZOOM_MAX, Math.round(z * 100) / 100));
  if(!S.settings) S.settings = {};
  S.settings.calZoom = newZoom;
  applyCalZoomCss();
  save();
  renderCalendar();
  // Brief toast so users see what zoom they're at
  if(!opts || !opts.silent) showZoomToast(newZoom);
}
function applyCalZoomCss(){
  const z = Math.max(CAL_ZOOM_MIN, Math.min(CAL_ZOOM_MAX, Number(S.settings?.calZoom) || 1));
  // Scale the cell minimum height. Density override (--cal-cell-h) acts as
  // the baseline; we multiply by zoom and set a separate var for the grid.
  const root = document.documentElement;
  const baseH = parseFloat(getComputedStyle(root).getPropertyValue('--cal-cell-h')) || 55;
  root.style.setProperty('--cal-cell-h-zoom', `${Math.round(baseH * z)}px`);
  root.style.setProperty('--cal-zoom', String(z));
}
function showZoomToast(z){
  // Tiny floating chip near the calendar header showing the % zoom level.
  let el = document.getElementById('calZoomToast');
  if(!el){
    el = document.createElement('div');
    el.id = 'calZoomToast';
    el.className = 'cal-zoom-toast';
    document.body.appendChild(el);
  }
  el.textContent = `${Math.round(z * 100)}%`;
  el.classList.add('show');
  if(_zoomToastT) clearTimeout(_zoomToastT);
  _zoomToastT = setTimeout(() => el.classList.remove('show'), 900);
}
function zoomIn(){  setCalZoom((Number(S.settings?.calZoom) || 1) + CAL_ZOOM_STEP); }
function zoomOut(){ setCalZoom((Number(S.settings?.calZoom) || 1) - CAL_ZOOM_STEP); }
function zoomReset(){ setCalZoom(1.0); }

// Wire wheel + keyboard listeners on first render (idempotent).
let _zoomBound = false;
function bindCalZoomListeners(){
  if(_zoomBound) return;
  _zoomBound = true;
  // Cmd/Ctrl + wheel anywhere on the calendar (handles pinch on macOS,
  // which fires wheel with ctrlKey=true). Bound globally and filtered
  // to only fire when the cursor is over the calendar surface.
  window.addEventListener('wheel', (e) => {
    if(!(e.ctrlKey || e.metaKey)) return;
    // Only consume the event when the pointer is over a calendar surface
    const t = e.target;
    if(!t || !t.closest) return;
    const onCal = t.closest('#calPanel, #calendarPageHost, .cal-week-wrap, .cal-panel');
    if(!onCal) return;
    e.preventDefault();
    const cur = Number(S.settings?.calZoom) || 1;
    const delta = -Math.sign(e.deltaY) * CAL_ZOOM_STEP;
    setCalZoom(cur + delta);
  }, { passive: false });
  // Cmd/Ctrl + = / - / 0 (zoom) AND Cmd/Ctrl + K (Quick Capture)
  window.addEventListener('keydown', (e) => {
    if(!(e.ctrlKey || e.metaKey)) return;

    // ── Cmd/Ctrl + K — Quick Capture (works anywhere) ──
    if((e.key === 'k' || e.key === 'K') && S.settings?.scaffolds?.quickCapture){
      e.preventDefault();
      openQuickCapture();
      return;
    }

    // ── Calendar zoom keys (only when a calendar is on screen) ──
    if(!document.querySelector('#calPanel, #calendarPageHost')) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if(tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
    if(e.key === '=' || e.key === '+'){ e.preventDefault(); zoomIn(); }
    else if(e.key === '-' || e.key === '_'){ e.preventDefault(); zoomOut(); }
    else if(e.key === '0'){ e.preventDefault(); zoomReset(); }
  });
}

// ── Google-Calendar style Week Hour View ──
function getWeekStartDate(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay()); // Sunday start
  return d;
}
function timeStrToMinutes(s){
  if(!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if(!m) return null;
  return Number(m[1])*60 + Number(m[2]);
}
function fmtTime12(s){
  const min = timeStrToMinutes(s);
  if(min === null) return s || '';
  const h = Math.floor(min/60);
  const m = min%60;
  const period = h<12 ? 'am' : 'pm';
  const hr = h===0 ? 12 : (h>12 ? h-12 : h);
  return m === 0 ? `${hr}${period}` : `${hr}:${String(m).padStart(2,'0')}${period}`;
}
// Only EVENTS appear in the hour grid. Tasks are unscheduled work — they live
// in the all-day strip regardless of their scheduledTime field. This keeps the
// hour grid focused on real time-bound commitments.
function collectTimedItems(ds){
  const showEvents = calViewMode !== 'tasks';
  if(!showEvents) return [];
  const out = [];
  S.events.forEach(e => {
    if(!eventOccursOn(e, ds)) return;
    const start = timeStrToMinutes(e.time);
    if(start === null) return;
    const end = timeStrToMinutes(e.endTime);
    const dur = (end !== null && end > start) ? end - start : 60;
    const isFocus = e.type === 'focus_block';
    out.push({
      kind: 'event',
      id: e.id,
      title: e.title,
      startMin: start,
      durationMin: dur,
      accent: e.color || eventColorForType(e.type) || 'var(--accent)',
      sig: e.type==='test' ? 'exam' : isFocus ? 'focus' : (e.type||'event'),
      isFocus,
      taskIds: Array.isArray(e.taskIds) ? e.taskIds : [],
      onClick: `editEvent('${e.id}')`
    });
  });
  out.sort((a,b)=>a.startMin - b.startMin);
  return out;
}
function collectAllDayItems(ds){
  const out = [];
  const showTasks = calViewMode !== 'events';
  const showEvents = calViewMode !== 'tasks';
  if(showTasks){
    S.tasks.forEach(t => {
      if(t.archived) return;
      if(!(t.scheduledDates?.includes(ds) || (t.due===ds && !isDueSignalDone(t,ds)) || isHabitDueToday(t,ds))) return;
      const sig = calendarSignalForTask(t,ds);
      out.push({ kind:'task', id:t.id, title:t.title, sig, accent:null });
    });
  }
  if(showEvents){
    S.events.forEach(e => {
      if(!eventOccursOn(e, ds)) return;
      if(timeStrToMinutes(e.time) !== null) return; // timed events go to hour grid
      out.push({ kind:'event', id:e.id, title:e.title, sig: e.type==='test'?'exam':(e.type||'event'), accent: e.color });
    });
  }
  return out;
}

// Toggle the expand state of a single day's all-day strip in week view.
// State lives on window so it survives a render() pass; we cap visible
// items at 3 by default so busy days don't dominate the calendar.
function toggleAlldayColumn(ds){
  if(!window._alldayExpanded) window._alldayExpanded = new Set();
  if(window._alldayExpanded.has(ds)) window._alldayExpanded.delete(ds);
  else window._alldayExpanded.add(ds);
  renderWeekView();
}

// LEGACY: kept as a no-op shim so anything still calling setAlldayCap
// doesn't blow up. The all-day cap is now driven by strip height, which
// the user adjusts via the resize handle (see startAlldayResize).
function setAlldayCap(_n){ /* deprecated */ }

// Drag the split between the calendar grid (.cal-panel) and the
// selected-day task card (.cal-day-tasks) inside the Todo List
// calendar column. Persists the calendar's flex-basis as a fraction
// of the column height in S.settings.calSplit (0.30 - 0.90).
function startCalSplitResize(e){
  e.preventDefault();
  const col = document.getElementById('workbenchCalendar');
  const panel = document.getElementById('calPanel');
  const dayCard = document.getElementById('calDayTasks');
  if(!col || !panel || !dayCard) return;
  const colRect = col.getBoundingClientRect();
  const heading = col.querySelector('.workbench-heading');
  const headingH = heading ? heading.offsetHeight + 8 : 32;
  const total = colRect.height - headingH;
  const startY = e.clientY;
  const startTop = panel.getBoundingClientRect().bottom;
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
  function onMove(ev){
    const newBottom = startTop + (ev.clientY - startY);
    // Clamp the calendar height to a minimum that keeps the month grid
    // legible (header + toolbar + 6 rows × ~28px = ~260px). Below this
    // the grid overflows and starts overlapping the day card.
    const calH = Math.max(260, Math.min(total - 80, newBottom - colRect.top - headingH));
    const fraction = Math.max(0.32, Math.min(0.88, calH / total));
    panel.style.flex = `${fraction} 1 0`;
    dayCard.style.flex = `${1 - fraction} 1 0`;
    // Re-fit the hour grid live so the week-view stays in view
    if(document.getElementById('calWeekWrap')?.offsetParent !== null){
      renderWeekView();
    }
  }
  function onUp(){
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist the resulting fraction
    const calH = panel.getBoundingClientRect().height;
    const fraction = Math.max(0.3, Math.min(0.9, calH / total));
    if(!S.settings) S.settings = {};
    S.settings.calSplit = Math.round(fraction * 100) / 100;
    save();
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// Restore the persisted calendar split on every render so the layout
// survives navigation between pages and reloads.
function applyCalSplit(){
  const panel = document.getElementById('calPanel');
  const dayCard = document.getElementById('calDayTasks');
  if(!panel || !dayCard) return;
  const f = Math.max(0.3, Math.min(0.9, Number(S.settings?.calSplit) || 0.65));
  panel.style.flex = `${f} 1 0`;
  dayCard.style.flex = `${1 - f} 1 0`;
}

// Drag the all-day strip taller/shorter by pulling its bottom handle.
// Persists the resulting height in S.settings.alldayStripHeight so each
// session lands on the user's preferred density.
function startAlldayResize(e){
  e.preventDefault();
  const allday = document.getElementById('calWeekAllday');
  if(!allday) return;
  const startY = e.clientY;
  const startH = allday.getBoundingClientRect().height;
  const min = 30, max = 260;
  document.body.style.cursor = 'ns-resize';
  document.body.style.userSelect = 'none';
  function onMove(ev){
    const newH = Math.max(min, Math.min(max, startH + (ev.clientY - startY)));
    allday.style.maxHeight = newH + 'px';
  }
  function onUp(ev){
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const finalH = Math.max(min, Math.min(max, startH + (ev.clientY - startY)));
    if(!S.settings) S.settings = {};
    S.settings.alldayStripHeight = Math.round(finalH);
    save();
    renderWeekView();
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function renderWeekView(){
  const grid = document.getElementById('calWeekGrid');
  const dayhead = document.getElementById('calWeekDayhead');
  const allday = document.getElementById('calWeekAllday');
  const wrap  = document.getElementById('calWeekWrap');
  if(!grid || !dayhead || !allday) return;
  const isDay = calLayout === 'day';
  if(wrap) wrap.classList.toggle('cwk-day-mode', isDay);

  const days = [];
  if(isDay){
    const d = new Date(calViewDate);
    d.setHours(0,0,0,0);
    days.push({ date:d, ds:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` });
  } else {
    const weekStart = getWeekStartDate(calViewDate);
    for(let i=0;i<7;i++){
      const d = new Date(weekStart);
      d.setDate(d.getDate()+i);
      days.push({ date:d, ds:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` });
    }
  }
  const today = todayStr();
  const hours = WEEK_END_HOUR - WEEK_START_HOUR;
  // Dynamic hour height — measure the available space inside the
  // .cal-week-wrap (its column's height minus dayhead + allday) and
  // size hourPx so all 18 hours fit in one view without scrolling.
  // Falls back to the fixed WEEK_HOUR_PX (56) if the wrap is smaller
  // than the minimum readable height (so scroll still works on phones).
  const _wrap = wrap;
  const _dayhead = dayhead;
  const _allday  = allday;
  const zoom = Math.max(0.5, Math.min(2.5, Number(S.settings?.calZoom) || 1));
  let hourPx = Math.round(WEEK_HOUR_PX * zoom);
  if(_wrap){
    const wrapH    = _wrap.clientHeight;
    const dayheadH = _dayhead ? _dayhead.offsetHeight : 0;
    const alldayH  = _allday  ? _allday.offsetHeight  : 0;
    const avail    = wrapH - dayheadH - alldayH - 8; // 8px gap budget
    const fit      = Math.floor(avail / hours);
    // When zoomed-out (zoom<1) — prefer fitting more hours in view, no scroll.
    // When zoomed-in (zoom>1) — honor the user's chosen hourPx; scroll if it overflows.
    if(zoom <= 1 && fit >= 26) hourPx = fit;
    else hourPx = Math.max(26, hourPx);
  }
  const gridHeight = hours * hourPx;

  // Day headers
  dayhead.innerHTML = `<div class="cwk-time-cell"></div>` + days.map(d=>{
    const isToday = d.ds === today;
    const isSel   = d.ds === calSelectedDate;
    return `<button type="button" class="cwk-day-header ${isToday?'today':''} ${isSel?'selected':''}"
      onclick="selectCalDate(event,'${d.ds}')"
      ondblclick="openQuickAdd(event,'${d.ds}')">
      <div class="cwk-dow">${DAY_NAMES[d.date.getDay()]}</div>
      <div class="cwk-num">${d.date.getDate()}</div>
    </button>`;
  }).join('');

  // All-day strip (tasks/events without a specific time).
  // The visible row count is driven by the strip's CSS height (px), which
  // the user adjusts by click+dragging the resize handle just below the
  // strip. We translate height → cap so the rest of the logic still uses
  // a per-column cap with "+N more" overflow.
  const showTasks = calViewMode !== 'events';
  if(!window._alldayExpanded) window._alldayExpanded = new Set();
  // Strip height (px) is persisted in S.settings.alldayStripHeight.
  // Default = 84px = 3 rows × 26px-ish + padding. Range: 30 (1 row) - 260.
  const stripH = Math.max(30, Math.min(260, Number(S.settings?.alldayStripHeight) || 84));
  allday.style.maxHeight = stripH + 'px';
  // Approximate visible cap from height: each row is ~22px tall (chip 18 + gap 3).
  const ALLDAY_CAP = Math.max(1, Math.floor((stripH - 8) / 22));
  let alldayHasContent = false;
  // Quiet "all day" label in the gutter — no +/- controls; resize via the
  // handle below the strip.
  const gutter = `<div class="cwk-time-cell cwk-allday-gutter"><span>all day</span></div>`;
  allday.innerHTML = gutter + days.map(d => {
    const items = collectAllDayItems(d.ds);
    if(items.length) alldayHasContent = true;
    const expanded = window._alldayExpanded.has(d.ds);
    const overflow = items.length > ALLDAY_CAP && !expanded;
    const visible = overflow ? items.slice(0, ALLDAY_CAP) : items;
    const hidden = items.length - visible.length;
    const itemsHtml = visible.map(it => `<button type="button" class="cwk-allday-item sig-${it.sig}" onclick="event.stopPropagation(); ${it.kind==='task'?`editTask('${it.id}')`:`editEvent('${it.id}')`}" title="${esc(it.title)}">${esc(it.title)}</button>`).join('');
    const moreBtn = hidden > 0
      ? `<button type="button" class="cwk-allday-more" onclick="event.stopPropagation(); toggleAlldayColumn('${d.ds}')">+${hidden} more</button>`
      : (expanded && items.length > ALLDAY_CAP
          ? `<button type="button" class="cwk-allday-more" onclick="event.stopPropagation(); toggleAlldayColumn('${d.ds}')">Show less</button>`
          : '');
    return `<div class="cwk-allday-col ${expanded?'expanded':''}" data-date="${d.ds}"
      ondragover="onCalDragOver(event)"
      ondrop="onCalDrop(event,'${d.ds}')"
      ondragleave="onCalDragLeave(event)">
      ${itemsHtml}
      ${moreBtn}
    </div>`;
  }).join('');
  allday.style.display = alldayHasContent ? '' : 'none';
  // Hide the resize handle if there's nothing to show
  const resizeHandle = document.getElementById('calAlldayResize');
  if(resizeHandle) resizeHandle.style.display = alldayHasContent ? '' : 'none';

  // Hour grid: time gutter + 7 day columns. Each column has hour gridlines +
  // absolutely positioned blocks.
  let gridHtml = `<div class="cwk-time-col" style="height:${gridHeight}px">`;
  for(let h = WEEK_START_HOUR; h < WEEK_END_HOUR; h++){
    const y = (h - WEEK_START_HOUR) * hourPx;
    const period = h<12 ? 'AM' : 'PM';
    const hr = h===0 ? 12 : (h>12 ? h-12 : h);
    gridHtml += `<div class="cwk-hour-label" style="top:${y}px">${hr} ${period}</div>`;
  }
  gridHtml += `</div>`;

  for(const d of days){
    const items = collectTimedItems(d.ds);
    const blocks = items.map(it => {
      const top = (it.startMin - WEEK_START_HOUR*60) * (hourPx/60);
      const height = Math.max(20, it.durationMin * (hourPx/60));
      const startStr = fmtTime12(`${String(Math.floor(it.startMin/60)).padStart(2,'0')}:${String(it.startMin%60).padStart(2,'0')}`);
      const endStr   = fmtTime12(`${String(Math.floor((it.startMin+it.durationMin)/60)).padStart(2,'0')}:${String((it.startMin+it.durationMin)%60).padStart(2,'0')}`);
      const focusBadge = it.isFocus && it.taskIds.length
        ? `<span class="cwk-block-badge">▤ ${it.taskIds.length}</span>` : '';
      return `<button type="button" class="cwk-block sig-${it.sig}" style="top:${top}px;height:${height}px;--block-accent:${it.accent}" onclick="${it.onClick}">
        <strong class="cwk-block-title">${esc(it.title)}</strong>
        <span class="cwk-block-time">${startStr} – ${endStr}${focusBadge}</span>
      </button>`;
    }).join('');

    // Hour gridlines
    let lines = '';
    for(let h = WEEK_START_HOUR; h < WEEK_END_HOUR; h++){
      lines += `<div class="cwk-line" style="top:${(h-WEEK_START_HOUR)*hourPx}px"></div>`;
    }

    // Current-time indicator (red line) if today
    let nowLine = '';
    if(d.ds === today){
      const now = new Date();
      const nowMin = now.getHours()*60 + now.getMinutes();
      if(nowMin >= WEEK_START_HOUR*60 && nowMin < WEEK_END_HOUR*60){
        const y = (nowMin - WEEK_START_HOUR*60) * (hourPx/60);
        nowLine = `<div class="cwk-now" style="top:${y}px"></div>`;
      }
    }

    gridHtml += `<div class="cwk-day-col ${d.ds===today?'today':''}" data-date="${d.ds}"
      style="height:${gridHeight}px"
      ondblclick="openQuickAdd(event,'${d.ds}')"
      ondragover="onCalDragOver(event)"
      ondrop="onCalDrop(event,'${d.ds}')"
      ondragleave="onCalDragLeave(event)">
      ${lines}
      ${blocks}
      ${nowLine}
    </div>`;
  }

  grid.innerHTML = gridHtml;

  // Scroll to ~8 AM on first render — only if the grid is taller than the
  // visible scroll area. With dynamic hourPx it usually fits in one view.
  const scroll = grid.parentElement;
  if(scroll && !scroll.dataset.scrolled && gridHeight > scroll.clientHeight){
    scroll.scrollTop = Math.max(0, (8 - WEEK_START_HOUR) * hourPx - 20);
    scroll.dataset.scrolled = '1';
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
  const events = calViewMode==='tasks' ? [] : S.events.filter(e=>eventOccursOn(e,ds));
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
      return `<div class="cal-task-item ${sig}" draggable="true" title="Drag to another day to move" ondragstart="onDayTaskDragStart(event,'${t.id}','${ds}')" onclick="editTask('${t.id}')">
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
    source.due=ds;
    source.calendarSignal='due';
  }else{
    if(source.isHabit && !await makeHabitSingleTask(source,ds,targetSection,true)){ resetDraggedTask(); return; }
    if(!source.scheduledDates) source.scheduledDates=[];
    if(!source.scheduledDates.includes(ds)) source.scheduledDates.push(ds);
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
  showToast(`Restored "${source.title}" to To-Do Bank`);
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

// Day-to-day move (drag a task chip off one calendar cell, drop on another)
let draggedDayTask=null; // { id, fromDate }
function onDayTaskDragStart(e,id,fromDate){
  e.stopPropagation();
  draggedDayTask={id, fromDate};
  draggedBankId=null;
  try{
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain', 'moonlit:move:'+id+':'+fromDate);
  }catch(_){}
  const t=S.tasks.find(x=>x.id===id);
  const ghost=document.createElement('div');
  ghost.textContent='Move: '+(t?.title||'task');
  ghost.style.cssText='position:fixed;top:-1000px;left:-1000px;max-width:200px;padding:6px 10px;border-radius:7px;background:#111;color:#fff;font:600 12px Inter,Arial;box-shadow:0 8px 24px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  document.body.appendChild(ghost);
  try{ e.dataTransfer.setDragImage(ghost,12,12); }catch(_){}
  setTimeout(()=>ghost.remove(),0);
}
function moveTaskToDate(t, fromDate, toDate){
  if(!t || fromDate===toDate) return false;
  if(t.isHabit){
    if(!t.skippedDates) t.skippedDates={};
    t.skippedDates[fromDate]=true;
    if(!Array.isArray(t.scheduledDates)) t.scheduledDates=[];
    if(!t.scheduledDates.includes(toDate)){
      if(t.skippedDates[toDate]) delete t.skippedDates[toDate];
      t.scheduledDates.push(toDate);
    } else if(t.skippedDates[toDate]){
      delete t.skippedDates[toDate];
    }
    return true;
  }
  if(!Array.isArray(t.scheduledDates)) t.scheduledDates=[];
  t.scheduledDates = t.scheduledDates.filter(d=>d!==fromDate);
  if(!t.scheduledDates.includes(toDate)) t.scheduledDates.push(toDate);
  if(t.due === fromDate) t.due = toDate;
  if(t.skippedDates && t.skippedDates[toDate]) delete t.skippedDates[toDate];
  if(t.skippedDates) delete t.skippedDates[fromDate];
  return true;
}

async function onCalDrop(e,ds){
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  const file=[...(e.dataTransfer?.files||[])].find(f=>/\.ics$/i.test(f.name) || /calendar|ics/i.test(f.type));
  if(file){
    const reader=new FileReader();
    reader.onload=async ()=>{ await importEvents(parseICS(String(reader.result||''))); render(); };
    reader.readAsText(file);
    return;
  }

  // Day → day MOVE
  // Triggered when the user drags a task that already has a source date:
  //   - a calendar mini-chip or side-panel row (onDayTaskDragStart sets draggedDayTask)
  //   - OR a task row from the Today/Daily/MUST list (onTaskDragStart sets draggedTaskId + draggedTaskDate,
  //     but NOT draggedBankId — bank drags are different)
  const moveSource = draggedDayTask
    ? { id: draggedDayTask.id, fromDate: draggedDayTask.fromDate }
    : (!draggedBankId && draggedTaskId && draggedTaskDate && draggedTaskDate !== ds && draggedTaskSection !== 'archive'
        ? { id: draggedTaskId, fromDate: draggedTaskDate }
        : null);

  if(moveSource){
    const t = S.tasks.find(x=>x.id===moveSource.id);
    draggedDayTask=null;
    if(!t || !moveSource.fromDate || moveSource.fromDate===ds){ resetDraggedTask(); return; }
    unarchiveForDrop(t, ds);
    if(moveTaskToDate(t, moveSource.fromDate, ds)){
      // Stay on the source day so the user can keep working through that day's list
      save(); render();
      showToast(`Moved "${t.title}" to ${fmtDate(ds)}.`, 'Undo', ()=>{
        moveTaskToDate(t, ds, moveSource.fromDate);
        save(); render();
      });
    }
    resetDraggedTask();
    return;
  }

  const droppedId=getDraggedTaskId(e);
  if(!droppedId) return;
  const t=S.tasks.find(x=>x.id===droppedId);
  if(!t){ resetDraggedTask(); return; }
  unarchiveForDrop(t,ds);

  // Default behaviour: schedule as a task silently. Only ask Task-vs-Event
  // when the user has explicitly enabled the prompt in Settings.
  const askPrompt = !!(S.settings && S.settings.askOnCalendarDrop);
  let asTask = true;
  if(askPrompt){
    asTask = await designConfirm('Add to calendar', `Add "${t.title}" to ${fmtDate(ds)} as a task or as a calendar event?`, 'Task', 'Event');
  }
  if(asTask){
    if(t.isHabit && !await makeHabitSingleTask(t,ds,'Study',true)){ resetDraggedTask(); return; }
    if(!t.scheduledDates) t.scheduledDates=[];
    if(!t.scheduledDates.includes(ds)) t.scheduledDates.push(ds);
    showToast(`Scheduled "${t.title}" for ${fmtDate(ds)}`);
  } else {
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
  // (Bank-folded-on-enter is handled in showPage() — every navigation
  // to the Todo List page collapses the bank by default, so attention
  // lands on Calendar + Today first.)
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
// Best-effort haptic feedback. Works on Android (Vibration API).
// iOS Safari currently no-ops navigator.vibrate; if the user later adds the
// site to their home screen as a PWA, recent iOS versions may enable it.
function triggerHaptic(ms = 8) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch (_) { /* no-op on unsupported devices */ }
}

function showPage(page, el){
  triggerHaptic();
  // Sidebar shortcut: nav items "today" / "bank" / "archive" all land on
  // the unified Todo List page; the JS just scrolls to the right section.
  // Note: when the user explicitly clicks the "Bank" shortcut, we
  // DON'T re-collapse the bank — they're asking to see it.
  let bankShortcut = false;
  if(['today','bank','archive'].includes(page)){
    const target = {
      today:'workbenchToday',
      bank:'workbenchBank',
      archive:'secArchive'
    }[page];
    if(page === 'bank') bankShortcut = true;
    page='todo';
    setTimeout(()=>document.getElementById(target)?.scrollIntoView({behavior:'smooth',block:'start'}),50);
  }
  currentPage=page;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+page));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n===el || (!el && n.dataset.page===page)));
  // Mirror active state on the mobile bottom tab bar
  document.querySelectorAll('.mt-tab').forEach(n=>n.classList.toggle('active', n.dataset.page===page));
  document.querySelector('.workspace')?.scrollTo({top:0,behavior:'smooth'});
  mountInteractiveSurface();
  render();
  // Always fold the Task Bank when the user enters the Todo List page,
  // unless they explicitly used the "Bank" shortcut from elsewhere.
  // This makes Calendar + Today's-tasks the first-glance attention pair.
  if(page === 'todo' && !bankShortcut){
    requestAnimationFrame(() => {
      const bank = document.getElementById('workbenchBank');
      if(bank) bank.classList.add('collapsed');
      if(typeof updateWorkbenchCollapseUI === 'function') updateWorkbenchCollapseUI();
    });
  }
}

// Mobile bottom tab "Settings" — opens the settings modal but also keeps the
// Settings tab visually highlighted while the sheet is open.
function openMobileSettings(el){
  triggerHaptic();
  document.querySelectorAll('.mt-tab').forEach(n=>n.classList.toggle('active', n === el));
  openModal('mSettings');
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
  if(id==='mIcal') renderIcalSourceList();
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
  // Restore page emoji icons
  applyPageEmojis();
}

// ── Page-title emoji picker ──
// Each page (Todo List, Dashboard, etc.) can have its own icon emoji
// next to the title. Stored in S.settings.pageEmojis[<key>] so it
// survives across sessions. Curated set matches the calm aesthetic.
const EMOJI_PALETTE = [
  '✏️','📝','✨','🌿','🌸','☕','🕊️','🌙','🍵','📚',
  '🎯','⭐','💭','🌊','🍃','🪶','📓','🗂️','🔖','🌱',
  '🍂','🪴','🍷','🎼','💡','🧭','🗺️','🪞','🫧','🍑'
];
function applyPageEmojis(){
  const map = S.settings?.pageEmojis || {};
  // Todo List default ✏️
  const todoBtn = document.getElementById('todoEmojiBtn');
  if(todoBtn) todoBtn.textContent = map.todoListEmoji || '✏️';
}
function openEmojiPicker(e, key){
  e.stopPropagation();
  // Close any existing picker
  const existing = document.getElementById('emojiPickerPop');
  if(existing){ existing.remove(); return; }
  const pop = document.createElement('div');
  pop.id = 'emojiPickerPop';
  pop.className = 'emoji-picker-pop';
  pop.innerHTML = `
    <div class="emoji-picker-grid">
      ${EMOJI_PALETTE.map(em => `<button type="button" class="emoji-cell"
        onclick="pickPageEmoji('${key}','${em}')">${em}</button>`).join('')}
    </div>
    <div class="emoji-picker-foot">
      <button type="button" class="emoji-reset" onclick="pickPageEmoji('${key}','')">Reset</button>
    </div>`;
  document.body.appendChild(pop);
  // Position below the trigger button
  const rect = e.currentTarget.getBoundingClientRect();
  pop.style.top  = (rect.bottom + 8) + 'px';
  pop.style.left = rect.left + 'px';
  // Click-outside to dismiss
  setTimeout(() => {
    document.addEventListener('pointerdown', _emojiOutside, { once: false, capture: true });
  }, 0);
}
function _emojiOutside(ev){
  const pop = document.getElementById('emojiPickerPop');
  if(!pop) {
    document.removeEventListener('pointerdown', _emojiOutside, true);
    return;
  }
  if(pop.contains(ev.target)) return;
  pop.remove();
  document.removeEventListener('pointerdown', _emojiOutside, true);
}
function pickPageEmoji(key, em){
  if(!S.settings) S.settings = {};
  if(!S.settings.pageEmojis || typeof S.settings.pageEmojis !== 'object') S.settings.pageEmojis = {};
  if(em) S.settings.pageEmojis[key] = em;
  else delete S.settings.pageEmojis[key];
  save();
  applyPageEmojis();
  const pop = document.getElementById('emojiPickerPop');
  if(pop) pop.remove();
  document.removeEventListener('pointerdown', _emojiOutside, true);
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
  document.getElementById('sAppName').value=S.settings.appName||'Focus Hub';
  document.getElementById('sAppSubtitle').value=S.settings.appSubtitle||'Productivity planner';
  document.getElementById('sDark').checked=S.settings.theme==='dark';
  document.getElementById('sPomoFocus').value=S.settings.pomo.focus;
  document.getElementById('sPomoShort').value=S.settings.pomo.shortBreak;
  document.getElementById('sPomoLong').value=S.settings.pomo.longBreak;
  document.getElementById('sPomoCycles').value=S.settings.pomo.cycles;
  document.getElementById('sAlarmSound').value=S.settings.alarmSound||'chime';
  const askBox=document.getElementById('sAskOnDrop');
  if(askBox) askBox.checked = !!(S.settings && S.settings.askOnCalendarDrop);
  renderDeletedList();
}
function saveSettings(){
  S.settings.name=document.getElementById('sName').value.trim()||'Jay';
  S.settings.appName=document.getElementById('sAppName').value.trim()||'Focus Hub';
  S.settings.appSubtitle=document.getElementById('sAppSubtitle').value.trim()||'Productivity planner';
  S.settings.theme=document.getElementById('sDark').checked?'dark':'light';
  S.settings.pomo.focus=+document.getElementById('sPomoFocus').value||25;
  S.settings.pomo.shortBreak=+document.getElementById('sPomoShort').value||5;
  S.settings.pomo.longBreak=+document.getElementById('sPomoLong').value||15;
  S.settings.pomo.cycles=+document.getElementById('sPomoCycles').value||4;
  S.settings.alarmSound=document.getElementById('sAlarmSound').value||'chime';
  const askBox=document.getElementById('sAskOnDrop');
  S.settings.askOnCalendarDrop = !!(askBox && askBox.checked);
  applyTheme();
  applyAppBranding();
  save();
  closeModal('mSettings');
  resetPomo();
}

// Send a password reset email to the currently-logged-in user
function changePasswordFromSettings(){
  if(!currentUser || !currentUser.email){
    showToast('Not logged in');
    return;
  }
  if(!confirm(`Send a password reset link to ${currentUser.email}?`)) return;
  auth.sendPasswordResetEmail(currentUser.email)
    .then(()=>{ showToast('Reset link sent. Check your email.'); })
    .catch(err=>{ showToast('Error: ' + (err.message||'Could not send reset email')); });
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
//  COGNITIVE SCAFFOLDS
//  Five features externalizing executive function for ADHD/ENTJ users:
//    1. First Step    — task surfaces its 5-second move
//    2. Quick Capture — Cmd+K opens a 3-word brain-dump anywhere
//    3. Dopamine Gate — plan tasks dimmed until N min of execute work
//    4. Domain Modes  — KTLO vs Active per domain
//    5. Time Anchor   — intrusive toast every 25 min during focus
// ════════════════════════════════════════════════════════════

// ── 2. QUICK CAPTURE ──
let _captureEl = null;
function openQuickCapture(){
  if(_captureEl){ closeQuickCapture(); return; }
  const el = document.createElement('div');
  el.className = 'quick-capture show';
  const unprocessed = (S.brainDump||[]).filter(b=>!b.processed).length;
  el.innerHTML = `
    <div class="qc-label">Brain dump · 3 words · ${unprocessed} unprocessed</div>
    <input type="text" class="qc-input" id="qcInput" placeholder="e.g. restaurant marketing idea" autocomplete="off" maxlength="80">
    <div class="qc-hint">Enter to save · Esc to close · Cmd+K toggles</div>`;
  document.body.appendChild(el);
  _captureEl = el;
  const input = el.querySelector('#qcInput');
  setTimeout(()=>input?.focus(), 20);
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); saveQuickCapture(input.value); }
    else if(e.key === 'Escape'){ e.preventDefault(); closeQuickCapture(); }
  });
  setTimeout(()=>document.addEventListener('pointerdown', _qcOutside, true), 0);
}
function _qcOutside(e){
  if(!_captureEl) return;
  if(_captureEl.contains(e.target)) return;
  closeQuickCapture();
}
function closeQuickCapture(){
  if(_captureEl){ _captureEl.remove(); _captureEl = null; }
  document.removeEventListener('pointerdown', _qcOutside, true);
}
function saveQuickCapture(text){
  const clean = String(text||'').trim();
  if(!clean){ closeQuickCapture(); return; }
  if(!Array.isArray(S.brainDump)) S.brainDump = [];
  S.brainDump.unshift({ id: uid(), text: clean.slice(0,80), createdAt: Date.now(), processed:false });
  save();
  closeQuickCapture();
  if(typeof showToast === 'function'){
    showToast(`Captured: "${clean.slice(0,40)}"`, 'Review', openBrainDumpPanel);
  }
  renderGateBadge();
}
function openBrainDumpPanel(){
  let panel = document.getElementById('brainDumpPanel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'brainDumpPanel';
    panel.className = 'overlay';
    panel.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="min-width:380px;max-width:520px">
      <div class="modal-header">
        <span class="modal-title">Brain Dump</span>
        <button class="modal-close" onclick="document.getElementById('brainDumpPanel').classList.remove('show')">✕</button>
      </div>
      <div class="modal-body" style="max-height:62vh;overflow-y:auto">
        <div id="brainDumpList"></div>
      </div>
    </div>`;
    document.body.appendChild(panel);
  }
  renderBrainDumpList();
  panel.classList.add('show');
}
function renderBrainDumpList(){
  const list = document.getElementById('brainDumpList');
  if(!list) return;
  const items = (S.brainDump||[]).filter(b=>!b.processed);
  if(!items.length){ list.innerHTML = `<div class="empty" style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Inbox empty. Cmd+K to capture.</div>`; return; }
  list.innerHTML = items.map(b => `
    <div class="brain-dump-row">
      <span class="bd-text">${esc(b.text)}</span>
      <span class="bd-time">${new Date(b.createdAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</span>
      <button class="task-action" title="Convert to task" onclick="brainDumpToTask('${b.id}')">→ task</button>
      <button class="task-action" title="Mark processed" onclick="brainDumpProcess('${b.id}')">✓</button>
      <button class="task-action" title="Delete" onclick="brainDumpDelete('${b.id}')">✕</button>
    </div>`).join('');
}
function brainDumpToTask(id){
  const b = (S.brainDump||[]).find(x=>x.id===id);
  if(!b) return;
  if(typeof resetAddForm === 'function') resetAddForm();
  const titleEl = document.getElementById('fTitle');
  if(titleEl) titleEl.value = b.text;
  brainDumpProcess(id);
  if(typeof openModal === 'function') openModal('mAddTask');
  document.getElementById('brainDumpPanel')?.classList.remove('show');
}
function brainDumpProcess(id){
  const b = (S.brainDump||[]).find(x=>x.id===id);
  if(!b) return;
  b.processed = true;
  save();
  renderBrainDumpList();
  renderGateBadge();
}
function brainDumpDelete(id){
  S.brainDump = (S.brainDump||[]).filter(x=>x.id!==id);
  save();
  renderBrainDumpList();
  renderGateBadge();
}

// ── 3. DOPAMINE GATE ──
function dopamineGateStatus(){
  const required = Number(S.settings?.dopamineGate?.minExecuteMinutes) || 15;
  const today = todayStr();
  let earned = 0;
  (S.sessions || []).forEach(s => {
    if(!s || !s.startedAt) return;
    const day = new Date(s.startedAt);
    const ds = `${day.getFullYear()}-${pad(day.getMonth()+1)}-${pad(day.getDate())}`;
    if(ds !== today) return;
    const t = S.tasks.find(x => x.id === s.taskId);
    if(t && t.taskKind === 'execute'){
      const mins = Number(s.actualMinutes || s.minutes || s.focusMinutes || 0);
      if(Number.isFinite(mins)) earned += mins;
    }
  });
  // Manual completion of execute tasks today counts as 5min credit each
  (S.tasks || []).forEach(t => {
    if(t.taskKind !== 'execute' || !t.completedAt) return;
    if(isSameDay(t.completedAt, today)) earned += 5;
  });
  earned = Math.floor(earned);
  return { earned, required, satisfied: earned >= required, remaining: Math.max(0, required - earned) };
}
function isPlanTaskGated(t){
  if(!S.settings?.scaffolds?.dopamineGate) return false;
  if(!t || t.taskKind !== 'plan') return false;
  return !dopamineGateStatus().satisfied;
}

// ── 4. DOMAIN MODES ──
function ensureDomain(name, mode='active'){
  if(!name) return null;
  if(!S.domains) S.domains = {};
  if(!S.domains[name]){
    const colors = ['#7aa2ff','#4dd49a','#f59040','#b07fff','#ff7faa','#e9c46a','#9fe0c7','#7fc7ff'];
    const idx = Object.keys(S.domains).length % colors.length;
    S.domains[name] = { mode, color: colors[idx], createdAt: Date.now() };
  }
  return S.domains[name];
}
function setDomainMode(name, mode){
  if(!S.domains || !S.domains[name]) ensureDomain(name, mode);
  else S.domains[name].mode = (mode === 'ktlo' ? 'ktlo' : 'active');
  save();
  renderDomainPanel();
  if(typeof renderBank === 'function') renderBank();
}
function isKtloTask(t){
  if(!S.settings?.scaffolds?.domainModes) return false;
  if(!t || !t.domain) return false;
  return S.domains?.[t.domain]?.mode === 'ktlo';
}
function refreshDomainSuggestions(){
  const dl = document.getElementById('domainSuggestions');
  if(!dl) return;
  const names = Object.keys(S.domains || {});
  dl.innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}

// ── 5. TIME ANCHOR ──
let _anchorTimer = null;
function startTimeAnchor(){
  if(!S.settings?.scaffolds?.timeAnchor) return;
  stopTimeAnchor();
  const intervalMs = 25 * 60 * 1000;
  _anchorTimer = setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    if(typeof showToast === 'function'){
      showToast(`⏱ Time check: ${timeStr} · check on your people`, 'OK', () => {});
    }
  }, intervalMs);
}
function stopTimeAnchor(){
  if(_anchorTimer){ clearInterval(_anchorTimer); _anchorTimer = null; }
}

// ── DASHBOARD WIDGETS ──
function renderGateBadge(){
  const wrap = document.getElementById('dashGateBadge');
  if(!wrap) return;
  if(!S.settings?.scaffolds?.dopamineGate){ wrap.style.display='none'; return; }
  const st = dopamineGateStatus();
  wrap.style.display = '';
  if(st.satisfied){
    wrap.innerHTML = `<div class="gate-pill gate-satisfied">✓ Planning unlocked · ${st.earned}m execute today</div>`;
  } else {
    const pct = Math.min(100, Math.round((st.earned/st.required)*100));
    wrap.innerHTML = `<div class="gate-pill gate-locked">
      <span>Execute ${st.earned}/${st.required} min · planning soft-locked</span>
      <div class="gate-bar"><span style="width:${pct}%"></span></div>
    </div>`;
  }
}
function renderDomainPanel(){
  const wrap = document.getElementById('dashDomains');
  if(!wrap) return;
  if(!S.settings?.scaffolds?.domainModes){ wrap.style.display='none'; return; }
  wrap.style.display = '';
  const names = Object.keys(S.domains || {});
  if(!names.length){
    wrap.innerHTML = `<div class="dash-title">Domains</div>
      <div class="empty" style="font-size:11px;color:var(--text3)">Tag tasks with a domain (e.g. "school", "lifting", "drums") to see Active vs KTLO modes here.</div>`;
    return;
  }
  const counts = {};
  (S.tasks||[]).forEach(t => { if(t.domain && !isArchivedForTodo(t)) counts[t.domain] = (counts[t.domain]||0) + 1; });
  wrap.innerHTML = `<div class="dash-title">Domains</div>
    <div class="domain-list">${names.map(n => {
      const d = S.domains[n];
      const c = counts[n] || 0;
      const active = d.mode !== 'ktlo';
      return `<div class="domain-row ${active?'active':'ktlo'}">
        <span class="domain-swatch" style="background:${esc(d.color||'#7aa2ff')}"></span>
        <span class="domain-name">${esc(n)}</span>
        <span class="domain-count">${c}</span>
        <button class="domain-mode" onclick="setDomainMode('${esc(n)}','${active?'ktlo':'active'}')">${active?'Active':'KTLO'}</button>
      </div>`;
    }).join('')}</div>`;
}

// ── MINIMAL HOME / SHORTCUTS MODAL ───────────────────────────
// Update the greeting + date in the home hero. Called on every
// render so the time-of-day and the date stay fresh.
function renderHomeHero(){
  const greetEl = document.getElementById('homeGreeting');
  const dateEl  = document.getElementById('homeDate');
  if(!greetEl && !dateEl) return;
  const name = (S.settings?.name || '').trim();
  const h = new Date().getHours();
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  if(greetEl) greetEl.textContent = name ? `${part}, ${name}` : part;
  if(dateEl){
    const d = new Date();
    dateEl.textContent = d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
  }
}

// Open the comprehensive Shortcuts & Tips modal.
function openShortcutsModal(){
  if(typeof openModal === 'function') openModal('mShortcuts');
}

// Persist <details> disclosure state per-key so the user's expand/
// collapse choices survive reloads.
function bindHomeDisclosures(){
  document.querySelectorAll('.home-disclosure[data-key]').forEach(d => {
    if(d.dataset._bound) return;
    d.dataset._bound = '1';
    const key = 'home_disc_' + d.dataset.key;
    try { if(localStorage.getItem(key) === 'open') d.open = true; } catch(_){}
    d.addEventListener('toggle', () => {
      try { localStorage.setItem(key, d.open ? 'open' : 'closed'); } catch(_){}
    });
  });
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
  const pr=getPomoConfig();
  updateHUDDisplay(pr.focus*60,pr.focus*60);
  render();
  checkThursdayReview();

  // Refresh EOPR every minute
  setInterval(updateEOPR, 60000);

  // Re-fit the week-view calendar when the window resizes, so the hour
  // grid keeps fitting in one view at any viewport height. Debounced.
  let _resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(() => {
      if(document.getElementById('calWeekWrap')?.offsetParent !== null){
        renderWeekView();
      }
    }, 80);
  });

  // Re-render at midnight for habit reset
  const msToMidnight=()=>{
    const now=new Date(), next=new Date(now);
    next.setHours(24,0,0,0);
    return next-now;
  };
  setTimeout(()=>{ render(); setInterval(render,86400000); }, msToMidnight());
})();

// ════════════════════════════════════════════════════════════
//  FIREBASE AUTHENTICATION & CLOUD SYNC
// ════════════════════════════════════════════════════════════

function handleSignUp() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('errorMsg');
  const loadingDiv = document.getElementById('loadingMsg');
  
  if (!email || !password) {
    errorDiv.textContent = 'Please enter email and password';
    errorDiv.classList.add('show');
    return;
  }
  if (password.length < 6) {
    errorDiv.textContent = 'Password must be at least 6 characters';
    errorDiv.classList.add('show');
    return;
  }
  
  loadingDiv.textContent = 'Creating account...';
  errorDiv.classList.remove('show');

  applyAuthPersistence().then(() =>
  auth.createUserWithEmailAndPassword(email, password))
    .then(() => { loadingDiv.textContent = ''; })
    .catch(error => {
      loadingDiv.textContent = '';
      let msg = error.message;
      if (error.code === 'auth/email-already-in-use') msg = 'An account with this email already exists. Try logging in instead.';
      else if (error.code === 'auth/invalid-email') msg = 'Please enter a valid email address';
      else if (error.code === 'auth/weak-password') msg = 'Password is too weak. Use at least 6 characters.';
      errorDiv.textContent = msg;
      errorDiv.classList.add('show');
    });
}

// Apply the user's "Stay signed in" preference to Firebase Auth.
// LOCAL = persists across browser sessions (default Firebase behaviour).
// SESSION = cleared when the tab closes; user has to sign in again next time.
// Returns a promise that resolves once persistence is set.
function applyAuthPersistence(){
  try{
    const checkbox = document.getElementById('stayLoggedIn');
    const stay = checkbox ? !!checkbox.checked : true;
    try { localStorage.setItem('focus_stay_signed_in', stay ? '1' : '0'); } catch(_) {}
    if (!firebase.auth.Auth || !firebase.auth.Auth.Persistence) return Promise.resolve();
    const target = stay ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
    return auth.setPersistence(target).catch(err => {
      console.warn('[auth] setPersistence failed; falling back to default:', err);
    });
  } catch(e){
    console.warn('[auth] applyAuthPersistence threw:', e);
    return Promise.resolve();
  }
}

function handleLogIn() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('errorMsg');
  const loadingDiv = document.getElementById('loadingMsg');

  if (!email || !password) {
    errorDiv.textContent = 'Please enter email and password';
    errorDiv.classList.add('show');
    return;
  }

  loadingDiv.textContent = 'Logging in...';
  errorDiv.classList.remove('show');

  // If the auth call hangs longer than ~12s show a user-friendly message.
  // Technical details (hostname / Firebase config hints) only go to the console.
  let stalled = false;
  const stallTimer = setTimeout(()=>{
    stalled = true;
    loadingDiv.textContent = '';
    errorDiv.textContent = "Login is taking longer than usual. Check your connection and try again.";
    errorDiv.classList.add('show');
    console.warn('[auth] signInWithEmailAndPassword stalled >12s. hostname=', location.hostname,
      '— if this persists, verify the hostname is in Firebase → Authentication → Settings → Authorized domains.');
  }, 12000);

  applyAuthPersistence()
    .then(() => auth.signInWithEmailAndPassword(email, password))
    .then(() => {
      clearTimeout(stallTimer);
      if(stalled) return;
      loadingDiv.textContent = '';
      // If the user just got here via the "link Google to existing account" flow, finish the link now
      return finishGoogleLinkIfPending();
    })
    .catch(error => {
      clearTimeout(stallTimer);
      if(stalled) return;
      loadingDiv.textContent = '';
      console.warn('[auth] sign-in error:', error && error.code, error && error.message);
      let msg = 'Could not sign you in. Please try again.';
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        msg = 'Incorrect email or password. Try again, or reset your password.';
      } else if (error.code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      } else if (error.code === 'auth/too-many-requests') {
        msg = 'Too many attempts. Please wait a moment and try again, or reset your password.';
      } else if (error.code === 'auth/network-request-failed') {
        msg = 'No internet connection. Connect to wifi or cellular and try again.';
      } else if (error.code === 'auth/user-disabled') {
        msg = 'This account has been disabled. Contact support if this is a mistake.';
      } else if (error.code === 'auth/unauthorized-domain' || error.code === 'auth/operation-not-allowed') {
        msg = 'Sign-in is temporarily unavailable. Please try again later.';
      }
      errorDiv.textContent = msg;
      errorDiv.classList.add('show');
    });
}

// Holds a Google credential when the user tried Google sign-in but already has
// an email/password account with the same Gmail. After they sign in with their
// existing password, we link this credential so future Google sign-ins work.
let pendingGoogleCredential = null;
let pendingGoogleEmail = '';

// True on iOS / Android phones + tablets where Safari & Chrome both block
// Google sign-in popups. Redirect flow is more reliable on those devices.
function isTouchDevice(){
  try{
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }catch(_){ return false; }
}

function handleGoogleLogin() {
  const errorDiv = document.getElementById('errorMsg');
  const successDiv = document.getElementById('successMsg');
  const loadingDiv = document.getElementById('loadingMsg');
  if(!auth || !window.firebase || !firebase.auth || !firebase.auth.GoogleAuthProvider){
    errorDiv.textContent = 'Google sign-in is not available right now.';
    errorDiv.classList.add('show');
    return;
  }
  loadingDiv.textContent = 'Opening Google sign-in…';
  errorDiv.classList.remove('show');
  if(successDiv) successDiv.classList.remove('show');
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  // Mobile Safari + iOS Chrome silently block popups — use full-page redirect there.
  if(isTouchDevice()){
    loadingDiv.textContent = 'Redirecting to Google…';
    applyAuthPersistence()
      .then(() => auth.signInWithRedirect(provider))
      .catch(err=>{
        loadingDiv.textContent = '';
        errorDiv.textContent = (err && err.message) || 'Google sign-in failed.';
        errorDiv.classList.add('show');
      });
    return;
  }

  applyAuthPersistence().then(() => auth.signInWithPopup(provider))
    .then(() => { loadingDiv.textContent = ''; })
    .catch(error => {
      loadingDiv.textContent = '';

      // Email already used by another sign-in method (e.g. password). Offer to link.
      if(error.code === 'auth/account-exists-with-different-credential'){
        const cred = error.credential;
        const email = error.email || (cred && cred.email) || '';
        pendingGoogleCredential = cred;
        pendingGoogleEmail = email;
        // Switch to Log In tab and pre-fill the email so they can finish in one step
        try { switchTab('login'); } catch(_){}
        const emailField = document.getElementById('email');
        if(emailField && email){ emailField.value = email; }
        const pwField = document.getElementById('password');
        if(pwField){ pwField.focus(); }
        auth.fetchSignInMethodsForEmail(email).then(methods=>{
          const human = methods.includes('password') ? 'with your existing password' : `with your existing ${methods[0]||'sign-in'} method`;
          errorDiv.textContent = `This Gmail (${email}) is already linked to an account. Sign in ${human} to add Google sign-in — we'll keep all your tasks.`;
          errorDiv.classList.add('show');
        }).catch(()=>{
          errorDiv.textContent = `This Gmail (${email}) is already linked to an account. Sign in with your existing password — we'll add Google sign-in once you're in.`;
          errorDiv.classList.add('show');
        });
        return;
      }

      console.warn('[auth] google sign-in error:', error && error.code, error && error.message);
      let msg = 'Could not sign in with Google. Please try again.';
      if (error.code === 'auth/popup-closed-by-user') msg = 'Sign-in was cancelled. Try again when ready.';
      else if (error.code === 'auth/popup-blocked') msg = 'Your browser blocked the Google sign-in window. Allow popups and try again.';
      else if (error.code === 'auth/network-request-failed') msg = 'No internet connection. Connect and try again.';
      else if (error.code === 'auth/unauthorized-domain' || error.code === 'auth/operation-not-allowed') msg = 'Google sign-in is temporarily unavailable.';
      errorDiv.textContent = msg;
      errorDiv.classList.add('show');
    });
}

// Called from handleLogIn after a successful email/password sign-in to finish
// linking the Google credential the user previously tried.
function finishGoogleLinkIfPending(){
  if(!pendingGoogleCredential || !auth.currentUser) return Promise.resolve(false);
  const cred = pendingGoogleCredential;
  pendingGoogleCredential = null;
  pendingGoogleEmail = '';
  return auth.currentUser.linkWithCredential(cred)
    .then(()=>{
      const successDiv = document.getElementById('successMsg');
      if(successDiv){
        successDiv.textContent = 'Google sign-in linked. Next time you can use either method.';
        successDiv.classList.add('show');
      }
      return true;
    })
    .catch(err=>{
      // Most common: already linked, or credential already in use elsewhere.
      console.warn('Google credential link failed:', err);
      return false;
    });
}

function handleLogOut() {
  if (confirm('Are you sure you want to log out?')) {
    auth.signOut().then(() => {
      document.getElementById('email').value = '';
      document.getElementById('password').value = '';
      document.getElementById('errorMsg').classList.remove('show');
      document.getElementById('loadingMsg').textContent = '';
    });
  }
}

function handlePasswordReset() {
  const email = document.getElementById('resetEmail').value.trim();
  const errorDiv = document.getElementById('resetErrorMsg');
  const successDiv = document.getElementById('resetSuccessMsg');
  const loadingDiv = document.getElementById('resetLoadingMsg');

  errorDiv.classList.remove('show');
  successDiv.classList.remove('show');

  if (!email) {
    errorDiv.textContent = 'Please enter your email address';
    errorDiv.classList.add('show');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorDiv.textContent = 'Please enter a valid email address';
    errorDiv.classList.add('show');
    return;
  }

  loadingDiv.textContent = 'Sending reset link...';

  auth.sendPasswordResetEmail(email)
    .then(() => {
      loadingDiv.textContent = '';
      successDiv.textContent = 'Reset link sent. Check your email (and spam folder).';
      successDiv.classList.add('show');
      document.getElementById('resetEmail').value = '';
    })
    .catch(error => {
      loadingDiv.textContent = '';
      let msg = error.message;
      if (error.code === 'auth/user-not-found') msg = 'No account found with this email address';
      else if (error.code === 'auth/invalid-email') msg = 'Please enter a valid email address';
      else if (error.code === 'auth/too-many-requests') msg = 'Too many attempts. Please try again later.';
      errorDiv.textContent = msg;
      errorDiv.classList.add('show');
    });
}

auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'flex';
    loadUserDataFromFirebase();
  } else {
    currentUser = null;
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
  }
});

// Handle return from signInWithRedirect (mobile Google sign-in). If the redirect
// completed normally, onAuthStateChanged above will already have signed us in,
// so we just need to catch errors (auth/account-exists-with-different-credential,
// auth/unauthorized-domain, etc.) and surface them on the login screen.
auth.getRedirectResult()
  .then(result => {
    if(result && result.user){
      // Optional: finish any pending Google credential link the user kicked off earlier
      try { finishGoogleLinkIfPending(); } catch(_){}
    }
  })
  .catch(error => {
    if(!error || !error.code) return;
    const errorDiv = document.getElementById('errorMsg');
    const loadingDiv = document.getElementById('loadingMsg');
    if(loadingDiv) loadingDiv.textContent = '';
    if(!errorDiv) return;
    console.warn('[auth] redirect result error:', error.code, error.message);
    let msg = 'Could not sign in. Please try again.';
    if(error.code === 'auth/unauthorized-domain' || error.code === 'auth/operation-not-allowed'){
      msg = 'Sign-in is temporarily unavailable.';
    } else if(error.code === 'auth/account-exists-with-different-credential'){
      // Stash the pending credential and switch to password login (same flow as the popup branch)
      const cred = error.credential;
      const email = error.email || (cred && cred.email) || '';
      pendingGoogleCredential = cred;
      pendingGoogleEmail = email;
      try { switchTab('login'); } catch(_){}
      const emailField = document.getElementById('email');
      if(emailField && email) emailField.value = email;
      msg = `An account already exists for ${email || 'this address'}. Sign in with your password to link Google to it — your tasks stay put.`;
    } else if(error.code === 'auth/web-storage-unsupported'){
      msg = 'Sign-in needs storage permissions. Turn off Private Browsing and try again.';
    } else if(error.code === 'auth/network-request-failed'){
      msg = 'No internet connection. Connect and try again.';
    }
    errorDiv.textContent = msg;
    errorDiv.classList.add('show');
  });

function loadUserDataFromFirebase() {
  if (!currentUser) return;
  const userRef = database.ref('users/' + currentUser.uid);
  
  userRef.once('value').then(snapshot => {
    let isNewUser = false;
    if (snapshot.exists()) {
      let raw = snapshot.val();
      // Handle older nested structure: users/uid/plannerState/state/...
      if (raw && raw.plannerState && raw.plannerState.state && (raw.plannerState.state.tasks || raw.plannerState.state.events)) {
        console.log('Migrating from nested plannerState/state structure');
        S = raw.plannerState.state;
      } else {
        S = raw;
      }
      S = normalizeState(Object.assign({}, DEF, S));
      // Make sure new settings exist on old accounts
      if(!S.settings) S.settings = {};
      if(!S.settings.appName) S.settings.appName = DEF.settings.appName;
      if(!S.settings.appSubtitle) S.settings.appSubtitle = DEF.settings.appSubtitle;
      console.log('Loaded data from Firebase. Tasks:', (S.tasks||[]).length, 'Events:', (S.events||[]).length);
    } else {
      S = JSON.parse(JSON.stringify(DEF));
      S = normalizeState(S);
      isNewUser = true;
      saveUserDataToFirebase();
    }
    
    if (S.settings && S.settings.theme) {
      document.documentElement.dataset.theme = S.settings.theme;
    }
    if (S.settings && S.settings.accentColor) {
      document.documentElement.style.setProperty('--accent', S.settings.accentColor);
    }
    
    applyAppBranding();
    render();
    
    // Show welcome modal for new users or those who haven't seen it
    if(isNewUser || !S.settings.welcomeSeen){
      setTimeout(()=>{ openModal('mWelcome'); }, 400);
    }
  });
}

// Apply the user's app name and subtitle to the sidebar + browser tab
function applyAppBranding(){
  const appName = (S.settings && S.settings.appName) || 'Focus Hub';
  const appSub = (S.settings && S.settings.appSubtitle) || 'Productivity planner';
  const logoText = document.getElementById('logoText');
  const logoSub = document.getElementById('logoSub');
  const logoMark = document.getElementById('logoMark');
  if(logoText) logoText.textContent = appName;
  if(logoSub) logoSub.textContent = appSub;
  if(logoMark) logoMark.textContent = (appName.trim()[0] || 'F').toUpperCase();
  document.title = appName;
  const welcomeTitle = document.getElementById('welcomeTitle');
  if(welcomeTitle) welcomeTitle.textContent = `Welcome to ${appName}`;
}

// Save the welcome modal preference and close
function dismissWelcome(){
  const dontShow = document.getElementById('welcomeDontShowAgain');
  if(dontShow && dontShow.checked){
    if(!S.settings) S.settings = {};
    S.settings.welcomeSeen = true;
    save();
  }
  closeModal('mWelcome');
}

// Persistence: local-first + debounced cloud sync.
// PROBLEM (pre-fix): if signed in, this only wrote to Firebase. When the
// network blipped or Firebase rejected the write, localStorage stayed
// stale and tasks "disappeared" on refresh. The complete-button felt
// laggy because every click awaited a Firebase round-trip.
// FIX: always write localStorage synchronously (source of truth), then
// flush to Firebase on a 400ms debounce so rapid edits coalesce into a
// single network write.
let _fbSaveTimer = null;
function saveUserDataToFirebase() {
  // 1. Synchronous local write — source of truth, survives refreshes.
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { console.warn('localStorage save failed:', e); }
  // 2. Debounced Firebase sync (skip if not signed in).
  if (!currentUser) return;
  if (_fbSaveTimer) clearTimeout(_fbSaveTimer);
  _fbSaveTimer = setTimeout(() => {
    _fbSaveTimer = null;
    try {
      const userRef = database.ref('users/' + currentUser.uid);
      userRef.set(S).catch(err => console.error('Firebase save error:', err));
    } catch (e) { console.error('Firebase save threw:', e); }
  }, 400);
}
// Flush any pending cloud sync immediately — call before page unload.
function flushPendingSave() {
  if (_fbSaveTimer) {
    clearTimeout(_fbSaveTimer); _fbSaveTimer = null;
    if (currentUser) {
      try { database.ref('users/' + currentUser.uid).set(S); } catch (e) {}
    }
  }
}
window.addEventListener('beforeunload', flushPendingSave);
