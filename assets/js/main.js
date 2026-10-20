/* A Fera: um documentário sobre Guilherme Silva */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDesk = matchMedia('(min-width: 900px)').matches;
  const hasGsap = !!(window.gsap && window.ScrollTrigger);
  const pad = (n, l = 2) => String(n).padStart(l, '0');

  // Se algo essencial falhar, o site ainda abre.
  const loaderEl = $('.loader');
  const unlock = () => { document.body.classList.remove('is-loading'); loaderEl && loaderEl.classList.add('is-done'); };
  if (!hasGsap) { unlock(); return; }

  gsap.registerPlugin(ScrollTrigger);

  /* ---------- scroll suave ---------- */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.95 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }
  const scrollToY = (y) => (lenis ? lenis.scrollTo(y, { duration: 2.2 }) : window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' }));

  /* ---------- fita (quadros do vídeo) ---------- */
  const Film = {
    ready: false, count: 0, w: 0, h: 0, offsets: null, track: null,
    buf: null, loaded: 0, total: 0,
    cache: new Map(), pending: new Set(), max: isDesk ? 22 : 14, want: 0,
    onprogress: null, ondecoded: null,

    async init() {
      const meta = await fetch('assets/fera/fera.json').then((r) => r.json());
      const key = isDesk ? 'hd' : 'sd';
      const info = meta[key];
      Object.assign(this, { count: meta.count, w: info.w, h: info.h, offsets: info.offsets, track: meta.track });
      this.total = info.offsets[info.offsets.length - 1];
      this.buf = new Uint8Array(this.total);
      this.ready = true;
      this.stream(key).catch(() => {});
    },

    async stream(key) {
      const res = await fetch(`assets/fera/fera-${key}.bin`);
      if (!res.ok) throw new Error('fita');
      if (!res.body || !res.body.getReader) {
        const all = new Uint8Array(await res.arrayBuffer());
        this.buf.set(all.subarray(0, this.total));
        this.loaded = this.total;
        this.onprogress && this.onprogress();
        return;
      }
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const n = Math.min(value.length, this.total - this.loaded);
        if (n > 0) { this.buf.set(value.subarray(0, n), this.loaded); this.loaded += n; }
        this.onprogress && this.onprogress();
      }
    },

    framesLoaded() {
      if (!this.ready) return 0;
      let lo = 0, hi = this.count;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.offsets[m] <= this.loaded) lo = m; else hi = m - 1; }
      return lo;
    },

    has(i) { return this.ready && this.offsets[i + 1] <= this.loaded; },

    async decode(i) {
      if (i < 0 || i >= this.count || this.cache.has(i) || this.pending.has(i) || !this.has(i)) return;
      if (this.pending.size >= 3) return;
      this.pending.add(i);
      const blob = new Blob([this.buf.subarray(this.offsets[i], this.offsets[i + 1])], { type: 'image/webp' });
      let bmp = null;
      try {
        bmp = await createImageBitmap(blob);
      } catch (e) {
        bmp = await new Promise((ok) => {
          const im = new Image(); const u = URL.createObjectURL(blob);
          im.onload = () => { URL.revokeObjectURL(u); ok(im); };
          im.onerror = () => { URL.revokeObjectURL(u); ok(null); };
          im.src = u;
        });
      }
      this.pending.delete(i);
      if (!bmp) return;
      this.cache.set(i, bmp);
      while (this.cache.size > this.max) {
        let far = -1, fd = -1;
        for (const k of this.cache.keys()) { const d = Math.abs(k - this.want); if (d > fd) { fd = d; far = k; } }
        const old = this.cache.get(far); if (old && old.close) old.close();
        this.cache.delete(far);
      }
      this.ondecoded && this.ondecoded(i);
    },

    nearest(i) {
      if (this.cache.has(i)) return this.cache.get(i);
      let best = null, bd = 1e9;
      for (const [k, v] of this.cache) { const d = Math.abs(k - i); if (d < bd) { bd = d; best = v; } }
      return best;
    }
  };

  /* ---------- loader ---------- */
  const pctEl = $('[data-loader-pct]'), ltxt = $('[data-loader-text]'), lbar = $('.loader__bar i');
  const W = { fonts: 0, hero: 0, film: 0, frames: 0 };
  const setP = () => {
    const p = Math.min(1, W.fonts * 0.25 + W.hero * 0.35 + W.film * 0.1 + W.frames * 0.3);
    pctEl.textContent = Math.round(p * 100) + '%';
    lbar.style.setProperty('--p', p.toFixed(3));
  };

  const fontsP = Promise.all([
    document.fonts.load('900 100px "Big Shoulders"'),
    document.fonts.load('800 100px "Big Shoulders"'),
    document.fonts.load('italic 400 20px "EB Garamond"'),
    document.fonts.load('400 20px "EB Garamond"'),
    document.fonts.load('20px "VT323"')
  ]).catch(() => {}).then(() => { W.fonts = 1; setP(); });

  const heroImg = $('.hero__cut img');
  const heroP = new Promise((ok) => {
    const done = () => { W.hero = 1; setP(); ok(); };
    if (heroImg.complete && heroImg.naturalWidth) (heroImg.decode ? heroImg.decode().catch(() => {}) : Promise.resolve()).then(done);
    else { heroImg.addEventListener('load', done, { once: true }); heroImg.addEventListener('error', done, { once: true }); }
  });

  const firstFrames = new Promise((ok) => {
    Film.onprogress = () => {
      const n = Film.framesLoaded();
      W.frames = Math.min(1, n / 24); setP();
      updateTape();
      if (n >= 1) ok();
    };
  });
  const filmP = Film.init().then(() => { W.film = 1; setP(); }).catch(() => { W.film = 1; W.frames = 1; setP(); });

  const minTime = new Promise((ok) => setTimeout(ok, 1300));
  const maxTime = new Promise((ok) => setTimeout(ok, 6500));

  Promise.race([Promise.all([fontsP, heroP, filmP, firstFrames, minTime]), maxTime]).then(() => {
    W.fonts = W.hero = W.film = W.frames = 1; setP();
    ltxt.textContent = 'Estou aí firme';
    setTimeout(start, reduce ? 50 : 420);
  });

  /* ---------- hero ---------- */
  const heroTc = $('[data-hero-tc]');
  const t0 = performance.now();
  gsap.ticker.add(() => {
    const s = (performance.now() - t0) / 1000;
    const f = Math.floor((s % 1) * 30);
    heroTc.textContent = `00:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)}:${pad(f)}`;
  });

  function start() {
    unlock();
    if (lenis) lenis.start();
    ScrollTrigger.refresh();
    if (reduce) return;
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from('.hero__fera', { yPercent: 105, duration: 1.5 }, 0)
      .from('.hero__a', { yPercent: 110, duration: 1.3 }, 0.1)
      .from('.hero__cut', { y: '22vh', opacity: 0, duration: 1.8 }, 0.18)
      .from('.hero__frame span', { scale: 1.35, opacity: 0, duration: 1.1, stagger: 0.06 }, 0.3)
      .from('.hero__osd > div', { opacity: 0, duration: 0.01, stagger: 0.12 }, 0.5)
      .from('.hero__copy > *', { opacity: 0, y: 14, duration: 1.1, stagger: 0.12 }, 0.75);
  }

  if (!reduce) {
    gsap.to('.hero__cut', { yPercent: -7, scale: 1.04, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero__title', { yPercent: 22, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  }

  // selo do canal entra quando o "programa" começa
  ScrollTrigger.create({
    trigger: isDesk ? '#expedicao' : '#ficha', start: 'top 70%',
    onEnter: () => document.body.classList.add('bug-on'),
    onLeaveBack: () => document.body.classList.remove('bug-on')
  });

  /* ---------- expedição: vídeo no scroll ---------- */
  const vf = $('.exp__vf'), cvs = $('.exp__canvas'), ctx = cvs.getContext('2d', { alpha: false });
  const amb = $('.exp__ambient'), actx = amb.getContext('2d');
  const tcEl = $('[data-tc]'), tapeEl = $('[data-tape]'), barEl = $('.exp__bar i');
  const trackEl = $('.exp__track'), trackLabel = $('[data-track-label]');
  const narrs = $$('.narr').map((el) => ({ el, from: +el.dataset.from, to: +el.dataset.to, alert: el.classList.contains('narr--alert') }));
  let vfW = 0, vfH = 0, target = 0, current = 0, lastKey = '', expOn = false, activeNarr = -1, drewReal = false;

  function sizeCanvas() {
    const r = vf.getBoundingClientRect();
    vfW = r.width; vfH = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = Math.max(1, Math.round(vfW * dpr));
    cvs.height = Math.max(1, Math.round(vfH * dpr));
    lastKey = '';
  }
  const cover = (cw, ch, iw, ih) => {
    const s = Math.max(cw / iw, ch / ih), w = iw * s, h = ih * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  };

  const poster = new Image();
  poster.src = 'assets/fera/poster.webp';
  poster.onload = () => { if (!drewReal) paint(poster, 'poster'); };

  function paint(src, key) {
    if (key === lastKey) return;
    const iw = src.width || src.naturalWidth, ih = src.height || src.naturalHeight;
    const r = cover(cvs.width, cvs.height, iw, ih);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, r.x, r.y, r.w, r.h);
    if (isDesk) actx.drawImage(src, 0, 0, amb.width, amb.height);
    lastKey = key;
  }

  function updateTape() {
    if (!Film.ready) return;
    const p = Film.loaded / Film.total;
    tapeEl.textContent = p >= 1 ? 'Fita OK' : `Fita ${Math.round(p * 100)}%`;
  }

  function setNarr(sec) {
    let idx = narrs.findIndex((n) => sec >= n.from && sec < n.to);
    if (idx === -1) idx = narrs.length - 1;
    if (idx === activeNarr) return;
    if (activeNarr > -1) narrs[activeNarr].el.classList.remove('is-on');
    narrs[idx].el.classList.add('is-on');
    activeNarr = idx;
    vf.classList.toggle('is-alert', narrs[idx].alert);
  }

  function filmTick() {
    if (!expOn || !Film.ready) return;
    current = reduce ? target : current + (target - current) * 0.16;
    if (Math.abs(target - current) < 0.002) current = target;
    const i = Math.max(0, Math.min(Film.count - 1, Math.round(current)));
    Film.want = i;

    // decodifica o quadro pedido e os vizinhos na direção do scroll
    const dir = target >= current ? 1 : -1;
    Film.decode(i);
    Film.decode(i + dir); Film.decode(i + dir * 2); Film.decode(i - dir); Film.decode(i + dir * 3);

    const exact = Film.cache.get(i);
    if (exact) { paint(exact, 'f' + i); drewReal = true; }
    else { const near = Film.nearest(i); if (near) { paint(near, 'n' + i); drewReal = true; } }

    // timecode a 30 fps da câmera
    const f = Math.round(current * 3);
    tcEl.textContent = `00:00:${pad(Math.floor(f / 30))}:${pad(f % 30)}`;
    const sec = current / 10;
    setNarr(sec);

    // caixa de rastreio no rosto
    if (Film.track && drewReal) {
      const a = Math.floor(current), b = Math.min(Film.count - 1, a + 1), k = current - a;
      const A = Film.track[a], B = Film.track[b];
      const cx = A[0] + (B[0] - A[0]) * k, cy = A[1] + (B[1] - A[1]) * k, w = A[2] + (B[2] - A[2]) * k, h = A[3] + (B[3] - A[3]) * k;
      const r = cover(vfW, vfH, Film.w, Film.h);
      const bw = w * r.w, bh = h * r.h;
      const bx = r.x + (cx * r.w) - bw / 2, by = r.y + (cy * r.h) - bh / 2;
      trackEl.style.width = bw.toFixed(1) + 'px';
      trackEl.style.height = bh.toFixed(1) + 'px';
      trackEl.style.transform = `translate3d(${bx.toFixed(1)}px, ${by.toFixed(1)}px, 0)`;
      trackEl.style.opacity = '1';
      const label = sec >= 12.4 ? 'É perigoso' : sec >= 9.9 ? 'Esturrar' : `Onça  ${94 + (i % 5)}%`;
      if (trackLabel.textContent !== label) trackLabel.textContent = label;
    }
  }
  gsap.ticker.add(filmTick);

  ScrollTrigger.create({
    trigger: '#expedicao', start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => {
      target = s.progress * (Film.count ? Film.count - 1 : 150);
      barEl.style.transform = `scaleX(${s.progress.toFixed(4)})`;
    }
  });
  ScrollTrigger.create({
    trigger: '#expedicao', start: 'top bottom', end: 'bottom top',
    onToggle: (s) => { expOn = s.isActive; if (expOn) { sizeCanvas(); } }
  });
  new ResizeObserver(() => { sizeCanvas(); }).observe(vf);
  sizeCanvas();
  setNarr(0);

  /* ---------- prancha ---------- */
  const lines = $$('.plate__lines polyline');
  const dots = $$('.plate__lines circle');
  const tags = $$('.plate .tag');
  const pin = $('.status__pin');
  if (!reduce) {
    gsap.set(lines, { strokeDashoffset: 1 });
    gsap.set([dots, tags], { opacity: 0 });
    gsap.set(pin, { left: '10%' });
    ScrollTrigger.create({
      trigger: '.plate__fig', start: 'top 62%', once: true,
      onEnter: () => {
        gsap.timeline()
          .to(dots, { opacity: 1, duration: 0.3, stagger: 0.15 }, 0)
          .to(lines, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut', stagger: 0.15 }, 0.1)
          .to(tags, { opacity: 1, duration: 0.6, stagger: 0.15 }, 0.55);
      }
    });
    ScrollTrigger.create({
      trigger: '.status', start: 'top 82%', once: true,
      onEnter: () => {
        gsap.timeline({ delay: 0.2 })
          .to(pin, { left: '50%', duration: 0.7, ease: 'power2.inOut' })
          .to(pin, { left: '32%', duration: 0.35, ease: 'power1.inOut' })
          .to(pin, { left: '90%', duration: 0.55, ease: 'back.out(2.6)' }, '+=0.25');
      }
    });
  }

  /* ---------- notificação psiu ---------- */
  const psiu = $('.psiu'), psiuBtn = $('.psiu__card');
  let psiuTimer = 0;
  const hidePsiu = () => { psiu.classList.remove('is-in'); psiuBtn.tabIndex = -1; };
  const showPsiu = () => {
    psiu.classList.add('is-in'); psiuBtn.tabIndex = 0;
    clearTimeout(psiuTimer); psiuTimer = setTimeout(hidePsiu, 7500);
  };
  psiuBtn.addEventListener('click', () => {
    psiu.classList.add('is-open');
    speak('Mata. Aqui tem coragem!', { pitch: 0.45, rate: 0.85 });
    clearTimeout(psiuTimer); psiuTimer = setTimeout(hidePsiu, 5200);
  });
  ScrollTrigger.create({ trigger: '#ficha', start: 'top 35%', once: true, onEnter: () => setTimeout(showPsiu, 700) });

  /* ---------- rugido ---------- */
  const wordEl = $('.roar__word');
  const word = wordEl.dataset.word;
  const durOf = (c) => ({ a: 0.13, r: 0.2, m: 0.17, i: 0.17, u: 0.15 }[c.toLowerCase()] || 0.14);
  const chars = [], times = [], env = [];
  let acc = 0;
  word.split('').forEach((c, i, arr) => {
    const s = document.createElement('span');
    s.className = 'ch'; s.textContent = c; s.setAttribute('aria-hidden', 'true');
    wordEl.appendChild(s); chars.push(s);
    times.push(acc); acc += durOf(c);
    const t = i / (arr.length - 1);
    env.push(1 + (isDesk ? 1.45 : 2.35) * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.4)), 1.5));
  });
  const roarLen = acc;
  const rings = $$('.roar__rings i');
  gsap.set(chars, { scaleY: (i) => env[i] });

  let roarTl = null;
  function roar(withSound) {
    if (withSound) roarSound();
    if (reduce) return;
    if (roarTl) roarTl.kill();
    gsap.set(wordEl, { x: 0, y: 0 });
    roarTl = gsap.timeline();
    chars.forEach((c, i) => {
      roarTl.fromTo(c, { scaleY: 0.04, opacity: 0, rotation: 0 }, { scaleY: env[i] * 1.32, opacity: 1, duration: 0.16, ease: 'power3.out' }, times[i]);
      roarTl.to(c, { scaleY: env[i], duration: 1.1, ease: 'elastic.out(1, 0.32)' }, times[i] + 0.16);
    });
    roarTl.to(wordEl, { x: 'random(-7, 7)', y: 'random(-5, 4)', duration: 0.045, repeat: Math.round(roarLen / 0.045), yoyo: true, repeatRefresh: true, ease: 'none' }, 0.1);
    roarTl.to(chars, { rotation: 'random(-3.5, 3.5)', duration: 0.06, repeat: Math.round(roarLen / 0.06), yoyo: true, repeatRefresh: true, ease: 'none' }, 0.1);
    roarTl.to(wordEl, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
    roarTl.to(chars, { rotation: 0, duration: 0.3, ease: 'power2.out' }, '<');
    rings.forEach((r, k) => roarTl.fromTo(r, { scale: 0.25, opacity: 0.85 }, { scale: 3.4, opacity: 0, duration: 1.7, ease: 'power2.out' }, 0.05 + k * 0.5));
  }
  if (!reduce) {
    gsap.set(chars, { opacity: 0 });
    ScrollTrigger.create({ trigger: '.roar', start: 'top 45%', once: true, onEnter: () => roar(false) });
  }
  $('[data-roar]').addEventListener('click', () => roar(true));

  // Rugido sintetizado: dente de serra + ruído passando por formantes de vogal
  let audio = null;
  function roarSound() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const A = audio, t = A.currentTime + 0.04, T = roarLen + 0.35;
      const osc = A.createOscillator(); osc.type = 'sawtooth';
      const f0 = osc.frequency;
      f0.setValueAtTime(92, t); f0.linearRampToValueAtTime(128, t + 0.4); f0.linearRampToValueAtTime(112, t + times[4]);
      f0.linearRampToValueAtTime(175, t + times[5] + 0.05); f0.linearRampToValueAtTime(150, t + times[6] + 0.5);
      f0.linearRampToValueAtTime(122, t + times[13]); f0.linearRampToValueAtTime(78, t + T);
      const lfo = A.createOscillator(); lfo.frequency.value = 31;
      const lfoG = A.createGain(); lfoG.gain.value = 11; lfo.connect(lfoG).connect(f0);

      const len = Math.ceil(A.sampleRate * T), nb = A.createBuffer(1, len, A.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const noise = A.createBufferSource(); noise.buffer = nb;
      const nG = A.createGain(); nG.gain.value = 0.32;

      const src = A.createGain(); osc.connect(src); noise.connect(nG).connect(src);
      const F1 = A.createBiquadFilter(); F1.type = 'bandpass'; F1.Q.value = 5;
      const F2 = A.createBiquadFilter(); F2.type = 'bandpass'; F2.Q.value = 7;
      const g1 = A.createGain(); g1.gain.value = 2.4; const g2 = A.createGain(); g2.gain.value = 1.4;
      const out = A.createGain(); out.gain.value = 0;
      src.connect(F1).connect(g1).connect(out); src.connect(F2).connect(g2).connect(out);
      const V = { a: [780, 1220], r: [560, 1350], m: [260, 950], i: [300, 2250], u: [330, 760] };
      word.split('').forEach((c, i) => {
        const v = V[c.toLowerCase()] || V.a, at = t + times[i];
        F1.frequency.setTargetAtTime(v[0], at, 0.03); F2.frequency.setTargetAtTime(v[1], at, 0.03);
        out.gain.setTargetAtTime(c.toLowerCase() === 'm' ? 0.35 : (c.toLowerCase() === 'u' ? 0.7 : 0.95), at, 0.04);
      });
      out.gain.setTargetAtTime(0, t + roarLen, 0.09);
      const comp = A.createDynamicsCompressor(); const master = A.createGain(); master.gain.value = 0.85;
      out.connect(comp).connect(master).connect(A.destination);
      osc.start(t); lfo.start(t); noise.start(t);
      osc.stop(t + T + 0.4); lfo.stop(t + T + 0.4); noise.stop(t + T + 0.4);
    } catch (e) { /* sem áudio, segue o baile */ }
  }

  /* ---------- onça fullbleed ---------- */
  if (!reduce) {
    const st = { trigger: '.onca', start: 'top bottom', end: 'bottom top', scrub: true };
    gsap.fromTo('.onca__bg', { yPercent: -7, scale: 1.1 }, { yPercent: 7, scale: 1, ease: 'none', scrollTrigger: st });
    gsap.fromTo('.onca__l--1', { xPercent: -10 }, { xPercent: 6, ease: 'none', scrollTrigger: st });
    gsap.fromTo('.onca__l--2', { xPercent: 10 }, { xPercent: -6, ease: 'none', scrollTrigger: st });
    gsap.fromTo('.onca__l--3', { xPercent: -8 }, { xPercent: 8, ease: 'none', scrollTrigger: st });
    gsap.fromTo('.onca__l--4', { xPercent: 8 }, { xPercent: -6, ease: 'none', scrollTrigger: st });
  }

  /* ---------- armadilhas (carrossel) ---------- */
  const track = $('.traps__track');
  const cards = $$('.card', track);
  const prevB = $('[data-prev]'), nextB = $('[data-next]'), curEl = $('[data-cur]');
  const step = () => (cards[1] ? cards[1].offsetLeft - cards[0].offsetLeft : track.clientWidth);
  const updateCount = () => {
    const i = Math.round(track.scrollLeft / step());
    const maxScroll = track.scrollWidth - track.clientWidth - 4;
    const shown = track.scrollLeft >= maxScroll ? cards.length : Math.min(cards.length, i + 1);
    curEl.textContent = pad(shown);
    prevB.disabled = track.scrollLeft < 4;
    nextB.disabled = track.scrollLeft >= maxScroll;
  };
  let raf = 0;
  track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateCount); }, { passive: true });
  prevB.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduce ? 'auto' : 'smooth' }));
  nextB.addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduce ? 'auto' : 'smooth' }));
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); nextB.click(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevB.click(); }
  });
  let dragging = false, moved = false, sx = 0, sl = 0;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true; moved = false; sx = e.clientX; sl = track.scrollLeft;
    track.setPointerCapture(e.pointerId);
  });
  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx;
    if (!moved && Math.abs(dx) > 4) { moved = true; track.classList.add('is-drag'); }
    if (moved) track.scrollLeft = sl - dx;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      const i = Math.round(track.scrollLeft / step());
      track.classList.remove('is-drag');
      track.scrollTo({ left: i * step(), behavior: 'smooth' });
    }
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  updateCount();

  /* ---------- vocalizações (voz sintetizada) ---------- */
  const synth = window.speechSynthesis;
  let voice = null;
  const pickVoice = () => {
    const vs = synth.getVoices();
    voice = vs.find((v) => /pt[-_]BR/i.test(v.lang) && /google|luciana|felipe|francisca|antonio|daniel/i.test(v.name))
      || vs.find((v) => /pt[-_]BR/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null;
  };
  if (synth && window.SpeechSynthesisUtterance) { pickVoice(); synth.onvoiceschanged = pickVoice; }
  else document.documentElement.classList.add('no-speech');

  function speak(text, opt = {}, on = {}) {
    if (!synth) return null;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR'; if (voice) u.voice = voice;
    u.pitch = opt.pitch ?? 1; u.rate = opt.rate ?? 1;
    u.onstart = on.start || null; u.onend = on.end || null; u.onerror = on.end || null; u.onboundary = on.boundary || null;
    synth.speak(u);
    return u;
  }

  // ondas: barras com altura derivada do texto
  const seeded = (str) => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; }; };
  const vocs = $$('.voc').map((li) => {
    const svg = $('.voc__wave', li), rnd = seeded(li.dataset.say), n = 40, bars = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), shape = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      const h = Math.max(4, Math.round(44 * shape * (0.35 + 0.65 * rnd())));
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', i * 6); r.setAttribute('y', (48 - h) / 2); r.setAttribute('width', 3); r.setAttribute('height', h);
      svg.appendChild(r); bars.push(r);
    }
    return { li, bars };
  });
  let playing = null, waveRaf = 0;
  const stopVoc = () => {
    if (!playing) return;
    playing.li.classList.remove('is-playing');
    playing.bars.forEach((b) => b.classList.remove('on'));
    cancelAnimationFrame(waveRaf); playing = null;
  };
  vocs.forEach((v) => {
    $('.voc__play', v.li).addEventListener('click', () => {
      if (playing === v) { synth.cancel(); stopVoc(); return; }
      stopVoc();
      const text = v.li.dataset.say, rate = +v.li.dataset.rate || 1;
      const est = Math.max(1.2, text.length * 0.072 / rate);
      let t0 = 0, frac = 0;
      playing = v; v.li.classList.add('is-playing');
      const tick = () => {
        if (playing !== v) return;
        const p = t0 ? Math.max(frac, Math.min(0.98, (performance.now() - t0) / 1000 / est)) : 0;
        const on = Math.round(p * v.bars.length);
        v.bars.forEach((b, i) => b.classList.toggle('on', i < on));
        waveRaf = requestAnimationFrame(tick);
      };
      speak(text, { pitch: +v.li.dataset.pitch || 1, rate }, {
        start: () => { t0 = performance.now(); },
        boundary: (e) => { if (e.charIndex != null) frac = e.charIndex / text.length; },
        end: () => { if (playing === v) { v.bars.forEach((b) => b.classList.add('on')); setTimeout(() => { if (playing === v) stopVoc(); }, 260); } }
      });
      t0 = performance.now();
      tick();
    });
  });

  /* ---------- créditos ---------- */
  $('[data-replay]').addEventListener('click', () => scrollToY(0));

  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
