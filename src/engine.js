/* Pigment — color engine.
   Everything perceptual happens in OKLab/OKLCH. sRGB is only an output format. */

import { converter, formatHex, parse, wcagContrast, differenceEuclidean } from 'culori';
import { NAMES } from './names.gen.js';

export const toOklch = converter('oklch');
export const toOklab = converter('oklab');
export const toRgb = converter('rgb');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ---------- gamut ---------- */

const inGamut = (rgb) =>
  rgb.r >= -1e-4 && rgb.r <= 1.0001 &&
  rgb.g >= -1e-4 && rgb.g <= 1.0001 &&
  rgb.b >= -1e-4 && rgb.b <= 1.0001;

/** Largest chroma that still lands inside sRGB for a given L/H. */
export function maxChroma(l, h) {
  if (l <= 0 || l >= 1) return 0;
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(toRgb({ mode: 'oklch', l, c: mid, h }))) lo = mid; else hi = mid;
  }
  return lo;
}

/** Pull a color back into sRGB by reducing chroma only — preserves L and H. */
export function fit(col) {
  const c = { mode: 'oklch', l: clamp(col.l, 0, 1), c: Math.max(0, col.c), h: col.h ?? 0 };
  const m = maxChroma(c.l, c.h);
  if (c.c > m) c.c = m;
  return c;
}

export const hex = (col) => formatHex(toRgb(fit(col))) || '#000000';

export function fromHex(str) {
  const p = parse(str);
  if (!p) return null;
  const o = toOklch(p);
  return { mode: 'oklch', l: o.l, c: o.c || 0, h: Number.isNaN(o.h) || o.h == null ? 0 : o.h };
}

/* ---------- harmony ---------- */

export const HARMONIES = {
  auto:        { label: 'Auto',              offsets: null },
  analogous:   { label: 'Analogous',         offsets: [0, 22, -22, 44, -44], jitter: 5 },
  monochrome:  { label: 'Monochrome',        offsets: [0, 0, 0, 0, 0], jitter: 3 },
  complement:  { label: 'Complementary',     offsets: [0, 180, 0, 180, 0], jitter: 7 },
  split:       { label: 'Split-complement',  offsets: [0, 150, 210, 0, 150], jitter: 6 },
  triadic:     { label: 'Triadic',           offsets: [0, 120, 240, 0, 120], jitter: 6 },
  tetradic:    { label: 'Tetradic',          offsets: [0, 90, 180, 270, 0], jitter: 6 },
};
const AUTO_POOL = ['analogous', 'complement', 'split', 'triadic', 'tetradic', 'monochrome'];

/* ---------- scoring ---------- */

const dE = differenceEuclidean('oklab');

function score(cols) {
  const ls = cols.map((c) => c.l);
  const spread = Math.max(...ls) - Math.min(...ls);
  const sorted = [...ls].sort((a, b) => a - b);
  let minGap = 1;
  for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i] - sorted[i - 1]);

  let minDist = 1;
  let maxRatio = 1;
  for (let i = 0; i < cols.length; i++)
    for (let j = i + 1; j < cols.length; j++) {
      minDist = Math.min(minDist, dE(cols[i], cols[j]));
      maxRatio = Math.max(maxRatio, wcagContrast(toRgb(cols[i]), toRgb(cols[j])) || 1);
    }

  const cs = cols.map((c) => c.c);
  const hasQuiet = Math.min(...cs) < 0.055;
  const hasVivid = Math.max(...cs) > 0.09;

  return (
    clamp(spread / 0.62, 0, 1) * 0.30 +
    clamp(minGap / 0.09, 0, 1) * 0.22 +
    clamp(minDist / 0.16, 0, 1) * 0.24 +
    clamp((maxRatio - 3) / 6, 0, 1) * 0.14 +
    (hasQuiet ? 0.05 : 0) +
    (hasVivid ? 0.05 : 0)
  );
}

/* ---------- generation ---------- */

function lightnessRamp(n, taken) {
  // Well-spaced L values that also avoid the locked colors' lightness.
  const out = [];
  const lo = rnd(0.13, 0.31);
  const hi = rnd(0.84, 0.97);
  for (let i = 0; i < n; i++) {
    let best = null, bestGap = -1;
    for (let t = 0; t < 26; t++) {
      const v = rnd(lo, hi);
      const gap = [...taken, ...out].reduce((m, o) => Math.min(m, Math.abs(o - v)), 1);
      if (gap > bestGap) { bestGap = gap; best = v; }
    }
    out.push(best);
  }
  return out.sort((a, b) => a - b);
}

function candidate(base, harmony, slots, locked) {
  const spec = HARMONIES[harmony] ?? HARMONIES.auto;
  const offsets = spec.offsets ?? HARMONIES[pick(AUTO_POOL)].offsets;
  const jitter = spec.jitter ?? 6;

  const ls = lightnessRamp(slots.length, locked.map((c) => c.l));
  if (Math.random() < 0.45) ls.reverse();

  const temperament = rnd(0.32, 0.98);       // palette-wide saturation appetite
  const quietSlot = Math.random() < 0.75 ? (Math.random() * slots.length) | 0 : -1;

  return slots.map((slotIdx, i) => {
    const l = ls[i];
    const h = (base + offsets[slotIdx % offsets.length] + rnd(-jitter, jitter) + 360) % 360;
    const mc = maxChroma(l, h);
    // bell curve: mid-lightness colors carry the chroma, the ends stay usable as bg/fg
    const bell = Math.sin(Math.PI * clamp(l, 0, 1)) ** 0.85;
    let c = mc * bell * temperament * rnd(0.72, 1.06);
    if (i === quietSlot) c *= rnd(0.06, 0.3);
    return fit({ mode: 'oklch', l, c, h });
  });
}

/**
 * Build a palette around whatever is locked.
 * @param {{color:object, locked:boolean}[]} swatches
 * @param {string} harmony
 */
export function generate(swatches, harmony) {
  const lockedCols = swatches.filter((s) => s.locked).map((s) => s.color);
  const slots = swatches.map((s, i) => (s.locked ? -1 : i)).filter((i) => i >= 0);
  if (!slots.length) return swatches.map((s) => s.color);

  // Anchor the hue on the most saturated locked color, else roll one.
  const anchor = lockedCols.slice().sort((a, b) => b.c - a.c)[0];
  const base = anchor && anchor.c > 0.02 ? anchor.h : Math.random() * 360;

  let best = null;
  for (let t = 0; t < 180; t++) {
    const gen = candidate(base, harmony, slots, lockedCols);
    const full = swatches.map((s) => s.color);
    slots.forEach((slotIdx, i) => { full[slotIdx] = gen[i]; });
    const s = score(full);
    if (!best || s > best.s) best = { s, full };
    if (best.s > 0.92) break;
  }
  return best.full;
}

/* ---------- tints & shades ---------- */

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const RAMP_L = [0.975, 0.94, 0.885, 0.81, 0.72, 0.63, 0.545, 0.455, 0.365, 0.27, 0.19];
const bellAt = (i) => 0.42 + 0.58 * Math.sin(Math.PI * (0.12 + 0.76 * (i / (RAMP_L.length - 1))));

/**
 * 11-step scale in OKLCH — hue held, lightness eased, chroma bell-curved.
 * The ramp is *anchored*: the step nearest the source lightness is the source
 * colour exactly, so `--x-600` and `--x` are never two different colours.
 */
export function scale(col) {
  const src = fit(col);
  let k = 0;
  for (let i = 1; i < RAMP_L.length; i++)
    if (Math.abs(RAMP_L[i] - src.l) < Math.abs(RAMP_L[k] - src.l)) k = i;

  // warp each half of the lightness ramp so step k lands on the source
  const lo = RAMP_L[0], hi = RAMP_L[RAMP_L.length - 1], mid = RAMP_L[k];
  const warp = (l, i) => {
    if (i === k) return src.l;
    return i < k
      ? lo + ((l - lo) / (mid - lo || 1)) * (src.l - lo)
      : src.l + ((l - mid) / (hi - mid || 1)) * (hi - src.l);
  };

  const anchorMax = maxChroma(src.l, src.h);
  const factor = anchorMax > 0 ? src.c / (anchorMax * bellAt(k)) : 0;

  return RAMP_L.map((l0, i) => {
    const l = clamp(warp(l0, i), 0.02, 0.995);
    return fit({ mode: 'oklch', l, c: maxChroma(l, src.h) * bellAt(i) * factor, h: src.h });
  });
}

/** Reference ring for the hue wheel — cached, palette-independent. */
let WHEEL = null;
export function hueRing(steps = 72) {
  if (WHEEL) return WHEEL;
  WHEEL = Array.from({ length: steps }, (_, i) => {
    const h = (i * 360) / steps;
    return hex({ mode: 'oklch', l: 0.72, c: maxChroma(0.72, h) * 0.9, h });
  });
  return WHEEL;
}

/* ---------- contrast ---------- */

export const wcag = (a, b) => wcagContrast(toRgb(a), toRgb(b)) || 1;

export function wcagGrade(r) {
  if (r >= 7) return 'AAA';
  if (r >= 4.5) return 'AA';
  if (r >= 3) return 'AA·lg';
  return 'fail';
}

/* APCA 0.1.9 (W3C draft) — lightness contrast, signed. Polarity matters. */
const sY = (col) => {
  const c = toRgb(fit(col));
  const f = (v) => Math.pow(clamp(v, 0, 1), 2.4);
  return 0.2126729 * f(c.r) + 0.7151522 * f(c.g) + 0.0721750 * f(c.b);
};

export function apca(text, bg) {
  let txtY = sY(text), bgY = sY(bg);
  const blkThrs = 0.022, blkClmp = 1.414;
  if (txtY < blkThrs) txtY += Math.pow(blkThrs - txtY, blkClmp);
  if (bgY < blkThrs) bgY += Math.pow(blkThrs - bgY, blkClmp);
  if (Math.abs(bgY - txtY) < 0.0005) return 0;
  let out;
  if (bgY > txtY) {
    const s = (Math.pow(bgY, 0.56) - Math.pow(txtY, 0.57)) * 1.14;
    out = s < 0.1 ? 0 : s - 0.027;
  } else {
    const s = (Math.pow(bgY, 0.65) - Math.pow(txtY, 0.62)) * 1.14;
    out = s > -0.1 ? 0 : s + 0.027;
  }
  return out * 100;
}

/** Plain-language read on an APCA Lc value. */
export function apcaGrade(lc) {
  const a = Math.abs(lc);
  if (a >= 90) return 'any text';
  if (a >= 75) return 'body text';
  if (a >= 60) return 'content';
  if (a >= 45) return 'large only';
  if (a >= 30) return 'headline';
  return 'decorative';
}

/* ---------- colour-vision deficiency (Machado 2009, severity 1.0) ---------- */

const CVD = {
  protanopia:   [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritanopia:   [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
  achromatopsia: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
};
export const CVD_TYPES = Object.keys(CVD);

const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const gam = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(clamp(v, 0, 1), 1 / 2.4) - 0.055);

export function simulate(col, type) {
  const m = CVD[type];
  if (!m) return col;
  const c = toRgb(fit(col));
  const r = lin(c.r), g = lin(c.g), b = lin(c.b);
  return toOklch({
    mode: 'rgb',
    r: clamp(gam(m[0] * r + m[1] * g + m[2] * b), 0, 1),
    g: clamp(gam(m[3] * r + m[4] * g + m[5] * b), 0, 1),
    b: clamp(gam(m[6] * r + m[7] * g + m[8] * b), 0, 1),
  });
}

/* ---------- image extraction: k-means++ in OKLab ---------- */

export function extract(imageData, want = 5) {
  // Over-cluster, then pick a spread: a photo's five biggest clusters are often
  // five shades of the same sky, which makes a useless palette.
  const k = Math.max(want + 5, 10);
  const px = [];
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const o = toOklab({ mode: 'rgb', r: d[i] / 255, g: d[i + 1] / 255, b: d[i + 2] / 255 });
    px.push([o.l, o.a, o.b]);
  }
  const asOklch = (p) => {
    const o = toOklch({ mode: 'oklab', l: p[0], a: p[1], b: p[2] });
    return fit({ mode: 'oklch', l: o.l, c: o.c || 0, h: Number.isNaN(o.h) || o.h == null ? 0 : o.h });
  };
  if (px.length < k) return px.slice(0, want).map(asOklch);

  const dist = (p, q) => (p[0] - q[0]) ** 2 * 2.2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

  // k-means++ seeding
  const cent = [px[(Math.random() * px.length) | 0].slice()];
  while (cent.length < k) {
    const w = px.map((p) => Math.min(...cent.map((c) => dist(p, c))));
    const total = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = w.findIndex((v) => (r -= v) <= 0);
    cent.push(px[idx < 0 ? px.length - 1 : idx].slice());
  }

  const assign = new Array(px.length).fill(0);
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    for (let i = 0; i < px.length; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dd = dist(px[i], cent[c]);
        if (dd < bd) { bd = dd; bi = c; }
      }
      if (assign[i] !== bi) { assign[i] = bi; moved = true; }
    }
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) {
      const s = sum[assign[i]];
      s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++;
    }
    for (let c = 0; c < k; c++) if (sum[c][3]) cent[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
    if (!moved) break;
  }

  const counts = Array(k).fill(0);
  assign.forEach((a) => counts[a]++);
  const pool = cent.map((c, i) => ({ c, share: counts[i] / px.length })).filter((x) => x.share > 0.004);
  if (!pool.length) return [];

  // greedy: biggest cluster first, then whatever balances prominence against
  // how far it already sits from everything picked
  pool.sort((a, b) => b.share - a.share);
  const chosen = [pool.shift()];
  while (chosen.length < want && pool.length) {
    let bi = 0, bv = -1;
    pool.forEach((p, i) => {
      const near = Math.min(...chosen.map((q) => Math.sqrt(dist(p.c, q.c))));
      const v = Math.pow(p.share, 0.3) * near;
      if (v > bv) { bv = v; bi = i; }
    });
    chosen.push(pool.splice(bi, 1)[0]);
  }
  return chosen.map((x) => asOklch(x.c));
}

/* ---------- names ---------- */

let NAME_LAB = null;
export function nameOf(col) {
  if (!NAME_LAB) {
    NAME_LAB = [];
    for (const key in NAMES) {
      const r = parseInt(key.slice(0, 2), 16) / 255;
      const g = parseInt(key.slice(2, 4), 16) / 255;
      const b = parseInt(key.slice(4, 6), 16) / 255;
      const o = toOklab({ mode: 'rgb', r, g, b });
      NAME_LAB.push([o.l, o.a, o.b, NAMES[key]]);
    }
  }
  const o = toOklab(fit(col));
  let best = '', bd = Infinity;
  for (let i = 0; i < NAME_LAB.length; i++) {
    const n = NAME_LAB[i];
    const d = (o.l - n[0]) ** 2 * 1.6 + (o.a - n[1]) ** 2 + (o.b - n[2]) ** 2;
    if (d < bd) { bd = d; best = n[3]; }
  }
  return best;
}

/* ---------- roles: how a palette maps onto an interface ---------- */

export function roles(cols) {
  const byL = cols.map((c, i) => ({ c, i })).sort((a, b) => a.c.l - b.c.l);
  const byC = cols.map((c, i) => ({ c, i })).sort((a, b) => b.c.c - a.c.c);
  const dark = byL[0], light = byL[byL.length - 1];
  const primary = byC[0];
  const accent = byC.find((x) => x.i !== primary.i && Math.abs(((x.c.h - primary.c.h + 540) % 360) - 180) < 150) ?? byC[1] ?? byC[0];
  const mids = byL.slice(1, -1).filter((x) => x.i !== primary.i && x.i !== accent.i);
  return {
    dark: dark.c, light: light.c, primary: primary.c, accent: accent.c,
    muted: (mids[0] ?? byL[1] ?? byL[0]).c,
  };
}
