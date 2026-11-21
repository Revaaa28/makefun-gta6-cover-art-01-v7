// VICEPRINT — editor wiring: state, undo/redo, panel picking, drag-pan,
// photo assignment, uploads and PNG export. Rendering lives in cover.js.

import {
  PHOTO_DEFS, GRADES, LAYOUTS, defaultState, viewOf,
  loadAllPhotos, renderCover, computeLayout,
} from './cover.js';

const canvas = document.getElementById('cover');
const ctx = canvas.getContext('2d');

let images = new Map();
let state = defaultState();
let selected = 0;
let customCount = 0;

const undoStack = [];
const redoStack = [];

const $ = (id) => document.getElementById(id);
const layoutSel = $('layoutSel');
const gradeSel = $('gradeSel');
const titleInput = $('titleInput');
const subtitleInput = $('subtitleInput');
const heatSel = $('heatSel');
const zoomRange = $('zoomRange');
const slotHint = $('slotHint');
const libraryEl = $('library');

for (const [name, def] of Object.entries(LAYOUTS)) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = def.label;
  layoutSel.appendChild(opt);
}
for (const [name, def] of Object.entries(GRADES)) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = def.label;
  gradeSel.appendChild(opt);
}

function snapshot() {
  return JSON.stringify(state);
}

function commit(mutator) {
  undoStack.push(snapshot());
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  mutator();
  syncControls();
  render();
}

function restore(json) {
  state = JSON.parse(json);
  if (selected >= LAYOUTS[state.layout].slots) selected = 0;
  syncControls();
  render();
}

function render() {
  renderCover(ctx, canvas.width, canvas.height, state, images);
  // selection outline on the chosen panel
  const L = computeLayout(state.layout, canvas.width, canvas.height);
  const p = L.panels[selected];
  if (p) {
    ctx.save();
    if (p.rot) {
      ctx.translate(p.cx, p.cy);
      ctx.rotate(p.rot);
      ctx.strokeStyle = '#ffc21f';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 7]);
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
    } else {
      ctx.strokeStyle = '#ffc21f';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 7]);
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
    ctx.restore();
  }
  $('undoBtn').disabled = undoStack.length === 0;
  $('redoBtn').disabled = redoStack.length === 0;
  markActiveThumb();
}

function syncControls() {
  layoutSel.value = state.layout;
  gradeSel.value = state.grade;
  titleInput.value = state.title;
  subtitleInput.value = state.subtitle;
  heatSel.value = String(state.heat);
  zoomRange.value = viewOf(state, selected).zoom;
  slotHint.textContent = `Panel ${selected + 1} of ${LAYOUTS[state.layout].slots} — click a photo to place it here.`;
}

function markActiveThumb() {
  const current = state.slots[state.layout][selected];
  for (const el of libraryEl.children) {
    el.classList.toggle('active', el.dataset.photo === current);
  }
}

function buildThumbs() {
  libraryEl.innerHTML = '';
  for (const def of PHOTO_DEFS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'thumb';
    btn.dataset.photo = def.id;
    const img = document.createElement('img');
    img.src = def.src;
    img.alt = def.label;
    const span = document.createElement('span');
    span.textContent = def.label;
    btn.append(img, span);
    btn.addEventListener('click', () => {
      commit(() => {
        state.slots[state.layout][selected] = def.id;
      });
    });
    libraryEl.appendChild(btn);
  }
}

// ------------------------------------------------------------ panel pick

function canvasPoint(evt) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - r.left) / r.width) * canvas.width,
    y: ((evt.clientY - r.top) / r.height) * canvas.height,
  };
}

function slotAt(pt) {
  const L = computeLayout(state.layout, canvas.width, canvas.height);
  for (let i = L.panels.length - 1; i >= 0; i--) {
    const p = L.panels[i];
    if (p.rot) {
      const dx = pt.x - p.cx;
      const dy = pt.y - p.cy;
      const cos = Math.cos(-p.rot);
      const sin = Math.sin(-p.rot);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2) return p.slot;
    } else if (pt.x >= p.x && pt.x <= p.x + p.w && pt.y >= p.y && pt.y <= p.y + p.h) {
      return p.slot;
    }
  }
  return null;
}

let drag = null;
canvas.addEventListener('pointerdown', (evt) => {
  const pt = canvasPoint(evt);
  const slot = slotAt(pt);
  if (slot === null) return;
  if (slot !== selected) {
    selected = slot;
    syncControls();
    render();
  }
  drag = { startX: pt.x, startY: pt.y, view: { ...viewOf(state, selected) }, moved: false };
  canvas.setPointerCapture(evt.pointerId);
});

canvas.addEventListener('pointermove', (evt) => {
  if (!drag) return;
  const pt = canvasPoint(evt);
  const L = computeLayout(state.layout, canvas.width, canvas.height);
  const p = L.panels[selected];
  const dx = (pt.x - drag.startX) / p.w;
  const dy = (pt.y - drag.startY) / p.h;
  if (Math.abs(pt.x - drag.startX) + Math.abs(pt.y - drag.startY) > 3) drag.moved = true;
  const view = {
    x: Math.min(1, Math.max(0, drag.view.x - dx / drag.view.zoom)),
    y: Math.min(1, Math.max(0, drag.view.y - dy / drag.view.zoom)),
    zoom: drag.view.zoom,
  };
  state.views[`${state.layout}:${selected}`] = view;
  render();
});

canvas.addEventListener('pointerup', () => {
  if (drag && drag.moved) {
    // record the pan as one undoable step, from the pre-drag view
    const now = snapshot();
    state.views[`${state.layout}:${selected}`] = drag.view;
    undoStack.push(snapshot());
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    restore(now);
  }
  drag = null;
});

// -------------------------------------------------------------- controls

layoutSel.addEventListener('change', () => commit(() => {
  state.layout = layoutSel.value;
  selected = 0;
}));
gradeSel.addEventListener('change', () => commit(() => { state.grade = gradeSel.value; }));
titleInput.addEventListener('change', () => commit(() => { state.title = titleInput.value.toUpperCase(); }));
subtitleInput.addEventListener('change', () => commit(() => { state.subtitle = subtitleInput.value; }));
heatSel.addEventListener('change', () => commit(() => { state.heat = Number(heatSel.value); }));

zoomRange.addEventListener('input', () => {
  const v = viewOf(state, selected);
  state.views[`${state.layout}:${selected}`] = { ...v, zoom: Number(zoomRange.value) };
  render();
});
zoomRange.addEventListener('change', () => {
  // fold the zoom into history as a single step
  undoStack.push(snapshot());
  redoStack.length = 0;
});

$('shuffleBtn').addEventListener('click', () => commit(() => {
  const ids = state.slots[state.layout];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
}));

$('spreadBtn').addEventListener('click', () => commit(() => {
  const current = state.slots[state.layout][selected];
  state.slots[state.layout] = state.slots[state.layout].map(() => current);
}));

$('undoBtn').addEventListener('click', () => {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
});
$('redoBtn').addEventListener('click', () => {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
});

$('uploadInput').addEventListener('change', async (evt) => {
  const file = evt.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  customCount += 1;
  const def = { id: `custom${customCount}`, src: url, label: file.name.slice(0, 14) || 'My photo' };
  PHOTO_DEFS.push(def);
  images.set(def.id, img);
  buildThumbs();
  commit(() => {
    state.slots[state.layout][selected] = def.id;
  });
  evt.target.value = '';
});

// ---------------------------------------------------------------- export

function exportCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  renderCover(c.getContext('2d'), w, h, state, images);
  return c;
}

function download(canvasEl, name) {
  canvasEl.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

function slug() {
  return state.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover';
}

$('exportBtn').addEventListener('click', () => {
  const [w, h] = $('exportSize').value.split('x').map(Number);
  download(exportCanvas(w, h), `viceprint-${slug()}-${w}x${h}.png`);
});

$('exportAllBtn').addEventListener('click', async () => {
  for (const opt of $('exportSize').options) {
    const [w, h] = opt.value.split('x').map(Number);
    download(exportCanvas(w, h), `viceprint-${slug()}-${w}x${h}.png`);
    await new Promise((r) => setTimeout(r, 350));
  }
});

// ------------------------------------------------------------------ init

buildThumbs();
syncControls();
loadAllPhotos()
  .then((loaded) => {
    images = loaded;
    render();
  })
  .catch((err) => {
    slotHint.textContent = `Could not load photos: ${err.message}`;
  });

// Hook for the screenshot scenes (src/shots.js): apply a full state and
// render at a chosen canvas size, without the selection outline.
window.__viceprint = {
  applyState(next, w, h) {
    state = next;
    selected = 0;
    if (w && h) {
      canvas.width = w;
      canvas.height = h;
    }
    syncControls();
    renderCover(ctx, canvas.width, canvas.height, state, images);
  },
  ready: () => images.size > 0,
};
