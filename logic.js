'use strict';
/* logic.js - פונקציות טהורות: בלי DOM, בלי רשת, בלי localStorage. נבדקות ב-Node (tests/logic.test.mjs). */
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/* ---------- תאריכים (זמן מקומי בלבד; אסור toISOString) ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseDateStr(s) {
  const p = String(s).slice(0, 10).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); // צהריים: מונע בעיות מעבר שעון
}
function addDays(s, n) { const d = parseDateStr(s); d.setDate(d.getDate() + n); return toDateStr(d); }
function dow(s) { return parseDateStr(s).getDay(); }
function fmtDM(s) { const p = s.split('-'); return p[2] + '/' + p[1]; }
function fmtDMY(s) { const p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function formatDays(days) {
  const first = days[0], last = days[days.length - 1];
  if (first === last) return 'יום ' + DAY_NAMES[dow(first)] + ', ' + fmtDMY(first);
  return DAY_NAMES[dow(first)] + ' ' + fmtDM(first) + ' - ' + DAY_NAMES[dow(last)] + ' ' + fmtDMY(last);
}
// טווח קומפקטי להודעת WhatsApp: 28-29/08/2026, או 31/07-01/08/2026, או בין שנים
function fmtRange(a, b) {
  const pa = a.split('-'), pb = b.split('-');
  if (pa[0] === pb[0] && pa[1] === pb[1]) return pa[2] + '-' + pb[2] + '/' + pb[1] + '/' + pb[0];
  if (pa[0] === pb[0]) return pa[2] + '/' + pa[1] + '-' + pb[2] + '/' + pb[1] + '/' + pb[0];
  return fmtDMY(a) + '-' + fmtDMY(b);
}

/* ---------- ניקוי טקסט ---------- */
function normalizeName(s) {
  return String(s == null ? '' : s)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[=+\-@]+/, '').trim();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ---------- בניית רשימת האירועים מתוך פריטי Hebcal מנורמלים ----------
   items: [{date:'YYYY-MM-DD', category:'parashat'|'holiday', yomtov:boolean, title, hebrew}] */
function holidayLabel(group, yomtov) {
  const names = [];
  group.forEach(function (d) { yomtov.get(d).forEach(function (n) { names.push(n); }); });
  const cleaned = names.map(function (n) { return n.replace(/\s*\d{4}\s*$/, '').trim(); });
  let uniq = Array.from(new Set(cleaned));
  if (group.length > 1 && uniq.length > 1) {
    // "ראש השנה" + "ראש השנה ב׳" -> "ראש השנה"
    const stripped = Array.from(new Set(uniq.map(function (n) { return n.replace(/\s+[א-ת][׳']$/, '').trim(); })));
    if (stripped.length === 1) uniq = stripped;
  }
  return uniq.join(' / ');
}
function buildEvents(items, todayStr, endStr, excludedTitles) {
  excludedTitles = excludedTitles || [];
  const yomtov = new Map();      // תאריך -> שמות עבריים של ימי טוב
  const parasha = new Map();     // תאריך שבת -> פרשה
  const shabbatNote = new Map(); // תאריך -> "שבת ..." מיוחדת (שבת חול המועד, וכד')
  (items || []).forEach(function (it) {
    const date = String(it.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (it.category === 'parashat') {
      parasha.set(date, it.hebrew || it.title || '');
    } else if (it.category === 'holiday') {
      if (it.yomtov === true) {
        const title = String(it.title || '');
        if (excludedTitles.some(function (x) { return title.indexOf(x) === 0; })) return;
        if (!yomtov.has(date)) yomtov.set(date, []);
        yomtov.get(date).push(it.hebrew || title);
      } else if (/^שבת/.test(it.hebrew || '')) {
        shabbatNote.set(date, it.hebrew);
      }
    }
  });
  const events = [];
  // 1. אירועי חג: ימי טוב רצופים = כרטיס אחד. חול המועד אינו יום טוב, ולכן סוכות/פסח מתפצלים.
  const ytDates = Array.from(yomtov.keys()).sort();
  let group = [];
  function flush() {
    if (!group.length) return;
    events.push({ key: 'H-' + group[0], kind: 'holiday', label: holidayLabel(group, yomtov), days: group.slice() });
    group = [];
  }
  ytDates.forEach(function (d) {
    if (group.length && addDays(group[group.length - 1], 1) !== d) flush();
    group.push(d);
  });
  flush();
  // 2. אירועי שבת: שישי + שבת, למעט יום שכבר שייך לכרטיס חג.
  let sat = addDays(todayStr, -3);
  while (dow(sat) !== 6) sat = addDays(sat, 1);
  for (; sat <= endStr; sat = addDays(sat, 7)) {
    const fri = addDays(sat, -1);
    const days = [];
    if (!yomtov.has(fri)) days.push(fri);
    if (!yomtov.has(sat)) days.push(sat);
    if (!days.length) continue;
    let label;
    const p = parasha.get(sat);
    if (days.length === 1 && days[0] === fri) label = 'שישי - ערב חג';
    else if (p) label = 'שבת ' + (/^פרשת/.test(p) ? p : 'פרשת ' + p);
    else label = shabbatNote.get(sat) || shabbatNote.get(fri) || 'שבת';
    events.push({ key: 'S-' + sat, kind: 'shabbat', label: label, days: days });
  }
  events.forEach(function (e) { e.allDays = e.days.slice(); e.seq = false; });
  events.sort(function (a, b) { return a.allDays[0] < b.allDays[0] ? -1 : a.allDays[0] > b.allDays[0] ? 1 : 0; });
  // 3. רצף חג-שבת: שני אירועים מסוגים שונים שצמודים ביום.
  for (let i = 1; i < events.length; i++) {
    const p = events[i - 1], c = events[i];
    if (p.kind !== c.kind && addDays(p.allDays[p.allDays.length - 1], 1) === c.allDays[0]) { p.seq = true; c.seq = true; }
  }
  // 4. מסננים אירועים שהסתיימו ואחרי האופק; ימים שעברו לא נשמרים להרשמה.
  return events.filter(function (e) {
    e.days = e.days.filter(function (d) { return d >= todayStr; });
    return e.days.length > 0 && e.allDays[0] <= endStr;
  }).map(function (e) {
    e.firstDay = e.days[0];
    e.lastDay = e.allDays[e.allDays.length - 1];
    e.dateText = formatDays(e.days);
    return e;
  });
}

/* ---------- קיבוץ שורות הגיליון (שורה ליום) להרשמות ---------- */
function fallbackKey(date, eventName) {
  if (eventName && !/^שבת/.test(eventName)) return 'H-' + date;
  const d = dow(date);
  if (d === 5) return 'S-' + addDays(date, 1);
  if (d === 6) return 'S-' + date;
  return 'D-' + date;
}
function groupRegistrations(rows, events, todayStr) {
  const byDate = new Map(), byKey = new Map();
  events.forEach(function (ev) {
    byKey.set(ev.key, ev);
    ev.days.forEach(function (d) { byDate.set(d, ev); });
  });
  const groups = new Map();
  (rows || []).forEach(function (r) {
    const date = String(r.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const name = normalizeName(r.name);
    if (!name) return;
    const ev = byDate.get(date);
    // שורה ישנה (בלי eventKey) מקושרת לאירוע לפי התאריך; אחרת מפתח חלופי
    const key = r.eventKey || (ev ? ev.key : fallbackKey(date, r.eventName));
    const gk = name + '|' + key;
    let g = groups.get(gk);
    if (!g) { g = { name: name, key: key, ids: [], dates: [], eventName: '', missingId: false }; groups.set(gk, g); }
    if (r.id) g.ids.push(r.id); else g.missingId = true;
    g.dates.push(date);
    if (!g.eventName && r.eventName) g.eventName = r.eventName;
  });
  const future = [], history = [];
  groups.forEach(function (g) {
    g.dates = Array.from(new Set(g.dates)).sort();
    const ev = byKey.get(g.key) || null;
    g.hasEvent = !!ev;
    g.kind = g.key.indexOf('H-') === 0 ? 'holiday' : 'shabbat';
    g.label = ev ? ev.label : (g.eventName || (g.kind === 'holiday' ? 'חג' : 'שבת'));
    g.seq = !!(ev && ev.seq);
    g.readonly = g.missingId || g.ids.length === 0; // שורה בלי מזהה: אי אפשר לערוך או למחוק
    let span = ev ? ev.allDays : g.dates;
    if (!ev && g.dates.length === 1 && g.kind === 'shabbat') {
      const d = g.dates[0];
      span = dow(d) === 5 ? [d, addDays(d, 1)] : dow(d) === 6 ? [addDays(d, -1), d] : [d];
    }
    g.spanText = formatDays(span);
    g.first = span[0];
    g.last = span[span.length - 1];
    (g.last >= todayStr ? future : history).push(g);
  });
  const byNameHe = function (a, b) { return a.name.localeCompare(b.name, 'he'); };
  future.sort(function (a, b) { return a.first < b.first ? -1 : a.first > b.first ? 1 : byNameHe(a, b); });
  history.sort(function (a, b) { return a.first < b.first ? 1 : a.first > b.first ? -1 : byNameHe(a, b); });
  return { future: future, history: history };
}
// שורות ישנות בהיסטוריה בלי שם אירוע: משלימים "שבת פרשת X" ממפת פרשות (תאריך שבת -> פרשה)
function applyParasha(groups, parashaMap) {
  groups.forEach(function (g) {
    if (g.hasEvent || g.eventName || g.kind !== 'shabbat') return;
    const sat = g.dates.map(function (d) { return dow(d) === 5 ? addDays(d, 1) : d; }).find(function (d) { return dow(d) === 6; });
    const p = sat && parashaMap.get(sat);
    if (p) g.label = 'שבת ' + (/^פרשת/.test(p) ? p : 'פרשת ' + p);
  });
}

/* בין כל שתי הרשמות סמוכות: מועדים ללא נרשמים מקובצים לשורה אחת. אין פער לפני הראשונה ואחרי האחרונה.
   maxLast מטפל בהרשמות חופפות (חג + שבת צמודים). */
function buildFutureItems(groups, events) {
  const registered = new Set(groups.map(function (g) { return g.key; }));
  const items = [];
  let maxLast = null;
  groups.forEach(function (g) {
    if (maxLast !== null) {
      const gap = events.filter(function (ev) { return !registered.has(ev.key) && ev.firstDay > maxLast && ev.lastDay < g.first; });
      if (gap.length) items.push({ type: 'gap', events: gap });
    }
    items.push({ type: 'card', g: g });
    if (maxLast === null || g.last > maxLast) maxLast = g.last;
  });
  return items;
}

/* ---------- הודעת WhatsApp (ניסוח כפי שבקוד החי; שורה לכל אירוע) ---------- */
function shareLine(ev) {
  const d = ev.days;
  if (ev.kind === 'holiday') return '🍷 חג: ' + ev.label + ' (' + formatDays(d) + ')';
  if (d.length === 2) return '📅 סופ״ש: ' + fmtRange(d[0], d[1]);
  return '📅 ' + ev.label + ' (' + formatDays(d) + ')';
}
function buildShareMessage(name, chosenEvents, url) {
  return 'מה נשמע שבט מקונן? 😎\n' +
    'לידיעתכם📯\n' +
    'רשימת שבת/חג אצל ההורים התעדכנה📝\n\n' +
    '👨‍👩‍👧‍👦 משפחה: ' + name + '\n' +
    chosenEvents.map(shareLine).join('\n') + '\n\n' +
    '🔗 לצפייה והרשמה: ' + url + '\n' +
    'המשך יום נפלא! 😀';
}

/* ---------- עזרים לשכבת ה-UI (טהורים, נבדקים ב-Node) ---------- */
// entries להרשמה או עריכה: לכל אירוע שנבחר, לכל יום עתידי שלו. בסדר האירועים וללא תאריכים כפולים.
function buildEntries(events, selectedKeys) {
  const keys = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys || []);
  const seen = new Set();
  const out = [];
  (events || []).forEach(function (ev) {
    if (!keys.has(ev.key)) return;
    ev.days.forEach(function (d) {
      if (seen.has(d)) return;
      seen.add(d);
      out.push({ date: d, eventKey: ev.key, eventName: ev.label });
    });
  });
  return out;
}
// עריכה בלי שינוי: אותו שם מנורמל ואותו אירוע בדיוק. שינוי באותיות לטיניות בלבד נחשב שינוי.
function isEditUnchanged(group, name, selectedKeys) {
  const keys = Array.from(selectedKeys instanceof Set ? selectedKeys : (selectedKeys || []));
  return keys.length === 1 && keys[0] === group.key && normalizeName(name) === normalizeName(group.name);
}
// פענוח תשובת GAS: דף HTML (שגיאת פריסה), לא JSON, גרסת שרת שונה, או תקין.
function parseServerResponse(text, serverVersion) {
  const t = String(text == null ? '' : text).trim();
  if (t.charAt(0) === '<') return { kind: 'deploy' };
  let data;
  try { data = JSON.parse(t); } catch (e) { return { kind: 'invalid' }; }
  if (!data || typeof data !== 'object') return { kind: 'invalid' };
  if (data.ver !== serverVersion) return { kind: 'old', data: data };
  return { kind: 'ok', data: data };
}

/* ---------- Hebcal, מטמון ופענוח: עזרים טהורים ---------- */
// חלוקת טווח תאריכים לחתיכות של עד size ימים (כולל): [[start, end], ...]
function chunkRanges(start, end, size) {
  const out = [];
  let s = start;
  while (s <= end) {
    const e = addDays(s, size - 1);
    out.push([s, e < end ? e : end]);
    s = addDays(e, 1);
  }
  return out;
}
// תשובת Hebcal (cfg=json) לפריטים מנורמלים. parashaOnly: רק פרשות (להיסטוריה).
function normalizeHebcal(json, parashaOnly) {
  const out = [];
  ((json && json.items) || []).forEach(function (it) {
    const date = String(it.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (it.category === 'parashat') {
      out.push({ date: date, category: 'parashat', title: it.title || '', hebrew: it.hebrew || '' });
    } else if (!parashaOnly && it.category === 'holiday' && (it.yomtov === true || /^שבת/.test(it.hebrew || ''))) {
      out.push({ date: date, category: 'holiday', yomtov: it.yomtov === true, title: it.title || '', hebrew: it.hebrew || '' });
    }
  });
  return out;
}
// מטמון אירועים תקף: גיל < maxAgeMs, start <= היום-3, end >= היום+horizonDays-7
function eventsCacheValid(cache, todayStr, nowMs, maxAgeMs, horizonDays) {
  if (!cache || !Array.isArray(cache.items) || !cache.start || !cache.end) return false;
  if (!(nowMs - cache.savedAt < maxAgeMs)) return false;
  return cache.start <= addDays(todayStr, -3) && cache.end >= addDays(todayStr, horizonDays - 7);
}
// שבתות בקבוצות היסטוריה שחסרה להן תווית ושעדיין אין להן רשומה במפת הפרשות (מפתח קיים, גם ריק, נחשב ידוע)
function missingParashaSaturdays(groups, known) {
  const out = new Set();
  groups.forEach(function (g) {
    if (g.hasEvent || g.eventName || g.kind !== 'shabbat') return;
    const sat = g.dates.map(function (d) { return dow(d) === 5 ? addDays(d, 1) : d; }).find(function (d) { return dow(d) === 6; });
    if (sat && !known.has(sat)) out.add(sat);
  });
  return Array.from(out).sort();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DAY_NAMES, pad2, toDateStr, parseDateStr, addDays, dow, fmtDM, fmtDMY, formatDays, fmtRange,
    normalizeName, esc, holidayLabel, buildEvents, fallbackKey, groupRegistrations, applyParasha,
    buildFutureItems, shareLine, buildShareMessage, buildEntries, isEditUnchanged, parseServerResponse,
    chunkRanges, normalizeHebcal, eventsCacheValid, missingParashaSaturdays };
}