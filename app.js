import { createThreeViewer } from './three-viewer.js';
import { environmentMapURL } from './environment.js';
import { createNativeRotation } from './native-rotation.js';

const DISPLAY_MS = 5000;
const LOAD_TIMEOUT_MS = 10000;
const select = document.querySelector('#model-select');
const autoCycle = document.querySelector('#auto-cycle');
const cycleStatus = document.querySelector('#cycle-status');
const progress = document.querySelector('#cycle-progress');
const nativeHost = document.querySelector('#native-host');
const panels = {
  native: { message: document.querySelector('#native-message'), status: document.querySelector('#native-status') },
  three: { message: document.querySelector('#three-message'), status: document.querySelector('#three-status') },
};
let models = [];
let currentIndex = 0;
let generation = 0;
let states = {};
let cycleTimer = null;
let cycleDeadline = null;
let loadDeadline = null;
let progressFrame = null;
let rotationFrame = null;
let nativeRotation = null;
let threeRotationEnabled = true;
let loadTimers = [];
let viewer = null;
let viewerError = '';

try {
  viewer = createThreeViewer(document.querySelector('#three-host'));
} catch (error) {
  viewerError = 'Three.js could not start. WebGL 2 is required.';
  console.error(error);
}

function setPanel(name, state, text) {
  states[name] = state;
  panels[name].message.hidden = state === 'ready';
  panels[name].message.firstElementChild.textContent = text;
  panels[name].status.textContent = state === 'ready' ? 'Ready · one turn every 5s' : text;
}

function stopRotation() {
  cancelAnimationFrame(rotationFrame);
  rotationFrame = null;
  const previousRotation = nativeRotation;
  nativeRotation = null;
  try {
    previousRotation?.dispose();
  } catch (error) {
    console.warn('Native rotation cleanup failed.', error);
  }
}

function startRotation(startedAt = performance.now()) {
  cancelAnimationFrame(rotationFrame);
  const id = generation;
  function rotate(time) {
    if (id !== generation) return;
    const degrees = ((time - startedAt) % DISPLAY_MS) / DISPLAY_MS * 360;
    if (nativeRotation) {
      try {
        nativeRotation.update(degrees);
      } catch (error) {
        const failedRotation = nativeRotation;
        nativeRotation = null;
        try {
          failedRotation.dispose();
        } catch (cleanupError) {
          console.warn('Native rotation cleanup failed.', cleanupError);
        }
        panels.native.status.textContent = 'Ready · automatic rotation is unavailable in this browser';
        console.warn('Native model rotation failed.', error);
      }
    }
    if (threeRotationEnabled && states.three === 'ready') {
      try {
        viewer?.setRotation(degrees);
      } catch (error) {
        threeRotationEnabled = false;
        panels.three.status.textContent = 'Ready · automatic rotation is unavailable for this model';
        console.warn('Three.js model rotation failed.', error);
      }
    }
    rotationFrame = requestAnimationFrame(rotate);
  }
  rotate(startedAt);
}

function stopCycle() {
  clearTimeout(cycleTimer);
  cycleTimer = null;
  cycleDeadline = null;
  cancelAnimationFrame(progressFrame);
  progress.style.transform = 'scaleX(0)';
}

function advanceModel() {
  if (!autoCycle.checked || !models.length) return;
  try {
    showModel((currentIndex + 1) % models.length);
  } catch (error) {
    console.error('Model selection failed; cycling will continue.', error);
    setPanel('native', 'error', 'Could not display this model. Cycling will continue.');
    setPanel('three', 'error', 'Could not display this model. Cycling will continue.');
    scheduleCycle();
  }
}

function scheduleCycle() {
  stopCycle();
  const loading = Object.values(states).includes('loading');
  const startedAt = performance.now();
  // Arm advancement before doing any renderer work. Even a load callback or
  // rotation failure cannot leave automatic cycling without a next-model timer.
  if (autoCycle.checked) {
    const id = generation;
    cycleDeadline = loading ? loadDeadline + DISPLAY_MS : startedAt + DISPLAY_MS;
    cycleTimer = setTimeout(() => {
      if (id === generation) advanceModel();
    }, Math.max(0, cycleDeadline - performance.now()));
  }
  if (!loading && (rotationFrame === null || autoCycle.checked)) startRotation(startedAt);
  if (!autoCycle.checked) {
    cycleStatus.textContent = 'Manual selection';
    return;
  }
  if (loading) {
    cycleStatus.textContent = 'Waiting for the views…';
    return;
  }
  const deadline = cycleDeadline;
  function updateProgress() {
    const remaining = Math.max(0, deadline - performance.now());
    const text = `Next model in ${Math.ceil(remaining / 1000)}s`;
    if (cycleStatus.textContent !== text) cycleStatus.textContent = text;
    progress.style.transform = `scaleX(${1 - remaining / DISPLAY_MS})`;
    if (remaining > 0) progressFrame = requestAnimationFrame(updateProgress);
  }
  updateProgress();
}

function loadNative(url) {
  const element = document.createElement('model');
  element.setAttribute('stagemode', 'orbit');
  element.setAttribute('autoplay', '');
  element.setAttribute('loop', '');
  element.setAttribute('aria-label', models[currentIndex].name);
  // A fresh element gives every selection its own ready promise and renderer.
  nativeHost.replaceChildren(element);
  if (!('ready' in element) && typeof window.HTMLModelElement !== 'function') {
    element.setAttribute('src', url);
    return Promise.reject(new Error('Native <model> is unavailable. Use a browser with model support enabled.'));
  }
  return new Promise((resolve, reject) => {
    element.addEventListener('error', () => reject(new Error('The browser could not display this GLB.')), { once: true });
    element.setAttribute('src', url);
    element.environmentMap = environmentMapURL;
    const ready = element.ready;
    const modelReady = ready && typeof ready.then === 'function'
      ? ready
      : new Promise((loaded) => element.addEventListener('load', loaded, { once: true }));
    const mapReady = element.environmentMapReady;
    const environmentReady = mapReady && typeof mapReady.then === 'function'
      ? mapReady.catch(() => { throw new Error('The browser could not load the environment map.'); })
      : Promise.resolve();
    Promise.all([modelReady, environmentReady]).then(() => resolve(element), reject);
  });
}

function showModel(index) {
  const id = ++generation;
  currentIndex = index;
  loadDeadline = performance.now() + LOAD_TIMEOUT_MS;
  states = { native: 'loading', three: 'loading' };
  threeRotationEnabled = true;
  scheduleCycle();
  stopRotation();
  loadTimers.forEach(clearTimeout);
  loadTimers = [];
  const asset = models[index];
  const url = new URL(asset.url, document.baseURI).href;
  select.value = String(index);
  document.querySelector('#model-name').textContent = asset.name;
  document.querySelector('#model-details').textContent = `${asset.path} · ${(asset.bytes / 1024 / 1024).toFixed(2)} MB`;
  document.querySelector('#model-count').textContent = `${index + 1} / ${models.length}`;
  setPanel('native', 'loading', 'Loading model…');
  setPanel('three', 'loading', 'Loading model…');

  function watch(name, load) {
    let settled = false;
    const timer = setTimeout(() => finish('error', 'Loading took too long. Try another model.'), LOAD_TIMEOUT_MS);
    loadTimers.push(timer);
    function finish(state, text, value) {
      if (settled || id !== generation) return;
      settled = true;
      clearTimeout(timer);
      setPanel(name, state, text);
      if (state === 'ready' && name === 'native') {
        try {
          nativeRotation = createNativeRotation(value);
        } catch (error) {
          panels.native.status.textContent = 'Ready · automatic rotation is unavailable in this browser';
          console.warn('Native model rotation could not start.', error);
        }
      }
      // Start the five seconds after both views are ready or have reported a failure.
      if (!Object.values(states).includes('loading')) scheduleCycle();
    }
    // Install the timeout first and turn synchronous load failures into normal
    // promise rejections, so the other view and the cycle always keep running.
    Promise.resolve().then(load).then(
      (value) => finish('ready', 'Ready', value),
      (error) => finish('error', name === 'native'
        ? (error.message || 'The browser could not display this GLB.')
        : (viewerError || 'Three.js could not load the model or its environment map. Try another model.')),
    );
  }
  watch('native', () => loadNative(url));
  watch('three', () => viewer ? viewer.load(url) : Promise.reject(new Error(viewerError)));
}

select.addEventListener('change', () => showModel(Number(select.value)));
autoCycle.addEventListener('change', scheduleCycle);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cycleDeadline !== null && performance.now() >= cycleDeadline) advanceModel();
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  stopCycle();
  stopRotation();
  loadTimers.forEach(clearTimeout);
  viewer?.dispose();
});

try {
  const response = await fetch('./models.json');
  if (!response.ok) throw new Error(`Collection request failed (${response.status}).`);
  models = await response.json();
  if (!models.length) throw new Error('The model collection is empty.');
  select.replaceChildren(...models.map((model, index) => new Option(model.name, String(index))));
  select.disabled = false;
  autoCycle.disabled = false;
  const initialIndex = models.findIndex((model) => model.path === 'RobotExpressive/RobotExpressive.glb');
  showModel(Math.max(initialIndex, 0));
} catch (error) {
  setPanel('native', 'error', 'Could not load the collection. Serve this folder over HTTP.');
  setPanel('three', 'error', 'Could not load the collection. Serve this folder over HTTP.');
  document.querySelector('#model-details').textContent = error.message;
}
