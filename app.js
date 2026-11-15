'use strict';

/* ================= config ================= */

const STORE_KEY = 'countdown.events.v1';
const SETTINGS_KEY = 'countdown.settings.v1';
const FIRED_KEY = 'countdown.fired.v1';
const DAY = 86400000;

const GRADIENTS = {
  violet: ['#7c3aed', '#db2777'],
  sunset: ['#fb923c', '#e11d48'],
  ocean:  ['#0ea5e9', '#6366f1'],
  mint:   ['#10b981', '#0e7490'],
  gold:   ['#facc15', '#f97316'],
  candy:  ['#f472b6', '#a855f7'],
  lime:   ['#a3e635', '#059669'],
  night:  ['#64748b', '#312e81'],
};

const EMOJIS = ['🎉', '🎂', '✈️', '🏖️', '🎄', '🎃', '💍', '❤️', '🎓', '📚', '🎸', '🎮', '⚽', '🏋️', '🍾', '🚗', '🏠', '👶', '🐣', '🎆', '🎁', '⛷️', '🏕️', '💼'];

// Offsets in minutes before the start. Negative = after start (used for all-day events, e.g. 9:00 on the day).
const REMINDERS_TIMED = [
  [0, 'Zum Start'], [15, '15 Min vorher'], [60, '1 Std vorher'], [1440, '1 Tag vorher'], [10080, '1 Woche vorher'],
];
const REMINDERS_ALLDAY = [
  [-540, 'Am Tag, 9 Uhr'], [900, 'Vortag, 9 Uhr'], [2340, '2 Tage vorher'], [9540, '1 Woche vorher'],
];

const DEMO = () => {
  const y = new Date().getFullYear();
  const xmas = new Date(y, 11, 24) < new Date() ? y + 1 : y;
  return [
    { id: uid(), title: 'Weihnachten', emoji: '🎄', date: `${xmas}-12-24`, time: '18:00', allday: false, yearly: true, color: 'mint', reminders: [1440, 0], note: '', created: Date.now() - 30 * DAY },
    { id: uid(), title: 'Silvester', emoji: '🎆', date: `${xmas}-12-31`, time: '23:59', allday: false, yearly: true, color: 'violet', reminders: [60], note: '', created: Date.now() - 30 * DAY },
  ];
};

/* ================= state ================= */

let events = load(STORE_KEY, null);
if (!Array.isArray(events)) { events = DEMO(); save(STORE_KEY, events); }
let settings = Object.assign({ showPast: false, showSeconds: true, hideInstall: false }, load(SETTINGS_KEY, {}));
let fired = load(FIRED_KEY, {});
let openId = null;      // event shown in detail view
let editing = null;     // draft in editor
let layoutKey = '';     // to detect when a full re-render is needed
const timers = new Map();

/* ================= helpers ================= */

function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const plural = (n, one, many) => (n === 1 ? one : many);
const fmtNum = (n) => n.toLocaleString('de-DE');

function gradient(color) {
  const [a, b] = GRADIENTS[color] || GRADIENTS.violet;
  return `--g: linear-gradient(135deg, ${a}, ${b}); --glow: ${a}aa;`;
}

function startOf(ev, year) {
  const [y, m, d] = ev.date.split('-').map(Number);
  const [hh, mm] = ev.allday ? [0, 0] : (ev.time || '00:00').split(':').map(Number);
  return new Date(year ?? y, m - 1, d, hh, mm, 0, 0);
}

// How long an occurrence counts as "happening now" after its start.
const activeSpan = (ev) => (ev.allday ? DAY : 3600000);

/** Returns { target, prev, state } where state is 'future' | 'now' | 'past'. */
function occurrence(ev, now = Date.now()) {
  let target = startOf(ev);
  let prev = null;
  if (ev.yearly) {
    const baseYear = target.getFullYear();
    let year = Math.max(baseYear, new Date(now).getFullYear() - 1);
    target = startOf(ev, year);
    while (target.getTime() + activeSpan(ev) <= now) { year++; target = startOf(ev, year); }
    if (year > baseYear) prev = startOf(ev, year - 1);
  }
  const t = target.getTime();
  const state = now < t ? 'future' : now < t + activeSpan(ev) ? 'now' : 'past';
  return { target, prev, state };
}

function diffParts(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60, total: ms };
}

function progress(ev, occ, now = Date.now()) {
  if (occ.state !== 'future') return 1;
  const from = occ.prev ? occ.prev.getTime() : Math.min(ev.created || now, now);
  const span = occ.target.getTime() - from;
  return span <= 0 ? 0 : Math.min(1, Math.max(0, (now - from) / span));
}

function nightsUntil(target) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(target); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / DAY);
}

const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
function fmtDate(ev, d) { return dateFmt.format(d) + (ev.allday ? '' : ` · ${timeFmt.format(d)} Uhr`); }

function relText(ev, occ, now = Date.now()) {
  if (occ.state === 'now') return ev.allday ? 'Heute ist es so weit! 🎉' : 'Jetzt! 🎉';
  if (occ.state === 'past') {
    const days = Math.floor((now - occ.target) / DAY);
    return days === 0 ? 'Heute vorbei' : `vor ${fmtNum(days)} ${plural(days, 'Tag', 'Tagen')}`;
  }
  const p = diffParts(occ.target - now);
  if (p.d > 0) return `noch ${fmtNum(p.d)} ${plural(p.d, 'Tag', 'Tage')}${p.h ? `, ${p.h} Std` : ''}`;
  if (p.h > 0) return `noch ${p.h} Std ${p.m} Min`;
  return `noch ${p.m} Min`;
}

/* ================= rendering ================= */

function sorted(now = Date.now()) {
  const withOcc = events.map((ev) => ({ ev, occ: occurrence(ev, now) }));
  const live = withOcc.filter((x) => x.occ.state !== 'past').sort((a, b) => a.occ.target - b.occ.target);
  const past = withOcc.filter((x) => x.occ.state === 'past').sort((a, b) => b.occ.target - a.occ.target);
  return { live, past };
}

function render() {
  const now = Date.now();
  const { live, past } = sorted(now);
  const hero = $('#hero');
  const list = $('#list');
  layoutKey = computeLayoutKey(now);

  if (live.length) {
    const { ev, occ } = live[0];
    hero.hidden = false;
    hero.dataset.id = ev.id;
    hero.setAttribute('style', gradient(ev.color));
    hero.innerHTML = `
      <span class="hero-tag"><span class="dot"></span>${occ.state === 'now' ? 'Jetzt' : 'Als Nächstes'}</span>
      <div class="hero-head">
        <div class="hero-emoji">${esc(ev.emoji)}</div>
        <div><h2 class="hero-title">${esc(ev.title)}</h2><p class="hero-date">${esc(fmtDate(ev, occ.target))}</p></div>
      </div>
      ${occ.state === 'now' ? `<div class="hero-now">${ev.allday ? 'Heute ist es so weit!' : 'Es geht los!'} 🎉</div>` : `<div class="units ${settings.showSeconds ? '' : 'no-sec'}">
        <div class="unit"><b data-u="d">0</b><span data-l="d">Tage</span></div>
        <div class="unit"><b data-u="h">0</b><span>Std</span></div>
        <div class="unit"><b data-u="m">0</b><span>Min</span></div>
        ${settings.showSeconds ? '<div class="unit"><b data-u="s">0</b><span>Sek</span></div>' : ''}
      </div>`}
      <div class="bar"><i data-bar></i></div>
      <div class="bar-label"><span data-rel></span><span data-pct></span></div>`;
  } else {
    hero.hidden = true;
    hero.innerHTML = '';
  }

  const rest = live.slice(1);
  let html = '';
  if (rest.length) html += `<p class="list-label">Demnächst</p>` + rest.map(cardHTML).join('');
  if (settings.showPast && past.length) html += `<p class="list-label">Vergangen</p>` + past.map(cardHTML).join('');
  list.innerHTML = html;
  list.querySelectorAll('.card').forEach((c, i) => (c.style.animationDelay = `${i * 40}ms`));

  $('#empty').hidden = events.length > 0;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#install-hint').hidden = standalone || settings.hideInstall || !/iPhone|iPad|iPod/.test(navigator.userAgent);

  if (openId) renderDetail();
  tick();
}

function cardHTML({ ev, occ }) {
  const cls = occ.state === 'past' ? 'past' : occ.state === 'now' ? 'today' : '';
  return `
    <button class="card ${cls}" data-id="${ev.id}" style="${gradient(ev.color)}">
      <div class="card-emoji">${esc(ev.emoji)}</div>
      <div class="card-main">
        <p class="card-title">${esc(ev.title)}</p>
        <p class="card-sub" data-sub>${esc(fmtDate(ev, occ.target))}</p>
      </div>
      <div class="card-count"><b data-big></b><span data-unit></span></div>
    </button>`;
}

function computeLayoutKey(now) {
  return events.map((ev) => { const o = occurrence(ev, now); return ev.id + o.state + o.target.getTime(); }).join('|');
}

function tick() {
  const now = Date.now();
  if (computeLayoutKey(now) !== layoutKey) { render(); return; }

  const hero = $('#hero');
  if (!hero.hidden) {
    const ev = events.find((e) => e.id === hero.dataset.id);
    if (ev) {
      const occ = occurrence(ev, now);
      const p = diffParts(occ.target - now);
      const set = (k, v) => { const el = hero.querySelector(`[data-u="${k}"]`); if (el && el.textContent !== v) el.textContent = v; };
      set('d', fmtNum(p.d)); set('h', pad(p.h)); set('m', pad(p.m)); set('s', pad(p.s));
      const dl = hero.querySelector('[data-l="d"]');
      if (dl) dl.textContent = plural(p.d, 'Tag', 'Tage');
      const pr = progress(ev, occ, now);
      hero.querySelector('[data-bar]').style.width = `${(pr * 100).toFixed(2)}%`;
      hero.querySelector('[data-rel]').textContent = relText(ev, occ, now);
      hero.querySelector('[data-pct]').textContent = `${Math.floor(pr * 100)} %`;
    }
  }

  document.querySelectorAll('.card').forEach((card) => {
    const ev = events.find((e) => e.id === card.dataset.id);
    if (!ev) return;
    const occ = occurrence(ev, now);
    const big = card.querySelector('[data-big]');
    const unit = card.querySelector('[data-unit]');
    let b, u;
    if (occ.state === 'now') { b = ev.allday ? 'Heute' : 'Jetzt'; u = '🎉'; }
    else if (occ.state === 'past') { const d = Math.floor((now - occ.target) / DAY); b = fmtNum(d); u = `${plural(d, 'Tag', 'Tage')} her`; }
    else {
      const p = diffParts(occ.target - now);
      if (p.d > 0) { b = fmtNum(p.d); u = plural(p.d, 'Tag', 'Tage'); }
      else if (p.h > 0) { b = `${p.h}:${pad(p.m)}`; u = 'Std'; }
      else { b = settings.showSeconds ? `${p.m}:${pad(p.s)}` : String(p.m); u = 'Min'; }
    }
    if (big.textContent !== b) big.textContent = b;
    if (unit.textContent !== u) unit.textContent = u;
    card.style.setProperty('--p', `${(progress(ev, occ, now) * 100).toFixed(2)}%`);
  });

  if (openId) tickDetail(now);
}

/* ---------- detail ---------- */

const RING_R = 140;
const RING_C = 2 * Math.PI * RING_R;

function renderDetail() {
  const ev = events.find((e) => e.id === openId);
  if (!ev) { closeDetail(); return; }
  const occ = occurrence(ev);
  const d = $('#detail');
  d.setAttribute('style', gradient(ev.color));
  d.classList.toggle('celebrate', occ.state === 'now');
  $('#detail-body').innerHTML = `
    <div class="d-emoji">${esc(ev.emoji)}</div>
    <h2 class="d-title">${esc(ev.title)}</h2>
    <p class="d-date">${esc(fmtDate(ev, occ.target))}${ev.yearly ? ' · jährlich' : ''}</p>
    <div class="ring">
      <svg viewBox="0 0 300 300"><circle class="track" cx="150" cy="150" r="${RING_R}"/><circle class="prog" data-ring cx="150" cy="150" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>
      <div class="ring-center"><b data-rb></b><span data-rs></span><small data-rsm></small></div>
    </div>
    <div class="facts">
      <div class="fact"><b data-f="nights"></b><span>Mal schlafen</span></div>
      <div class="fact"><b data-f="weeks"></b><span>Wochen</span></div>
      <div class="fact"><b data-f="hours"></b><span>Stunden</span></div>
      <div class="fact"><b data-f="beats"></b><span>Herzschläge ❤️</span></div>
    </div>
    ${ev.note ? `<p class="d-note">${esc(ev.note)}</p>` : ''}
    <div class="d-buttons">
      <button id="d-ics"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>In Kalender</button>
      <button class="ghost" id="d-notify"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>${ev.reminders?.length ? `${ev.reminders.length} Erinnerung${ev.reminders.length > 1 ? 'en' : ''}` : 'Erinnern'}</button>
    </div>`;
  $('#d-ics').onclick = () => downloadICS([ev], ev.title);
  $('#d-notify').onclick = () => openEditor(ev);
  tickDetail(Date.now());
  if (occ.state === 'now' && !d.dataset.confetti) { d.dataset.confetti = '1'; confetti(); }
}

function tickDetail(now) {
  const ev = events.find((e) => e.id === openId);
  if (!ev) return;
  const occ = occurrence(ev, now);
  const p = diffParts(occ.target - now);
  const body = $('#detail-body');
  const set = (sel, v) => { const el = body.querySelector(sel); if (el && el.textContent !== v) el.textContent = v; };
  let rb, rs, rsm;
  if (occ.state === 'now') { rb = '🎉'; rs = ev.allday ? 'Heute!' : 'Jetzt!'; rsm = ''; }
  else if (occ.state === 'past') { const d = Math.floor((now - occ.target) / DAY); rb = fmtNum(d); rs = `${plural(d, 'Tag', 'Tage')} her`; rsm = ''; }
  else if (p.d > 0) { rb = fmtNum(p.d); rs = plural(p.d, 'Tag', 'Tage'); rsm = `${pad(p.h)}:${pad(p.m)}${settings.showSeconds ? ':' + pad(p.s) : ''}`; }
  else if (p.h > 0) { rb = String(p.h); rs = 'Stunden'; rsm = `${pad(p.m)}:${pad(p.s)}`; }
  else { rb = String(p.m); rs = 'Minuten'; rsm = `${pad(p.s)} Sek`; }
  set('[data-rb]', rb); set('[data-rs]', rs); set('[data-rsm]', rsm);
  const ring = body.querySelector('[data-ring]');
  if (ring) ring.setAttribute('stroke-dashoffset', String(RING_C * (1 - progress(ev, occ, now))));
  const future = occ.state === 'future';
  set('[data-f="nights"]', future ? fmtNum(Math.max(0, nightsUntil(occ.target))) : '0');
  set('[data-f="weeks"]', future ? (p.total / (7 * DAY)).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '0');
  set('[data-f="hours"]', future ? fmtNum(Math.floor(p.total / 3600000)) : '0');
  set('[data-f="beats"]', future ? fmtNum(Math.floor((p.total / 60000) * 72)) : '0');
}

function openDetail(id) {
  openId = id;
  const d = $('#detail');
  delete d.dataset.confetti;
  d.hidden = false;
  d.scrollTop = 0;
  renderDetail();
  if (location.hash !== `#e=${id}`) history.pushState({ detail: id }, '', `#e=${id}`);
}

function closeDetail(fromPop) {
  openId = null;
  $('#detail').hidden = true;
  if (!fromPop && location.hash.startsWith('#e=')) history.back();
}

function confetti() {
  const colors = ['#fff', '#fde047', '#f472b6', '#a78bfa', '#34d399', '#60a5fa'];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = `${2.5 + Math.random() * 2.5}s`;
    c.style.animationDelay = `${Math.random() * 0.8}s`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 6000);
  }
  navigator.vibrate?.([30, 50, 30]);
}

/* ================= editor ================= */

function tomorrow() { const d = new Date(Date.now() + DAY); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function openEditor(ev) {
  editing = ev
    ? JSON.parse(JSON.stringify(ev))
    : { id: null, title: '', emoji: '🎉', date: tomorrow(), time: '20:00', allday: true, yearly: false, color: Object.keys(GRADIENTS)[Math.floor(Math.random() * 4)], reminders: [-540], note: '' };
  $('#form-title').textContent = ev ? 'Bearbeiten' : 'Neues Event';
  $('#f-title').value = editing.title;
  $('#f-date').value = editing.date;
  $('#f-time').value = editing.time || '20:00';
  $('#f-allday').checked = editing.allday;
  $('#f-yearly').checked = editing.yearly;
  $('#f-note').value = editing.note || '';
  $('#btn-delete').hidden = !ev;
  syncEditor();
  openSheet('#sheet');
  if (!ev) setTimeout(() => $('#f-title').focus(), 350);
}

function syncEditor() {
  $('#preview').setAttribute('style', gradient(editing.color));
  $('#emoji-btn').textContent = editing.emoji;
  $('#time-row').hidden = editing.allday;

  const inList = EMOJIS.includes(editing.emoji);
  $('#emoji-row').innerHTML =
    (inList ? '' : `<button type="button" class="on" data-emoji="${esc(editing.emoji)}">${esc(editing.emoji)}</button>`) +
    EMOJIS.map((e) => `<button type="button" data-emoji="${e}" class="${e === editing.emoji ? 'on' : ''}">${e}</button>`).join('') +
    `<button type="button" class="custom" data-emoji-custom>Eigenes</button>`;

  $('#colors').innerHTML = Object.keys(GRADIENTS)
    .map((c) => `<button type="button" aria-label="${c}" data-color="${c}" class="${c === editing.color ? 'on' : ''}" style="${gradient(c)}"></button>`).join('');

  const opts = editing.allday ? REMINDERS_ALLDAY : REMINDERS_TIMED;
  $('#reminders').innerHTML = opts
    .map(([v, l]) => `<button type="button" data-rem="${v}" class="${editing.reminders.includes(v) ? 'on' : ''}">${l}</button>`).join('');

  const perm = notifPermission();
  $('#notif-hint').innerHTML =
    perm === 'unsupported' ? 'Benachrichtigungen gehen hier erst, wenn die App zum Home-Bildschirm hinzugefügt wurde. Alternativ: „In Kalender“.'
    : perm === 'denied' ? 'Benachrichtigungen sind blockiert – in den Systemeinstellungen erlauben.'
    : editing.reminders.length ? 'Tipp: Für zuverlässige Erinnerungen bei geschlossener App zusätzlich „In Kalender“ nutzen.' : '';
}

function readForm() {
  editing.title = $('#f-title').value.trim();
  editing.date = $('#f-date').value;
  editing.time = $('#f-time').value || '00:00';
  editing.note = $('#f-note').value.trim();
}

/* ================= sheets ================= */

function openSheet(sel) {
  const s = $(sel);
  s.classList.remove('closing');
  s.hidden = false;
}
function closeSheet(sel) {
  const s = $(sel);
  if (s.hidden) return;
  s.classList.add('closing');
  setTimeout(() => { s.hidden = true; s.classList.remove('closing'); }, 240);
}

/* ================= notifications ================= */

function notifPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission; // default | granted | denied
}

async function askNotifications() {
  const p = notifPermission();
  if (p === 'unsupported') { toast('Erst zum Home-Bildschirm hinzufügen 📲'); return false; }
  if (p === 'granted') return true;
  const res = await Notification.requestPermission();
  updateSettingsUI();
  if (res === 'granted') { toast('Benachrichtigungen aktiv 🔔'); scheduleAll(); return true; }
  toast('Benachrichtigungen nicht erlaubt');
  return false;
}

async function notify(title, body, tag, id) {
  if (notifPermission() !== 'granted') return;
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: id ? `./#e=${id}` : './' }, vibrate: [80, 40, 80] };
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, opts);
  } catch {
    try { new Notification(title, opts); } catch {}
  }
}

function reminderTimes(ev, now = Date.now()) {
  const occ = occurrence(ev, now);
  if (occ.state === 'past') return [];
  return (ev.reminders || []).map((off) => ({ at: occ.target.getTime() - off * 60000, off, key: `${ev.id}:${occ.target.getTime()}:${off}` }));
}

function reminderBody(ev) {
  const occ = occurrence(ev);
  return `${relText(ev, occ)} · ${fmtDate(ev, occ.target)}`;
}

async function scheduleAll() {
  timers.forEach(clearTimeout);
  timers.clear();
  if (notifPermission() !== 'granted') return;
  const now = Date.now();
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const canTrigger = reg && 'showTrigger' in Notification.prototype && 'TimestampTrigger' in window;

  for (const ev of events) {
    for (const r of reminderTimes(ev, now)) {
      if (fired[r.key]) continue;
      const delay = r.at - now;
      const title = `${ev.emoji} ${ev.title}`;
      if (delay <= 0) {
        // Missed while the app was closed: deliver late, but only if it is still relevant (< 6 h).
        if (delay > -6 * 3600000) { markFired(r.key); notify(title, reminderBody(ev), r.key, ev.id); }
        continue;
      }
      if (canTrigger) {
        // Experimental (Chromium): lets the OS deliver even when the app is closed.
        try { reg.showNotification(title, { body: fmtDate(ev, occurrence(ev).target), tag: r.key, icon: 'icons/icon-192.png', data: { url: `./#e=${ev.id}` }, showTrigger: new TimestampTrigger(r.at) }); } catch {}
      }
      if (delay < 2147483647) {
        timers.set(r.key, setTimeout(() => {
          if (fired[r.key]) return;
          markFired(r.key);
          notify(title, reminderBody(ev), r.key, ev.id);
        }, delay));
      }
    }
  }
}

function markFired(key) {
  fired[key] = Date.now();
  // prune entries older than 60 days
  const cutoff = Date.now() - 60 * DAY;
  for (const k in fired) if (fired[k] < cutoff) delete fired[k];
  save(FIRED_KEY, fired);
}

/* ================= calendar (.ics) ================= */

function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c); }
function icsDate(d, allday) {
  const base = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return allday ? base : `${base}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function buildICS(list) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Countdown//DE', 'CALSCALE:GREGORIAN'];
  for (const ev of list) {
    const occ = occurrence(ev);
    const start = ev.yearly ? occ.target : startOf(ev);
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@countdown`, `DTSTAMP:${stamp}`);
    if (ev.allday) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(start, true)}`, `DTEND;VALUE=DATE:${icsDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1), true)}`);
    } else {
      lines.push(`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(new Date(start.getTime() + 3600000))}`);
    }
    lines.push(`SUMMARY:${icsEscape(`${ev.emoji} ${ev.title}`)}`);
    if (ev.note) lines.push(`DESCRIPTION:${icsEscape(ev.note)}`);
    if (ev.yearly) lines.push('RRULE:FREQ=YEARLY');
    for (const off of ev.reminders || []) {
      const trig = off >= 0 ? `-PT${off}M` : `PT${-off}M`;
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(ev.title)}`, `TRIGGER:${trig}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadICS(list, name) {
  if (!list.length) { toast('Keine Events vorhanden'); return; }
  const ics = buildICS(list);
  const file = (name || 'countdowns').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim() || 'countdown';
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    // iOS opens text/calendar data directly in the "Add to Calendar" dialog.
    location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    return;
  }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${file}.ics` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ================= backup ================= */

function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'countdown', version: 1, events }, null, 2)], { type: 'application/json' });
  const file = new File([blob], 'countdown-backup.json', { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file], title: 'Countdown Backup' }).catch(() => {}); return; }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'countdown-backup.json' });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importBackup(fileInput) {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.events;
    if (!Array.isArray(list)) throw new Error();
    const valid = list.filter((e) => e && typeof e.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    const ids = new Set(events.map((e) => e.id));
    let added = 0;
    for (const e of valid) {
      if (ids.has(e.id)) continue;
      events.push({ reminders: [], color: 'violet', emoji: '🎉', allday: true, yearly: false, note: '', created: Date.now(), ...e, id: e.id || uid() });
      added++;
    }
    persist();
    toast(`${added} Event${added === 1 ? '' : 's'} importiert`);
  } catch {
    toast('Datei konnte nicht gelesen werden');
  }
}

/* ================= misc ================= */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function persist() {
  save(STORE_KEY, events);
  render();
  scheduleAll();
}

function updateSettingsUI() {
  const p = notifPermission();
  const label = { granted: 'Aktiv 🔔', denied: 'Blockiert', default: 'Aus', unsupported: 'Nur als installierte App' }[p];
  $('#notif-status').textContent = `Status: ${label}`;
  const btn = $('#btn-notif');
  btn.hidden = p === 'granted';
  btn.disabled = p === 'denied';
  btn.textContent = p === 'unsupported' ? 'Info' : 'Aktivieren';
  $('#btn-test').disabled = p !== 'granted';
  $('#s-past').checked = settings.showPast;
  $('#s-seconds').checked = settings.showSeconds;
}

async function shareEvent(ev) {
  const occ = occurrence(ev);
  const text = `${ev.emoji} ${ev.title}: ${relText(ev, occ)} (${fmtDate(ev, occ.target)})`;
  if (navigator.share) { navigator.share({ title: ev.title, text }).catch(() => {}); return; }
  try { await navigator.clipboard.writeText(text); toast('In Zwischenablage kopiert'); } catch { toast(text); }
}

function updateToday() {
  $('#today').textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

/* ================= wiring ================= */

function bind() {
  $('#btn-add').onclick = () => openEditor(null);
  $('#hero').onclick = () => openDetail($('#hero').dataset.id);
  $('#list').onclick = (e) => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); };
  $('#detail-close').onclick = () => closeDetail();
  $('#detail-edit').onclick = () => openEditor(events.find((e) => e.id === openId));
  $('#detail-share').onclick = () => shareEvent(events.find((e) => e.id === openId));
  $('#install-hint-close').onclick = () => { settings.hideInstall = true; save(SETTINGS_KEY, settings); render(); };

  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => closeSheet(`#${el.closest('.sheet-wrap').id}`)));

  // editor interactions
  $('#emoji-row').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-emoji-custom')) { customEmoji(); return; }
    readForm(); editing.emoji = b.dataset.emoji; syncEditor();
  };
  $('#emoji-btn').onclick = customEmoji;
  $('#colors').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; readForm(); editing.color = b.dataset.color; syncEditor(); };
  $('#reminders').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    readForm();
    const v = Number(b.dataset.rem);
    if (editing.reminders.includes(v)) editing.reminders = editing.reminders.filter((x) => x !== v);
    else { editing.reminders.push(v); if (notifPermission() === 'default') await askNotifications(); }
    syncEditor();
  };
  $('#f-allday').onchange = (e) => {
    readForm();
    editing.allday = e.target.checked;
    editing.reminders = editing.allday ? [-540] : [60];
    syncEditor();
  };
  $('#f-yearly').onchange = (e) => { editing.yearly = e.target.checked; };

  $('#form').onsubmit = (e) => {
    e.preventDefault();
    readForm();
    if (!editing.title) { toast('Gib dem Event einen Namen'); $('#f-title').focus(); return; }
    if (!editing.date) { toast('Bitte ein Datum wählen'); return; }
    const isNew = !editing.id;
    if (!isNew) {
      const i = events.findIndex((x) => x.id === editing.id);
      if (i >= 0) events[i] = { ...events[i], ...editing };
    } else {
      editing.id = uid();
      editing.created = Date.now();
      events.push(editing);
    }
    persist();
    closeSheet('#sheet');
    toast(isNew ? 'Countdown gestartet 🚀' : 'Gespeichert');
    if (openId) renderDetail();
  };

  $('#btn-delete').onclick = () => {
    if (!editing?.id || !confirm(`„${editing.title || 'Event'}“ wirklich löschen?`)) return;
    events = events.filter((x) => x.id !== editing.id);
    persist();
    closeSheet('#sheet');
    if (openId === editing.id) closeDetail();
    toast('Gelöscht');
  };

  // settings
  $('#btn-settings').onclick = () => { updateSettingsUI(); openSheet('#settings'); };
  $('#btn-notif').onclick = async () => {
    if (notifPermission() === 'unsupported') { toast('Erst zum Home-Bildschirm hinzufügen 📲'); return; }
    await askNotifications();
    updateSettingsUI();
  };
  $('#btn-test').onclick = () => notify('⏳ Countdown', 'So sehen deine Erinnerungen aus!', 'test');
  $('#s-past').onchange = (e) => { settings.showPast = e.target.checked; save(SETTINGS_KEY, settings); render(); };
  $('#s-seconds').onchange = (e) => { settings.showSeconds = e.target.checked; save(SETTINGS_KEY, settings); render(); };
  $('#btn-ics-all').onclick = () => downloadICS(events.filter((ev) => occurrence(ev).state !== 'past'), 'countdowns');
  $('#btn-export').onclick = exportBackup;
  $('#f-import').onchange = (e) => importBackup(e.target);

  window.addEventListener('popstate', () => {
    const m = location.hash.match(/^#e=(.+)$/);
    if (m && events.some((e) => e.id === m[1])) { openId = m[1]; $('#detail').hidden = false; renderDetail(); }
    else if (openId) closeDetail(true);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { updateToday(); render(); scheduleAll(); }
  });
}

function customEmoji() {
  const v = prompt('Emoji eingeben:', editing.emoji);
  if (!v) return;
  const text = v.trim();
  const first = Intl.Segmenter ? [...new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(text)][0]?.segment : [...text][0];
  readForm();
  editing.emoji = first || '🎉';
  syncEditor();
}

/* ================= boot ================= */

bind();
updateToday();
render();

// Align ticks to the full second so all counters flip together.
setTimeout(function loop() { tick(); setTimeout(loop, 1000 - (Date.now() % 1000) + 5); }, 1000 - (Date.now() % 1000) + 5);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => scheduleAll()).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.open) openDetail(e.data.open); });
}

const deep = location.hash.match(/^#e=(.+)$/);
if (deep && events.some((e) => e.id === deep[1])) {
  history.replaceState(null, '', location.pathname);
  openDetail(deep[1]);
}
