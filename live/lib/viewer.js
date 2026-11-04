// ---------------------------------------------------------------------------
// STL viewer
// ---------------------------------------------------------------------------

/**
 * Three.js viewer for the generated STL.
 *
 * Loaded on demand by generator.js so a blocked or offline CDN only costs the
 * 3D preview, not the rest of the page.
 *
 * This file is the only place that depends on a third party.
 */

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let container = null;
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let model = null;
let observer = null;
let home = null;

/** Starts the renderer. Safe to call more than once; only the first mounts. */
export function mount(target) {
  if (renderer) return;

  container = target;

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    throw new Error('WebGL is not available in this browser, so the model cannot be shown.');
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111315);

  camera = new THREE.PerspectiveCamera(45, aspect(), 0.1, 10000);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;

  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x24272a, 1.15));

  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(160, 260, 200);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffd9c0, 0.5);
  fill.position.set(-220, 90, -160);
  scene.add(fill);

  observer = new ResizeObserver(resize);
  observer.observe(container);

  resize();
  animate();
}

function aspect() {
  return Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);
}

function resize() {
  if (!renderer) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  // The container has no size while its tab is hidden. Keep the last good size
  // rather than collapsing the renderer to a single pixel.
  if (!width || !height) return;

  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (!renderer || !container.clientWidth) return;
  controls.update();
  renderer.render(scene, camera);
}

/**
 * Replaces the displayed model with the given binary STL bytes.
 * @param {ArrayBuffer} stlBytes
 */
export function show(stlBytes) {
  if (!renderer) throw new Error('The viewer was not mounted.');

  const geometry = new STLLoader().parse(stlBytes);
  if (!geometry.getAttribute('position') || geometry.getAttribute('position').count === 0) {
    throw new Error('The generated model has no triangles to display.');
  }

  showGeometry(geometry);
}

/**
 * Shows an indexed mesh in model space (Z up) for in-place updates.
 * Call updateMesh() after rewriting the positions buffer.
 * @param {Float32Array} positions xyz triples
 * @param {Uint32Array} indices triangle vertex indices
 * @param {{ frame?: boolean }} [options] keep the current camera when false
 */
export function showMesh(positions, indices, { frame: shouldFrame = true } = {}) {
  if (!renderer) throw new Error('The viewer was not mounted.');

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // Already centred on the origin; translating would fight the in-place updates.
  showGeometry(geometry, false, shouldFrame);
}

/** Refreshes a mesh shown with showMesh() after its positions changed. */
export function updateMesh() {
  if (!model) return;

  model.geometry.getAttribute('position').needsUpdate = true;
  model.geometry.computeVertexNormals();
}

function showGeometry(geometry, recenter = true, shouldFrame = true) {
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const box = geometry.boundingBox;
  const size = box.getSize(new THREE.Vector3());

  if (recenter) {
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
  }

  disposeModel();

  model = new THREE.Mesh(geometry, createMaterial());
  // The mesh is modelled Z-up; Three.js is Y-up.
  model.rotation.x = -Math.PI / 2;
  scene.add(model);

  if (shouldFrame) frame(size);
}

function createMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xe4e3da,
    metalness: 0.05,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
}

/**
 * The view a freshly framed model starts from, and the one resetView() returns
 * to: back-left, slightly above, and a touch closer than the fitted distance.
 * Measured on the live ring, whose fitted distance is 282.22 mm at fov 45.
 * Kept relative to that fit so models of any size frame alike.
 */
const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(-0.686926, 0.261874, 0.677905);
const DEFAULT_VIEW_SCALE = 0.985835;

/** Positions the camera to fit a bounding-box size, once per model. */
function frame(size) {
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.35;

  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.position
    .copy(DEFAULT_VIEW_DIRECTION)
    .multiplyScalar(distance * DEFAULT_VIEW_SCALE);
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.minDistance = radius * 0.2;
  controls.maxDistance = radius * 12;
  controls.update();

  home = {
    position: camera.position.clone(),
    target: controls.target.clone(),
  };
}

/** Restores the view used when the model was framed. */
export function resetView() {
  if (!home) return;
  controls.autoRotate = false;
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  controls.update();
}

/** Looks straight down at the target, keeping the current distance. */
export function setTopView() {
  if (!home) return;
  controls.autoRotate = false;

  const target = controls.target.clone();
  const distance = Math.max(camera.position.distanceTo(target), 1);
  // A tiny tilt keeps OrbitControls away from its pole.
  const tilt = distance * 0.001;
  camera.position.set(target.x + tilt, target.y + distance, target.z + tilt);
  controls.update();
}

/**
 * Prints the current camera placement, so a view found by orbiting can be
 * copied out as a new default. Returns the same values it logs.
 */
export function logCamera() {
  if (!camera || !controls) return null;

  const position = camera.position.clone();
  const target = controls.target.clone();
  const round = (value) => Number(value.toFixed(2));

  const placement = {
    position: [round(position.x), round(position.y), round(position.z)],
    target: [round(target.x), round(target.y), round(target.z)],
    distance: round(position.distanceTo(target)),
    fov: camera.fov,
  };

  console.log(
    `[camera] position ${placement.position.join(', ')} · ` +
    `target ${placement.target.join(', ')} · ` +
    `distance ${placement.distance} · fov ${placement.fov}`,
  );
  console.log(`[camera] ${JSON.stringify(placement)}`);

  return placement;
}

/** Toggles the slow orbit and reports whether it is now on. */
export function toggleAutoRotate() {
  if (!controls) return false;
  controls.autoRotate = !controls.autoRotate;
  controls.autoRotateSpeed = 0.6;
  return controls.autoRotate;
}

function disposeModel() {
  if (!model) return;
  scene.remove(model);
  model.geometry.dispose();
  model.material.dispose();
  model = null;
}

/** Releases the renderer and its GPU resources. */
export function dispose() {
  if (!renderer) return;
  observer.disconnect();
  observer = null;
  if (model) {
    model.geometry.dispose();
    model.material.dispose();
    model = null;
  }
  controls.dispose();
  renderer.dispose();
  renderer.domElement.remove();
  renderer = null;
  container = null;
}
