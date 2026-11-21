// VICEPRINT — deterministic screenshot scenes.
//
// With ?shot=<name> in the URL, this applies the named scene from
// shots.json, renders it, and flags data-shot-ready on <html> so a
// headless browser can capture the frame. Without the parameter it
// does nothing and the editor runs as usual.
//
// The scene set: cover + editor show the castPoster flagship in the
// Golden Cast grade, portrait runs the same layout in its tall
// composition, and square runs it at 1:1.

import { defaultState, loadAllPhotos, renderCover } from './cover.js';

const params = new URLSearchParams(location.search);
const sceneName = params.get('shot');

if (sceneName) {
  run(sceneName).catch((err) => {
    document.documentElement.dataset.shotError = String((err && err.message) || err);
  });
}

async function waitForEditor(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (window.__viceprint && window.__viceprint.ready()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('editor did not finish loading its photos in time');
}

async function fetchScenes() {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch('src/shots.json').then((r) => r.json());
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastErr;
}

async function run(name) {
  const scenes = await fetchScenes();
  const scene = scenes[name];
  if (!scene) throw new Error(`unknown shot scene: ${name} (have: ${Object.keys(scenes).join(', ')})`);
  if (!['cover', 'editor'].includes(scene.mode)) {
    throw new Error(`shot scene ${name} has unknown mode: ${scene.mode}`);
  }

  const state = defaultState();
  Object.assign(state, scene.state);
  if (scene.state && scene.state.slots) {
    state.slots = { ...defaultState().slots, ...scene.state.slots };
  }

  // The editor module loads the same photos through the same cache;
  // waiting for it keeps its first render from racing ours. A cover
  // scene can still render without the editor, so only the editor
  // scene treats a timeout as fatal.
  const images = await loadAllPhotos();
  if (scene.mode === 'editor') {
    await waitForEditor();
  } else {
    await waitForEditor(4000).catch(() => {});
  }

  if (scene.mode === 'editor') {
    window.__viceprint.applyState(state);
  } else {
    document.body.classList.add('shot-cover');
    const canvas = document.getElementById('cover');
    canvas.width = scene.width;
    canvas.height = scene.height;
    renderCover(canvas.getContext('2d'), scene.width, scene.height, state, images);
  }

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Never flag a capture before the web fonts land: the script
  // subtitle and display lettering must not be photographed in a
  // fallback font.
  await document.fonts.ready;
  document.documentElement.dataset.shotReady = '1';
}
