'use strict';
/* app.js - שכבת UI ורשת בלבד. כל הלוגיקה הטהורה ב-logic.js (נטען לפניו). אין innerHTML עם נתונים. */
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbw8HqfAwKkgGz6Xyxj-p24cW954cemIEpVB4cHgy1q8QD4LW5R5S44cMlHD1WuwrKo-Qw/exec', /* להדביק כאן את הערך הקיים מ-app.js החי, בלי לשנות (ראו DEPLOY_AND_TESTS.md) */
  HORIZON_DAYS: 270, CHUNK_DAYS: 100,
  EVENTS_CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
  REGS_REFRESH_AFTER_MS: 60 * 1000,
  INITIAL_EVENTS_SHOWN: 3, MORE_STEP: 5,
  SERVER_VERSION: 3, CLIENT_VERSION: '3.0.0',
  MAX_NAME: 40, MAX_ENTRIES: 20,
  EXCLUDED_YOMTOV_TITLES: ['Yom Kippur']
};
const LS = { EVENTS: 'shabbat.events.v3', REGS: 'shabbat.regs.v3', PARASHA: 'shabbat.parasha.v3', THEME: 'shabbat.theme' };
const HEBCAL_URL = 'https://www.hebcal.com/hebcal';

/* טקסטים: טבלה 11.6 כלשונה, ובהמשך טקסטים שנגזרו מה-FR (ראו תוכנית היישום) */
const STR = {
  submit: 'הרשמה', update: 'עדכן הרשמה',
  more: 'הצג עוד מועדים', less: 'צמצם מועדים',
  errNet: 'שגיאת תקשורת. בדקו את החיבור ונסו שוב.',
  errOld: 'השרת עדיין בגרסה ישנה. יש לבצע פריסה מחדש ב-GAS.',
  errDeploy: 'שגיאת הרשאות פריסה ב-GAS. ודאו שהפריסה מוגדרת ל-"Anyone".',
  noFuture: 'אין הרשמות עתידיות.', noPast: 'אין היסטוריית הרשמות.',
  delMsg: (name, event) => 'האם למחוק את ההרשמה של ' + name + ' ל-' + event + '?',
  // נגזרים
  loading: 'טוען נתונים...', retry: 'נסו שוב', cached: 'מוצגים נתונים שמורים. אין חיבור',
  signup: 'הירשמו', seq: 'רצף חג-שבת', edit: 'עריכה', del: 'מחיקה',
  noName: 'נא להזין שם.', noEvent: 'נא לבחור לפחות שבת או חג אחד.',
  tooMany: 'אפשר לסמן עד ' + CONFIG.MAX_ENTRIES + ' ימים בבת אחת.',
  errConfig: 'כתובת השרת לא הוגדרה (CONFIG.GAS_URL ב-app.js).',
  noChange: 'לא בוצע שינוי', updated: 'ההרשמה עודכנה.', saved: 'ההרשמה נשמרה', deleted: 'ההרשמה נמחקה',
  addToHome: 'הוספה למסך הבית',
  themeNames: { auto: 'אוטומטי', light: 'בהיר', dark: 'כהה' },
  version: (v) => 'גרסה ' + v,
  server: (v) => ' · שרת ' + v,
  gapTitle: (n) => (n === 1 ? 'מועד אחד בלי נרשמים' : n + ' מועדים בלי נרשמים'),
  partial: (added, skipped) => 'נרשמתם ' + (added === 1 ? 'ליום אחד' : 'ל-' + added + ' ימים') + '. ' +
    (skipped === 1 ? 'יום אחד כבר היה רשום.' : skipped + ' ימים כבר היו רשומים.'),
  themeLabel: (mode, next) => 'ערכת נושא: ' + STR.themeNames[mode] + '. לחצו למעבר ל' + STR.themeNames[next]
};

const state = {
  hebItems: [], eventsStatus: 'loading',      // loading | ok | stale | error
  rows: [], regsStatus: 'loading', regsError: '', // loading | ok | cached | error
  events: [], groups: { future: [], history: [] }, items: [],
  parashaMap: new Map(), parashaBusy: false,
  selectedKeys: new Set(), shown: CONFIG.INITIAL_EVENTS_SHOWN,
  editing: null,      // { ids, name, key, trigger }
  deleting: null, deleteTrigger: null,
  tab: 'future', busy: false, today: '', lastRegsFetch: 0, deferredInstall: null
};

/* ---------- עזרים ---------- */
const $ = (id) => document.getElementById(id);
function h(tag, props, children) {
  const e = document.createElement(tag);
  Object.keys(props || {}).forEach(function (k) {
    const v = props[k];
    if (v == null || v === false) return;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'data') Object.keys(v).forEach(function (d) { e.dataset[d] = v[d]; });
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  });
  (children || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}
function todayStr() { return toDateStr(new Date()); }
function lsGet(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* חסום או מלא */ } }
function lsRaw(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsRawSet(key, val) { try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) { /* חסום */ } }
function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function scrollToEl(el) { el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); }
function appUrl() { return location.origin + location.pathname; }

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); toastTimer = setTimeout(function () { t.textContent = ''; }, 300); }, 4000);
}
function setMsg(id, text) { $(id).textContent = text || ''; }
function clearFormMessages() { setMsg('formMsg', ''); setMsg('formErr', ''); $('share').hidden = true; }

/* ---------- ערכת נושא ---------- */
const THEME_NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
// המצב נשמר גם בזיכרון, כדי שהסבב יעבוד כש-localStorage חסום
function themeMode() {
  if (state.theme) return state.theme;
  const t = lsRaw(LS.THEME);
  return t === 'light' || t === 'dark' ? t : 'auto';
}
function applyTheme(mode) {
  state.theme = mode;
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
  lsRawSet(LS.THEME, mode === 'auto' ? null : mode);
  $('themeBtn').setAttribute('aria-label', STR.themeLabel(mode, THEME_NEXT[mode]));
  $('icoAuto').hidden = mode !== 'auto'; $('icoLight').hidden = mode !== 'light'; $('icoDark').hidden = mode !== 'dark';
  syncThemeColor();
}
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const c = getComputedStyle(document.documentElement).getPropertyValue('--header-bg').trim();
  if (meta && c) meta.setAttribute('content', c);
}

/* ---------- רשת: Hebcal ---------- */
function hebcalUrl(start, end, withMajor) {
  return HEBCAL_URL + '?v=1&cfg=json&' + (withMajor ? 'maj=on&' : '') + 's=on&i=on&start=' + start + '&end=' + end;
}
async function fetchHebcal(start, end, parashaOnly) {
  const parts = await Promise.all(chunkRanges(start, end, CONFIG.CHUNK_DAYS).map(async function (r) {
    const res = await fetch(hebcalUrl(r[0], r[1], !parashaOnly));
    if (!res.ok) throw new Error('hebcal ' + res.status);
    return normalizeHebcal(await res.json(), parashaOnly);
  }));
  return [].concat.apply([], parts);
}
async function loadEvents() {
  const today = todayStr();
  const cache = lsGet(LS.EVENTS);
  if (eventsCacheValid(cache, today, Date.now(), CONFIG.EVENTS_CACHE_MAX_AGE_MS, CONFIG.HORIZON_DAYS)) {
    state.hebItems = cache.items; state.eventsStatus = 'ok';
    return;
  }
  const start = addDays(today, -3), end = addDays(today, CONFIG.HORIZON_DAYS);
  try {
    const items = await fetchHebcal(start, end, false);
    state.hebItems = items; state.eventsStatus = 'ok';
    lsSet(LS.EVENTS, { savedAt: Date.now(), start: start, end: end, items: items });
  } catch (e) {
    if (cache && Array.isArray(cache.items)) { state.hebItems = cache.items; state.eventsStatus = 'stale'; }
    else state.eventsStatus = 'error';
  }
}

/* ---------- רשת: GAS ---------- */
async function gasCall(options) {
  if (!CONFIG.GAS_URL) return { kind: 'config' };
  let text;
  try {
    const res = await fetch(CONFIG.GAS_URL, options);
    text = await res.text();
  } catch (e) { return { kind: 'network' }; }
  return parseServerResponse(text, CONFIG.SERVER_VERSION);
}
function gasPost(payload) {
  return gasCall({ method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
}
function errText(kind) { return kind === 'config' ? STR.errConfig : kind === 'deploy' ? STR.errDeploy : kind === 'old' ? STR.errOld : STR.errNet; }
// true אם נטענו הרשמות חדשות. כשל לא מוחק את מה שכבר מוצג. קריאה במקביל משתפת את הקריאה שכבר בדרך.
// fresh: אחרי כתיבה. קריאה שנשלחה לפני הכתיבה לא מספיקה, ולכן נשלחת קריאה חדשה אחריה.
function loadRegs(fresh) {
  if (state.regsInflight && !fresh) return state.regsInflight;
  const before = state.regsInflight || Promise.resolve();
  state.lastRegsFetch = Date.now();
  const p = before.then(fetchRegs, fetchRegs).finally(function () {
    if (state.regsInflight === p) state.regsInflight = null;
    state.lastRegsFetch = Date.now();
  });
  state.regsInflight = p;
  return p;
}
async function fetchRegs() {
  const r = await gasCall({});
  if (r.kind === 'ok' && r.data.status === 'success' && Array.isArray(r.data.data)) {
    state.rows = r.data.data; state.regsStatus = 'ok'; state.regsError = '';
    lsSet(LS.REGS, { savedAt: Date.now(), rows: state.rows });
    $('serverVer').textContent = STR.server(r.data.ver);
    return true;
  }
  if (r.kind === 'ok' && r.data.status === 'error') { state.regsStatus = 'error'; state.regsError = r.data.message || STR.errNet; return false; } // למשל: חסרה כותרת, יש להריץ migrateSheet
  const kind = r.kind === 'ok' ? 'invalid' : r.kind;
  if ((kind === 'network' || kind === 'invalid') && state.rows.length) { state.regsStatus = 'cached'; return false; }
  const cached = lsGet(LS.REGS);
  if ((kind === 'network' || kind === 'invalid') && cached && Array.isArray(cached.rows)) { state.rows = cached.rows; state.regsStatus = 'cached'; return false; }
  state.regsStatus = 'error'; state.regsError = errText(kind);
  return false;
}

/* ---------- חישוב ורינדור ---------- */
function eventsReady() { return state.eventsStatus === 'ok' || state.eventsStatus === 'stale'; }
function recompute() {
  state.today = todayStr();
  state.events = eventsReady() ? buildEvents(state.hebItems, state.today, addDays(state.today, CONFIG.HORIZON_DAYS), CONFIG.EXCLUDED_YOMTOV_TITLES) : [];
  Array.from(state.selectedKeys).forEach(function (k) { if (!state.events.some(function (e) { return e.key === k; })) state.selectedKeys.delete(k); });
  const g = groupRegistrations(state.rows, state.events, state.today);
  applyParasha(g.history, state.parashaMap);
  state.groups = g;
  state.items = buildFutureItems(g.future, state.events);
}
function stateBlock(text, isError, withRetry) {
  return h('div', { class: 'state' + (isError ? ' is-error' : '') }, [
    h('p', { text: text, role: isError ? 'alert' : null }),
    withRetry ? h('button', { type: 'button', class: 'btn btn-secondary', text: STR.retry, onclick: function () { refreshAll(true); } }) : null
  ]);
}
function updateNotice() {
  setMsg('notice', state.regsStatus === 'cached' || state.eventsStatus === 'stale' ? STR.cached : '');
}
function renderAll() { renderPicker(); renderLists(); updateNotice(); renderFormMode(); }

function eventById(key) { return state.events.find(function (e) { return e.key === key; }); }
// אירוע מסומן לעולם לא מוסתר ("צמצם" לא מסתיר בחירה שתישלח)
function ensureShown() {
  let last = -1;
  state.events.forEach(function (e, i) { if (state.selectedKeys.has(e.key)) last = i; });
  if (last >= 0) state.shown = Math.max(state.shown, last + 1);
}
// force: מיוצר מחדש גם כשהאירועים לא השתנו. בלי force רענון ברקע לא מאבד פוקוס ובחירה.
function renderPicker(force) {
  const sig = [eventsReady() ? 'ready' : state.eventsStatus, state.shown, state.editing ? 1 : 0, state.events.map(function (e) { return e.key + e.label + e.dateText + e.seq; }).join(',')].join('~');
  if (!force && sig === state.pickerSig) return;
  state.pickerSig = sig;
  const box = $('events'), more = $('moreRow');
  const active = document.activeElement;
  const focusId = active && active.id;
  const focusKey = active && active.name === 'ev' && box.contains(active) ? active.value : null;
  box.replaceChildren(); more.replaceChildren();
  if (state.eventsStatus === 'loading') { box.appendChild(stateBlock(STR.loading, false, false)); return; }
  if (state.eventsStatus === 'error') { box.appendChild(stateBlock(STR.errNet, true, true)); return; }
  ensureShown();
  const editing = !!state.editing;
  state.events.slice(0, state.shown).forEach(function (ev) {
    const on = state.selectedKeys.has(ev.key);
    const dateId = 'evd-' + ev.key;
    const input = h('input', { type: editing ? 'radio' : 'checkbox', name: 'ev', value: ev.key, 'aria-describedby': dateId, checked: on });
    if (on) input.checked = true;
    box.appendChild(h('label', { class: 'event' + (on ? ' is-on' : '') }, [
      input,
      h('span', { class: 'event-text' }, [h('span', { class: 'event-name', text: ev.label }), h('span', { class: 'event-date', id: dateId, text: ev.dateText })]),
      ev.seq ? h('span', { class: 'tag tag-seq', text: STR.seq }) : null
    ]));
  });
  const total = state.events.length;
  if (state.shown < total) more.appendChild(h('button', { type: 'button', id: 'moreBtn', class: 'btn btn-link', text: STR.more,
    onclick: function () { state.shown += CONFIG.MORE_STEP; renderPicker(true); } }));
  if (total > CONFIG.INITIAL_EVENTS_SHOWN && state.shown > CONFIG.INITIAL_EVENTS_SHOWN) more.appendChild(h('button', { type: 'button', id: 'lessBtn', class: 'btn btn-link', text: STR.less,
    onclick: function () { state.shown = CONFIG.INITIAL_EVENTS_SHOWN; ensureShown(); renderPicker(true); } }));
  if (focusKey) { const again = box.querySelector('input[value="' + focusKey + '"]'); if (again) again.focus(); }
  else if (focusId && $(focusId)) $(focusId).focus();
  else if (focusId === 'moreBtn' && $('lessBtn')) $('lessBtn').focus();
  else if (focusId === 'lessBtn' && $('moreBtn')) $('moreBtn').focus();
}
function renderFormMode() {
  const editing = !!state.editing;
  $('editBanner').hidden = !editing;
  $('cancelBtn').hidden = !editing;
  $('submitBtn').textContent = editing ? STR.update : STR.submit;
  $('pickerHint').hidden = editing;
}

function regCard(g, past) {
  const top = [h('h3', { class: 'reg-name', text: g.name }), h('span', { class: 'tag', text: g.label })];
  if (g.seq) top.push(h('span', { class: 'tag tag-seq', text: STR.seq }));
  const bottom = [h('span', { class: 'reg-range', text: g.spanText })];
  if (!past && !g.readonly) {
    bottom.push(h('span', { class: 'reg-actions' }, [
      h('button', { type: 'button', class: 'btn btn-secondary', text: STR.edit, 'aria-label': STR.edit + ': ' + g.name, data: { gid: g.key + '|' + g.name }, onclick: function () { startEdit(g); } }),
      h('button', { type: 'button', class: 'btn btn-danger', text: STR.del, 'aria-label': STR.del + ': ' + g.name, data: { gid: g.key + '|' + g.name }, onclick: function (e) { openDelete(g, e.currentTarget); } })
    ]));
  }
  return h('article', { class: 'card reg' + (past ? ' is-past' : '') }, [
    past ? null : h('div', { class: 'gold-line' }),
    h('div', { class: 'reg-body' }, [h('div', { class: 'reg-top' }, top), h('div', { class: 'reg-bottom' }, bottom)])
  ]);
}
function gapBlock(events) {
  return h('section', { class: 'gap' }, [
    h('p', { class: 'gap-title', text: STR.gapTitle(events.length) })
  ].concat(events.map(function (ev) {
    return h('div', { class: 'gap-row' }, [
      h('span', { class: 'gap-text' }, [h('span', { class: 'gap-name', text: ev.label }), h('span', { class: 'gap-date', text: ev.dateText })]),
      h('button', { type: 'button', class: 'btn btn-secondary', text: STR.signup, 'aria-label': STR.signup + ': ' + ev.label, onclick: function () { pickFromGap(ev.key); } })
    ]);
  })));
}
function renderLists() {
  const fut = $('panel-future'), past = $('panel-past');
  // שמירת הפוקוס על כפתור בכרטיס (עריכה/מחיקה) לאורך רענון ברקע
  const a = document.activeElement;
  const keep = a && a.dataset && a.dataset.gid && fut.contains(a) ? { gid: a.dataset.gid, cls: a.classList.contains('btn-danger') ? '.btn-danger' : '.btn-secondary' } : null;
  fut.replaceChildren(); past.replaceChildren();
  renderListsInto(fut, past);
  if (keep) {
    const again = Array.prototype.find.call(fut.querySelectorAll(keep.cls + '[data-gid]'), function (b) { return b.dataset.gid === keep.gid; });
    if (again) again.focus();
  }
}
function renderListsInto(fut, past) {
  if (state.regsStatus === 'error') {
    fut.appendChild(stateBlock(state.regsError, true, true));
    past.appendChild(stateBlock(state.regsError, true, true));
    return;
  }
  if (state.regsStatus === 'loading') { fut.appendChild(stateBlock(STR.loading, false, false)); past.appendChild(stateBlock(STR.loading, false, false)); return; }
  if (!state.items.length) fut.appendChild(stateBlock(STR.noFuture, false, false));
  state.items.forEach(function (it) { fut.appendChild(it.type === 'gap' ? gapBlock(it.events) : regCard(it.g, false)); });
  if (!state.groups.history.length) past.appendChild(stateBlock(STR.noPast, false, false));
  state.groups.history.forEach(function (g) { past.appendChild(regCard(g, true)); });
}

/* ---------- לשוניות ---------- */
function setTab(name, focus) {
  state.tab = name;
  ['future', 'past'].forEach(function (t) {
    const sel = t === name;
    $('tab-' + t).setAttribute('aria-selected', sel ? 'true' : 'false');
    $('tab-' + t).tabIndex = sel ? 0 : -1;
    $('panel-' + t).hidden = !sel;
  });
  if (focus) $('tab-' + name).focus();
}

/* ---------- בורר, הרשמה ועריכה ---------- */
function onPickerChange(e) {
  const input = e.target;
  if (!input || input.name !== 'ev') return;
  if (input.type === 'radio') state.selectedKeys = new Set([input.value]);
  else if (input.checked) state.selectedKeys.add(input.value);
  else state.selectedKeys.delete(input.value);
  document.querySelectorAll('#events .event').forEach(function (lab) { lab.classList.toggle('is-on', lab.querySelector('input').checked); });
}
function resetForm() {
  $('nameInput').value = '';
  state.selectedKeys = new Set();
  state.editing = null;
  state.shown = CONFIG.INITIAL_EVENTS_SHOWN;
}
function startEdit(g) {
  if (state.busy) return; // שליחה בדרך: לא מחליפים את מצב הטופס באמצע
  clearFormMessages();
  state.editing = { ids: g.ids.slice(), name: g.name, key: g.key, trigger: g.key + '|' + g.name };
  state.selectedKeys = new Set(eventById(g.key) ? [g.key] : []);
  $('nameInput').value = g.name;
  renderPicker(true); renderFormMode();
  scrollToEl($('regForm'));
  $('nameInput').focus({ preventScroll: true });
}
function cancelEdit(restoreFocus) {
  if (state.busy) return;
  const trigger = state.editing && state.editing.trigger;
  resetForm(); clearFormMessages();
  renderPicker(true); renderFormMode();
  if (restoreFocus && trigger) {
    const btn = Array.prototype.find.call(document.querySelectorAll('[data-gid]'), function (b) { return b.dataset.gid === trigger; });
    if (btn) btn.focus();
  }
}
function pickFromGap(key) {
  if (state.busy) return;
  if (state.editing) cancelEdit(false);
  state.selectedKeys.add(key);
  const idx = state.events.findIndex(function (e) { return e.key === key; });
  if (idx >= 0) state.shown = Math.max(state.shown, idx + 1);
  renderPicker(true);
  scrollToEl($('regForm'));
  const name = $('nameInput');
  if (!name.value.trim()) name.focus({ preventScroll: true });
  else { const box = document.querySelector('#events input[value="' + key + '"]'); if (box) box.focus({ preventScroll: true }); }
}
function setBusy(on) {
  state.busy = on;
  $('submitBtn').disabled = on;
  $('regForm').setAttribute('aria-busy', on ? 'true' : 'false');
}
async function onSubmit(ev) {
  ev.preventDefault();
  if (state.busy) return;
  clearFormMessages();
  const name = normalizeName($('nameInput').value).slice(0, CONFIG.MAX_NAME).trim();
  if (!name) { setMsg('formErr', STR.noName); $('nameInput').focus(); return; }
  const entries = buildEntries(state.events, state.selectedKeys);
  if (!entries.length) { setMsg('formErr', STR.noEvent); return; }
  if (entries.length > CONFIG.MAX_ENTRIES) { setMsg('formErr', STR.tooMany); return; }
  const editing = state.editing;
  if (editing && isEditUnchanged(editing, name, state.selectedKeys)) { setMsg('formMsg', STR.noChange); toast(STR.noChange); return; }
  const chosen = state.events.filter(function (e) { return state.selectedKeys.has(e.key); });
  setBusy(true);
  const r = await gasPost(editing ? { action: 'edit', ids: editing.ids, name: name, entries: entries } : { action: 'register', name: name, entries: entries });
  setBusy(false);
  if (r.kind !== 'ok') { setMsg('formErr', errText(r.kind)); return; }
  const d = r.data;
  if (d.status === 'success') {
    const skipped = (d.skipped || []).length;
    resetForm();
    if (skipped) setMsg('formMsg', STR.partial(d.added, skipped));
    else if (editing) setMsg('formMsg', STR.updated);
    toast(editing ? STR.updated : STR.saved);
    // בהודעה רק אירועים שנרשם להם לפחות יום אחד (ימים שכבר היו רשומים לא נכללים)
    const skippedDates = d.skipped || [];
    const shared = chosen.filter(function (e) { return e.days.some(function (day) { return skippedDates.indexOf(day) < 0; }); });
    $('waLink').href = 'https://wa.me/?text=' + encodeURIComponent(buildShareMessage(name, shared, appUrl()));
    $('share').hidden = false;
    renderPicker(true); renderFormMode();
    await loadRegs(true); recompute(); renderAll(); resolveHistoryParasha();
    return;
  }
  setMsg('formErr', d.message || STR.errNet);
  if (editing && d.status === 'error') {
    // ההרשמה נמחקה או שונתה על ידי אחר: יוצאים ממצב עריכה (השם והבחירה נשארים) ומרעננים
    if (/לא נמצאה/.test(d.message || '')) { state.editing = null; renderPicker(true); renderFormMode(); }
    await loadRegs(true); recompute(); renderLists(); updateNotice();
  }
}

/* ---------- מחיקה ---------- */
function openDelete(g, trigger) {
  if (state.busy) return; // שליחת טופס בדרך: לא פותחים חלון שאי אפשר לאשר בו
  state.deleting = g; state.deleteTrigger = trigger;
  setMsg('delErr', '');
  $('delMsg').textContent = STR.delMsg(g.name, g.label);
  $('delConfirm').disabled = false;
  $('delDialog').showModal();
}
async function confirmDelete() {
  const g = state.deleting;
  if (!g || state.busy) return;
  setBusy(true); $('delConfirm').disabled = true; $('delCancel').disabled = true; setMsg('delErr', '');
  const r = await gasPost({ action: 'delete', ids: g.ids });
  setBusy(false); $('delConfirm').disabled = false; $('delCancel').disabled = false;
  if (r.kind !== 'ok') { setMsg('delErr', errText(r.kind)); return; }
  if (r.data.status === 'success' || (r.data.status === 'error' && /לא נמצאה/.test(r.data.message || ''))) {
    $('delDialog').close();
    toast(STR.deleted);
    if (state.editing && state.editing.ids.some(function (id) { return g.ids.indexOf(id) >= 0; })) { resetForm(); renderPicker(true); renderFormMode(); }
    await loadRegs(true); recompute(); renderAll(); resolveHistoryParasha();
    $('tab-' + state.tab).focus(); // הכפתור שהפעיל את המחיקה כבר לא קיים
    return;
  }
  setMsg('delErr', r.data.message || STR.errNet);
}
function onDeleteClosed() {
  const t = state.deleteTrigger;
  state.deleting = null; state.deleteTrigger = null;
  if (!t) return;
  if (document.contains(t)) { t.focus(); return; }
  // הרשימה רועננה ברקע בזמן שהחלון היה פתוח: מחפשים את הכפתור החדש של אותה הרשמה
  const same = Array.prototype.find.call(document.querySelectorAll('.btn-danger[data-gid]'), function (b) { return b.dataset.gid === t.dataset.gid; });
  if (same) same.focus();
}

/* ---------- פרשות להיסטוריה ישנה (FR-17) ---------- */
async function resolveHistoryParasha() {
  if (state.parashaBusy || state.regsStatus === 'error') return;
  const missing = missingParashaSaturdays(state.groups.history, state.parashaMap);
  if (!missing.length) return;
  state.parashaBusy = true;
  try {
    const start = missing[0], end = missing[missing.length - 1];
    const items = await fetchHebcal(start, end, true);
    items.forEach(function (it) { if (it.hebrew) state.parashaMap.set(it.date, it.hebrew); });
    // שבת שהוחזרה בלי פרשה (למשל שבת חג) נשמרת כריקה, כדי לא לשאול שוב
    for (let d = start; d <= end; d = addDays(d, 7)) if (!state.parashaMap.has(d)) state.parashaMap.set(d, '');
    const obj = {};
    state.parashaMap.forEach(function (v, k) { obj[k] = v; });
    lsSet(LS.PARASHA, obj);
    applyParasha(state.groups.history, state.parashaMap);
    renderLists();
  } catch (e) { /* נשארת התווית "שבת" */ }
  state.parashaBusy = false;
}

/* ---------- טעינה, רענון והתקנה ---------- */
async function refreshAll(showLoading) {
  if (showLoading) {
    if (!state.rows.length) state.regsStatus = 'loading';
    if (!state.hebItems.length) state.eventsStatus = 'loading';
    recompute(); renderAll();
  }
  await Promise.all([loadEvents(), loadRegs()]);
  recompute(); renderAll();
  resolveHistoryParasha();
}
async function silentRefresh() {
  const dayChanged = todayStr() !== state.today;
  if (!dayChanged && Date.now() - state.lastRegsFetch <= CONFIG.REGS_REFRESH_AFTER_MS) return;
  // גם אירועים שנטענו מהמטמון בגלל כשל רשת מנסים שוב, כדי שהודעת "אין חיבור" לא תישאר
  const retryEvents = dayChanged || state.eventsStatus !== 'ok';
  if (retryEvents) await loadEvents();
  await loadRegs();
  recompute();
  if (retryEvents) renderAll(); else { renderLists(); updateNotice(); }
  resolveHistoryParasha();
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}
function bindInstall() {
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    state.deferredInstall = e;
    if (!isStandalone()) $('installRow').hidden = false;
  });
  window.addEventListener('appinstalled', function () { state.deferredInstall = null; $('installRow').hidden = true; });
  $('installBtn').addEventListener('click', async function () {
    const p = state.deferredInstall;
    if (!p) return;
    p.prompt();
    try { await p.userChoice; } catch (e) { /* בוטל */ }
    state.deferredInstall = null; $('installRow').hidden = true;
  });
}

function init() {
  $('clientVer').textContent = STR.version(CONFIG.CLIENT_VERSION);
  $('installBtn').textContent = STR.addToHome;
  applyTheme(themeMode());
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', syncThemeColor);
  }
  $('themeBtn').addEventListener('click', function () { applyTheme(THEME_NEXT[themeMode()]); });
  $('regForm').addEventListener('submit', onSubmit);
  $('events').addEventListener('change', onPickerChange);
  $('cancelBtn').addEventListener('click', function () { cancelEdit(true); });
  $('delConfirm').addEventListener('click', confirmDelete);
  $('delCancel').addEventListener('click', function () { $('delDialog').close(); });
  $('delDialog').addEventListener('close', onDeleteClosed);
  // Escape בזמן מחיקה בדרך היה סוגר את החלון ומעלים שגיאה אפשרית
  $('delDialog').addEventListener('cancel', function (e) { if (state.busy) e.preventDefault(); });
  ['future', 'past'].forEach(function (t) {
    $('tab-' + t).addEventListener('click', function () { setTab(t, false); });
    $('tab-' + t).addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setTab(t === 'future' ? 'past' : 'future', true);
      else if (e.key === 'Home') setTab('future', true);
      else if (e.key === 'End') setTab('past', true);
    });
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') silentRefresh(); });
  bindInstall();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* ללא SW האפליקציה עובדת */ }); });
  }

  // הצגה מיידית מהמטמון, ואז רשת ברקע
  const ec = lsGet(LS.EVENTS), rc = lsGet(LS.REGS), pc = lsGet(LS.PARASHA);
  if (ec && Array.isArray(ec.items) && ec.items.length) { state.hebItems = ec.items; state.eventsStatus = 'stale'; }
  if (rc && Array.isArray(rc.rows)) { state.rows = rc.rows; state.regsStatus = 'cached'; }
  if (pc && typeof pc === 'object') state.parashaMap = new Map(Object.keys(pc).map(function (k) { return [k, pc[k]]; }));
  recompute(); renderAll();
  // בזמן הטעינה הראשונה אין עדיין אינדיקציה של "אין חיבור": ההודעה תופיע רק אם הרשת נכשלה
  setMsg('notice', '');
  refreshAll(false);
}
init();
