import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { environmentMapURL } from './environment.js';

function disposeModel(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [].concat(object.material || [])) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
    object.skeleton?.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  const images = new Set();
  textures.forEach((texture) => {
    images.add(texture.source.data);
    texture.dispose();
  });
  images.forEach((image) => image?.close?.());
}

export function createThreeViewer(host) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Interactive Three.js model preview');

  const pmrem = new THREE.PMREMGenerator(renderer);
  let environmentTarget = null;
  let environmentError = null;
  let disposed = false;
  const environmentReady = new THREE.TextureLoader().loadAsync(environmentMapURL)
    .then((texture) => {
      try {
        if (disposed) return;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        environmentTarget = pmrem.fromEquirectangular(texture);
        scene.environment = environmentTarget.texture;
      } finally {
        texture.dispose();
      }
    })
    .catch((error) => { environmentError = error; })
    .finally(() => pmrem.dispose());

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  camera.position.z = 5;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const draco = new DRACOLoader().setDecoderPath('./vendor/three/examples/jsm/libs/draco/gltf/');
  const ktx2 = new KTX2Loader().setTranscoderPath('./vendor/three/examples/jsm/libs/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  let currentModel = null;
  let mixer = null;
  let request = 0;
  let radius = 1;
  let lastTime = performance.now();

  function fit() {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.08;
    camera.position.set(0, 0, distance);
    camera.near = Math.max(radius / 100, 0.00001);
    camera.far = distance + radius * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 0.1;
    controls.maxDistance = distance * 10;
    controls.update();
    controls.saveState();
  }

  const resizeObserver = new ResizeObserver(() => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (currentModel) fit();
  });
  resizeObserver.observe(host);

  renderer.setAnimationLoop((time) => {
    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    mixer?.update(delta);
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    async load(url) {
      const id = ++request;
      if (currentModel) {
        mixer?.stopAllAction();
        if (mixer) mixer.uncacheRoot(mixer.getRoot());
        mixer = null;
        scene.remove(currentModel);
        disposeModel(currentModel);
        currentModel = null;
      }
      const [gltf] = await Promise.all([loader.loadAsync(url), environmentReady]);
      if (id !== request) {
        gltf.scenes.forEach(disposeModel);
        return;
      }
      if (environmentError) {
        gltf.scenes.forEach(disposeModel);
        throw new Error('The environment map could not be loaded.', { cause: environmentError });
      }
      currentModel = gltf.scene;
      currentModel.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(currentModel);
      if (bounds.isEmpty()) {
        disposeModel(currentModel);
        currentModel = null;
        throw new Error('This asset contains no visible geometry.');
      }
      const center = bounds.getCenter(new THREE.Vector3());
      radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.001);
      // Keep the asset's root transform intact so animation tracks cannot undo centering.
      const centeredModel = new THREE.Group();
      centeredModel.position.copy(center).negate();
      centeredModel.add(currentModel);
      // The outer group rotates around the centered geometry, keeping the asset
      // in place even when its original root is away from the bounds center.
      const group = new THREE.Group();
      group.add(centeredModel);
      currentModel = group;
      scene.add(currentModel);
      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        mixer.clipAction(gltf.animations[0]).play();
      }
      fit();
      renderer.render(scene, camera);
    },
    setRotation(degrees) {
      if (currentModel) currentModel.rotation.y = THREE.MathUtils.degToRad(degrees);
    },
    dispose() {
      disposed = true;
      ++request;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      draco.dispose();
      ktx2.dispose();
      mixer?.stopAllAction();
      if (currentModel) disposeModel(currentModel);
      environmentTarget?.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
