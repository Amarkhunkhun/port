/* Amar Khunkhun portfolio, v2.
   One idea everywhere: fine white lines blended from a wavy inner shape out to an outer shape, bright at the
   inside edge and fading to black, like the original intro frame. Used for the page frame, artwork halos,
   the lightbox, and (as SVG rings) the section titles. Needs gsap + ScrollTrigger + Lenis (js/vendor). */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = !!(window.gsap && window.ScrollTrigger);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mobile = () => innerWidth < 768;

  // ======================================================================
  // Contour engine
  // ======================================================================
  const css = getComputedStyle(document.documentElement);
  const BG = css.getPropertyValue("--bg").trim() || "#070708";
  const INK = css.getPropertyValue("--ink").trim() || "#f4f4f2";

  // perimeter of a rounded rect split into 8 segments; fractions decide how t maps onto it
  function fracs(w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const a = (Math.PI * r) / 2, e1 = Math.max(w - 2 * r, 0), e2 = Math.max(h - 2 * r, 0);
    const L = [e1, a, e2, a, e1, a, e2, a];
    const T = L.reduce((s, v) => s + v, 0) || 1;
    let c = 0;
    return L.map((v) => { const o = [c / T, (c + v) / T]; c += v; return o; });
  }
  const mkBuf = (n) => ({ x: new Float32Array(n), y: new Float32Array(n), nx: new Float32Array(n), ny: new Float32Array(n) });
  function sample(x, y, w, h, r, F, n, o) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    let s = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      while (s < 7 && t >= F[s][1]) s++;
      const span = F[s][1] - F[s][0];
      const u = span > 0 ? (t - F[s][0]) / span : 0;
      let px, py, nx, ny, a, cx, cy;
      switch (s) {
        case 0: px = x + r + u * (w - 2 * r); py = y; nx = 0; ny = -1; break;
        case 1: a = -Math.PI / 2 + u * Math.PI / 2; cx = x + w - r; cy = y + r; break;
        case 2: px = x + w; py = y + r + u * (h - 2 * r); nx = 1; ny = 0; break;
        case 3: a = u * Math.PI / 2; cx = x + w - r; cy = y + h - r; break;
        case 4: px = x + w - r - u * (w - 2 * r); py = y + h; nx = 0; ny = 1; break;
        case 5: a = Math.PI / 2 + u * Math.PI / 2; cx = x + r; cy = y + h - r; break;
        case 6: px = x; py = y + h - r - u * (h - 2 * r); nx = -1; ny = 0; break;
        default: a = Math.PI + u * Math.PI / 2; cx = x + r; cy = y + r;
      }
      if (a !== undefined) { nx = Math.cos(a); ny = Math.sin(a); px = cx + r * nx; py = cy + r * ny; }
      o.x[i] = px; o.y[i] = py; o.nx[i] = nx; o.ny[i] = ny;
    }
  }
  // smooth closed-loop wobble along the perimeter
  const wob = (t, s, tm) =>
    Math.sin(TAU * 2 * t + s + tm * 0.35) * 0.55 +
    Math.sin(TAU * 3 * t + s * 1.7 - tm * 0.27) * 0.3 +
    Math.sin(TAU * 5 * t + s * 2.9 + tm * 0.21) * 0.15;
  function wobble(o, n, amp, seed, tm) {
    if (!amp) return;
    for (let i = 0; i < n; i++) { const d = amp * wob(i / n, seed, tm); o.x[i] += o.nx[i] * d; o.y[i] += o.ny[i] * d; }
  }
  const W2 = new Float32Array(400);
  function midField(n, seed, tm) { for (let i = 0; i < n; i++) W2[i] = wob(i / n, seed + 11.3, tm * 1.3); }
  const pathOf = (ctx, o, n) => { ctx.moveTo(o.x[0], o.y[0]); for (let i = 1; i < n; i++) ctx.lineTo(o.x[i], o.y[i]); ctx.closePath(); };

  // the blend: N lines from inner (u=0) to outer (u=1)
  function blend(ctx, A, B, n, { k0 = 0, N, gamma = 1.1, a0 = 1, pow = 1.4, mid = 0, lw = 0.8 }) {
    ctx.strokeStyle = INK; ctx.lineWidth = lw;
    for (let k = k0; k <= N; k++) {
      const u = Math.pow(k / N, gamma);
      const al = a0 * Math.pow(1 - u, pow);
      if (al < 0.012) continue;
      const m = mid * Math.sin(Math.PI * u);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = A.x[i] + (B.x[i] - A.x[i]) * u + A.nx[i] * m * W2[i];
        const y = A.y[i] + (B.y[i] - A.y[i]) * u + A.ny[i] * m * W2[i];
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.globalAlpha = al; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- canvases ----------
  const frameCv = $(".frame-cv"), haloCv = $(".halo-cv"), lbCv = $(".lb__cv");
  const fctx = frameCv.getContext("2d"), hctx = haloCv.getContext("2d"), lctx = lbCv.getContext("2d");
  let DPR = 1, VW = innerWidth, VH = innerHeight;
  const fit = (cv, ctx) => {
    const w = cv.clientWidth || innerWidth, h = cv.clientHeight || innerHeight;
    cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  };

  // CSS lengths, read through a probe so JS and CSS share one source of truth
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;height:0";
  document.body.appendChild(probe);
  const len = (v) => { probe.style.width = v; return probe.getBoundingClientRect().width; };
  const Mx = {};
  function measure() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    fit(frameCv, fctx); fit(haloCv, hctx);
    VW = frameCv.clientWidth || innerWidth; VH = frameCv.clientHeight || innerHeight;
    Mx.b = len("var(--b)"); Mx.hbx = len("var(--hbx)"); Mx.hby = len("var(--hby)"); Mx.fw = len("var(--fw)");
  }

  // ---------- frame shapes ----------
  // a: loader -> intro, c: intro -> browsing, f: browsing -> footer (back to the intro shape)
  const FR = { a: reduce ? 1 : 0, c: reduce ? 1 : 0, f: 0 };
  const shapeL = () => { const w = Mx.fw, h = w * 1.25; return { x: (VW - w) / 2, y: (VH - h) / 2, w, h, r: w * 0.16, A: w * 0.035, mid: w * 0.05 }; };
  const shapeH = () => { const w = VW - 2 * Mx.hbx, h = VH - 2 * Mx.hby; const m = Math.min(VW, VH); return { x: Mx.hbx, y: Mx.hby, w, h, r: Math.min(w, h) * 0.12, A: m * 0.028, mid: m * 0.03 }; };
  const shapeC = () => ({ x: Mx.b, y: Mx.b, w: VW - 2 * Mx.b, h: VH - 2 * Mx.b, r: Math.min(Mx.b * 1.6, 30), A: Mx.b * 0.16, mid: Mx.b * 0.14 });
  const mix = (p, q, t) => { const o = {}; for (const k in p) o[k] = lerp(p[k], q[k], t); return o; };
  const frameShape = () => mix(mix(mix(shapeL(), shapeH(), FR.a), shapeC(), FR.c), shapeH(), FR.f);

  const NF = 320;
  const fin = mkBuf(NF), fout = mkBuf(NF);
  const nav = $(".nav");
  let navKey = "";
  function drawFrame(tm) {
    const s = frameShape();
    const F = fracs(s.w, s.h, s.r);
    sample(s.x, s.y, s.w, s.h, s.r, F, NF, fin);
    wobble(fin, NF, s.A, 1.3, tm);
    sample(-3, -3, VW + 6, VH + 6, 0, F, NF, fout);
    midField(NF, 2.1, tm);
    const ctx = fctx;
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); pathOf(ctx, fin, NF); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    const band = Math.max(s.x, s.y);
    const N = clamp(Math.round(band / 2.5), 6, mobile() ? 80 : 140);
    blend(ctx, fin, fout, NF, { N, gamma: 1.12, a0: 1, pow: 1.5, mid: s.mid, lw: band > 40 ? 0.7 : 0.6 });
    // nav rides inside the hole
    const k = `${Math.round(s.x)}|${Math.round(s.y)}`;
    if (k !== navKey) { navKey = k; nav.style.top = s.y + "px"; nav.style.left = s.x + "px"; nav.style.right = s.x + "px"; }
  }

  // ---------- halos around artwork ----------
  const NH = 160;
  const hin = mkBuf(NH), hout = mkBuf(NH);
  const halos = $$("[data-halo]").map((el, i) => {
    el._hs = { h: 0, vis: el.classList.contains("preview") ? 0 : 1, in: hasGsap && !reduce ? 0 : 1, seed: i * 2.37 + 0.5 };
    if (!el.classList.contains("preview")) {
      el.addEventListener("pointerenter", () => tw(el._hs, { h: 1, duration: 0.8, ease: "expo.out" }));
      el.addEventListener("pointerleave", () => tw(el._hs, { h: 0, duration: 0.9, ease: "expo.out" }));
    }
    return el;
  });
  function tw(obj, vars) {
    if (hasGsap && !reduce) gsap.to(obj, { ...vars, overwrite: "auto" });
    else Object.keys(vars).forEach((k) => { if (k in obj) obj[k] = vars[k]; });
  }
  function drawHalos(tm) {
    const ctx = hctx;
    ctx.clearRect(0, 0, VW, VH);
    const m = mobile();
    for (const el of halos) {
      const st = el._hs, vis = st.vis * st.in;
      if (vis < 0.01) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2) continue;
      const big = el.dataset.halo === "big" ? 1.45 : 1;
      const E = ((m ? 24 : 46) + (m ? 8 : 34) * st.h) * big;
      if (r.right < -E || r.left > VW + E || r.bottom < -E || r.top > VH + E) continue;
      const ox = r.left - E, oy = r.top - E, ow = r.width + 2 * E, oh = r.height + 2 * E, orr = E * 0.95;
      const F = fracs(ow, oh, orr);
      sample(r.left, r.top, r.width, r.height, 0, F, NH, hin);
      sample(ox, oy, ow, oh, orr, F, NH, hout);
      wobble(hout, NH, E * 0.2, st.seed, tm);
      midField(NH, st.seed, tm);
      blend(ctx, hin, hout, NH, { k0: 1, N: m ? 9 : Math.round(13 + 5 * st.h), gamma: 1.05, a0: (0.68 + 0.3 * st.h) * vis, pow: 1.15, mid: E * 0.12, lw: 0.7 });
    }
  }

  // ---------- lightbox field ----------
  const lb = $(".lb"), lbImg = $(".lb__img");
  const lin = mkBuf(NF), lout = mkBuf(NF);
  const LBS = { p: 0 };
  function drawLb(tm) {
    if (lb.hidden) return;
    const ctx = lctx;
    ctx.clearRect(0, 0, VW, VH);
    const r = lbImg.getBoundingClientRect();
    if (r.width < 2 || !lbImg.complete) return;
    const c = shapeC();
    const F = fracs(c.w, c.h, c.r);
    sample(r.left - 1, r.top - 1, r.width + 2, r.height + 2, 0, F, NF, lin);
    sample(c.x, c.y, c.w, c.h, c.r, F, NF, lout);
    wobble(lout, NF, c.A, 4.2, tm);
    midField(NF, 7.7, tm);
    const band = Math.max(r.left - c.x, r.top - c.y);
    blend(ctx, lin, lout, NF, { k0: 1, N: clamp(Math.round(band / 3), 10, 70), gamma: 1.05, a0: 0.75 * LBS.p, pow: 1.6, mid: Math.min(band * 0.12, 26), lw: 0.6 });
  }

  // ---------- one loop for all canvases ----------
  const t0 = performance.now();
  function frame() {
    const tm = reduce ? 0 : (performance.now() - t0) / 1000;
    drawFrame(tm); drawHalos(tm); drawLb(tm);
  }
  measure();
  let rz = 0;
  addEventListener("resize", () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { measure(); fit(lbCv, lctx); buildTitles(); fitName(); }); });

  // ======================================================================
  // Contour titles (SVG): letter-shaped holes with rings rippling out
  // ======================================================================
  const RINGS = 9;
  let ctN = 0;
  function buildTitle(svg) {
    const NS = "http://www.w3.org/2000/svg";
    if (!svg._built) {
      const id = "ctt" + ctN++;
      let h = `<defs><text id="${id}" x="0" y="0">${svg.dataset.text}</text></defs>`;
      for (let k = RINGS; k >= 1; k--) {
        const a = Math.pow(1 - (k - 1) / RINGS, 1.6).toFixed(3);
        h += `<use href="#${id}" class="r" style="--k:${k};stroke-opacity:${a}"></use><use href="#${id}" class="m" style="--k:${k}"></use>`;
      }
      h += `<use href="#${id}" class="g"></use>`;
      svg.innerHTML = h;
      svg.setAttribute("xmlns", NS);
      svg._built = true;
    }
    const g = svg.querySelector(".g");
    let bb;
    try { bb = g.getBBox(); } catch (e) { return; }
    if (!bb || !bb.width) return;
    const s = parseFloat(getComputedStyle(svg).getPropertyValue("--s")) || 2.6;
    const pad = RINGS * s + 3;
    const vb = [bb.x - pad, bb.y - pad, bb.width + 2 * pad, bb.height + 2 * pad];
    svg.setAttribute("viewBox", vb.map((v) => v.toFixed(1)).join(" "));
    if (svg.hasAttribute("data-fit")) { svg.style.width = "100%"; svg.style.margin = `-${(pad / vb[2]) * 100}% 0`; return; }
    const fs = parseFloat(getComputedStyle(svg.parentNode).fontSize) || 160;
    const scale = fs / 100;
    svg.style.width = vb[2] * scale + "px";
    const off = -pad * scale + "px";
    svg.style.margin = svg.dataset.align === "right" ? `${off} ${off} ${off} 0` : `${off} 0 ${off} ${off}`;
  }
  const titles = $$("svg.ct");
  function buildTitles() { titles.forEach(buildTitle); }
  buildTitles();
  if (document.fonts) document.fonts.ready.then(() => { buildTitles(); if (hasGsap) ScrollTrigger.refresh(); });

  // ======================================================================
  // Content: works list, hero name, hero images
  // ======================================================================
  const works = [];
  $$("[data-work]").forEach((el) => { const i = +el.dataset.i; works[i] = { i, title: el.dataset.title, s: el.dataset.s, l: el.dataset.l, el }; });

  const SHUFFLE = ["img/art-12-s.webp", "img/art-03-s.webp", "img/art-15-s.webp", "img/art-05-s.webp",
    "img/art-11-s.webp", "img/art-02-s.webp", "img/art-17-s.webp", "img/art-01-s.webp"];
  const COVER = "img/art-07-l.webp";

  function fitName() {
    const el = $(".hero__name"); if (!el) return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const w = $(".hero__line").getBoundingClientRect().width;
    if (w > 0 && !fitName.done) document.documentElement.style.setProperty("--k", (fs / w).toFixed(5));
  }
  fitName();
  if (document.fonts) document.fonts.ready.then(fitName);

  const heroImgs = $(".hero__imgs");
  const mkImg = (src, parent) => { const im = new Image(); im.src = src; im.alt = ""; im.decoding = "async"; parent.appendChild(im); return im; };
  const heroSet = SHUFFLE.map((s) => mkImg(s, heroImgs));
  const coverImg = mkImg(COVER, heroImgs);
  let shuffleTimer = null, shuffleIdx = 0, shuffling = false;
  const show = (set, idx) => set.forEach((im, k) => im.classList.toggle("on", k === idx));
  const startShuffle = (ms) => {
    if (reduce || shuffling) return;
    shuffling = true; coverImg.classList.remove("on");
    clearInterval(shuffleTimer);
    shuffleTimer = setInterval(() => {
      const ready = heroSet.filter((im) => im.complete && im.naturalWidth);
      if (!ready.length) return;
      shuffleIdx = (shuffleIdx + 1) % ready.length; show(heroSet, heroSet.indexOf(ready[shuffleIdx]));
    }, ms);
  };
  const stopShuffle = () => { if (!shuffling) return; shuffling = false; clearInterval(shuffleTimer); heroSet.forEach((im) => im.classList.remove("on")); coverImg.classList.add("on"); };

  // ---------- smooth scroll + anchor links ----------
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    if (hasGsap) { lenis.on("scroll", ScrollTrigger.update); }
  }
  $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    const t = id === "#top" ? 0 : $(id);
    if (t === null) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(t, { duration: 1.6 });
    else if (t === 0) window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    else t.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }));

  // ---------- static path: no gsap or reduced motion ----------
  if (!hasGsap || reduce) {
    coverImg.classList.add("on");
    $(".loader") && $(".loader").remove();
    const loop = () => { frame(); if (lenis) lenis.raf(performance.now()); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    // footer still closes the frame back in, driven by plain scroll position
    addEventListener("scroll", () => {
      const ft = $(".footer").getBoundingClientRect();
      FR.f = clamp(1 - (ft.bottom - innerHeight) / Math.max(ft.height, 1), 0, 1);
    }, { passive: true });
    setupMade(false);
    setupLightbox();
    return;
  }

  // ======================================================================
  // Animated path
  // ======================================================================
  gsap.registerPlugin(ScrollTrigger);
  gsap.ticker.add((t) => { if (lenis) lenis.raf(t * 1000); frame(); });
  gsap.ticker.lagSmoothing(0);
  if (lenis) lenis.stop();
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);
  startShuffle(140);

  // ---------- loader: the frame is the window, the counter tracks real loading ----------
  const loader = $(".loader");
  const lNum = $(".loader__num");
  const total = SHUFFLE.length + 2;
  let loaded = 0;
  const counter = { v: 0 };
  const setNum = () => (lNum.textContent = Math.round(counter.v));
  const bump = () => { loaded++; gsap.to(counter, { v: Math.round((loaded / total) * 100), duration: 0.6, ease: "power2.out", overwrite: true, onUpdate: setNum }); };
  const waitImg = (im) => new Promise((r) => (im.complete ? r() : (im.onload = im.onerror = r)));
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  heroSet.forEach((im) => waitImg(im).then(bump));
  waitImg(coverImg).then(bump);
  fontsReady.then(bump);
  Promise.race([
    Promise.all([...heroSet.map(waitImg), waitImg(coverImg), fontsReady, new Promise((r) => setTimeout(r, 1600))]),
    new Promise((r) => setTimeout(r, 6000)),
  ]).then(() => { gsap.to(counter, { v: 100, duration: 0.4, onUpdate: setNum }); setTimeout(intro, 450); });

  const nameChars = $$(".hero__name .ch");
  const foot = $(".hero__foot");
  gsap.set(nameChars, { yPercent: 110 });
  gsap.set(foot, { autoAlpha: 0, y: 16 });
  gsap.set(".nav", { autoAlpha: 0 });

  function intro() {
    clearInterval(shuffleTimer); shuffling = false; startShuffle(650);
    const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
    tl.to(".loader__count, .loader__meta", { yPercent: 30, autoAlpha: 0, duration: 0.6, ease: "power3.in" })
      .to(FR, { a: 1, duration: 1.7, ease: "expo.inOut" }, "-=.25")
      .to(nameChars, { yPercent: 0, duration: 1.3, stagger: 0.035 }, "-=.75")
      .to(foot, { autoAlpha: 1, y: 0, duration: 1 }, "-=1")
      .to(".nav", { autoAlpha: 1, duration: 0.8 }, "<")
      .add(() => { loader.remove(); if (lenis) lenis.start(); buildScroll(); });
  }

  function buildScroll() {
    const mm = gsap.matchMedia();
    fitName(); fitName.done = true;

    // hero: name collapses to AK, the thick frame thins to a hairline border, AK zooms through
    const collapse = $$(".hero__name .collapse");
    const nfs = parseFloat(getComputedStyle($(".hero__name")).fontSize);
    collapse.forEach((el) => { el.style.width = el.getBoundingClientRect().width / nfs + "em"; });
    gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: ".hero", start: "top top", end: "+=160%", pin: true, scrub: 0.7,
        onUpdate: (self) => { self.progress > 0.01 ? stopShuffle() : startShuffle(650); },
      },
    })
      .to(foot, { autoAlpha: 0, y: -12, duration: 0.12 }, 0)
      .to(collapse, { width: 0, duration: 0.38, ease: "power2.inOut" }, 0)
      .to($$(".hero__name .collapse .ch"), { autoAlpha: 0, duration: 0.16, stagger: 0.008 }, 0)
      .to(FR, { c: 1, duration: 0.62, ease: "power2.inOut" }, 0.1)
      .fromTo(".hero__imgs", { scale: 1.12 }, { scale: 1, duration: 0.7, ease: "power2.out" }, 0.1)
      .to(".hero__name", { scale: 7, duration: 0.42, ease: "power2.in" }, 0.5)
      .to(".hero__name", { autoAlpha: 0, duration: 0.1 }, 0.82)
      .to({}, { duration: 0.08 });

    // found: horizontal reel on desktop
    const cards = $$(".found .work__media");
    mm.add("(min-width: 768px)", () => {
      const track = $(".found__track");
      const dist = () => track.scrollWidth - innerWidth;
      const pan = gsap.to(track, {
        x: () => -dist(), ease: "none",
        scrollTrigger: {
          trigger: ".found", start: "top top", end: () => "+=" + dist(), pin: true, scrub: 0.8, invalidateOnRefresh: true,
          onUpdate: (self) => gsap.set(".found__bar span", { scaleX: self.progress }),
        },
      });
      $$(".work__media img").forEach((img) => {
        gsap.fromTo(img, { xPercent: -5 }, { xPercent: 5, ease: "none",
          scrollTrigger: { trigger: img.parentNode, containerAnimation: pan, start: "left right", end: "right left", scrub: true } });
      });
      gsap.from($$(".work"), { y: 60, autoAlpha: 0, duration: 1.2, ease: "expo.out", stagger: 0.08,
        scrollTrigger: { trigger: ".found", start: "top 70%", once: true } });
      gsap.to(cards.map((c) => c._hs), { in: 1, duration: 1.6, ease: "power2.out", stagger: 0.08, delay: 0.3,
        scrollTrigger: { trigger: ".found", start: "top 70%", once: true } });
    });
    mm.add("(max-width: 767px)", () => {
      $$(".work").forEach((w) => {
        const st = { trigger: w, start: "top 88%", once: true };
        gsap.from(w, { y: 50, autoAlpha: 0, duration: 1.1, ease: "expo.out", scrollTrigger: st });
        gsap.to($(".work__media", w)._hs, { in: 1, duration: 1.4, delay: 0.25, ease: "power2.out", scrollTrigger: { ...st } });
      });
    });

    // titles: rings grow out of the letters
    $$(".ctitle .ct").forEach((svg) => gsap.fromTo(svg, { "--p": 0, autoAlpha: 0 }, { "--p": 1, autoAlpha: 1, duration: 2.2, ease: "expo.out",
      scrollTrigger: { trigger: svg.parentNode, start: "top 85%", once: true } }));
    $$(".lede").forEach((p) => gsap.from(p, { autoAlpha: 0, y: 20, duration: 1, ease: "expo.out", delay: 0.3,
      scrollTrigger: { trigger: p, start: "top 92%", once: true } }));

    // made rows rise in
    gsap.from($$(".row__rise"), { yPercent: 100, duration: 1.1, ease: "expo.out", stagger: 0.06,
      scrollTrigger: { trigger: ".index", start: "top 80%", once: true } });

    // about: portrait wipes open with its halo, bio reads itself in
    const portrait = $(".about__portrait");
    gsap.fromTo(portrait, { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.6, ease: "expo.inOut",
      scrollTrigger: { trigger: ".about", start: "top 70%", once: true } });
    gsap.to(portrait._hs, { in: 1, duration: 1.8, delay: 0.6, ease: "power2.out", scrollTrigger: { trigger: ".about", start: "top 70%", once: true } });
    gsap.fromTo(".about__portrait img", { scale: 1.3 }, { scale: 1, ease: "none",
      scrollTrigger: { trigger: ".about", start: "top bottom", end: "bottom 60%", scrub: true } });
    const bio = $(".about__bio");
    bio.innerHTML = bio.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(" ");
    gsap.fromTo($$(".w", bio), { opacity: 0.16 }, { opacity: 1, stagger: 0.1, ease: "none",
      scrollTrigger: { trigger: bio, start: "top 80%", end: "bottom 50%", scrub: true } });

    // footer: the frame closes back to the intro shape and the name's rings grow with it
    gsap.timeline({ scrollTrigger: { trigger: ".footer", start: "top bottom", end: "bottom bottom", scrub: 0.6 } })
      .to(FR, { f: 1, ease: "power2.inOut", duration: 1 }, 0)
      .fromTo(".footer__name .ct", { "--p": 0 }, { "--p": 1, ease: "power2.out", duration: 1 }, 0);

    setupMade(true);
    setupLightbox();
    ScrollTrigger.refresh();
  }

  // ======================================================================
  // Made: cursor-following preview (with its own halo)
  // ======================================================================
  function setupMade(animated) {
    const list = $(".index"), pv = $(".preview"), inner = $(".preview__inner");
    if (!list || !pv || !matchMedia("(hover: hover) and (min-width: 768px)").matches) return;
    const imgs = {};
    let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, on = false, raf = null;
    const loop = () => {
      x += (tx - x) * (animated ? 0.14 : 1); y += (ty - y) * (animated ? 0.14 : 1);
      pv.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      raf = on || Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5 ? requestAnimationFrame(loop) : null;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    list.addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; kick(); });
    $$(".row", list).forEach((row) => {
      row.addEventListener("pointerenter", (e) => {
        if (!on) { x = tx = e.clientX; y = ty = e.clientY; }
        on = true; pv.classList.add("on"); tw(pv._hs, { vis: 1, duration: 0.5, ease: "power2.out" }); kick();
        const src = row.dataset.s;
        let im = imgs[src];
        if (!im) im = imgs[src] = mkImg(src, inner);
        $$("img", inner).forEach((o) => o !== im && o.classList.remove("on"));
        inner.appendChild(im);
        requestAnimationFrame(() => im.classList.add("on"));
      });
    });
    list.addEventListener("pointerleave", () => { on = false; pv.classList.remove("on"); tw(pv._hs, { vis: 0, duration: 0.35, ease: "power2.out" }); });
  }

  // ======================================================================
  // Lightbox
  // ======================================================================
  function setupLightbox() {
    const title = $(".lb__title"), count = $(".lb__count");
    let cur = 0, lastFocus = null;
    const pad = (n) => String(n).padStart(2, "0");
    const anim = hasGsap && !reduce;
    const render = (i, dir = 0) => {
      cur = (i + works.length) % works.length;
      const w = works[cur];
      lbImg.src = w.s; lbImg.alt = w.title;
      const hi = new Image(); hi.src = w.l; hi.onload = () => { if (works[cur] === w) lbImg.src = w.l; };
      title.textContent = w.title;
      count.textContent = `${pad(cur + 1)} / ${pad(works.length)}`;
      if (anim) {
        gsap.fromTo(lbImg, { autoAlpha: 0, x: dir * 40 }, { autoAlpha: 1, x: 0, duration: 0.7, ease: "expo.out" });
        gsap.fromTo(LBS, { p: 0 }, { p: 1, duration: 1.1, ease: "power2.out" });
      } else LBS.p = 1;
    };
    const open = (i) => {
      lastFocus = document.activeElement;
      lb.hidden = false; fit(lbCv, lctx); render(i);
      if (lenis) lenis.stop();
      document.body.style.overflow = "hidden";
      if (anim) gsap.fromTo(lb, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 });
      $(".lb__close").focus();
    };
    const close = () => {
      const done = () => { lb.hidden = true; document.body.style.overflow = ""; if (lenis) lenis.start(); lastFocus && lastFocus.focus({ preventScroll: true }); };
      if (anim) gsap.to(lb, { autoAlpha: 0, duration: 0.3, onComplete: done }); else done();
    };
    works.forEach((w) => w.el.addEventListener("click", () => open(w.i)));
    $(".lb__prev").addEventListener("click", () => render(cur - 1, -1));
    $(".lb__next").addEventListener("click", () => render(cur + 1, 1));
    $(".lb__close").addEventListener("click", close);
    $(".lb__fig").addEventListener("click", (e) => { if (e.target !== lbImg) close(); });
    addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") render(cur + 1, 1);
      else if (e.key === "ArrowLeft") render(cur - 1, -1);
      else if (e.key === "Tab") {
        const f = $$("button", lb); const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    let sx = null;
    lb.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50) render(cur + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    });
  }
})();
