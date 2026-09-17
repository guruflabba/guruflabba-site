import { CONFIG } from './config.js';

// Twitch live detection + the "off air" schedule shown when not live.
//
// Live status comes from two places:
//  1. the Twitch embed player's ONLINE / OFFLINE events (authoritative, real time)
//  2. decapi.me, a free no-auth uptime endpoint, which answers faster on first
//     load and covers cases where the embed can't load (e.g. opened from file://)

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const formatters = new Map();

function zoneParts(date, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  const p = {};
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  return {
    y: +p.year, m: +p.month - 1, d: +p.day,
    h: +p.hour % 24, mi: +p.minute, s: +p.second,
    dow: DAYS.indexOf(p.weekday.slice(0, 3).toUpperCase()),
  };
}

function zoneOffset(ms, tz) {
  const p = zoneParts(new Date(ms), tz);
  return Date.UTC(p.y, p.m, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// Wall-clock time in `tz` -> real instant.
function zonedToDate(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m, d, h, mi);
  let t = guess - zoneOffset(guess, tz);
  const corrected = guess - zoneOffset(t, tz);
  if (corrected !== t) t = corrected;
  return new Date(t);
}

// Next occurrence of every slot (or the one currently running), soonest first.
export function upcomingSlots(schedule, now = new Date()) {
  let tz = schedule?.timezone;
  try {
    zoneParts(now, tz);
  } catch {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  const today = zoneParts(now, tz);
  const out = [];

  for (const slot of schedule?.slots || []) {
    const dow = DAYS.indexOf(String(slot.day).slice(0, 3).toUpperCase());
    const [hh, mm = 0] = String(slot.start).split(':').map(Number);
    if (dow < 0 || Number.isNaN(hh)) continue;
    const ahead = (dow - today.dow + 7) % 7;
    for (const week of [-7, 0, 7]) {
      const day = new Date(Date.UTC(today.y, today.m, today.d + ahead + week));
      const start = zonedToDate(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm, tz);
      const end = new Date(start.getTime() + (slot.hours || 2) * 3600e3);
      if (end > now) {
        out.push({ ...slot, start, end, running: start <= now });
        break;
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- off-air view

function createOfflineView(root, twitchUrl) {
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const zoneName = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value || '';

  const unit = (label) => `<div class="cd-unit"><span class="cd-num" data-unit="${label}">00</span><span class="cd-lbl">${label}</span></div>`;
  root.innerHTML = `
    <div class="offair">
      <p class="offair-flag"><span class="glitch-text" data-text="OFF AIR">OFF AIR</span></p>
      <p class="offair-sub">NEXT TRANSMISSION IN</p>
      <div class="countdown" role="timer">
        ${unit('DAYS')}<span class="cd-sep">:</span>${unit('HRS')}<span class="cd-sep">:</span>${unit('MIN')}<span class="cd-sep">:</span>${unit('SEC')}
      </div>
      <ol class="guide"></ol>
      <p class="guide-note">TIMES SHOWN IN YOUR TIME ZONE${zoneName ? ` · ${zoneName.toUpperCase()}` : ''}</p>
      <a class="btn" href="${twitchUrl}" target="_blank" rel="noopener">FOLLOW FOR LIVE ALERTS</a>
    </div>`;

  const sub = root.querySelector('.offair-sub');
  const countdown = root.querySelector('.countdown');
  const guide = root.querySelector('.guide');
  const nums = Object.fromEntries([...root.querySelectorAll('.cd-num')].map((el) => [el.dataset.unit, el]));

  let slots = [];
  let renderedKey = '';

  const label = (date) => `${dayFmt.format(date)} ${timeFmt.format(date)}`.toUpperCase();

  function renderGuide() {
    const key = slots.map((s) => s.start.getTime()).join();
    if (key === renderedKey) return;
    renderedKey = key;
    guide.replaceChildren();

    if (!slots.length) {
      const li = document.createElement('li');
      li.className = 'guide-empty';
      li.textContent = 'SCHEDULE COMING SOON';
      guide.append(li);
      return;
    }

    slots.forEach((slot, i) => {
      const li = document.createElement('li');
      li.className = 'guide-row';
      if (i === 0) li.classList.add(slot.running ? 'is-soon' : 'is-next');
      const day = document.createElement('span');
      day.className = 'g-day';
      day.textContent = dayFmt.format(slot.start).toUpperCase();
      const time = document.createElement('span');
      time.className = 'g-time';
      time.textContent = timeFmt.format(slot.start).toUpperCase();
      const title = document.createElement('span');
      title.className = 'g-title';
      title.textContent = slot.title || 'STREAM';
      li.append(day, time, title);
      guide.append(li);
    });
  }

  function tick() {
    const now = new Date();
    if (!slots.length || slots[0].end <= now || now.getSeconds() === 0) {
      slots = upcomingSlots(CONFIG.schedule, now);
    }
    renderGuide();

    const next = slots[0];
    countdown.hidden = !next;
    if (!next) {
      sub.textContent = 'NO TRANSMISSIONS SCHEDULED';
      return;
    }
    if (next.running) {
      sub.textContent = 'SHOULD BE ON ANY MINUTE';
    } else {
      sub.textContent = 'NEXT TRANSMISSION IN';
    }
    let s = Math.max(0, Math.floor((next.start - now) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    nums.DAYS.textContent = String(Math.min(d, 99)).padStart(2, '0');
    nums.HRS.textContent = String(h).padStart(2, '0');
    nums.MIN.textContent = String(m).padStart(2, '0');
    nums.SEC.textContent = String(s).padStart(2, '0');
    countdown.setAttribute('aria-label', `Next stream ${label(next.start)}`);
  }

  let timer = 0;
  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, 1000);
    },
    stop() {
      clearInterval(timer);
      timer = 0;
    },
    summary() {
      const next = (slots.length ? slots : upcomingSlots(CONFIG.schedule))[0];
      return next ? `OFF AIR · NEXT ${label(next.start)}` : 'OFF AIR';
    },
  };
}

// ---------------------------------------------------------------- live status

async function askDecapi(channel) {
  try {
    const res = await fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(channel)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = (await res.text()).toLowerCase();
    if (text.includes('offline')) return false;
    if (/\d+\s*(second|minute|hour|day)/.test(text)) return true;
    return null;
  } catch {
    return null;
  }
}

export function initBroadcast({ onState } = {}) {
  const channel = CONFIG.twitch.channel;
  const twitchUrl = `https://www.twitch.tv/${channel}`;
  const tv = document.getElementById('tv');
  const status = document.getElementById('status');
  const statusText = status.querySelector('.status-text');
  const heading = document.getElementById('air-heading');
  const playerEl = document.getElementById('twitch-player');
  const offline = createOfflineView(document.getElementById('tv-offline'), twitchUrl);

  let state = 'tuning';
  let player = null;
  let playerHasSpoken = false;

  function apply(next) {
    if (next === state) return;
    state = next;
    tv.dataset.state = next;
    status.dataset.state = next;
    document.body.classList.toggle('is-live', next === 'live');

    if (next === 'live') {
      offline.stop();
      heading.textContent = 'LIVE NOW';
      statusText.textContent = 'LIVE NOW ON TWITCH';
      if (player) {
        try { player.play(); } catch { /* autoplay may be blocked; controls still work */ }
      } else {
        playerEl.innerHTML = `<div class="twitch-fallback"><p>WE ARE LIVE</p><a class="btn" href="${twitchUrl}" target="_blank" rel="noopener">WATCH ON TWITCH</a></div>`;
      }
    } else if (next === 'offline') {
      offline.start();
      heading.textContent = 'STREAM SCHEDULE';
      statusText.textContent = offline.summary();
    }
    onState?.(next);
  }

  // Twitch refuses to embed without a real hostname, so file:// can only use decapi.
  const host = window.location.hostname;
  if (host && window.Twitch?.Player) {
    try {
      player = new window.Twitch.Player(playerEl.id, {
        channel,
        parent: [host],
        width: '100%',
        height: '100%',
        autoplay: true,
        muted: true,
      });
      player.addEventListener(window.Twitch.Player.ONLINE, () => { playerHasSpoken = true; apply('live'); });
      player.addEventListener(window.Twitch.Player.OFFLINE, () => { playerHasSpoken = true; apply('offline'); });
    } catch {
      player = null;
    }
  }

  const check = async () => {
    const live = await askDecapi(channel);
    if (playerHasSpoken || live === null) return;
    apply(live ? 'live' : 'offline');
  };
  check();
  if (!player) setInterval(check, 120000);

  setTimeout(() => { if (state === 'tuning') apply('offline'); }, 9000);

  // keep the hero chip's "next stream" text fresh
  setInterval(() => { if (state === 'offline') statusText.textContent = offline.summary(); }, 60000);

  return { get state() { return state; } };
}
