import {
  generate, hex, fromHex, fit, scale, STEPS, wcag, wcagGrade, apca, apcaGrade,
  simulate, extract, nameOf, HARMONIES, toOklab, toOklch, toRgb, maxChroma, hueRing,
} from './engine.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const N = 5;

/* ---------------- state ---------------- */

const state = {
  sw: [],           // [{ color, locked }]
  harmony: 'auto',
  sel: 0,
  cvd: '',
  pane: 'inspect',
  fmt: 'css',
  pair: [0, N - 1],
  pvMode: 'light',
  hist: [],
  hi: -1,
};

const LIB_KEY = 'pigment.library.v2';
const lib = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY)) || []; } catch { return []; } };
const setLib = (v) => localStorage.setItem(LIB_KEY, JSON.stringify(v.slice(0, 60)));

/* ---------------- colour helpers ---------------- */

/** Perceptual mix in OKLab — safe for neutrals, no hue drift. */
function mix(a, b, t) {
  const x = toOklab(fit(a)), y = toOklab(fit(b));
  return toOklch({ mode: 'oklab', l: x.l + (y.l - x.l) * t, a: x.a + (y.a - x.a) * t, b: x.b + (y.b - x.b) * t });
}

/** Whichever of black/white reads better on this colour. */
const on = (c) => (wcag(c, { mode: 'oklch', l: 0, c: 0, h: 0 }) >= wcag(c, { mode: 'oklch', l: 1, c: 0, h: 0 }) ? '#000' : '#fff');

/** What the eye actually sees, after any CVD simulation. */
const seen = (c) => (state.cvd ? simulate(c, state.cvd) : c);
const shex = (c) => hex(seen(c));

const colors = () => state.sw.map((s) => s.color);

function slug(name, used) {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'color';
  if (used.has(s)) { let i = 2; while (used.has(`${s}-${i}`)) i++; s = `${s}-${i}`; }
  used.add(s);
  return s;
}

const names = () => {
  const used = new Set();
  return state.sw.map((s) => ({ label: nameOf(s.color), key: slug(nameOf(s.color), used) }));
};

const oklchStr = (c) => {
  const f = fit(c);
  return `oklch(${(f.l * 100).toFixed(1)}% ${f.c.toFixed(3)} ${(f.h || 0).toFixed(1)})`;
};
const rgbStr = (c) => {
  const r = toRgb(fit(c));
  return `rgb(${Math.round(r.r * 255)} ${Math.round(r.g * 255)} ${Math.round(r.b * 255)})`;
};
const hslStr = (c) => {
  const r = toRgb(fit(c));
  const mx = Math.max(r.r, r.g, r.b), mn = Math.min(r.r, r.g, r.b), d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = mx === r.r ? 60 * (((r.g - r.b) / d) % 6) : mx === r.g ? 60 * ((r.b - r.r) / d + 2) : 60 * ((r.r - r.g) / d + 4);
  return `hsl(${Math.round((h + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
};

/* ---------------- history & url ---------------- */

function commit(push = true) {
  if (push) {
    const snap = colors().map(hex).join('-');
    if (state.hist[state.hi] !== snap) {
      state.hist = state.hist.slice(0, state.hi + 1);
      state.hist.push(snap);
      if (state.hist.length > 80) state.hist.shift();
      state.hi = state.hist.length - 1;
    }
  }
  syncURL();
  render();
}

function loadSnap(snap) {
  const cols = snap.split('-').map((h) => fromHex('#' + h.replace('#', ''))).filter(Boolean);
  if (cols.length !== N) return false;
  state.sw = cols.map((c, i) => ({ color: c, locked: state.sw[i]?.locked ?? false }));
  return true;
}

/** The shareable address of the current palette. A real query string, not a
    hash: it survives link unfurlers and needs no server rewrite. */
function paletteURL() {
  const p = colors().map((c) => hex(c).slice(1)).join('-');
  return `${location.origin}${location.pathname}?p=${p}&h=${state.harmony}`;
}

function syncURL() {
  history.replaceState(null, '', paletteURL());
}

function readURL() {
  // query string is canonical; the old #p= form still loads so early links keep working
  const src = location.search.length > 1 ? location.search : location.hash;
  const m = /[?#&]p=([0-9a-fA-F-]+)/.exec(src);
  const h = /[?#&]h=([a-z]+)/i.exec(src);
  if (h && HARMONIES[h[1]]) state.harmony = h[1];
  if (!m) return false;
  return loadSnap(m[1]);
}

/* ---------------- generation ---------------- */

function roll() {
  const next = generate(state.sw, state.harmony);
  state.sw = next.map((c, i) => ({ color: c, locked: state.sw[i].locked }));
  commit();
}

function rollOne(i) {
  const saved = state.sw.map((s) => s.locked);
  state.sw.forEach((s, j) => { s.locked = j !== i; });
  const next = generate(state.sw, state.harmony);
  state.sw = next.map((c, j) => ({ color: c, locked: saved[j] }));
  commit();
}

/* ---------------- toast ---------------- */

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('is-on'), 1500);
}

/** Returns whether the copy actually landed — never claim success we can't verify. */
async function copy(text, label) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? (label || `Copied ${text}`) : 'Press Ctrl+C to copy');
  return ok;
}

/* ---------------- modal ---------------- */

let closeModal = null;

function modal(title, build) {
  closeModal?.();
  const back = el('div', 'modal');
  const card = el('div', 'modal__card');
  const head = el('div', 'modal__head');
  head.append(el('h2', null, title));
  const x = el('button', 'modal__x', '✕');
  x.setAttribute('aria-label', 'Close');
  head.append(x);
  const body = el('div', 'modal__body');
  card.append(head, body);
  back.append(card);
  document.body.append(back);

  const done = () => {
    back.classList.remove('is-on');
    removeEventListener('keydown', onKey, true);
    setTimeout(() => back.remove(), 200);
    closeModal = null;
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); done(); }
    if (e.key === ' ') e.stopPropagation();   // don't regenerate behind the sheet
  };
  addEventListener('keydown', onKey, true);
  x.onclick = done;
  back.onclick = (e) => { if (e.target === back) done(); };
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  closeModal = done;
  build(body, done);
  requestAnimationFrame(() => back.classList.add('is-on'));
  return done;
}

/** A row of the current palette, used as the header of both sheets. */
function paletteStrip(h = 54) {
  const row = el('div', 'sheet__strip');
  row.style.height = h + 'px';
  state.sw.forEach((s, i) => {
    const c = el('span');
    c.style.setProperty('--i', i);
    c.style.background = shex(s.color);
    row.append(c);
  });
  return row;
}

/* ---------------- share ---------------- */

/** Palette as a PNG — what people actually paste into Slack. */
function paletteCanvas(scale = 2) {
  const W = 1200, H = 630;
  const cv = el('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  const ns = names();
  const cw = W / N;
  colors().forEach((c, i) => {
    g.fillStyle = hex(c);
    g.fillRect(i * cw, 0, Math.ceil(cw) + 1, H);
    g.fillStyle = on(c);
    g.globalAlpha = 1;
    g.font = '500 30px "Geist Mono", ui-monospace, monospace';
    g.fillText(hex(c).toUpperCase(), i * cw + 26, H - 66);
    g.globalAlpha = 0.72;
    g.font = 'italic 22px "Instrument Serif", Georgia, serif';
    const name = ns[i].label;
    let t = name;
    while (g.measureText(t).width > cw - 52 && t.length > 4) t = t.slice(0, -2);
    g.fillText(t + (t === name ? '' : '…'), i * cw + 26, H - 34);
    g.globalAlpha = 1;
  });
  return cv;
}

function download(blobOrUrl, filename) {
  const a = el('a');
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.download = filename;
  a.click();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function shareSheet() {
  modal('Share this palette', (body) => {
    body.append(paletteStrip());

    const url = paletteURL();
    const field = el('div', 'field');
    const input = el('input', 'field__input');
    input.value = url;
    input.readOnly = true;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Palette link');
    // select all but keep the start of the URL in view
    const selectAll = () => { input.setSelectionRange(0, input.value.length); input.scrollLeft = 0; };
    input.onfocus = selectAll;
    input.onclick = selectAll;
    const cp = el('button', 'btn btn--primary', 'Copy');
    cp.onclick = async () => {
      selectAll();
      const ok = await copy(url, 'Link copied');
      cp.textContent = ok ? 'Copied' : 'Ctrl+C';
      setTimeout(() => (cp.textContent = 'Copy'), 1600);
    };
    field.append(input, cp);
    body.append(field);
    body.append(el('p', 'sheet__note', 'Opens straight into the generator with these five colours and the same harmony rule.'));

    const row = el('div', 'sheet__row');
    const act = (label, fn) => { const b = el('button', 'btn', label); b.onclick = fn; row.append(b); };
    act('Open in new tab', () => window.open(url, '_blank', 'noopener'));
    act('Download PNG', () => {
      paletteCanvas().toBlob((b) => { download(b, `pigment-${names()[0].key}.png`); toast('PNG downloaded'); }, 'image/png');
    });
    act('Download SVG', () => { download(svgSheet(), `pigment-${names()[0].key}.svg`); toast('SVG downloaded'); });
    act('Copy hex list', () => copy(colors().map((c) => hex(c).toUpperCase()).join(', '), 'Hex list copied'));
    if (navigator.share) {
      act('Share…', () => navigator.share({ title: 'Pigment palette', text: names().map((n) => n.label).join(' · '), url }).catch(() => {}));
    }
    body.append(row);

    setTimeout(() => { input.focus(); selectAll(); }, 60);
  });
}

function svgSheet() {
  const ns = names();
  const w = 200, h = 320;
  const esc = (s) => s.replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m]));
  const body = colors().map((c, i) => {
    const t = on(c);
    return `<rect x="${i * w}" y="0" width="${w}" height="${h}" fill="${hex(c)}"/>` +
      `<text x="${i * w + 20}" y="${h - 44}" fill="${t}" font-family="monospace" font-size="20">${hex(c).toUpperCase()}</text>` +
      `<text x="${i * w + 20}" y="${h - 22}" fill="${t}" font-family="serif" font-style="italic" font-size="15" opacity=".7">${esc(ns[i].label)}</text>`;
  }).join('');
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${w * N}" height="${h}" viewBox="0 0 ${w * N} ${h}">${body}</svg>`], { type: 'image/svg+xml' });
}

/* ---------------- save ---------------- */

function saveSheet() {
  const p = colors().map((c) => hex(c).slice(1)).join('-');
  const existing = lib().find((x) => x.p === p);
  const ns = names();

  modal(existing ? 'Already in your library' : 'Save to library', (body, done) => {
    body.append(paletteStrip());

    const field = el('div', 'field');
    const input = el('input', 'field__input');
    input.value = existing?.n || `${ns[0].label} & ${ns[N - 1].label}`;
    input.maxLength = 60;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Palette name');
    input.placeholder = 'Name this palette';
    const go = el('button', 'btn btn--primary', existing ? 'Rename' : 'Save');
    field.append(input, go);
    body.append(field);
    body.append(el('p', 'sheet__note', 'Stored in this browser, on this device. Nothing leaves your machine.'));

    const commitSave = () => {
      const name = input.value.trim() || `${ns[0].label} & ${ns[N - 1].label}`;
      const l = lib();
      const hit = l.find((x) => x.p === p);
      if (hit) hit.n = name;
      else l.unshift({ p, h: state.harmony, n: name, t: Date.now() });
      setLib(l);
      done();
      setPane('library');            // show the user it actually happened
      flashLibrary(p);
      toast(hit ? 'Renamed' : 'Saved to library');
    };
    go.onclick = commitSave;
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commitSave();
      if (e.key === 'Escape') done();
    };

    const row = el('div', 'sheet__row');
    const share = el('button', 'btn', 'Share instead');
    share.onclick = () => { done(); shareSheet(); };
    row.append(share);
    if (existing) {
      const del = el('button', 'btn', 'Remove from library');
      del.onclick = () => { setLib(lib().filter((x) => x.p !== p)); done(); setPane('library'); toast('Removed'); };
      row.append(del);
    }
    body.append(row);

    setTimeout(() => { input.focus(); input.select(); }, 60);
  });
}

function flashLibrary(p) {
  requestAnimationFrame(() => {
    const items = document.querySelectorAll('#pane-library .lib__item');
    const idx = lib().findIndex((x) => x.p === p);
    const node = items[idx];
    if (!node) return;
    node.classList.add('is-new');
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

/* ---------------- render: strip ---------------- */

const LOCK_ON = '<svg viewBox="0 0 24 24"><path d="M6 10V7a6 6 0 0 1 12 0v3h1.5v12h-15V10H6zm2 0h8V7a4 4 0 0 0-8 0v3z"/></svg>';
const LOCK_OFF = '<svg viewBox="0 0 24 24" opacity=".85"><path d="M6 10V7a6 6 0 0 1 11.6-2.2l-1.9.7A4 4 0 0 0 8 7v3h11.5v12h-15V10H6zm.5 2v8h11v-8h-11z"/></svg>';

const strip = $('#strip');

function renderStrip() {
  strip.replaceChildren();
  state.sw.forEach((s, i) => {
    const view = seen(s.color);
    const node = el('div', 'sw');
    node.style.setProperty('--i', i);
    node.style.background = hex(view);
    node.style.color = on(view);
    node.dataset.locked = s.locked;
    node.dataset.sel = state.sel === i;

    const top = el('div', 'sw__top');
    top.append(el('span', 'sw__idx', String(i + 1).padStart(2, '0')));
    const lock = el('button', 'sw__lock', s.locked ? LOCK_ON : LOCK_OFF);
    lock.title = s.locked ? 'Unlock (' + (i + 1) + ')' : 'Lock (' + (i + 1) + ')';
    lock.setAttribute('aria-pressed', s.locked);
    lock.onclick = (e) => { e.stopPropagation(); s.locked = !s.locked; commit(false); };
    top.append(lock);

    const body = el('div', 'sw__body');
    const inp = el('input', 'sw__hex');
    inp.value = hex(s.color).toUpperCase();
    inp.spellcheck = false;
    inp.setAttribute('aria-label', `Swatch ${i + 1} colour`);
    inp.onclick = (e) => e.stopPropagation();
    inp.onfocus = () => { state.sel = i; renderPane(); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = hex(s.color).toUpperCase(); inp.blur(); } };
    inp.onblur = () => {
      const c = fromHex(inp.value.trim());
      if (c) { s.color = fit(c); commit(); } else { inp.value = hex(s.color).toUpperCase(); toast('Not a colour'); }
    };
    body.append(inp);

    const f = fit(s.color);
    body.append(el('div', 'sw__name', nameOf(s.color)));
    body.append(el('div', 'sw__meta',
      `L ${(f.l * 100).toFixed(0)} · C ${f.c.toFixed(3)} · H ${(f.h || 0).toFixed(0)}°`));

    const acts = el('div', 'sw__acts');
    const act = (label, title, fn) => {
      const b = el('button', 'sw__act', label);
      b.title = title;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      acts.append(b);
    };
    act('COPY', 'Copy hex', () => copy(hex(s.color).toUpperCase()));
    act('↻', 'Reroll this swatch', () => rollOne(i));
    act('◀', 'Move left', () => { if (i > 0) { [state.sw[i - 1], state.sw[i]] = [state.sw[i], state.sw[i - 1]]; state.sel = i - 1; commit(); } });
    act('▶', 'Move right', () => { if (i < N - 1) { [state.sw[i + 1], state.sw[i]] = [state.sw[i], state.sw[i + 1]]; state.sel = i + 1; commit(); } });
    body.append(acts);

    const ramp = el('div', 'sw__ramp');
    scale(s.color).forEach((c, j) => {
      const cell = el('i');
      cell.style.setProperty('--j', j);
      cell.style.background = shex(c);
      cell.title = `${STEPS[j]} · ${hex(c).toUpperCase()}`;
      cell.onclick = (e) => { e.stopPropagation(); s.color = c; state.sel = i; commit(); };
      ramp.append(cell);
    });
    body.append(ramp);

    node.append(top, body);
    node.onclick = () => { state.sel = i; render(); };
    strip.append(node);
  });
}

/* ---------------- render: panes ---------------- */

/** Polar plot of the palette: angle = hue, radius = chroma. The harmony, drawn. */
function hueWheel() {
  const R = 120, cx = 60, cy = 60;
  const RING = 55, PLOT = 44, CMAX = 0.33;
  const pt = (h, r) => [cx + r * Math.cos((h * Math.PI) / 180), cy - r * Math.sin((h * Math.PI) / 180)];
  // ^0.62 opens up the low-chroma end so near-neutrals don't pile onto the origin
  const rad = (c) => Math.pow(clamp(c / CMAX, 0, 1), 0.62) * PLOT;

  const s = svg('svg', { class: 'wheel', viewBox: `-13 -13 ${R + 26} ${R + 26}`, role: 'img' });
  s.setAttribute('aria-label', 'Hue and chroma plot of the palette');

  const ring = hueRing(72);
  const w = (2 * Math.PI * RING) / 72 + 0.6;
  ring.forEach((col, i) => {
    const h = (i * 360) / 72;
    const [x1, y1] = pt(h, RING - 3.5);
    const [x2, y2] = pt(h, RING + 3.5);
    s.append(svg('line', { class: 'seg', x1, y1, x2, y2, stroke: state.cvd ? shex(fromHex(col)) : col, 'stroke-width': w }));
  });

  [0.05, 0.12, 0.22].forEach((c) => s.append(svg('circle', { class: 'grid', cx, cy, r: rad(c) })));
  s.append(svg('circle', { class: 'grid', cx, cy, r: 1.2 }));

  [0, 90, 180, 270].forEach((h) => {
    const [x, y] = pt(h, RING + 10);
    const t = svg('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = h + '°';
    s.append(t);
  });

  state.sw.forEach((sw, i) => {
    const c = fit(sw.color);
    const [x, y] = pt(c.h || 0, rad(c.c));
    s.append(svg('line', { class: 'spoke', x1: cx, y1: cy, x2: x, y2: y }));
    if (state.sel === i) s.append(svg('circle', { cx: x, cy: y, r: 9.5, fill: 'none', stroke: '#e9e7e3', 'stroke-width': 1 }));
    const dot = svg('circle', {
      class: 'node', cx: x, cy: y, r: state.sel === i ? 7 : 5.5,
      fill: shex(c), stroke: '#0a0a0b', 'stroke-width': 1,
    });
    dot.append(svg('title'));
    dot.lastChild.textContent = `${i + 1} · ${nameOf(c)} · H ${(c.h || 0).toFixed(0)}° C ${c.c.toFixed(3)}`;
    dot.onclick = () => { state.sel = i; render(); };
    s.append(dot);
  });

  return s;
}

function paneInspect(root) {
  const s = state.sw[state.sel];
  const c = fit(s.color);
  const view = seen(c);

  const head = el('div', 'ins__head');
  const chip = el('div', 'ins__chip');
  chip.style.background = hex(view);
  const meta = el('div');
  meta.append(el('div', 'ins__title', nameOf(c)));
  meta.append(el('div', 'ins__sub',
    `SWATCH ${state.sel + 1} · ${s.locked ? 'LOCKED' : 'FREE'}${state.cvd ? ' · ' + state.cvd.toUpperCase() : ''}`));
  const fmt = el('dl', 'fmt');
  [['HEX', hex(c).toUpperCase()], ['OKLCH', oklchStr(c)], ['RGB', rgbStr(c)], ['HSL', hslStr(c)]].forEach(([k, v]) => {
    fmt.append(el('dt', null, k));
    const dd = el('dd', null, v);
    dd.title = 'Copy';
    dd.onclick = () => copy(v);
    fmt.append(dd);
  });
  meta.style.minWidth = '0';
  meta.append(fmt);
  head.append(chip, meta);
  root.append(head);

  root.append(el('div', 'eyebrow', 'Hue &amp; chroma'));
  root.append(hueWheel());

  root.append(el('div', 'eyebrow', 'Perceptual controls'));
  const mk = (label, key, min, max, step, fmtv) => {
    const row = el('div', 'slider');
    row.append(el('label', null, label));
    const r = el('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step;
    r.value = key === 'l' ? c.l : key === 'c' ? c.c : (c.h || 0);
    const out = el('output', null, fmtv(+r.value));
    r.oninput = () => {
      const next = { mode: 'oklch', l: c.l, c: c.c, h: c.h || 0 };
      next[key] = +r.value;
      out.textContent = fmtv(+r.value);
      s.color = fit(next);
      renderStrip();
      chip.style.background = shex(s.color);
      updateStatus();
    };
    r.onchange = () => commit();
    row.append(r, out);
    root.append(row);
  };
  mk('L', 'l', 0, 1, 0.001, (v) => (v * 100).toFixed(1) + '%');
  mk('C', 'c', 0, Math.max(0.05, Math.ceil(maxChroma(c.l, c.h || 0) * 100) / 100), 0.001, (v) => v.toFixed(3));
  mk('H', 'h', 0, 360, 0.5, (v) => v.toFixed(0) + '°');

  root.append(el('div', 'eyebrow', 'Tints &amp; shades'));
  const ramp = el('div', 'ramp');
  scale(c).forEach((sc, j) => {
    const b = el('button', null, String(STEPS[j]));
    b.style.background = shex(sc);
    b.style.color = on(seen(sc));
    b.title = `${hex(sc).toUpperCase()} — click to adopt, shift-click to copy`;
    b.onclick = (e) => {
      if (e.shiftKey) return copy(hex(sc).toUpperCase());
      s.color = sc; commit();
    };
    ramp.append(b);
  });
  root.append(ramp);

  root.append(el('div', 'eyebrow', 'Blends'));
  state.sw.forEach((o, i) => {
    if (i === state.sel) return;
    const row = el('div', 'blend');
    row.append(el('b', null, `0${i + 1}`));
    const track = el('div', 'blend__track');
    for (let j = 0; j < 9; j++) {
      const b = el('button');
      const m = fit(mix(c, o.color, (j + 1) / 10));
      b.style.background = shex(m);
      b.title = `${hex(m).toUpperCase()} — click to adopt`;
      b.onclick = () => { s.color = m; commit(); };
      track.append(b);
    }
    row.append(track);
    root.append(row);
  });

  root.append(el('div', 'eyebrow', 'Against the rest'));
  const list = el('dl', 'fmt');
  state.sw.forEach((o, i) => {
    if (i === state.sel) return;
    const r = wcag(c, o.color);
    const lc = apca(c, o.color);
    list.append(el('dt', null, `0${i + 1}`));
    const dd = el('dd', null,
      `<span class="${r >= 4.5 ? 'pass' : r >= 3 ? 'warn' : 'fail'}">${r.toFixed(2)}:1</span> · Lc ${lc.toFixed(0)} · ${wcagGrade(r)}`);
    dd.onclick = () => { state.pair = [state.sel, i]; setPane('contrast'); };
    list.append(dd);
  });
  root.append(list);
}

function mapUI(cols, mode) {
  const byL = cols.map((c) => fit(c)).sort((a, b) => a.l - b.l);
  const byC = cols.map((c) => fit(c)).slice().sort((a, b) => b.c - a.c);
  const dark = byL[0], light = byL[byL.length - 1];
  const bg = mode === 'light' ? light : dark;
  const text = mode === 'light' ? dark : light;
  // primary = most chromatic colour that still separates from the background
  const primary = byC.find((c) => wcag(c, bg) >= 2.4) || byC[0];
  const accent = byC.find((c) => c !== primary && wcag(c, bg) >= 1.8) || byC[1] || byC[0];
  return {
    bg,
    surface: mix(bg, text, mode === 'light' ? 0.05 : 0.08),
    line: mix(bg, text, 0.16),
    text,
    dim: mix(text, bg, 0.4),
    primary,
    onPrimary: on(primary),
    accent,
    onAccent: on(accent),
  };
}

function panePreview(root) {
  const seg = el('div', 'seg');
  ['light', 'dark'].forEach((m) => {
    const b = el('button', state.pvMode === m ? 'is-on' : '', m === 'light' ? 'Light map' : 'Dark map');
    b.onclick = () => { state.pvMode = m; renderPane(); };
    seg.append(b);
  });
  root.append(seg);

  const u = mapUI(colors(), state.pvMode);
  const H = (c) => shex(c);

  const card = el('div', 'pv');
  card.style.background = H(u.bg);
  card.style.color = H(u.text);
  card.style.borderColor = H(u.line);

  const bar = el('div', 'pv__bar');
  bar.style.borderBottom = `1px solid ${H(u.line)}`;
  const dot = el('span', 'pv__dot');
  dot.style.background = H(u.primary);
  bar.append(dot, el('b', null, 'Northbound'));
  const tag = el('span', 'pv__tag', 'beta');
  tag.style.background = H(u.accent);
  tag.style.color = u.onAccent;
  tag.style.marginLeft = 'auto';
  bar.append(tag);

  const body = el('div', 'pv__body');
  body.append(el('h3', null, 'Every colour decision, in one place.'));
  const p = el('p', null, 'A palette is only as good as the interface it survives. This is that interface.');
  p.style.color = H(u.dim);
  body.append(p);

  const row = el('div', 'pv__row');
  const b1 = el('button', 'pv__btn', 'Get started');
  b1.style.background = H(u.primary); b1.style.color = u.onPrimary;
  const b2 = el('button', 'pv__btn pv__btn--ghost', 'Documentation');
  b2.style.color = H(u.text);
  const b3 = el('button', 'pv__btn', 'Upgrade');
  b3.style.background = H(u.accent); b3.style.color = u.onAccent;
  row.append(b1, b2, b3);
  body.append(row);

  const stats = el('div', 'pv__stats');
  [['2,481', 'sessions'], ['94.2%', 'retention'], ['0.31s', 'p95']].forEach(([v, k], i) => {
    const s = el('div', 'pv__stat');
    s.style.background = H(mix(u.bg, u.text, 0.05 + i * 0.008));
    s.append(el('b', null, v), el('span', null, k));
    s.style.color = H(u.text);
    s.lastChild.style.color = H(u.dim);
    stats.append(s);
  });
  body.append(stats);

  const chart = el('div', 'pv__chart');
  [38, 62, 47, 88, 71, 54, 95, 66, 41, 79, 58, 84].forEach((v, i) => {
    const bar = el('i');
    bar.style.height = v + '%';
    bar.style.background = H(i % 3 === 2 ? u.accent : mix(u.primary, u.bg, i % 3 === 1 ? 0.42 : 0));
    chart.append(bar);
  });
  body.append(chart);

  const foot = el('p', null, 'Sampled from the last 30 days of traffic.');
  foot.style.color = H(u.dim);
  foot.style.fontSize = '11px';
  foot.style.marginTop = '11px';
  body.append(foot);

  card.append(bar, body);
  root.append(card);

  root.append(el('div', 'eyebrow', 'Role assignment'));
  const dl = el('dl', 'fmt');
  [['bg', u.bg], ['surface', u.surface], ['text', u.text], ['primary', u.primary], ['accent', u.accent], ['line', u.line]].forEach(([k, v]) => {
    dl.append(el('dt', null, k));
    const dd = el('dd', null, `<span class="dot" style="background:${H(v)}"></span>${hex(v).toUpperCase()}`);
    dd.onclick = () => copy(hex(v).toUpperCase());
    dl.append(dd);
  });
  root.append(dl);

  const warn = wcag(u.text, u.bg);
  const note = el('div', 'ins__sub');
  note.innerHTML = `Body text on background: <span class="${warn >= 4.5 ? 'pass' : warn >= 3 ? 'warn' : 'fail'}">${warn.toFixed(2)}:1</span> · Lc ${apca(u.text, u.bg).toFixed(0)}`;
  note.style.marginTop = '12px';
  root.append(note);
}

function paneContrast(root) {
  root.append(el('div', 'eyebrow', 'Every pair · WCAG 2.1'));
  const mx = el('div', 'mx');
  mx.style.gridTemplateColumns = `20px repeat(${N}, 1fr)`;
  mx.append(el('div', 'mx__head', ''));
  for (let j = 0; j < N; j++) mx.append(el('div', 'mx__head', String(j + 1)));
  for (let i = 0; i < N; i++) {
    mx.append(el('div', 'mx__head', String(i + 1)));
    for (let j = 0; j < N; j++) {
      const cell = el('button', 'mx__cell');
      if (i === j) {
        cell.style.background = shex(state.sw[i].color);
        cell.style.color = on(seen(state.sw[i].color));
        cell.innerHTML = '<u>—</u>';
      } else {
        const r = wcag(state.sw[i].color, state.sw[j].color);
        cell.style.background = shex(state.sw[j].color);
        cell.style.color = shex(state.sw[i].color);
        cell.innerHTML = `${r.toFixed(1)}<u>${wcagGrade(r)}</u>`;
      }
      cell.title = `Text ${i + 1} on background ${j + 1}`;
      cell.onclick = () => { state.pair = [i, j]; renderPane(); };
      mx.append(cell);
    }
  }
  root.append(mx);

  const [ti, bi] = state.pair;
  const t = state.sw[ti].color, b = state.sw[bi].color;

  root.append(el('div', 'eyebrow', `Text ${ti + 1} on background ${bi + 1}`));
  const sel = el('div', 'seg seg--pair');
  const mkSel = (which, label) => {
    const wrap = el('div');
    wrap.append(el('span', null, label));
    for (let i = 0; i < N; i++) {
      const b2 = el('button', state.pair[which] === i ? 'is-on' : '', String(i + 1));
      b2.style.flex = '1';
      b2.title = `${label} = swatch ${i + 1}`;
      b2.onclick = () => { state.pair[which] = i; renderPane(); };
      wrap.append(b2);
    }
    return wrap;
  };
  sel.append(mkSel(0, 'TEXT'), mkSel(1, 'BG'));
  root.append(sel);

  const pair = el('div', 'pair');
  pair.style.background = shex(b);
  pair.style.color = shex(t);
  pair.append(el('div', 'pair__lg', 'Grotesque at 27 pixels'));
  pair.append(el('div', 'pair__md', 'Semibold body copy at 15px'));
  pair.append(el('div', 'pair__sm', 'And the small print, at twelve pixels, where accessibility usually goes quietly wrong.'));
  root.append(pair);

  const r = wcag(t, b);
  const lc = apca(t, b);
  const g = el('div', 'grades');
  const cls = r >= 4.5 ? 'pass' : r >= 3 ? 'warn' : 'fail';
  const lcls = Math.abs(lc) >= 60 ? 'pass' : Math.abs(lc) >= 45 ? 'warn' : 'fail';
  const g1 = el('div', 'grade', `<span>WCAG 2.1</span><b class="${cls}">${r.toFixed(2)}:1</b><em class="${cls}">${wcagGrade(r)}</em>`);
  const g2 = el('div', 'grade', `<span>APCA Lc</span><b class="${lcls}">${lc.toFixed(1)}</b><em class="${lcls}">${apcaGrade(lc)}</em>`);
  g.append(g1, g2);
  root.append(g);

  const detail = el('dl', 'fmt');
  [
    ['AA body', r >= 4.5], ['AA large', r >= 3], ['AAA body', r >= 7], ['AAA large', r >= 4.5],
  ].forEach(([k, ok]) => {
    detail.append(el('dt', null, k));
    detail.append(el('dd', null, `<span class="${ok ? 'pass' : 'fail'}">${ok ? 'pass' : 'fail'}</span>`));
  });
  detail.style.marginTop = '12px';
  root.append(detail);

  const fixNote = el('div', 'ins__sub');
  fixNote.style.marginTop = '12px';
  if (r < 4.5) {
    const btn = el('button', 'btn');
    btn.textContent = 'Nudge text lightness to AA';
    btn.onclick = () => {
      const base = fit(t), bgc = fit(b);
      const dir = bgc.l > base.l ? -1 : 1;
      let best = base;
      for (let i = 0; i <= 100; i++) {
        const cand = fit({ mode: 'oklch', l: clamp(base.l + dir * i * 0.01, 0, 1), c: base.c, h: base.h });
        best = cand;
        if (wcag(cand, bgc) >= 4.5) break;
      }
      state.sw[ti].color = best;
      commit();
      toast(`Swatch ${ti + 1} nudged to ${wcag(best, bgc).toFixed(2)}:1`);
    };
    fixNote.append(btn);
  } else {
    fixNote.textContent = 'This pair clears AA for body text.';
  }
  root.append(fixNote);
}

/* ---------------- exports ---------------- */

function exportText(fmt) {
  const ns = names();
  const cols = colors();
  const rule = HARMONIES[state.harmony].label;

  if (fmt === 'hex') return cols.map((c) => hex(c).toUpperCase()).join('\n');

  if (fmt === 'json') {
    return JSON.stringify({
      name: `${ns[0].label} / ${ns[N - 1].label}`,
      harmony: state.harmony,
      url: location.href,
      colors: cols.map((c, i) => {
        const f = fit(c);
        return {
          name: ns[i].label,
          key: ns[i].key,
          hex: hex(c).toUpperCase(),
          rgb: rgbStr(c),
          hsl: hslStr(c),
          oklch: { l: +f.l.toFixed(4), c: +f.c.toFixed(4), h: +(f.h || 0).toFixed(2) },
          locked: state.sw[i].locked,
          scale: Object.fromEntries(scale(c).map((s, j) => [STEPS[j], hex(s).toUpperCase()])),
          contrast: { onWhite: +wcag(c, fromHex('#ffffff')).toFixed(2), onBlack: +wcag(c, fromHex('#000000')).toFixed(2) },
        };
      }),
    }, null, 2);
  }

  if (fmt === 'css') {
    const base = cols.map((c, i) => `  --${ns[i].key}: ${hex(c)};`).join('\n');
    const ok = cols.map((c, i) => `  --${ns[i].key}: ${oklchStr(c)};`).join('\n');
    const scales = cols.map((c, i) =>
      scale(c).map((s, j) => `  --${ns[i].key}-${STEPS[j]}: ${hex(s)};`).join('\n')).join('\n\n');
    return `/* Pigment — ${rule} palette */\n:root {\n${base}\n\n${scales}\n}\n\n/* Wide-gamut: same colours, perceptual space */\n@supports (color: oklch(0% 0 0)) {\n  :root {\n${ok.replace(/^ {2}/gm, '    ')}\n  }\n}\n`;
  }

  // tailwind — v4 @theme first, v3 config below
  const v4 = cols.map((c, i) =>
    scale(c).map((s, j) => `  --color-${ns[i].key}-${STEPS[j]}: ${oklchStr(s)};`).join('\n')).join('\n\n');
  const v3 = cols.map((c, i) =>
    `        '${ns[i].key}': {\n${scale(c).map((s, j) => `          ${STEPS[j]}: '${hex(s)}',`).join('\n')}\n        },`).join('\n');
  return `/* Tailwind v4 — app.css */\n@import "tailwindcss";\n\n@theme {\n${v4}\n}\n\n/* Tailwind v3 — tailwind.config.js */\n/*\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n${v3}\n      },\n    },\n  },\n};\n*/\n`;
}

function highlight(text) {
  return text
    .replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="c-com">$1</span>')
    .replace(/(#[0-9a-fA-F]{6}|oklch\([^)]*\)|rgb\([^)]*\)|hsl\([^)]*\))/g, '<span class="c-val">$1</span>')
    .replace(/(--[a-z0-9-]+|"[a-z]+":)/g, '<span class="c-key">$1</span>');
}

function paneExport(root) {
  const seg = el('div', 'seg');
  [['css', 'CSS'], ['tailwind', 'Tailwind'], ['json', 'JSON'], ['hex', 'Hex']].forEach(([k, label]) => {
    const b = el('button', state.fmt === k ? 'is-on' : '', label);
    b.onclick = () => { state.fmt = k; renderPane(); };
    seg.append(b);
  });
  root.append(seg);

  const text = exportText(state.fmt);
  const pre = el('pre', 'code');
  pre.innerHTML = highlight(text);
  root.append(pre);

  const row = el('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:12px';
  const cp = el('button', 'btn btn--primary', 'Copy');
  cp.onclick = () => copy(text, `${state.fmt.toUpperCase()} copied`);
  const dl = el('button', 'btn', 'Download');
  dl.onclick = () => {
    const ext = { css: 'css', tailwind: 'css', json: 'json', hex: 'txt' }[state.fmt];
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `pigment-${names()[0].key}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Downloaded');
  };
  const sv = el('button', 'btn', 'SVG sheet');
  sv.onclick = () => { download(svgSheet(), `pigment-${names()[0].key}.svg`); toast('SVG downloaded'); };
  const sh = el('button', 'btn', 'Share…');
  sh.onclick = shareSheet;
  row.append(cp, dl, sv, sh);
  root.append(row);
}

const ago = (t) => {
  if (!t) return '';
  const m = (Date.now() - t) / 6e4;
  if (m < 1) return 'just now';
  if (m < 60) return `${m | 0}m ago`;
  if (m < 1440) return `${(m / 60) | 0}h ago`;
  return `${(m / 1440) | 0}d ago`;
};

function paneLibrary(root) {
  const items = lib();
  const current = colors().map((c) => hex(c).slice(1)).join('-');

  const row = el('div', 'sheet__row');
  row.style.marginBottom = '14px';
  const sv = el('button', 'btn btn--primary', items.some((x) => x.p === current) ? 'Saved ✓' : 'Save current');
  sv.onclick = saveSheet;
  const sh = el('button', 'btn', 'Share');
  sh.onclick = shareSheet;
  row.append(sv, sh);
  root.append(row);

  root.append(el('div', 'eyebrow', `Saved · ${items.length}`));
  if (!items.length) {
    root.append(el('div', 'empty', 'Nothing saved yet — press S, or hit Save current above. Palettes are kept in this browser.'));
    return;
  }

  const wrap = el('div', 'lib');
  items.forEach((it, i) => {
    const card = el('div', 'lib__item');
    if (it.p === current) card.classList.add('is-current');
    const sw = el('div', 'lib__sw');
    it.p.split('-').forEach((h) => {
      const s = el('span');
      s.style.background = '#' + h;
      sw.append(s);
    });
    const foot = el('div', 'lib__foot');
    foot.append(el('span', 'lib__name', it.n));
    const meta = el('span', 'lib__meta');
    meta.textContent = [(HARMONIES[it.h]?.label || '').toUpperCase(), ago(it.t)].filter(Boolean).join(' · ');
    foot.append(meta);

    const act = (label, title, fn) => {
      const b = el('button', 'lib__x', label);
      b.title = title;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      foot.append(b);
    };
    act('↗', 'Copy share link', () => {
      copy(`${location.origin}${location.pathname}?p=${it.p}&h=${it.h || 'auto'}`, `Link to “${it.n}” copied`);
    });
    act('✕', 'Delete', () => {
      const l = lib(); l.splice(i, 1); setLib(l); renderPane(); toast(`Deleted “${it.n}”`);
    });

    card.append(sw, foot);
    card.onclick = () => {
      if (loadSnap(it.p)) {
        state.harmony = it.h || 'auto';
        state.sw.forEach((s) => (s.locked = false));
        commit();
        toast(`Loaded “${it.n}”`);
      }
    };
    wrap.append(card);
  });
  root.append(wrap);
}


const PANES = { inspect: paneInspect, preview: panePreview, contrast: paneContrast, export: paneExport, library: paneLibrary };

function renderPane() {
  const root = $('#pane-' + state.pane);
  root.replaceChildren();
  PANES[state.pane](root);
}

function setPane(name) {
  state.pane = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset.pane === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('is-on', p.id === 'pane-' + name));
  renderPane();
}

/* ---------------- status ---------------- */

function updateStatus() {
  // keep the rule selector honest — a pasted share link changes state.harmony
  // without going through the buttons
  document.querySelectorAll('#harmony button').forEach((b) =>
    b.setAttribute('aria-checked', b.dataset.key === state.harmony));
  $('#cvd').value = state.cvd;
  $('#statRule').textContent = HARMONIES[state.harmony].label.toUpperCase();
  let lo = Infinity, hi = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const r = wcag(state.sw[i].color, state.sw[j].color);
    lo = Math.min(lo, r); hi = Math.max(hi, r);
  }
  $('#statContrast').textContent = `CONTRAST ${lo.toFixed(2)} → ${hi.toFixed(2)}`;
  $('#undo').disabled = state.hi <= 0;
  $('#redo').disabled = state.hi >= state.hist.length - 1;
}

function render() {
  renderStrip();
  renderPane();
  updateStatus();
}

/* ---------------- image extraction ---------------- */

function fromImage(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Not an image');
  const img = new Image();
  img.onload = () => {
    const cv = $('#canvas');
    const maxSide = 220;
    const s = Math.min(1, maxSide / Math.max(img.width, img.height));
    cv.width = Math.max(1, Math.round(img.width * s));
    cv.height = Math.max(1, Math.round(img.height * s));
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    let data;
    try { data = ctx.getImageData(0, 0, cv.width, cv.height); }
    catch { URL.revokeObjectURL(img.src); return toast('Could not read that image'); }
    const found = extract(data, N);
    if (!found.length) { URL.revokeObjectURL(img.src); return toast('No colours found'); }
    // preserve locked swatches; fill the rest, lightest-first for a readable ramp
    const open = state.sw.map((s, i) => (s.locked ? -1 : i)).filter((i) => i >= 0);
    const use = found.slice(0, open.length).sort((a, b) => b.l - a.l);
    open.forEach((idx, k) => { state.sw[idx].color = use[k % use.length] || state.sw[idx].color; });
    URL.revokeObjectURL(img.src);
    commit();
    toast(`Extracted ${use.length} colours`);
  };
  img.onerror = () => toast('Could not load that image');
  img.src = URL.createObjectURL(file);
}

/* ---------------- wiring ---------------- */

function buildHarmony() {
  const nav = $('#harmony');
  Object.entries(HARMONIES).forEach(([key, { label }]) => {
    const b = el('button', null, label);
    b.dataset.key = key;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', state.harmony === key);
    b.onclick = () => { state.harmony = key; roll(); };
    nav.append(b);
  });
}

function undo(dir) {
  const next = state.hi + dir;
  if (next < 0 || next >= state.hist.length) return;
  state.hi = next;
  loadSnap(state.hist[next]);
  commit(false);
}

function init() {
  const seeded = readURL();
  if (!seeded) {
    state.sw = Array.from({ length: N }, () => ({ color: fromHex('#808080'), locked: false }));
    state.sw = generate(state.sw, state.harmony).map((c) => ({ color: c, locked: false }));
  }
  state.hist = [colors().map(hex).join('-')];
  state.hi = 0;

  buildHarmony();
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => setPane(t.dataset.pane)));

  $('#gen').onclick = roll;
  $('#undo').onclick = () => undo(-1);
  $('#redo').onclick = () => undo(1);
  $('#save').onclick = saveSheet;
  $('#share').onclick = shareSheet;
  $('#file').onchange = (e) => { fromImage(e.target.files[0]); e.target.value = ''; };
  $('#cvd').onchange = (e) => { state.cvd = e.target.value; render(); };
  $('#dockToggle').onclick = toggleDock;

  const motion = $('#motion');
  const applyMotion = (v) => {
    document.documentElement.dataset.motion = v;
    motion.textContent = 'motion: ' + (v === 'off' ? 'off' : 'on');
    localStorage.setItem('pigment.motion', v);
  };
  applyMotion(localStorage.getItem('pigment.motion') || 'auto');
  motion.onclick = () => applyMotion(document.documentElement.dataset.motion === 'off' ? 'on' : 'off');

  // drag & drop anywhere
  const drop = $('#drop');
  let depth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); if (++depth === 1) drop.classList.add('is-on'); });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.classList.remove('is-on'); } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; drop.classList.remove('is-on');
    fromImage(e.dataTransfer.files[0]);
  });
  addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f) return fromImage(f);
    const t = e.clipboardData?.getData('text')?.trim();
    if (t && fromHex(t)) { state.sw[state.sel].color = fit(fromHex(t)); commit(); toast('Pasted ' + t); }
  });

  // a link pasted into this same tab, or back/forward
  addEventListener('hashchange', () => { if (readURL()) commit(false); });
  addEventListener('popstate', () => { if (readURL()) commit(false); });

  addEventListener('keydown', (e) => {
    if (closeModal) return;               // a sheet is open; it owns the keyboard
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); return roll(); }
    if (k >= '1' && k <= String(N)) { const i = +k - 1; state.sw[i].locked = !state.sw[i].locked; state.sel = i; return commit(false); }
    if (k === 'ArrowLeft') { e.preventDefault(); state.sel = (state.sel + N - 1) % N; return render(); }
    if (k === 'ArrowRight') { e.preventDefault(); state.sel = (state.sel + 1) % N; return render(); }
    const l = k.toLowerCase();
    if (l === 'c') return copy(hex(state.sw[state.sel].color).toUpperCase());
    if (l === 'z') return undo(e.shiftKey ? 1 : -1);
    if (l === 's') { e.preventDefault(); return saveSheet(); }
    if (l === 'h') { e.preventDefault(); return shareSheet(); }
    if (l === 'i') return $('#file').click();
    if (l === 'r') return rollOne(state.sel);
    if (k === '\\') return toggleDock();
    const idx = ['inspect', 'preview', 'contrast', 'export', 'library'].indexOf(
      { q: 'inspect', w: 'preview', e: 'contrast', x: 'export', l: 'library' }[l]);
    if (idx >= 0) setPane(['inspect', 'preview', 'contrast', 'export', 'library'][idx]);
  });

  setPane('inspect');
  syncURL();
  render();
}

function toggleDock() {
  const app = $('#app');
  app.dataset.dock = app.dataset.dock === 'off' ? 'on' : 'off';
}

init();
