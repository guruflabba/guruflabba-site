import { CONFIG } from './config.js';
import { pixelIcon } from './pixels.js';
import * as fx from './fx.js';
import { initBroadcast } from './broadcast.js';
import { initLatest } from './latest.js';

const $ = (sel) => document.querySelector(sel);

document.documentElement.classList.add('js');

// Links go first: whatever else fails, the link tree has to work.
const menu = $('#menu');
renderLinks();

const sound = fx.createSound();
const subliminal = $('#subliminal');
let space = null;
let isLive = false;

function safely(name, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn(`[${name}]`, err);
    return undefined;
  }
}

function renderLinks() {
  const frag = document.createDocumentFragment();
  CONFIG.links.forEach((link, i) => {
    const handle = link.url.replace(/^https?:\/\/(www\.)?/, '');
    const a = document.createElement('a');
    a.className = 'menu-item';
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.setProperty('--brand', link.brand);
    a.style.setProperty('--brand-ink', link.ink);
    a.setAttribute('aria-label', `${link.label}, ${handle} (opens in a new tab)`);
    a.innerHTML = `
      <span class="mi-cursor" aria-hidden="true"><i class="tri"></i></span>
      <span class="mi-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
      <span class="mi-icon">${pixelIcon(link.id)}</span>
      <span class="mi-text"><span class="mi-label"></span><span class="mi-handle"></span></span>
      <span class="mi-go" aria-hidden="true"><i class="tri"></i><i class="tri"></i></span>`;
    a.querySelector('.mi-label').textContent = link.label;
    a.querySelector('.mi-handle').textContent = handle;
    const li = document.createElement('li');
    li.append(a);
    frag.append(li);
  });
  menu.append(frag);
}

function wireLinks() {
  const items = [...menu.querySelectorAll('.menu-item')];
  items[0]?.classList.add('is-selected');
  let active = null;

  items.forEach((a, i) => {
    const link = CONFIG.links[i];
    const label = a.querySelector('.mi-label');
    const enter = () => {
      if (active === a) return;
      active = a;
      items.forEach((other) => other.classList.toggle('is-selected', other === a));
      fx.scramble(label, link.label);
      sound.play('hover');
      space?.setAccent(link.brand);
      space?.setBoost(1);
    };
    const leave = () => {
      if (active !== a) return;
      active = null;
      space?.setAccent(null);
      space?.setBoost(0);
    };
    a.addEventListener('pointerenter', enter);
    a.addEventListener('focus', enter);
    a.addEventListener('pointerleave', leave);
    a.addEventListener('blur', leave);
    a.addEventListener('click', () => {
      sound.play('select');
      space?.glitch(0.9);
      fx.domGlitch();
    });
  });

  menu.addEventListener('keydown', (e) => {
    const idx = items.indexOf(document.activeElement);
    if (idx < 0) return;
    const moves = {
      ArrowDown: (idx + 1) % items.length,
      ArrowUp: (idx - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    items[moves[e.key]].focus();
  });
}

function runBoot() {
  const boot = $('#boot');
  let skip = fx.reducedMotion;
  try { skip ||= sessionStorage.getItem('gf-booted') === '1'; } catch { /* storage blocked */ }

  if (skip) {
    boot.remove();
    document.body.classList.remove('is-booting');
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { sessionStorage.setItem('gf-booted', '1'); } catch { /* storage blocked */ }
      window.removeEventListener('keydown', finish);
      sound.play('start');
      boot.classList.add('is-leaving');
      document.body.classList.remove('is-booting');
      setTimeout(() => boot.remove(), 700);
      resolve(true);
    };
    setTimeout(finish, 1900);
    boot.addEventListener('pointerdown', finish);
    window.addEventListener('keydown', finish);
  });
}

function cheatMode() {
  sound.play('cheat');
  space?.hyperspace(9);
  fx.flashWord(subliminal, 'CHEAT MODE', 650);
  document.body.classList.add('is-hyper');
  clearTimeout(cheatMode.t);
  cheatMode.t = setTimeout(() => document.body.classList.remove('is-hyper'), 9000);
}

async function initSpace(booted) {
  const stage = $('#title-stage');
  try {
    const { createSpace } = await import('./space.js');
    space = createSpace($('#space'), {
      reducedMotion: fx.reducedMotion,
      anchors: { title: stage, planet: $('#on-air'), eye: $('#eye-space') },
    });
  } catch (err) {
    console.warn('[space] 3D scene unavailable', err);
  }

  if (!space) {
    document.documentElement.classList.add('no-webgl');
    return;
  }

  space.onTitleSize = (px) => stage.style.setProperty('--title-h', `${Math.round(px + 30)}px`);
  space.layout();
  space.setLive(isLive);
  space.start();
  booted.then((played) => { if (played) space.replayIntro(); });

  new ResizeObserver(() => space.refreshAnchors()).observe($('#main'));

  let taps = [];
  stage.addEventListener('click', () => {
    space.explode();
    space.glitch(0.7);
    sound.play('boom');
    const now = performance.now();
    taps = taps.filter((t) => now - t < 2500);
    taps.push(now);
    if (taps.length >= 5) {
      taps = [];
      cheatMode();
    }
  });
}

// ---------------------------------------------------------------- go

safely('links', wireLinks);
safely('year', () => { $('#year').textContent = new Date().getFullYear(); });

const booted = runBoot();
initSpace(booted);

const osd = safely('osd', fx.initOSD);

safely('sound', () => {
  const btn = $('#snd');
  const sync = () => {
    btn.setAttribute('aria-pressed', String(sound.enabled));
    btn.querySelector('span').textContent = sound.enabled ? 'ON' : 'OFF';
  };
  sync();
  btn.addEventListener('click', () => {
    sound.toggle();
    sync();
    sound.play('select');
  });
});

safely('broadcast', () => {
  const tvStatic = fx.createStatic($('#tv-static'));
  tvStatic.start();
  initBroadcast({
    onState(state) {
      isLive = state === 'live';
      if (state !== 'tuning') tvStatic.stop();
      space?.setLive(isLive);
      space?.staticBurst(0.4);
    },
  });
});

safely('latest', () => {
  const vcrStatic = fx.createStatic($('#vcr-static'));
  vcrStatic.start();
  initLatest({
    staticFx: vcrStatic,
    onPlay() {
      sound.play('select');
      space?.glitch(0.8);
    },
  }).catch((err) => console.warn('[latest]', err));
});

safely('rewind', () => {
  $('#rewind').addEventListener('click', () => {
    sound.play('rewind');
    osd?.rewind();
    space?.glitch(1);
    space?.staticBurst(0.3);
    fx.domGlitch();
    window.scrollTo({ top: 0, behavior: fx.reducedMotion ? 'auto' : 'smooth' });
  });
});

safely('konami', () => fx.onKonami(cheatMode));

booted.then(() => {
  safely('tagline', () => fx.typeLines($('#tagline'), CONFIG.taglines));
  safely('panels', () => fx.powerOnPanels([...document.querySelectorAll('.panel')]));
  safely('channels', () => fx.initChannels([...document.querySelectorAll('[data-channel]')], (el, first) => {
    if (first) return;
    sound.play('channel');
    space?.staticBurst(0.3);
    space?.glitch(0.45);
  }));
  safely('subliminal', () => fx.initSubliminal(subliminal, CONFIG.subliminal));
});
