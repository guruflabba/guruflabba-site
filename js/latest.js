import { CONFIG } from './config.js';

// Latest YouTube upload. YouTube's RSS feed has no CORS headers, so it's read
// through rss2json (free, no key). If that fails, the uploads playlist embed is
// used instead, which always starts on the newest video.

async function fetchLatest(channelId) {
  const feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`, { signal: ctrl.signal });
    const json = await res.json();
    const item = json?.status === 'ok' ? json.items?.[0] : null;
    if (!item) return null;
    const id = String(item.guid || '').replace('yt:video:', '') || (String(item.link).match(/(?:v=|shorts\/)([\w-]{11})/) || [])[1];
    if (!/^[\w-]{11}$/.test(id)) return null;
    return {
      id,
      title: item.title || 'UNTITLED',
      link: item.link || `https://www.youtube.com/watch?v=${id}`,
      published: item.pubDate ? new Date(`${item.pubDate.replace(' ', 'T')}Z`) : null,
      isShort: String(item.link).includes('/shorts/'),
    };
  } finally {
    clearTimeout(timer);
  }
}

function relativeTime(date) {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const secs = (date.getTime() - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (Math.abs(secs) >= size) return rtf.format(Math.trunc(secs / size), unit);
  }
  return 'just now';
}

// Draws the thumbnail into a tiny canvas and steps the resolution back up,
// like a tape finding its tracking.
function pixelResolver(img, canvas) {
  const ctx = canvas.getContext('2d');
  let timers = [];

  const drawAt = (w) => {
    const h = Math.max(1, Math.round((w * 9) / 16));
    canvas.width = w;
    canvas.height = h;
    const srcH = Math.min(img.naturalHeight, (img.naturalWidth * 9) / 16);
    const sy = (img.naturalHeight - srcH) / 2;
    ctx.drawImage(img, 0, sy, img.naturalWidth, srcH, 0, 0, w, h);
  };

  const clear = () => timers.forEach(clearTimeout);

  return {
    pixelate(w = 12) {
      if (!img.naturalWidth) return;
      clear();
      canvas.classList.remove('is-clear');
      drawAt(w);
    },
    resolve(from = 12) {
      if (!img.naturalWidth) return;
      clear();
      canvas.classList.remove('is-clear');
      const steps = [from, from * 2, from * 4, from * 8].filter((s) => s <= 160);
      timers = steps.map((w, i) => setTimeout(() => drawAt(w), i * 110));
      timers.push(setTimeout(() => canvas.classList.add('is-clear'), steps.length * 110));
    },
  };
}

export async function initLatest({ staticFx, onPlay } = {}) {
  const { channelId, url } = CONFIG.youtube;
  const vcr = document.getElementById('vcr');
  const screen = document.getElementById('vcr-screen');
  const titleEl = document.getElementById('vcr-title');
  const meta = document.getElementById('vcr-meta');
  const link = document.getElementById('vcr-link');

  let video = null;
  try {
    video = await fetchLatest(channelId);
  } catch {
    video = null;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vcr-play';
  button.innerHTML = `
    <span class="vcr-osd">STOP <i class="sq"></i></span>
    <span class="vcr-big" aria-hidden="true"><i class="tri"></i></span>`;
  const osd = button.querySelector('.vcr-osd');

  let resolver = null;

  if (video) {
    titleEl.textContent = video.title;
    titleEl.title = video.title;
    const bits = [];
    if (video.published && !Number.isNaN(video.published.getTime())) {
      bits.push(`REC ${relativeTime(video.published).toUpperCase()}`);
    }
    if (video.isShort) bits.push('SHORT');
    meta.textContent = bits.join(' · ');
    link.href = video.link;
    button.setAttribute('aria-label', `Play latest upload: ${video.title}`);

    const img = document.createElement('img');
    img.className = 'vcr-thumb';
    img.alt = '';
    img.decoding = 'async';
    img.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
    const canvas = document.createElement('canvas');
    canvas.className = 'vcr-pixels';
    button.prepend(img, canvas);
    if (video.isShort) {
      const badge = document.createElement('span');
      badge.className = 'vcr-badge';
      badge.textContent = 'SHORT';
      button.append(badge);
    }

    resolver = pixelResolver(img, canvas);
    img.addEventListener('load', () => {
      resolver.pixelate(12);
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        setTimeout(() => resolver.resolve(12), 250);
      }, { threshold: 0.5 });
      io.observe(screen);
    }, { once: true });

    let lastHover = 0;
    button.addEventListener('pointerenter', () => {
      const now = performance.now();
      if (now - lastHover < 1200) return;
      lastHover = now;
      resolver.resolve(24);
    });
  } else {
    titleEl.textContent = 'LATEST UPLOADS';
    meta.textContent = 'YOUTUBE';
    link.href = url;
    button.classList.add('is-empty');
    button.setAttribute('aria-label', 'Play latest uploads from YouTube');
  }

  screen.querySelector('.tv-msg')?.remove();
  screen.append(button);
  vcr.dataset.state = 'ready';
  if (video) staticFx?.stop();

  button.addEventListener('click', () => {
    onPlay?.();
    osd.innerHTML = 'PLAY <i class="tri"></i>';
    resolver?.pixelate(8);
    const src = video
      ? `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`
      : `https://www.youtube-nocookie.com/embed/videoseries?list=UU${channelId.slice(2)}&autoplay=1&rel=0&playsinline=1`;

    setTimeout(() => {
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.title = video ? video.title : 'Latest YouTube uploads';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      staticFx?.stop();
      screen.replaceChildren(iframe);
      vcr.dataset.state = 'playing';
      iframe.focus();
    }, 380);
  }, { once: true });
}
