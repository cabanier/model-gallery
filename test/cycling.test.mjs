import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const models = JSON.parse(await readFile(new URL('../models.json', import.meta.url), 'utf8'));
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const initialIndex = models.findIndex((model) => model.name === 'Robot Expressive');

class Clock {
  now = 0;
  nextId = 0;
  timers = new Map();
  set = (callback, delay = 0) => {
    const id = ++this.nextId;
    this.timers.set(id, { time: this.now + delay, callback });
    return id;
  };
  clear = (id) => this.timers.delete(id);
  async flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  async advance(milliseconds) {
    await this.flush();
    const end = this.now + milliseconds;
    for (;;) {
      const next = [...this.timers]
        .filter(([, timer]) => timer.time <= end)
        .sort((a, b) => a[1].time - b[1].time || a[0] - b[0])[0];
      if (!next) break;
      this.now = Math.max(this.now, next[1].time);
      this.timers.delete(next[0]);
      next[1].callback();
      await this.flush();
    }
    this.now = end;
    await this.flush();
  }
  delay(milliseconds) {
    return new Promise((resolve) => this.set(resolve, milliseconds));
  }
}

class Element {
  textContent = '';
  value = '';
  checked = false;
  style = {};
  children = [];
  firstElementChild = { textContent: '' };
  listeners = new Map();
  attributes = new Map();
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  dispatch(type) {
    for (const callback of this.listeners.get(type) || []) callback({ type });
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  replaceChildren(...children) { this.children = children; }
}

async function gallery(failures = {}) {
  const clock = new Clock();
  const elements = new Map();
  const loads = [];
  const warnings = [];
  const document = new Element();
  const window = new Element();
  document.hidden = false;
  document.baseURI = 'http://localhost:8000/';
  document.querySelector = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  class Model extends Element {
    get ready() {
      const name = this.getAttribute('aria-label');
      return failures.nativeHang?.(name) ? new Promise(() => {}) : clock.delay(10);
    }
    set environmentMap(value) { this.environmentMapReady = clock.delay(10); }
  }
  document.createElement = () => new Model();
  const nativeHost = document.querySelector('#native-host');
  nativeHost.replaceChildren = (element) => {
    if (failures.nativeAttach?.(element.getAttribute('aria-label'))) {
      throw new Error('Native renderer attachment failed');
    }
    nativeHost.children = [element];
  };
  let threeName;
  const three = {
    load(url) {
      threeName = models.find((model) => url.endsWith(model.url)).name;
      loads.push(threeName);
      if (failures.threeLoad?.(threeName)) throw new Error('Three.js load failed');
      return failures.threeHang?.(threeName) ? new Promise(() => {}) : clock.delay(10);
    },
    setRotation() {
      if (failures.threeRotation?.(threeName)) throw new Error('Three.js rotation failed');
    },
    dispose() {},
  };
  const context = vm.createContext({
    window, document, URL,
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
    performance: { now: () => clock.now },
    setTimeout: clock.set, clearTimeout: clock.clear,
    requestAnimationFrame: (callback) => clock.set(() => callback(clock.now), 25),
    cancelAnimationFrame: clock.clear,
    fetch: async () => ({ ok: true, json: async () => models }),
  });
  function module(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  }
  const dependencies = {
    './three-viewer.js': module({ createThreeViewer: () => three }),
    './environment.js': module({ environmentMapURL: 'http://localhost:8000/environment/test.jpg' }),
    './native-rotation.js': module({
      createNativeRotation: (element) => {
        const name = element.getAttribute('aria-label');
        return {
          update() {
            if (failures.nativeRotation?.(name)) throw new Error('Native rotation failed');
          },
          dispose() {
            if (failures.nativeCleanup?.(name)) throw new Error('Native cleanup failed');
          },
        };
      },
    }),
  };
  const app = new vm.SourceTextModule(appSource, { context });
  await app.link((name) => dependencies[name]);
  await app.evaluate();
  await clock.flush();
  const select = document.querySelector('#model-select');
  const cycle = document.querySelector('#auto-cycle');
  return {
    clock, loads, warnings, document, select,
    enable(value = true) { cycle.checked = value; cycle.dispatch('change'); },
    choose(index) { select.value = String(index); select.dispatch('change'); },
  };
}

const robot = (name) => name === 'Robot Expressive';

test('cycles through all 46 models repeatedly, including Robot Expressive on every lap', async () => {
  const app = await gallery();
  app.enable();
  await app.clock.advance(10);
  await app.clock.advance(3 * models.length * 5010);
  assert.equal(app.loads.length, 3 * models.length + 1);
  assert.equal(app.select.value, String(initialIndex));
  for (let i = 0; i < app.loads.length; i++) {
    assert.equal(app.loads[i], models[(initialIndex + i) % models.length].name);
  }
  await app.clock.advance(5010);
  assert.equal(app.select.value, String((initialIndex + 1) % models.length));
});

test('rotation and cleanup exceptions cannot stop advancement', async () => {
  const app = await gallery({ nativeRotation: robot, nativeCleanup: robot, threeRotation: robot });
  app.enable();
  await app.clock.advance(10);
  assert.equal(app.warnings.length, 3);
  await app.clock.advance(5010);
  assert.equal(app.select.value, String((initialIndex + 1) % models.length));
  await app.clock.advance(models.length * 5010);
  assert.equal(app.loads.length, models.length + 2);
});

test('cleanup failure during a normal model transition cannot stop the next load', async () => {
  const app = await gallery({ nativeCleanup: robot });
  app.enable();
  await app.clock.advance(5020);
  assert.equal(app.loads.length, 2);
  assert.equal(app.select.value, String((initialIndex + 1) % models.length));
  assert.equal(app.warnings.length, 1);
});

test('both hanging renderers time out and advance instead of waiting forever', async () => {
  const app = await gallery({ nativeHang: robot, threeHang: robot });
  app.enable();
  await app.clock.advance(14999);
  assert.equal(app.select.value, String(initialIndex));
  await app.clock.advance(1);
  assert.equal(app.select.value, String((initialIndex + 1) % models.length));
  await app.clock.advance(5010);
  assert.equal(app.loads.length, 3);
});

test('synchronous native attachment and Three.js load errors still advance', async () => {
  const app = await gallery({ nativeAttach: robot, threeLoad: robot });
  app.enable();
  await app.clock.flush();
  await app.clock.advance(5000);
  assert.equal(app.select.value, String((initialIndex + 1) % models.length));
  await app.clock.advance(5010);
  assert.equal(app.loads.length, 3);
});

test('disabling cycling cancels advancement during a hung load', async () => {
  const app = await gallery({ nativeHang: robot });
  app.enable();
  await app.clock.advance(1000);
  app.enable(false);
  await app.clock.advance(20000);
  assert.equal(app.select.value, String(initialIndex));
  assert.equal(app.loads.length, 1);
  app.enable();
  await app.clock.advance(5000);
  assert.equal(app.select.value, String((initialIndex + 1) % models.length));
});

test('manual selection restarts the display interval and cancels the old deadline', async () => {
  const app = await gallery();
  app.enable();
  await app.clock.advance(4000);
  app.choose(0);
  await app.clock.advance(5009);
  assert.equal(app.select.value, '0');
  await app.clock.advance(1);
  assert.equal(app.select.value, '1');
});

test('returning to a suspended tab advances once without duplicating the old timer', async () => {
  const app = await gallery();
  app.enable();
  await app.clock.advance(10);
  app.clock.now += 20000;
  app.document.dispatch('visibilitychange');
  await app.clock.advance(10);
  assert.equal(app.loads.length, 2);
  assert.equal(app.select.value, String((initialIndex + 1) % models.length));
});
