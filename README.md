# Model gallery

A static website comparing native `<model>` rendering with Three.js, using all 46
GLB files from `/Users/cabanier/local/three.js/examples/models/gltf`.

## Run

```sh
cd /Users/cabanier/local/model-gallery
python3 -m http.server 8000 --bind 127.0.0.1
```

Open **http://localhost:8000**. No package installation or internet connection is needed.

Choose an asset from the dropdown, or enable **Cycle all models**. Both views load the
same GLB. Once both finish loading, the model is displayed for five seconds before
advancing. The collection loops back to the first model after the last. Selecting a
model manually while cycling resets its display interval; switching cycling off
keeps the current model. Failed assets show a message and cycling continues. Loads
time out after ten seconds; an independent advancement timer also prevents a stalled
renderer from blocking the sequence. Cycling resumes when a background tab becomes
visible again.

Both models spin around their vertical axis, completing a full turn every five
seconds. Rotation starts together after loading; enabling automatic cycling restarts
the turn so each displayed model completes one rotation before advancing. Manual
selection also starts a fresh turn. The models keep spinning when cycling is off.
The Three.js view supports dragging to orbit and scrolling to zoom.

The left view uses the native `<model>` element with `autoplay` and `loop`. It first
uses `stagemode="orbit"` to fit the model, then switches to `none` so script can rotate
`entityTransform` around the bounding-box center. The fit adjusts when the viewport
resizes. It needs a browser with native model support enabled and a secure context
(localhost qualifies). If native support is unavailable, the Three.js view still works.
Some GLB extensions may be unsupported by a particular native implementation.

Both views use the same brighter Royal Esplanade daylight JPEG for environment lighting
and reflections. The native view sets `environmentMap` and waits for
`environmentMapReady`; Three.js generates a filtered environment texture from the
same image. Cycling waits for the environment lighting as well as the models.

The right view uses the local Three.js 0.186.0 build, image-based lighting, orbit
controls, and the first animation clip when available. Draco, Meshopt, and Basis/KTX2
decoders are bundled locally. Browser AVIF and WebP support is required for assets
using those texture formats. Each renderer chooses its own camera fit and processes
the shared environment image using its own rendering pipeline.

## Files

- `index.html`, `styles.css`, `app.js`: interface and cycling logic.
- `three-viewer.js`: Three.js rendering and model cleanup.
- `native-rotation.js`: native model rotation and fitting after resize.
- `environment.js`, `environment/`: shared environment-map URL and equirectangular images.
- `models.json`: the complete collection, sorted by name.
- `models/`: unchanged copies of the source GLBs, preserving relative paths.
- `vendor/three/`: the local Three.js build, required addons, decoders, and license.

Source collection: [Three.js glTF examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf).

## Cycling checks

```sh
node --experimental-vm-modules --test test/cycling.test.mjs
```

These checks use a simulated clock and renderers to cover repeated full-collection
loops, stalled loads, rendering and cleanup errors, and cycling controls.
