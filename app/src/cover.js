// VICEPRINT — cover renderer.
//
// Turns photos + a caption into GTA-style poster covers on a 2D canvas:
// multi-panel layouts with cream gutters and dark keylines, a halftone
// title block, banded-ink colour grades (posterize + gradient map, so a
// photo reads as printed poster art rather than a filtered snapshot),
// heat stars and a studio badge. No network, no libraries: canvas only.

export const PHOTO_DEFS = [
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
  posterNine: { label: 'Poster Nine', slots: 8 },
  tiltedStack: { label: 'Tilted Stack', slots: 4 },
  heroStrip: { label: 'Hero + Strip', slots: 4 },
};

const DISPLAY_FONT = '"Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SCRIPT_FONT = 'italic 700 1px "Brush Script MT", "Segoe Script", "Comic Sans MS", cursive';

export function defaultState() {
  const ids = PHOTO_DEFS.map((p) => p.id);
  return {
    layout: 'posterNine',
    grade: 'posterInk',
    title: 'PALM HEAT',
    subtitle: 'One Last Score',
    heat: 5,
    slots: {
      posterNine: ids.slice(0, 8),
      tiltedStack: ['rooftop', 'friends', 'marina', 'drive'],
      heroStrip: ['hero', 'pool', 'friends', 'boulevard'],
    },
    views: {},
  };
}

export function viewOf(state, slot) {
  return state.views[`${state.layout}:${slot}`] ?? { x: 0.5, y: 0.5, zoom: 1 };
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

  if (state.layout === 'posterNine') {
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
