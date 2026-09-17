// DOM-side effects: VCR on-screen display, channel changes, subliminal frames,
// text scrambling, chiptune blips, TV static and the Konami code.

export let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// For broadcast graphics (e.g. a BRB screen captured into a stream), where the
// viewer is watching the stream rather than this browser.
export function forceMotion() {
  reducedMotion = false;
  document.documentElement.classList.add('force-motion');
}

const pad = (n) => String(n).padStart(2, '0');
const tri = (rev = false) => `<i class="tri${rev ? ' rev' : ''}"></i>`;

// ---------------------------------------------------------------- text

const NOISE_CHARS = '#$%&*+=?/\\<>|!01';

export function scramble(el, text, duration = 380) {
  if (reducedMotion) {
    el.textContent = text;
    return;
  }
  cancelAnimationFrame(el._scrambleRaf);
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const locked = Math.floor(p * text.length);
    let out = '';
    for (let i = 0; i < text.length; i++) {
      out += i < locked || text[i] === ' ' ? text[i] : NOISE_CHARS[(Math.random() * NOISE_CHARS.length) | 0];
    }
    el.textContent = out;
    if (p < 1) el._scrambleRaf = requestAnimationFrame(step);
  };
  el._scrambleRaf = requestAnimationFrame(step);
}

export function typeLines(el, lines) {
  if (!lines.length) return;
  if (reducedMotion) {
    el.textContent = lines[0];
    return;
  }
  let li = 0;
  let ci = 0;
  let deleting = false;
  const step = () => {
    const line = lines[li];
    if (!deleting) {
      ci++;
      el.textContent = line.slice(0, ci);
      if (ci >= line.length) {
        deleting = true;
        return setTimeout(step, 1900);
      }
      return setTimeout(step, 45 + Math.random() * 70);
    }
    ci--;
    el.textContent = line.slice(0, ci);
    if (ci <= 0) {
      deleting = false;
      li = (li + 1) % lines.length;
      return setTimeout(step, 380);
    }
    return setTimeout(step, 22);
  };
  step();
}

// ---------------------------------------------------------------- sound

export function createSound({ enabled: forced } = {}) {
  let ctx = null;
  let enabled = false;
  try { enabled = localStorage.getItem('gf-sound') === 'on'; } catch { /* storage blocked */ }
  if (forced !== undefined) enabled = forced;

  const audio = () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };

  const tone = (freq, dur, { type = 'square', vol = 0.04, when = 0, slide = 0 } = {}) => {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  };

  const hiss = (dur, vol = 0.05) => {
    const c = audio();
    if (!c) return;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    src.buffer = buf;
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    gain.gain.setValueAtTime(vol, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start();
  };

  const sfx = {
    hover: () => tone(1480, 0.035, { vol: 0.025 }),
    select: () => [660, 990, 1320].forEach((f, i) => tone(f, 0.07, { when: i * 0.055 })),
    channel: () => hiss(0.14),
    start: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1, { when: i * 0.075, vol: 0.045 })),
    boom: () => { tone(180, 0.25, { slide: 0.3, vol: 0.06 }); hiss(0.2, 0.04); },
    cheat: () => [392, 523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.08, { when: i * 0.06 })),
    rewind: () => tone(2200, 0.55, { type: 'sawtooth', slide: 0.15, vol: 0.02 }),
  };

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('gf-sound', enabled ? 'on' : 'off'); } catch { /* storage blocked */ }
      if (enabled) audio();
      return enabled;
    },
    play(name) {
      if (enabled) sfx[name]?.();
    },
  };
}

// ---------------------------------------------------------------- OSD

export function initOSD() {
  const mode = document.getElementById('osd-mode');
  const counter = document.getElementById('osd-counter');
  const date = document.getElementById('osd-date');
  const clock = document.getElementById('osd-clock');
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const started = performance.now();

  const tick = () => {
    const d = new Date();
    date.textContent = `${MONTHS[d.getMonth()]}.${pad(d.getDate())} ${d.getFullYear()}`;
    const h = d.getHours();
    clock.textContent = `${h >= 12 ? 'PM' : 'AM'} ${h % 12 || 12}:${pad(d.getMinutes())}`;
    const s = Math.floor((performance.now() - started) / 1000);
    counter.textContent = `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  };
  tick();
  setInterval(tick, 1000);

  const PLAY = `PLAY ${tri()}`;
  let current = PLAY;
  let lastY = window.scrollY;
  let idle = 0;
  const set = (html) => {
    if (html === current) return;
    current = html;
    mode.innerHTML = html;
  };

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const dy = y - lastY;
    lastY = y;
    if (Math.abs(dy) < 3) return;
    set(dy > 0 ? `${tri()}${tri()} FF` : `${tri(true)}${tri(true)} REW`);
    clearTimeout(idle);
    idle = setTimeout(() => set(PLAY), 240);
  }, { passive: true });

  return {
    rewind() {
      set(`${tri(true)}${tri(true)} REW`);
      clearTimeout(idle);
      idle = setTimeout(() => set(PLAY), 1400);
    },
  };
}

export function initChannels(sections, onChange) {
  const chLabel = document.getElementById('osd-ch');
  const pop = document.getElementById('osd-channel');
  const popNum = pop.querySelector('.osd-channel-num');
  const popName = pop.querySelector('.osd-channel-name');
  let current = null;
  let first = true;

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.target === current) continue;
      current = entry.target;
      const { channel, channelName } = current.dataset;
      chLabel.textContent = `CH ${channel}`;
      if (!first) {
        popNum.textContent = `CH ${channel}`;
        popName.textContent = channelName;
        pop.classList.remove('show');
        void pop.offsetWidth;
        pop.classList.add('show');
      }
      onChange(current, first);
      first = false;
    }
  }, { rootMargin: '-48% 0px -48% 0px' });

  sections.forEach((s) => io.observe(s));
}

export function powerOnPanels(panels) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-on');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  panels.forEach((p) => io.observe(p));
}

export function domGlitch() {
  if (reducedMotion) return;
  document.body.classList.remove('is-glitching');
  void document.body.offsetWidth;
  document.body.classList.add('is-glitching');
  clearTimeout(domGlitch.t);
  domGlitch.t = setTimeout(() => document.body.classList.remove('is-glitching'), 320);
}

// ---------------------------------------------------------------- subliminal

export function flashWord(el, word, ms = 70) {
  el.textContent = word;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), ms);
}

export function initSubliminal(el, words) {
  if (reducedMotion || !words.length) return;
  const queue = () => setTimeout(fire, 9000 + Math.random() * 13000);
  const fire = () => {
    if (!document.hidden) flashWord(el, words[(Math.random() * words.length) | 0], 50 + Math.random() * 40);
    queue();
  };
  queue();
}

// ---------------------------------------------------------------- konami

export function onKonami(callback) {
  const seq = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let i = 0;
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === seq[i]) i++;
    else if (key === 'arrowup') i = i === 2 ? 2 : 1;
    else i = 0;
    if (i === seq.length) {
      i = 0;
      callback();
    }
  });
}

// ---------------------------------------------------------------- static

export function createStatic(canvas, { width = 160, height = 90 } = {}) {
  const ctx = canvas.getContext('2d');
  canvas.width = width;
  canvas.height = height;
  const img = ctx.createImageData(width, height);
  const data = img.data;
  let running = false;
  let inView = true;
  let raf = 0;
  let last = 0;

  const draw = (now = 0) => {
    const band = (now / 14) % (height + 30) - 15;
    for (let y = 0; y < height; y++) {
      const lift = Math.abs(y - band) < 7 ? 70 : 0;
      const tear = Math.random() < 0.04 ? 40 : 0;
      for (let x = 0; x < width; x++) {
        const v = Math.min(255, ((Math.random() * 190) | 0) + lift + tear);
        const i = (y * width + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = Math.min(255, v + 18);
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 55) return;
    last = now;
    draw(now);
  };

  const sync = () => {
    cancelAnimationFrame(raf);
    if (running && inView && !reducedMotion) raf = requestAnimationFrame(loop);
  };

  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  }).observe(canvas);

  draw();
  return {
    start() { running = true; sync(); },
    stop() { running = false; sync(); },
  };
}
