// VICEPRINT — cover renderer.
//
// Turns photos + a caption into GTA-style poster covers on a 2D canvas:
// multi-panel layouts with cream gutters and dark keylines, a halftone
// title block, banded-ink colour grades (posterize + gradient map, so a
// photo reads as printed poster art rather than a filtered snapshot),
// heat stars and a studio badge. No network, no libraries: canvas only.

export const PHOTO_DEFS = [
  { id: 'cast-hero', src: 'assets/cast-hero.jpg', label: 'The Boss' },
  { id: 'cast-driver', src: 'assets/cast-driver.jpg', label: 'The Driver' },
  { id: 'cast-rider', src: 'assets/cast-rider.jpg', label: 'The Rider' },
  { id: 'cast-mechanic', src: 'assets/cast-mechanic.jpg', label: 'The Mechanic' },
  { id: 'cast-captain', src: 'assets/cast-captain.jpg', label: 'The Captain' },
  { id: 'cast-fixer', src: 'assets/cast-fixer.jpg', label: 'The Fixer' },
  { id: 'cast-lookout', src: 'assets/cast-lookout.jpg', label: 'The Lookout' },
  { id: 'hero', src: 'assets/hero.jpg', label: 'Convertible' },
  { id: 'rooftop', src: 'assets/rooftop.jpg', label: 'Rooftop' },
  { id: 'friends', src: 'assets/friends.jpg', label: 'Friends' },
  { id: 'pool', src: 'assets/pool.jpg', label: 'Pool' },
  { id: 'marina', src: 'assets/marina.jpg', label: 'Marina' },
  { id: 'drive', src: 'assets/drive.jpg', label: 'Beach Drive' },
  { id: 'boulevard', src: 'samples/boulevard.jpg', label: 'Boulevard' },
  { id: 'pier', src: 'samples/pier.jpg', label: 'Pier' },
];

// A grade is a gradient map over posterized luminance: `bands` luminance
// steps (0 = keep the photo's own colour), `mix` how much of the map to
// lay over the photo, plus plain saturation / contrast / brightness.
export const GRADES = {
  posterInk: {
    label: 'Poster Ink',
    bands: 6, mix: 0.88, saturation: 1.25, contrast: 1.12, brightness: 1.0,
    stops: [[0, '#171233'], [0.28, '#5b1e78'], [0.52, '#c22a6d'], [0.74, '#f06423'], [0.9, '#ffb347'], [1, '#fff3c4']],
  },
  goldenCast: {
    label: 'Golden Cast',
    bands: 0, mix: 0.3, saturation: 1.14, contrast: 1.06, brightness: 1.02,
    stops: [[0, '#241108'], [0.4, '#8a4a1e'], [0.75, '#e89a4e'], [1, '#fff0cd']],
  },
  sunsetDuotone: {
    label: 'Sunset Duotone',
    bands: 9, mix: 0.82, saturation: 1.1, contrast: 1.08, brightness: 1.02,
    stops: [[0, '#1d1440'], [0.35, '#7a2358'], [0.62, '#e04e39'], [0.82, '#ff9e4f'], [1, '#ffe8bd']],
  },
  neonNights: {
    label: 'Neon Nights',
    bands: 6, mix: 0.85, saturation: 1.3, contrast: 1.15, brightness: 0.98,
    stops: [[0, '#070b26'], [0.3, '#123a7d'], [0.55, '#0e7fa8'], [0.76, '#c92b8f'], [1, '#a8fff0']],
  },
  goldenHour: {
    label: 'Golden Hour',
    bands: 8, mix: 0.8, saturation: 1.15, contrast: 1.06, brightness: 1.03,
    stops: [[0, '#2a1608'], [0.32, '#7a3c10'], [0.58, '#d97b26'], [0.8, '#ffc95e'], [1, '#fff6d8']],
  },
  noir: {
    label: 'Noir',
    bands: 5, mix: 0.92, saturation: 0.4, contrast: 1.28, brightness: 1.0,
    stops: [[0, '#0a0a0c'], [0.4, '#3c3f45'], [0.7, '#9aa0a8'], [1, '#f4f2ec']],
  },
  clean: {
    label: 'Clean Colour',
    bands: 0, mix: 0, saturation: 1.18, contrast: 1.05, brightness: 1.01,
    stops: [[0, '#000000'], [1, '#ffffff']],
  },
};

export const LAYOUTS = {
  castPoster: { label: 'Cast Poster', slots: 7 },
  posterNine: { label: 'Poster Nine', slots: 8 },
  tiltedStack: { label: 'Tilted Stack', slots: 4 },
  heroStrip: { label: 'Hero + Strip', slots: 4 },
};

// Role name tags printed on the cast panels, one per castPoster slot.
export const CAST_TAGS = ['THE BOSS', 'THE DRIVER', 'THE RIDER', 'THE MECHANIC', 'THE CAPTAIN', 'THE FIXER', 'THE LOOKOUT'];

const DISPLAY_FONT = '"Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SCRIPT_FONT = 'italic 700 1px "Brush Script MT", "Segoe Script", "Comic Sans MS", cursive';

export function defaultState() {
  const ids = PHOTO_DEFS.map((p) => p.id);
  return {
    layout: 'castPoster',
    grade: 'goldenCast',
    title: 'PALM HEAT',
    subtitle: 'One Last Score',
    heat: 5,
    slots: {
      castPoster: ids.slice(0, 7),
      posterNine: ['hero', 'rooftop', 'friends', 'pool', 'marina', 'drive', 'boulevard', 'pier'],
      tiltedStack: ['rooftop', 'friends', 'marina', 'drive'],
      heroStrip: ['hero', 'pool', 'friends', 'boulevard'],
    },
    views: {},
  };
}

export function viewOf(state, slot) {
  return state.views[`${state.layout}:${slot}`] ?? { x: 0.5, y: 0.5, zoom: 1 };
}

// ------------------------------------------------------- face-aware crop
// Face-aware crop anchor: a panel crop should centre on the face, not
// on the blind middle of the photo. faceAnchor draws the photo to a
// small offscreen canvas, scans the whole frame for skin-tone-ish
// pixels and returns their centroid (in 0..1 image coordinates) as the
// crop anchor. When no convincing skin cluster is found it falls back
// to the upper-third centre, where a face usually sits in a portrait.
const faceAnchorCache = new Map();
export function faceAnchor(img) {
  const key = img.src || '';
  if (faceAnchorCache.has(key)) return faceAnchorCache.get(key);
  let anchor = { x: 0.5, y: 0.38 };
  try {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const w = 96;
    const h = Math.max(2, Math.round((w * ih) / iw));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const scan = c.getContext('2d', { willReadFrequently: true });
    scan.drawImage(img, 0, 0, w, h);
    const px = scan.getImageData(0, 0, w, h).data;
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        // The saturation clause keeps sunlit grey or blonde hair —
        // bright but washed out — from counting as skin and dragging
        // the anchor up into the hairline.
        const skin = r > 95 && g > 40 && b > 20 && r > g && r > b && r - g > 15 && r - b > 10 && r < 250 && mx - mn > mx * 0.3;
        if (skin) {
          n++;
          sx += x;
          sy += y;
        }
      }
    }
    if (n >= Math.max(30, w * h * 0.02)) {
      anchor = {
        x: Math.min(0.8, Math.max(0.2, sx / n / w)),
        y: Math.min(0.75, Math.max(0.15, sy / n / h)),
      };
    }
  } catch {
    // keep the fallback anchor
  }
  faceAnchorCache.set(key, anchor);
  return anchor;
}

// The view a cast panel renders with: the user's own pan/zoom when
// they have touched the panel, otherwise the face-aware anchor —
// zoomed in further on the hero slot so the lead face lands large.
// In a tall hero panel the anchor is also eased down the face, so
// the face rides high in the frame and the title stack overlaps the
// jaw and neck, never the eyes.
export function castView(state, slot, rawImg, tallPanel = false) {
  const custom = state.views[`${state.layout}:${slot}`];
  if (custom) return custom;
  const a = faceAnchor(rawImg);
  if (slot === 0 && tallPanel) return { x: a.x, y: Math.min(0.78, a.y + 0.1), zoom: 1.22 };
  return { x: a.x, y: a.y, zoom: slot === 0 ? 1.22 : 1.08 };
}

// ---------------------------------------------------------------- images

const loadCache = new Map();
export function loadPhoto(def) {
  if (!loadCache.has(def.id)) {
    loadCache.set(
      def.id,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`cannot load ${def.src}`));
        img.src = def.src;
      }),
    );
  }
  return loadCache.get(def.id);
}

export async function loadAllPhotos() {
  const out = new Map();
  await Promise.all(
    PHOTO_DEFS.map(async (def) => out.set(def.id, await loadPhoto(def))),
  );
  return out;
}

// ------------------------------------------------------------- grade LUT

const lutCache = new Map();
function gradeLut(grade) {
  if (lutCache.has(grade)) return lutCache.get(grade);
  const g = GRADES[grade];
  const stops = g.stops.map(([t, hex]) => [
    t,
    [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)],
  ]);
  const lut = new Uint8Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    let t = v / 255;
    if (g.bands > 0) t = Math.round(t * (g.bands - 1)) / (g.bands - 1);
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        a = stops[i];
        b = stops[i + 1];
        break;
      }
    }
    const span = b[0] - a[0] || 1;
    const f = Math.min(1, Math.max(0, (t - a[0]) / span));
    for (let c = 0; c < 3; c++) lut[v * 3 + c] = Math.round(a[1][c] + (b[1][c] - a[1][c]) * f);
  }
  lutCache.set(grade, lut);
  return lut;
}

// A photo run through a grade once, cached: pan/zoom then samples this.
const processedCache = new Map();
export function processedPhoto(img, gradeName) {
  const key = `${gradeName}:${img.src}`;
  if (processedCache.has(key)) return processedCache.get(key);
  const g = GRADES[gradeName];
  const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const lut = gradeLut(gradeName);
  const { saturation: sat, contrast, brightness, mix } = g;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i];
    let gr = px[i + 1];
    let b = px[i + 2];
    // contrast + brightness about mid-grey
    r = (r - 128) * contrast + 128 * brightness;
    gr = (gr - 128) * contrast + 128 * brightness;
    b = (b - 128) * contrast + 128 * brightness;
    // saturation about the pixel's own luminance
    const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
    r = lum + (r - lum) * sat;
    gr = lum + (gr - lum) * sat;
    b = lum + (b - lum) * sat;
    if (mix > 0) {
      const li = Math.min(255, Math.max(0, Math.round(lum)));
      r = r * (1 - mix) + lut[li * 3] * mix;
      gr = gr * (1 - mix) + lut[li * 3 + 1] * mix;
      b = b * (1 - mix) + lut[li * 3 + 2] * mix;
    }
    px[i] = Math.min(255, Math.max(0, r));
    px[i + 1] = Math.min(255, Math.max(0, gr));
    px[i + 2] = Math.min(255, Math.max(0, b));
  }
  ctx.putImageData(data, 0, 0);
  processedCache.set(key, c);
  return c;
}

// --------------------------------------------------------------- drawing

function drawPanelImage(ctx, img, rect, view) {
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(rect.w / iw, rect.h / ih) * (view.zoom || 1);
  const sw = rect.w / scale;
  const sh = rect.h / scale;
  let sx = (view.x ?? 0.5) * iw - sw / 2;
  let sy = (view.y ?? 0.5) * ih - sh / 2;
  sx = Math.min(Math.max(sx, 0), Math.max(0, iw - sw));
  sy = Math.min(Math.max(sy, 0), Math.max(0, ih - sh));
  ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
}

function keyline(ctx, rect, W) {
  ctx.strokeStyle = '#14101f';
  ctx.lineWidth = Math.max(2, W * 0.0022);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
}

function star(ctx, cx, cy, r, fill) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawStars(ctx, x, y, size, heat) {
  for (let i = 0; i < 5; i++) {
    star(ctx, x + i * size * 1.25 + size / 2, y + size / 2, size / 2, i < heat ? '#ffc21f' : 'rgba(255,255,255,0.35)');
  }
}

export function drawBadge(ctx, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#171233';
  ctx.fill();
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = '#ffc21f';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.035;
  ctx.strokeStyle = 'rgba(255,243,196,0.85)';
  ctx.stroke();
  star(ctx, cx, cy - r * 0.18, r * 0.34, '#ffc21f');
  ctx.fillStyle = '#fff3c4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${r * 0.21}px ${DISPLAY_FONT}`;
  ctx.fillText('VICEPRINT', cx, cy + r * 0.32);
  ctx.font = `700 ${r * 0.15}px ${DISPLAY_FONT}`;
  ctx.fillStyle = 'rgba(255,243,196,0.75)';
  ctx.fillText('EST. 2026', cx, cy + r * 0.55);
  ctx.restore();
}

// Shrink the font until `text` fits `maxW`; returns the size used.
function fitText(ctx, text, maxW, base, family, weight = 900) {
  let size = base;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > 8 && ctx.measureText(text).width > maxW) {
    size *= 0.92;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

function scriptFont(size) {
  return SCRIPT_FONT.replace('1px', `${size}px`);
}

// The halftone sunset field behind the title block: gradient + dot grid.
function halftoneField(ctx, rect, gradeName) {
  const g = GRADES[gradeName];
  const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  const stops = g.stops;
  for (const [t, hex] of stops) grad.addColorStop(t, hex);
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  // Fine dots, softly blended into the sunset gradient so the block
  // reads as a neon-sunset glow rather than a coarse printed screen;
  // they still grow gently toward the bottom of the block.
  const step = Math.max(4, rect.w * 0.013);
  ctx.fillStyle = 'rgba(24,8,44,0.20)';
  for (let row = 0, y = rect.y + step / 2; y < rect.y + rect.h; row++, y += step) {
    const r = step * 0.14 + (row * step * 0.006);
    for (let x = rect.x + step / 2 + (row % 2) * step * 0.5; x < rect.x + rect.w; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, Math.min(r, step * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function titleLines(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [title.trim() || 'UNTITLED'];
  return words;
}

// Stacked display lettering with a hard offset shadow; returns height used.
function drawTitle(ctx, lines, cx, top, maxW, baseSize, fill = '#fff3d6') {
  let y = top;
  for (const line of lines) {
    const size = fitText(ctx, line, maxW, baseSize, DISPLAY_FONT);
    ctx.font = `900 ${size}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(16,8,30,0.9)';
    ctx.fillText(line, cx + size * 0.045, y + size * 0.05);
    ctx.fillStyle = fill;
    ctx.fillText(line, cx, y);
    y += size * 0.98;
  }
  return y - top;
}

function drawSubtitle(ctx, text, cx, y, size, fill = '#ffd9ec') {
  if (!text.trim()) return 0;
  ctx.font = scriptFont(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(16,8,30,0.85)';
  ctx.fillText(text, cx + size * 0.04, y + size * 0.05);
  ctx.fillStyle = fill;
  ctx.fillText(text, cx, y);
  return size * 1.25;
}

// --------------------------------------------------------------- layouts
// Each layout returns the photo panel rects (with slot indexes) plus a
// title block rect (posterNine) so the editor can hit-test clicks.

export function computeLayout(name, W, H) {
  if (name === 'posterNine') {
    const g = Math.max(6, W * 0.014);
    const cols = [0.27, 0.23, 0.24, 0.26];
    const rows = [0.36, 0.32, 0.32];
    const xs = [g];
    for (let i = 0; i < 4; i++) xs.push(xs[i] + cols[i] * (W - g * 2) + (i < 3 ? g : 0));
    const ys = [g];
    for (let i = 0; i < 3; i++) ys.push(ys[i] + rows[i] * (H - g * 2) + (i < 2 ? g : 0));
    const cell = (c, r, cs = 1, rs = 1) => ({
      x: xs[c],
      y: ys[r],
      w: xs[c + cs] - xs[c] - (cs > 1 ? 0 : g),
      h: ys[r + rs] - ys[r] - (rs > 1 ? 0 : g),
    });
    // spans absorb the gutters they cross
    const span = (c, r, cs, rs) => {
      const a = cell(c, r);
      const b = cell(c + cs - 1, r + rs - 1);
      return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
    };
    return {
      gutter: g,
      titleBlock: span(0, 0, 2, 1),
      panels: [
        { ...cell(2, 0), slot: 0 },
        { ...span(3, 0, 1, 2), slot: 1 },
        { ...cell(0, 1), slot: 2 },
        { ...cell(1, 1), slot: 3 },
        { ...cell(2, 1), slot: 4 },
        { ...span(0, 2, 2, 1), slot: 5 },
        { ...cell(2, 2), slot: 6 },
        { ...cell(3, 2), slot: 7 },
      ],
    };
  }
  if (name === 'castPoster') {
    const stripH = Math.round(H * 0.075);
    const billH = Math.round(H * 0.088);
    const m = W * 0.012;
    const gp = Math.max(4, W * 0.007);
    const fy = stripH + gp;
    const fh = H - stripH - billH - gp * 2;
    const innerW = W - m * 2;
    const mk = (x, y, w, h, slot) => ({ x, y, w, h, slot, tag: CAST_TAGS[slot] });
    let panels;
    if (W >= H * 1.15) {
      // Landscape: two stacked portraits on the left, the giant hero
      // face close-up in the centre, two columns of stacked portraits
      // on the right. Every panel is a person.
      const heroW = innerW * 0.28;
      const sideW = (innerW - heroW - gp * 2) / 2;
      const colW = (sideW - gp) / 2;
      const cellH = (fh - gp) / 2;
      const lx = m;
      const hx = m + sideW + gp;
      const rx = hx + heroW + gp;
      panels = [
        mk(hx, fy, heroW, fh, 0),
        mk(lx, fy, sideW, cellH, 1),
        mk(lx, fy + cellH + gp, sideW, cellH, 2),
        mk(rx, fy, colW, cellH, 3),
        mk(rx + colW + gp, fy, colW, cellH, 4),
        mk(rx, fy + cellH + gp, colW, cellH, 5),
        mk(rx + colW + gp, fy + cellH + gp, colW, cellH, 6),
      ];
    } else {
      // Portrait and square: the hero across the top, the rest of the
      // cast in a two-column grid beneath.
      const heroH = fh * 0.36;
      const cellW = (innerW - gp) / 2;
      const cellH = (fh - heroH - gp * 3) / 3;
      panels = [mk(m, fy, innerW, heroH, 0)];
      for (let i = 0; i < 6; i++) {
        const cx = m + (i % 2) * (cellW + gp);
        const cy = fy + heroH + gp + Math.floor(i / 2) * (cellH + gp);
        panels.push(mk(cx, cy, cellW, cellH, i + 1));
      }
    }
    return {
      gutter: gp,
      strip: { x: 0, y: 0, w: W, h: stripH },
      billing: { x: 0, y: H - billH, w: W, h: billH },
      panels,
    };
  }
  if (name === 'tiltedStack') {
    const pw = W * 0.52;
    const ph = H * 0.34;
    const spots = [
      { cx: W * 0.30, cy: H * 0.52, rot: -0.10 },
      { cx: W * 0.70, cy: H * 0.50, rot: 0.07 },
      { cx: W * 0.36, cy: H * 0.79, rot: 0.05 },
      { cx: W * 0.68, cy: H * 0.78, rot: -0.06 },
    ];
    return {
      gutter: 0,
      titleBlock: { x: 0, y: H * 0.03, w: W, h: H * 0.2 },
      panels: spots.map((s, i) => ({ x: s.cx - pw / 2, y: s.cy - ph / 2, w: pw, h: ph, rot: s.rot, cx: s.cx, cy: s.cy, slot: i })),
    };
  }
  // heroStrip
  const g = Math.max(6, W * 0.014);
  const heroH = (H - g * 3) * 0.66;
  const stripY = g * 2 + heroH;
  const stripH = H - stripY - g;
  const sw = (W - g * 4) / 3;
  return {
    gutter: g,
    titleBlock: null,
    hero: { x: g, y: g, w: W - g * 2, h: heroH },
    panels: [
      { x: g, y: g, w: W - g * 2, h: heroH, slot: 0 },
      { x: g, y: stripY, w: sw, h: stripH, slot: 1 },
      { x: g * 2 + sw, y: stripY, w: sw, h: stripH, slot: 2 },
      { x: g * 3 + sw * 2, y: stripY, w: sw, h: stripH, slot: 3 },
    ],
  };
}

// ------------------------------------------------------- cast poster kit

// Slanted black name-tag chip with a gold slash, in a panel corner.
function drawNameTag(ctx, panel, tag, W, atTop = false) {
  const size = Math.max(11, W * 0.0135);
  ctx.save();
  ctx.font = `900 ${size}px "Arial Narrow", ${DISPLAY_FONT}`;
  const tw = ctx.measureText(tag).width;
  const chipW = tw + size * 2.3;
  const chipH = size * 1.7;
  const inset = W * 0.006;
  const x = panel.x + inset;
  const y = atTop ? panel.y + inset : panel.y + panel.h - chipH - inset;
  ctx.translate(x, y);
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  ctx.fillStyle = 'rgba(8,6,16,0.88)';
  ctx.fillRect(0, 0, chipW, chipH);
  ctx.fillStyle = '#ffc21f';
  ctx.fillRect(size * 0.38, chipH * 0.18, size * 0.16, chipH * 0.64);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, size * 0.78, chipH / 2 + 1);
  ctx.restore();
}

// Stacked title lettering in striped chrome: sunset bands running
// through the letters, a bright chrome highlight line across the
// middle, a white outline and a hard drop shadow.
function drawChromeTitle(ctx, lines, cx, top, maxW, baseSize) {
  let y = top;
  for (const line of lines) {
    const size = fitText(ctx, line, maxW, baseSize, DISPLAY_FONT);
    ctx.font = `900 ${size}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(10,5,20,0.85)';
    ctx.fillText(line, cx + size * 0.05, y + size * 0.06);
    const grad = ctx.createLinearGradient(0, y, 0, y + size);
    grad.addColorStop(0, '#fff6d8');
    grad.addColorStop(0.22, '#ffd23e');
    grad.addColorStop(0.45, '#ff8a3c');
    grad.addColorStop(0.52, '#fff8e6');
    grad.addColorStop(0.58, '#ff3d7e');
    grad.addColorStop(0.8, '#c22a6d');
    grad.addColorStop(1, '#5b1e78');
    ctx.lineWidth = size * 0.055;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(line, cx, y);
    ctx.fillStyle = grad;
    ctx.fillText(line, cx, y);
    y += size * 0.98;
  }
  return y - top;
}

// Gold seal: ringed badge with a star and the selection wording.
function drawCastSeal(ctx, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#c9971f';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  ctx.fillStyle = '#171233';
  ctx.fill();
  ctx.lineWidth = r * 0.03;
  ctx.strokeStyle = '#ffe9a8';
  ctx.stroke();
  star(ctx, cx, cy - r * 0.34, r * 0.3, '#ffc21f');
  ctx.fillStyle = '#fff3c4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${r * 0.185}px ${DISPLAY_FONT}`;
  ctx.fillText('OFFICIAL', cx, cy + r * 0.22);
  ctx.fillText('SELECTION', cx, cy + r * 0.45);
  ctx.font = `700 ${r * 0.13}px ${DISPLAY_FONT}`;
  ctx.fillStyle = 'rgba(255,243,196,0.75)';
  ctx.fillText('PALM HEAT', cx, cy + r * 0.66);
  ctx.restore();
}

// --------------------------------------------------------------- render

export function renderCover(ctx, W, H, state, images) {
  const grade = GRADES[state.grade] ? state.grade : 'posterInk';
  const photo = (slot) => {
    const id = state.slots[state.layout][slot];
    const img = images.get(id);
    return img ? processedPhoto(img, grade) : null;
  };
  ctx.save();
  ctx.clearRect(0, 0, W, H);

  if (state.layout === 'castPoster') {
    const L = computeLayout('castPoster', W, H);
    const wide = W >= H * 1.15;
    // dark poster ground
    ctx.fillStyle = '#100c1e';
    ctx.fillRect(0, 0, W, H);
    // ---- top strip: stars + review quote on the left, VOL. 1 box right
    const st = L.strip;
    ctx.fillStyle = '#0a0714';
    ctx.fillRect(st.x, st.y, st.w, st.h);
    const starSize = st.h * 0.34;
    drawStars(ctx, W * 0.022, st.y + (st.h - starSize) / 2, starSize, state.heat);
    const quoteX = W * 0.022 + starSize * 6.9;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f3ead2';
    const quote = '"A SUN-SCORCHED RIDE YOU CAN FEEL"';
    const qSize = fitText(ctx, quote, W * 0.6, st.h * 0.3, DISPLAY_FONT, 700);
    ctx.font = `700 ${qSize}px ${DISPLAY_FONT}`;
    ctx.fillText(quote, quoteX, st.y + st.h * 0.36);
    ctx.fillStyle = '#ffc21f';
    const srcSize = fitText(ctx, '— THE PALM GAZETTE', W * 0.6, st.h * 0.24, DISPLAY_FONT, 700);
    ctx.font = `700 ${srcSize}px ${DISPLAY_FONT}`;
    ctx.fillText('— THE PALM GAZETTE', quoteX, st.y + st.h * 0.73);
    const volW = W * 0.075;
    const volH = st.h * 0.62;
    const volX = W - W * 0.022 - volW;
    const volY = st.y + (st.h - volH) / 2;
    ctx.strokeStyle = '#f3ead2';
    ctx.lineWidth = Math.max(1.5, W * 0.0016);
    ctx.strokeRect(volX, volY, volW, volH);
    ctx.fillStyle = '#f3ead2';
    ctx.textAlign = 'center';
    const volSize = fitText(ctx, 'VOL. 1', volW * 0.88, volH * 0.44, DISPLAY_FONT);
    ctx.font = `900 ${volSize}px ${DISPLAY_FONT}`;
    ctx.fillText('VOL. 1', volX + volW / 2, volY + volH / 2 + 1);
    // ---- panel field: every panel a person, face-aware crop
    for (const p of L.panels) {
      const id = state.slots[state.layout][p.slot];
      const raw = images.get(id);
      if (raw) {
        const img = processedPhoto(raw, grade);
        drawPanelImage(ctx, img, p, castView(state, p.slot, raw, p.h > p.w * 1.2));
        // warm cinematic wash: sunset light from above, shade below,
        // so the faces stay photographic under warm light
        const wash = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
        wash.addColorStop(0, 'rgba(255,176,92,0.13)');
        wash.addColorStop(0.5, 'rgba(255,176,92,0)');
        wash.addColorStop(1, 'rgba(16,8,32,0.16)');
        ctx.fillStyle = wash;
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
      ctx.strokeStyle = 'rgba(243,234,210,0.85)';
      ctx.lineWidth = Math.max(1.5, W * 0.0016);
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
    // ---- sunset-stripe semicircle motif behind the title
    const tcx = W / 2;
    const billTop = L.billing.y;
    const motifR = wide ? W * 0.17 : W * 0.2;
    const motifBase = billTop - H * 0.045;
    ctx.save();
    ctx.beginPath();
    ctx.arc(tcx, motifBase, motifR, Math.PI, 0);
    ctx.closePath();
    ctx.clip();
    const stripeCols = ['#ffd23e', '#ffb347', '#ff8a3c', '#f06423', '#ff3d7e', '#c22a6d', '#5b1e78'];
    const stripeH = motifR / 7;
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = stripeCols[i];
      ctx.fillRect(tcx - motifR, motifBase - motifR + i * stripeH, motifR * 2, stripeH + 1);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(tcx, motifBase, motifR, Math.PI, 0);
    ctx.strokeStyle = 'rgba(243,234,210,0.9)';
    ctx.lineWidth = Math.max(1.5, W * 0.0016);
    ctx.stroke();
    // ---- striped-chrome title overlapping the panels, lower-centre,
    // with the neon script subtitle and the ribbon tagline beneath
    const lines = titleLines(state.title);
    const titleBase = wide ? H * 0.15 : W * 0.115;
    const subSize = wide ? H * 0.048 : W * 0.042;
    const ribbonH = Math.min(H * 0.04, W * 0.032);
    const ribbonY = motifBase - ribbonH * 0.55;
    const subTop = ribbonY - subSize * 1.35;
    let titleH = 0;
    for (const line of lines) titleH += fitText(ctx, line, W * 0.66, titleBase, DISPLAY_FONT) * 0.98;
    const titleTop = subTop - H * 0.01 - titleH;
    drawChromeTitle(ctx, lines, tcx, titleTop, W * 0.66, titleBase);
    ctx.save();
    ctx.shadowColor = '#ff3d7e';
    ctx.shadowBlur = W * 0.012;
    drawSubtitle(ctx, state.subtitle, tcx, subTop, subSize, '#ff6fb3');
    ctx.restore();
    const ribbonText = 'EVERY LAST SUNSET HAS A PRICE';
    ctx.font = `700 ${ribbonH * 0.5}px ${DISPLAY_FONT}`;
    const ribbonW = Math.min(W * 0.56, ctx.measureText(ribbonText).width + ribbonH * 2.2);
    ctx.beginPath();
    ctx.roundRect(tcx - ribbonW / 2, ribbonY, ribbonW, ribbonH, ribbonH * 0.22);
    ctx.fillStyle = '#7a1030';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, W * 0.0014);
    ctx.strokeStyle = '#ffc21f';
    ctx.stroke();
    ctx.fillStyle = '#ffe9b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ribbonText, tcx, ribbonY + ribbonH / 2 + 1);
    // name tags come after the title stack, so the title and motif
    // never cover a tag
    for (const p of L.panels) drawNameTag(ctx, p, p.tag, W, p.slot === 0);
    // ---- gold seal on the right edge
    const sealR = W * 0.052;
    drawCastSeal(ctx, W - sealR * 0.9, motifBase - motifR * 0.35, sealR);
    // ---- bottom billing block: COMING SOON, dense credits, barcode
    const bl = L.billing;
    ctx.fillStyle = '#0a0714';
    ctx.fillRect(bl.x, bl.y, bl.w, bl.h);
    ctx.fillStyle = 'rgba(243,234,210,0.25)';
    ctx.fillRect(bl.x, bl.y, bl.w, 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffc21f';
    // Billing text is sized off the canvas WIDTH: on tall canvases a
    // height-keyed size overflows the strip and collides with itself.
    const csSize = Math.min(bl.h * 0.26, W * 0.02);
    ctx.font = `900 ${csSize}px ${DISPLAY_FONT}`;
    ctx.fillText('C O M I N G   S O O N', W * 0.022, bl.y + bl.h / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(243,234,210,0.88)';
    const creditFamily = `"Arial Narrow", ${DISPLAY_FONT}`;
    const credits1 = 'VICEPRINT PICTURES PRESENTS A PALM HEAT STORY "PALM HEAT" MARCO VANE · LUCIA SOL · DEX MARLOWE · ROSA IBARRA · TONY FERRANTE';
    const credits2 = 'MUSIC BY THE GLASS COAST · EDITED BY N. OKAFOR · PRODUCTION DESIGN MIRA SOLANO · DIRECTOR OF PHOTOGRAPHY ELIAS RENN · WRITTEN BY C. DELGADO · DIRECTED BY A. MARLOWE';
    const crSize = fitText(ctx, credits2, W * 0.47, Math.min(bl.h * 0.155, W * 0.0125), creditFamily, 700);
    ctx.font = `700 ${crSize}px ${creditFamily}`;
    ctx.fillText(credits1, W * 0.545, bl.y + bl.h * 0.32);
    ctx.fillText(credits2, W * 0.545, bl.y + bl.h * 0.68);
    const bcW = W * 0.085;
    const bcH = bl.h * 0.58;
    const bcX = W - W * 0.022 - bcW;
    const bcY = bl.y + (bl.h - bcH) / 2;
    ctx.fillStyle = '#f7f3e8';
    ctx.fillRect(bcX, bcY, bcW, bcH);
    ctx.fillStyle = '#14101f';
    let seed = 20260830;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let bx = bcX + bcW * 0.06;
    while (bx < bcX + bcW * 0.9) {
      const bw = 1 + rnd() * 3;
      if (rnd() > 0.42) ctx.fillRect(bx, bcY + bcH * 0.08, bw, bcH * 0.66);
      bx += bw + 1 + rnd() * 2;
    }
    ctx.font = `700 ${bcH * 0.17}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('8 90126 40771 3', bcX + bcW / 2, bcY + bcH * 0.9);
  } else if (state.layout === 'posterNine') {
    const L = computeLayout('posterNine', W, H);
    ctx.fillStyle = '#f3ead2';
    ctx.fillRect(0, 0, W, H);
    for (const p of L.panels) {
      const img = photo(p.slot);
      if (img) drawPanelImage(ctx, img, p, viewOf(state, p.slot));
      keyline(ctx, p, W);
    }
    const tb = L.titleBlock;
    halftoneField(ctx, tb, grade);
    keyline(ctx, tb, W);
    // Stack the block's content with a reserved strip at the bottom for
    // the heat stars, so the lettering never collides with them.
    const lines = titleLines(state.title);
    const pad = tb.h * 0.06;
    const starSize = tb.h * 0.105;
    const subSize = tb.h * 0.15;
    const avail = tb.h - pad * 2 - starSize * 1.6 - subSize * 1.35;
    const base = Math.min(tb.h * 0.3, avail / Math.max(1, lines.length) / 0.98);
    // Sunset-gradient lettering (amber -> orange -> pink -> purple),
    // the classic GTA title treatment, over the halftone sunset block.
    const titleGrad = ctx.createLinearGradient(0, tb.y, 0, tb.y + tb.h);
    titleGrad.addColorStop(0, '#ffd23e');
    titleGrad.addColorStop(0.35, '#ff8a3c');
    titleGrad.addColorStop(0.65, '#ff3d7e');
    titleGrad.addColorStop(1, '#7b2ff7');
    const used = drawTitle(ctx, lines, tb.x + tb.w / 2, tb.y + pad, tb.w * 0.92, base, titleGrad);
    drawSubtitle(ctx, state.subtitle, tb.x + tb.w / 2, tb.y + pad + used + tb.h * 0.015, subSize);
    const pillW = starSize * 6.9;
    const pillH = starSize * 1.55;
    const pillX = tb.x + tb.w / 2 - pillW / 2;
    const pillY = tb.y + tb.h - pad - pillH;
    ctx.fillStyle = 'rgba(16,8,30,0.5)';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    drawStars(ctx, tb.x + tb.w / 2 - starSize * 3.1, pillY + (pillH - starSize) / 2, starSize, state.heat);
    drawBadge(ctx, W - L.gutter - W * 0.052, H - L.gutter - W * 0.052, W * 0.052);
  } else if (state.layout === 'tiltedStack') {
    const L = computeLayout('tiltedStack', W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#131038');
    bg.addColorStop(0.55, '#33124d');
    bg.addColorStop(1, '#0b0820');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    const step = W * 0.03;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, step * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const lines = titleLines(state.title);
    const used = drawTitle(ctx, lines, W / 2, H * 0.035, W * 0.9, H * 0.085);
    drawSubtitle(ctx, state.subtitle, W / 2, H * 0.035 + used + H * 0.008, H * 0.05, '#8ef6ff');
    drawStars(ctx, W / 2 - H * 0.028 * 3.1, H * 0.045 + used + H * 0.062, H * 0.028, state.heat);
    const border = W * 0.012;
    for (const p of L.panels) {
      const img = photo(p.slot);
      ctx.save();
      ctx.translate(p.cx, p.cy);
      ctx.rotate(p.rot);
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = W * 0.02;
      ctx.shadowOffsetY = W * 0.008;
      ctx.fillStyle = '#fdfdf8';
      ctx.fillRect(-p.w / 2 - border, -p.h / 2 - border, p.w + border * 2, p.h + border * 2.6);
      ctx.shadowColor = 'transparent';
      if (img) {
        drawPanelImage(ctx, img, { x: -p.w / 2, y: -p.h / 2, w: p.w, h: p.h }, viewOf(state, p.slot));
      }
      ctx.restore();
    }
    drawBadge(ctx, W * 0.055, H - W * 0.055, W * 0.05);
  } else {
    const L = computeLayout('heroStrip', W, H);
    ctx.fillStyle = '#f3ead2';
    ctx.fillRect(0, 0, W, H);
    for (const p of L.panels) {
      const img = photo(p.slot);
      if (img) drawPanelImage(ctx, img, p, viewOf(state, p.slot));
      keyline(ctx, p, W);
    }
    const hero = L.hero;
    const scrim = ctx.createLinearGradient(0, hero.y + hero.h * 0.45, 0, hero.y + hero.h);
    scrim.addColorStop(0, 'rgba(10,6,24,0)');
    scrim.addColorStop(1, 'rgba(10,6,24,0.82)');
    ctx.fillStyle = scrim;
    ctx.fillRect(hero.x, hero.y + hero.h * 0.45, hero.w, hero.h * 0.55);
    const lines = titleLines(state.title);
    const base = hero.h * 0.17;
    let totalH = 0;
    const sizes = lines.map((line) => {
      const s = fitText(ctx, line, hero.w * 0.62, base, DISPLAY_FONT);
      totalH += s * 0.98;
      return s;
    });
    let y = hero.y + hero.h - totalH - hero.h * 0.16;
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      const s = sizes[i];
      ctx.font = `900 ${s}px ${DISPLAY_FONT}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(16,8,30,0.9)';
      ctx.fillText(lines[i], hero.x + hero.w * 0.035 + s * 0.045, y + s * 0.05);
      ctx.fillStyle = '#fff3d6';
      ctx.fillText(lines[i], hero.x + hero.w * 0.035, y);
      y += s * 0.98;
    }
    ctx.font = scriptFont(hero.h * 0.085);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffd9ec';
    if (state.subtitle.trim()) ctx.fillText(state.subtitle, hero.x + hero.w * 0.037, hero.y + hero.h - hero.h * 0.145);
    const starSize = hero.h * 0.055;
    drawStars(ctx, hero.x + hero.w - starSize * 6.6, hero.y + hero.h - starSize * 1.9, starSize, state.heat);
    drawBadge(ctx, hero.x + hero.w - W * 0.045, hero.y + W * 0.045, W * 0.042);
  }
  ctx.restore();
}
