import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/controls/OrbitControls.js';
import { imageDistance, imagePoint, rayThroughAperture } from './optics.js';
import { translations } from './translations.js';
import { orientPixels } from './image-processing.js';

const $ = (id) => document.getElementById(id);
const stage = $('threeStage');
const preview = $('sensorPreview');
const previewContext = preview.getContext('2d', { willReadFrequently: true });
const lensCenter = { x: 0, y: 2.04, z: 0 };
const pose = { x: 0, y: 0, z: 0 };
const OBJECT_X = 9.4;
const SENSOR_W = 1.88;
const SENSOR_H = SENSOR_W * 9 / 16;
const APERTURE = [[0, 0], [.42, 0], [-.42, 0], [0, .42], [0, -.42], [.29, .29], [-.29, -.29]];
const points = [
  { p: { x: OBJECT_X, y: 3.05, z: .82 }, color: 0x6be7dc, line: 0x64e2d9 },
  { p: { x: OBJECT_X, y: .72, z: -1.48 }, color: 0xffc782, line: 0xffbd73 },
];
const views = {
  overview: { position: [-7.0, 5.1, 11.8], target: [3.35, 1.45, 0] },
  rays: { position: [1.25, 4.15, 11.5], target: [3.85, 1.8, 0] },
  sensor: { position: [-5.1, 2.72, 1.5], target: [-1.25, 2.04, 0] },
};
const state = { focalMM: 50, rays: true, axis: true, shell: true, sensorDirty: true, view: 'overview', language: 'en', exposure: 1.3, light: 2.35, photo: null, photoMode: 'RGB' };

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
} catch (error) {
  stage.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#e6f6ee">Não foi possível iniciar a cena 3D. Ativa WebGL no navegador para usar o laboratório.</div>';
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 800 ? 1.5 : 1.8));
renderer.setSize(stage.clientWidth, stage.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = state.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8bbdc3);
scene.fog = new THREE.Fog(0xa3c8c5, 24, 58);
const skyGeometry = new THREE.SphereGeometry(60, 36, 22);
const skyColors = [];
const skyTop = new THREE.Color(0x5c9bad), skyHorizon = new THREE.Color(0xb6d8d1), skyBelow = new THREE.Color(0x247e8b);
for (let i = 0; i < skyGeometry.attributes.position.count; i++) {
  const y = skyGeometry.attributes.position.getY(i) / 60;
  const color = y >= 0 ? skyHorizon.clone().lerp(skyTop, Math.min(y * 2, 1)) : skyHorizon.clone().lerp(skyBelow, Math.min(-y * 3, 1));
  skyColors.push(color.r, color.g, color.b);
}
skyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
scene.add(new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
const camera = new THREE.PerspectiveCamera(42, stage.clientWidth / Math.max(stage.clientHeight, 1), .1, 100);
camera.position.set(...views.overview.position);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .065;
controls.enablePan = false;
controls.minDistance = 2.8;
controls.maxDistance = 26;
controls.maxPolarAngle = Math.PI * .79;
controls.target.set(...views.overview.target);
controls.update();
let desiredView = null;
controls.addEventListener('start', () => { desiredView = null; });

scene.add(new THREE.HemisphereLight(0xcdfafa, 0x34505b, 1.7));
const sunlight = new THREE.DirectionalLight(0xffe4b5, state.light);
sunlight.position.set(4, 12, 8);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);
sunlight.shadow.camera.left = -15;
sunlight.shadow.camera.right = 18;
sunlight.shadow.camera.top = 12;
sunlight.shadow.camera.bottom = -12;
scene.add(sunlight);
const fill = new THREE.DirectionalLight(0x5ddde2, 1.25);
fill.position.set(-5, 4, -7);
scene.add(fill);

// The island keeps the palm-covered, sandy scene from the supplied prototype.
// A radial terrain avoids the visible square edges of the original plane.
const island = new THREE.Group();
scene.add(island);
const terrainRadius = 3.25;
function terrainHeight(r, angle) {
  const t = Math.min(r / terrainRadius, 1);
  return .1 + .73 * Math.pow(1 - t * t, 1.5) + .04 * Math.sin(angle * 5 + r * 2.1) * t + .015 * Math.sin(angle * 13 + r * 11) * (1 - t);
}
function makeTerrain() {
  const rings = 36, sides = 96;
  const positions = [], colors = [], indices = [];
  const grass = new THREE.Color(0x4b9a65), edgeGrass = new THREE.Color(0x8ab382);
  const sand = new THREE.Color(0xe5c893), shore = new THREE.Color(0xd49f6e);
  for (let r = 0; r <= rings; r++) {
    const radius = r / rings * terrainRadius;
    for (let i = 0; i <= sides; i++) {
      const angle = i / sides * Math.PI * 2;
      const h = terrainHeight(radius, angle);
      positions.push(OBJECT_X + Math.cos(angle) * radius, h, Math.sin(angle) * radius);
      const t = radius / terrainRadius;
      const c = t < .58 ? grass.clone().lerp(edgeGrass, t / .58 * .7) : edgeGrass.clone().lerp(t > .86 ? shore : sand, Math.min((t - .58) / .42, 1));
      const variation = .91 + .045 * Math.sin(i * 1.7 + r * 2.3) + .035 * Math.sin(i * 5.9 - r * 3.4);
      colors.push(c.r * variation, c.g * variation, c.b * variation);
      if (r < rings && i < sides) {
        const a = r * (sides + 1) + i, b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: THREE.DoubleSide }));
  land.castShadow = true; land.receiveShadow = true;
  island.add(land);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(terrainRadius, terrainRadius * .82, .3, 80), new THREE.MeshStandardMaterial({ color: 0xb69268, roughness: 1 }));
  rim.position.set(OBJECT_X, -.07, 0); rim.receiveShadow = true; island.add(rim);
}
makeTerrain();

// The sea is an annulus with an opening around the island, and the wet shore
// and submerged sand remain separate surfaces instead of being flooded by a disc.
function makeAnnulus(inner, outer, height, material) {
  const count = 128, vertices = [], triangles = [];
  for (let ring = 0; ring <= 10; ring++) {
    for (let i = 0; i <= count; i++) {
      const a = i / count * Math.PI * 2;
      const r = inner + (outer - inner) * ring / 10;
      const wave = .028 * Math.sin(a * 7) + .017 * Math.sin(a * 13 + r * 2);
      vertices.push(OBJECT_X + (r + wave) * Math.cos(a), height + .008 * Math.sin(a * 9 + r * 5), (r + wave) * Math.sin(a));
      if (ring < 10 && i < count) { const p = ring * (count + 1) + i, q = p + count + 1; triangles.push(p, q, p + 1, p + 1, q, q + 1); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(triangles); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; scene.add(mesh);
  return mesh;
}
makeAnnulus(3.18, 3.55, -.16, new THREE.MeshStandardMaterial({ color: 0x8eb5a5, roughness: .9, side: THREE.DoubleSide }));
makeAnnulus(3.28, 5.35, -.19, new THREE.MeshStandardMaterial({ color: 0x248994, roughness: .21, metalness: .25, transparent: true, opacity: .9, side: THREE.DoubleSide }));
const distantSea = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x2b8995, roughness: .36, metalness: .1 }));
distantSea.rotation.x = -Math.PI / 2;
distantSea.position.set(54, -.35, 0);
distantSea.receiveShadow = true;
scene.add(distantSea);
for (const [radius, opacity] of [[3.39, .62], [3.54, .26], [4.34, .17]]) {
  const foam = new THREE.Mesh(new THREE.TorusGeometry(radius, .017, 5, 128), new THREE.MeshBasicMaterial({ color: 0xb0efe6, transparent: true, opacity }));
  foam.rotation.x = Math.PI / 2; foam.position.set(OBJECT_X, -.137, 0); scene.add(foam);
}

function makePalm(baseX, baseZ, height, angle) {
  const rootY = terrainHeight(Math.hypot(baseX - OBJECT_X, baseZ), Math.atan2(baseZ, baseX - OBJECT_X));
  const top = new THREE.Vector3(baseX + Math.cos(angle) * .27, rootY + height, baseZ + Math.sin(angle) * .2);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(baseX, rootY, baseZ),
    new THREE.Vector3(baseX + Math.cos(angle) * .12, rootY + height * .38, baseZ + Math.sin(angle) * .09),
    new THREE.Vector3(baseX + Math.cos(angle) * .18, rootY + height * .7, baseZ + Math.sin(angle) * .14), top,
  ]);
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, .087, 7, false), new THREE.MeshStandardMaterial({ color: 0xa4774d, roughness: 1 }));
  trunk.castShadow = true; island.add(trunk);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(.15, 10, 8), new THREE.MeshStandardMaterial({ color: 0x487d51, roughness: 1 }));
  crown.position.copy(top); island.add(crown);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2;
    const length = .65 + (i % 3) * .13;
    const outward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const cross = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const mid = top.clone().addScaledVector(outward, length * .55).add(new THREE.Vector3(0, .14, 0));
    const tip = top.clone().addScaledVector(outward, length).add(new THREE.Vector3(0, -.22 - (i % 2) * .08, 0));
    const vertices = [top.clone(), mid.clone().addScaledVector(cross, .14), tip.clone(), top.clone(), tip.clone(), mid.clone().addScaledVector(cross, -.14)];
    const geo = new THREE.BufferGeometry().setFromPoints(vertices);
    geo.computeVertexNormals();
    const leaf = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: i % 2 ? 0x3c8d5a : 0x57ad67, roughness: .85, side: THREE.DoubleSide }));
    leaf.castShadow = true; island.add(leaf);
    const vein = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([top.clone(), mid, tip]), 8, .009, 3, false), new THREE.MeshStandardMaterial({ color: 0x95bf73, roughness: 1 }));
    island.add(vein);
  }
  for (let j = 0; j < 3; j++) {
    const coconut = new THREE.Mesh(new THREE.SphereGeometry(.085, 8, 6), new THREE.MeshStandardMaterial({ color: 0x6b5038, roughness: 1 }));
    coconut.position.copy(top).add(new THREE.Vector3(Math.cos(j * 2.1) * .11, -.12, Math.sin(j * 2.1) * .11)); island.add(coconut);
  }
  return top;
}
// This crown and the amber beach marker share x=9.4: they are on one object plane.
makePalm(9.14, .82, 2.23, .07);
makePalm(8.35, -1.04, 1.65, .8);
makePalm(10.25, 1.35, 1.46, 2.45);
for (const [x, z, scale] of [[7.95,.75,.35],[10.8,-.65,.28],[8.4,1.82,.25],[10.7,1.95,.29]]) {
  const y = terrainHeight(Math.hypot(x - OBJECT_X, z), Math.atan2(z, x - OBJECT_X));
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(scale, 0), new THREE.MeshStandardMaterial({ color: 0x879d8c, roughness: 1 }));
  rock.scale.set(1.35, .65, 1); rock.position.set(x, y + scale * .21, z); rock.castShadow = true; island.add(rock);
}
// Low foliage and small surface detail make the shore read clearly in the high-resolution photo.
const tuftGeo = new THREE.ConeGeometry(.035, .19, 3);
const tuftMaterial = new THREE.MeshStandardMaterial({ color: 0x628d54, roughness: 1, side: THREE.DoubleSide });
const tufts = new THREE.InstancedMesh(tuftGeo, tuftMaterial, 210);
const dummy = new THREE.Object3D();
for (let i = 0; i < 210; i++) {
  const a = i * 2.39996, r = .25 + 2.4 * Math.sqrt((i + .5) / 210);
  const x = OBJECT_X + Math.cos(a) * r, z = Math.sin(a) * r;
  dummy.position.set(x, terrainHeight(r, a) + .08, z);
  dummy.rotation.set(0, i * .63, -.15 + .3 * Math.sin(i * 5.1));
  const size = .65 + .75 * (Math.sin(i * 32.71) * .5 + .5);
  dummy.scale.set(size, size, size); dummy.updateMatrix(); tufts.setMatrixAt(i, dummy.matrix);
}
tufts.castShadow = true; island.add(tufts);
function makeBroadleaf(x, z, height) {
  const y = terrainHeight(Math.hypot(x - OBJECT_X, z), Math.atan2(z, x - OBJECT_X));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.07, .13, height, 9), new THREE.MeshStandardMaterial({ color: 0x705541, roughness: 1 }));
  trunk.position.set(x, y + height / 2, z); trunk.castShadow = true; island.add(trunk);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x4b9163, roughness: .95 });
  for (let i = 0; i < 13; i++) {
    const a = i * 2.39996, r = .25 * Math.sqrt(i / 13);
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(.23 + .045 * Math.sin(i * 3.1), 1), canopyMat);
    foliage.position.set(x + r * Math.cos(a), y + height - .1 + .24 * Math.sin(i * 2), z + r * Math.sin(a));
    foliage.castShadow = true; island.add(foliage);
  }
}
makeBroadleaf(8.0, -1.48, 1.35);
makeBroadleaf(10.75, -.15, 1.65);

// Cutaway camera: clear shell, visible lens, sensor plane and outward-facing image.
const cameraRig = new THREE.Group();
scene.add(cameraRig);
const shellParts = new THREE.Group();
cameraRig.add(shellParts);
const shell = new THREE.Mesh(new THREE.BoxGeometry(2.52, 1.64, 2.12), new THREE.MeshPhysicalMaterial({ color: 0x7cd7d6, metalness: .23, roughness: .18, transparent: true, opacity: .105, depthWrite: false, side: THREE.DoubleSide }));
shell.position.set(-1.26, lensCenter.y, 0); shellParts.add(shell);
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry), new THREE.LineBasicMaterial({ color: 0x70b7bd, transparent: true, opacity: .56 }));
outline.position.copy(shell.position); shellParts.add(outline);
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x23343b, metalness: .8, roughness: .32 });
const band = new THREE.Mesh(new THREE.CylinderGeometry(.69, .69, .48, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x243943, side: THREE.DoubleSide, transparent: true, opacity: .36, depthWrite: false }));
band.rotation.z = Math.PI / 2; band.position.set(.10, lensCenter.y, 0); cameraRig.add(band);
for (const x of [-.11, .33]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.69, .028, 8, 64), darkMetal);
  ring.rotation.y = Math.PI / 2; ring.position.set(x, lensCenter.y, 0); cameraRig.add(ring);
}
const optic = new THREE.Mesh(new THREE.SphereGeometry(.59, 40, 24), new THREE.MeshPhysicalMaterial({ color: 0x8ff8ef, emissive: 0x1f7276, emissiveIntensity: .22, transparent: true, opacity: .42, metalness: .03, roughness: .08, depthWrite: false, side: THREE.DoubleSide }));
optic.scale.x = .21; optic.position.set(0, lensCenter.y, 0); cameraRig.add(optic);
const prism = new THREE.Mesh(new THREE.BoxGeometry(.7, .23, .68), darkMetal);
prism.position.set(-1.03, lensCenter.y + .93, 0); cameraRig.add(prism);
const grip = new THREE.Mesh(new THREE.BoxGeometry(.82, 1.15, .32), darkMetal);
grip.position.set(-1.18, lensCenter.y - .16, -1.17); cameraRig.add(grip);
const shutter = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .04, 20), new THREE.MeshStandardMaterial({ color: 0x92aaac, metalness: .7, roughness: .3 }));
shutter.position.set(-1.23, lensCenter.y + .93, -.28); cameraRig.add(shutter);
const tripod = new THREE.Group(); cameraRig.add(tripod);
const tripodMat = new THREE.MeshStandardMaterial({ color: 0x38464b, metalness: .8, roughness: .35 });
const pole = new THREE.Mesh(new THREE.CylinderGeometry(.055, .075, .6, 12), tripodMat);
pole.position.set(-1.2, .95, 0); tripod.add(pole);
const tripodHead = new THREE.Mesh(new THREE.CylinderGeometry(.2, .19, .12, 16), tripodMat);
tripodHead.position.set(-1.2, 1.3, 0); tripod.add(tripodHead);
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2;
  const start = new THREE.Vector3(-1.2, .78, 0);
  const end = new THREE.Vector3(-1.2 + Math.cos(a) * .88, -.12, Math.sin(a) * .88);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(.022, .033, start.distanceTo(end), 8), tripodMat);
  leg.position.copy(start).add(end).multiplyScalar(.5);
  leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  tripod.add(leg);
}

const sensorTarget = new THREE.WebGLRenderTarget(preview.width, preview.height, { depthBuffer: true, stencilBuffer: false });
sensorTarget.texture.colorSpace = THREE.SRGBColorSpace;
const sensorTexture = new THREE.CanvasTexture(preview);
sensorTexture.colorSpace = THREE.SRGBColorSpace;
sensorTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
const sensorAssembly = new THREE.Group();
cameraRig.add(sensorAssembly);
const sensorPlate = new THREE.Mesh(new THREE.BoxGeometry(.07, SENSOR_H + .14, SENSOR_W + .14), new THREE.MeshStandardMaterial({ color: 0x1b3138, metalness: .64, roughness: .32 }));
sensorAssembly.add(sensorPlate);
// Plane normal points towards -X, so a person behind the camera sees the image immediately.
const sensorScreen = new THREE.Mesh(new THREE.PlaneGeometry(SENSOR_W, SENSOR_H), new THREE.MeshBasicMaterial({ map: sensorTexture, side: THREE.DoubleSide, toneMapped: false }));
sensorScreen.rotation.y = -Math.PI / 2;
sensorScreen.position.x = -.039;
sensorScreen.renderOrder = 20;
sensorAssembly.add(sensorScreen);
const sensorBorder = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.08, SENSOR_H + .15, SENSOR_W + .15)), new THREE.LineBasicMaterial({ color: 0x7adfd5 }));
sensorAssembly.add(sensorBorder);

const pointMarkers = new THREE.Group();
scene.add(pointMarkers);
const rayGroup = new THREE.Group();
scene.add(rayGroup);
const spotGroup = new THREE.Group();
scene.add(spotGroup);
for (const point of points) {
  const mat = new THREE.MeshBasicMaterial({ color: point.color });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.092, 12, 12), mat);
  dot.position.set(point.p.x, point.p.y, point.p.z); pointMarkers.add(dot);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(.18, 16, 12), new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: .20, depthWrite: false }));
  halo.position.copy(dot.position); pointMarkers.add(halo);
}
const axisGroup = new THREE.Group(); scene.add(axisGroup);
const opticalAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.65, lensCenter.y, 0), new THREE.Vector3(13, lensCenter.y, 0)]), new THREE.LineDashedMaterial({ color: 0xff6a67, transparent: true, opacity: .65, dashSize: .18, gapSize: .14 }));
opticalAxis.computeLineDistances(); axisGroup.add(opticalAxis);
const colouredAxes = new THREE.AxesHelper(1.55);
colouredAxes.position.set(0, lensCenter.y, 0); axisGroup.add(colouredAxes);
const sensorCamera = new THREE.PerspectiveCamera(40, preview.width / preview.height, .2, 70);
sensorCamera.position.set(0, lensCenter.y, 0);
sensorCamera.up.set(0, 1, 0);
sensorCamera.lookAt(1, lensCenter.y, 0);

function disposeChildren(group) {
  while (group.children.length) {
    const child = group.children[0]; group.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material?.map) child.material.map.dispose();
    if (child.material) child.material.dispose();
  }
}
function updateOptics() {
  const focal = state.focalMM / 45; // 45 mm corresponds to one 3D scene unit.
  const u = OBJECT_X - lensCenter.x;
  const v = imageDistance(focal, u);
  sensorAssembly.position.set(-v, 2.04, 0);
  sensorCamera.position.set(lensCenter.x, lensCenter.y, lensCenter.z);
  sensorCamera.lookAt(lensCenter.x + 1, lensCenter.y, lensCenter.z);
  sensorCamera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(SENSOR_H / (2 * v)));
  sensorCamera.updateProjectionMatrix();
  disposeChildren(rayGroup);
  disposeChildren(spotGroup);
  for (const [index, point] of points.entries()) {
    const destination = imagePoint(point.p, lensCenter, focal);
    for (const [y, z] of APERTURE) {
      const ray = rayThroughAperture(point.p, lensCenter, focal, y, z);
      const input = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ray.from.x, ray.from.y, ray.from.z), new THREE.Vector3(ray.through.x, ray.through.y, ray.through.z)]), new THREE.LineBasicMaterial({ color: point.line, transparent: true, opacity: index ? .33 : .38, depthWrite: false }));
      const output = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ray.through.x, ray.through.y, ray.through.z), new THREE.Vector3(ray.to.x, ray.to.y, ray.to.z)]), new THREE.LineBasicMaterial({ color: point.line, transparent: true, opacity: .9, depthWrite: false }));
      rayGroup.add(input, output);
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.062, 12, 10), new THREE.MeshBasicMaterial({ color: point.color, depthTest: false }));
    dot.position.set(destination.x - .07, destination.y, destination.z);
    dot.renderOrder = 21;
    spotGroup.add(dot);
  }
  rayGroup.visible = state.rays;
  spotGroup.visible = state.rays;
  const f = $('focalRange');
  f.style.background = `linear-gradient(to right, var(--cyan) ${(state.focalMM - 35) / 50 * 100}%, #2a4650 ${(state.focalMM - 35) / 50 * 100}%)`;
  $('focalValue').textContent = `${state.focalMM} mm`;
  const locale = state.language === 'pt' ? 'pt-PT' : 'en-GB';
  $('objectDistance').textContent = `${u.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} u`;
  $('imageDistance').textContent = `${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} u`;
  $('magnification').textContent = `−${(v / u).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
  state.sensorDirty = true;
}

// The live sensor and finished photograph share the same movable lens view.
// Only the small live preview is inverted; a new large render is taken for a photo.
function renderFrame(target) {
  const objects = [cameraRig, rayGroup, spotGroup, axisGroup, pointMarkers];
  const visibility = objects.map(object => object.visible);
  objects.forEach(object => { object.visible = false; });
  const pixels = new Uint8Array(target.width * target.height * 4);
  try {
    sensorCamera.aspect = target.width / target.height;
    sensorCamera.updateProjectionMatrix();
    renderer.setRenderTarget(target);
    renderer.render(scene, sensorCamera);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
  } finally {
    renderer.setRenderTarget(null);
    objects.forEach((object, i) => { object.visible = visibility[i]; });
  }
  return pixels;
}

function updateSensor() {
  const pixels = renderFrame(sensorTarget);
  const image = previewContext.createImageData(preview.width, preview.height);
  image.data.set(orientPixels(pixels, preview.width, preview.height, true));
  previewContext.putImageData(image, 0, 0);
  sensorTexture.needsUpdate = true;
  state.sensorDirty = false;
}

function t(key) { return translations[state.language][key] || key; }
function announce(key) { $('announce').textContent = t(key); }
function setView(name, immediate = false) {
  if (!views[name]) return;
  state.view = name;
  document.querySelectorAll('.view-button').forEach(button => {
    const selected = button.dataset.view === name;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('viewName').textContent = t('view' + name[0].toUpperCase() + name.slice(1) + 'Label');
  const view = views[name];
  if (immediate) {
    camera.position.set(...view.position); controls.target.set(...view.target); controls.update();
    desiredView = null;
  } else {
    desiredView = { position: new THREE.Vector3(...view.position), target: new THREE.Vector3(...view.target) };
  }
}

function updateCameraPose() {
  lensCenter.x = pose.x;
  lensCenter.y = 2.04 + pose.y;
  lensCenter.z = pose.z;
  cameraRig.position.set(pose.x, pose.y, pose.z);
  axisGroup.position.copy(cameraRig.position);
  $('cameraPosition').textContent = 'X ' + pose.x.toFixed(1) + ' · Y ' + pose.y.toFixed(1) + ' · Z ' + pose.z.toFixed(1);
  updateOptics();
}
const clamp = THREE.MathUtils.clamp;
function moveCamera(direction) {
  const step = .3;
  if (direction === 'center') { pose.x = pose.y = pose.z = 0; }
  else if (direction === 'up') pose.y = clamp(pose.y + step, -1.1, 1.4);
  else if (direction === 'down') pose.y = clamp(pose.y - step, -1.1, 1.4);
  else if (direction === 'left') pose.z = clamp(pose.z - step, -2, 2);
  else if (direction === 'right') pose.z = clamp(pose.z + step, -2, 2);
  else if (direction === 'forward') pose.x = clamp(pose.x + step, -1.4, 1.8);
  else if (direction === 'back') pose.x = clamp(pose.x - step, -1.4, 1.8);
  updateCameraPose();
}

function applyLanguage() {
  const language = state.language;
  document.documentElement.lang = language === 'pt' ? 'pt-PT' : 'en';
  document.title = language === 'pt' ? 'ImageProcessing · Laboratório de Ótica 3D' : 'ImageProcessing · 3D Optics Lab';
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const value = t(element.dataset.i18n);
    if (element.dataset.i18n === 'orbitHint') element.innerHTML = value;
    else element.textContent = value;
  });
  $('languageButton').textContent = language === 'en' ? 'PT' : 'EN';
  $('languageButton').setAttribute('aria-label', t('switchLanguage'));
  const collapsed = $('sidebar').classList.contains('collapsed');
  $('collapseButton').setAttribute('aria-label', t(collapsed ? 'expandControls' : 'minimizeControls'));
  document.querySelectorAll('.close-button').forEach(button => button.setAttribute('aria-label', t('closeModal')));
  $('viewName').textContent = t('view' + state.view[0].toUpperCase() + state.view.slice(1) + 'Label');
  updateOptics();
  if (state.photo) renderMetadata();
}

function photoResolution() {
  const gpuLimit = Math.min(renderer.capabilities.maxTextureSize, renderer.getContext().getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE));
  const memory = navigator.deviceMemory || 8;
  const sizes = window.innerWidth < 700 || memory <= 3 ? [1920, 1280] : memory <= 4 ? [2560, 1920] : [3840, 2560, 1920];
  const width = sizes.find(size => size <= gpuLimit) || 1280;
  return [width, Math.round(width * 9 / 16)];
}

function paintPhotoInformation(ctx, photo, mode) {
  const width = photo.width, height = photo.height;
  const band = Math.max(100, Math.round(height * .115));
  const gradient = ctx.createLinearGradient(0, height - band, 0, height);
  gradient.addColorStop(0, '#13232bdd'); gradient.addColorStop(1, '#07131aff');
  ctx.fillStyle = gradient; ctx.fillRect(0, height - band, width, band);
  const left = Math.round(width * .025);
  const titleSize = Math.round(width * .012);
  const small = Math.round(width * .0071);
  const top = height - band + Math.round(band * .1);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e7f5f1'; ctx.font = 'bold ' + titleSize + 'px system-ui,sans-serif';
  ctx.fillText(t('photoOverlayTitle'), left, top);
  ctx.font = small + 'px system-ui,sans-serif';
  ctx.fillText(width + ' × ' + height + ' px · ' + mode + ' · PNG', left, top + titleSize * 1.3);
  ctx.fillText('f ' + photo.focalMM + ' mm · u ' + photo.u.toFixed(2) + ' u · v ' + photo.v.toFixed(2) +
    ' u · m −' + (photo.v / photo.u).toFixed(3) + '× · X ' + photo.pose.x.toFixed(1) +
    ' · Y ' + photo.pose.y.toFixed(1) + ' · Z ' + photo.pose.z.toFixed(1), left, top + titleSize * 1.3 + small * 1.35);
}

function addRows(id, rows) {
  const list = $(id);
  list.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    list.append(dt, dd);
  }
}
function renderMetadata() {
  const photo = state.photo;
  if (!photo) return;
  const mode = state.photoMode;
  const blob = photo.blobs[mode];
  const size = blob ? '~' + Math.round(blob.size / 1024).toLocaleString(state.language === 'pt' ? 'pt-PT' : 'en-GB') + ' KB' : '…';
  const fmt = mode === 'RGB' ? 'PNG · RGB' : state.language === 'pt' ? 'PNG · cinzento (canais RGB)' : 'PNG · grayscale (RGB channels)';
  const number = (n, decimals) => n.toLocaleString(state.language === 'pt' ? 'pt-PT' : 'en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  addRows('fileMetadata', [
    [t('resolution'), photo.width + ' × ' + photo.height + ' px'],
    [t('format'), fmt], [t('approximateSize'), size],
    [t('sensorRatio'), number(SENSOR_W, 2) + ' × ' + number(SENSOR_H, 2) + ' u · 16:9']
  ]);
  addRows('opticalMetadata', [
    [t('lensType'), t('convergingReal')],
    [t('focalLength') + ' (f)', photo.focalMM + ' mm'],
    [t('objectDistanceLabel'), number(photo.u, 2) + ' u'],
    [t('imageDistanceLabel'), number(photo.v, 2) + ' u'],
    [t('magnificationLabel'), '−' + number(photo.v / photo.u, 3) + '×'],
    [t('cameraPositionLabel'), 'X ' + number(photo.pose.x, 1) + ' · Y ' + number(photo.pose.y, 1) + ' · Z ' + number(photo.pose.z, 1)],
    [t('verticalFov'), number(photo.fov, 1) + '°'],
    [t('exposure'), number(photo.exposure, 2)],
    [t('lightIntensity'), number(photo.light, 2)],
    [t('imageMode'), mode]
  ]);
}
function renderPhotoMode(mode) {
  const photo = state.photo;
  if (!photo) return;
  state.photoMode = mode;
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const canvas = $('capturePreview');
  canvas.width = photo.width; canvas.height = photo.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = orientPixels(photo.readback, photo.width, photo.height, false, mode !== 'RGB');
  ctx.putImageData(new ImageData(pixels, photo.width, photo.height), 0, 0);
  paintPhotoInformation(ctx, photo, mode);
  renderMetadata();
  if (!photo.blobs[mode]) {
    canvas.toBlob(blob => {
      if (!blob || state.photo !== photo) return;
      photo.blobs[mode] = blob;
      if (state.photoMode === mode) renderMetadata();
    }, 'image/png');
  }
}

function takePhotograph() {
  const button = $('captureButton');
  button.disabled = true; button.querySelector('span').textContent = t('processing');
  // Paint the processing state before reading a high-resolution framebuffer.
  requestAnimationFrame(() => setTimeout(() => {
    let target;
    try {
      const [width, height] = photoResolution();
      target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: false });
      const readback = renderFrame(target);
      const u = OBJECT_X - lensCenter.x;
      const f = state.focalMM / 45;
      state.photo = {
        width, height, readback, blobs: {}, focalMM: state.focalMM,
        u, v: imageDistance(f, u), fov: sensorCamera.fov,
        pose: { ...pose }, exposure: state.exposure, light: state.light
      };
      renderPhotoMode('RGB');
      $('captureDialog').showModal();
      announce('photoReady');
    } catch (error) {
      console.error('Photograph capture:', error);
      announce('captureFailed');
      window.alert(t('captureFailed'));
    } finally {
      target?.dispose();
      button.disabled = false;
      button.querySelector('span').textContent = t('captureButton');
    }
  }, 20));
}

document.querySelectorAll('.view-button').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => moveCamera(button.dataset.move)));
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('button,input,dialog') || document.querySelector('dialog[open]')) return;
  const commands = { w:'up', s:'down', a:'left', d:'right', q:'forward', e:'back', ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' };
  const command = commands[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (command) { event.preventDefault(); moveCamera(command); }
});
$('focalRange').addEventListener('input', event => { state.focalMM = Number(event.target.value); updateOptics(); });
$('exposureRange').addEventListener('input', event => {
  state.exposure = Number(event.target.value); renderer.toneMappingExposure = state.exposure;
  $('exposureValue').textContent = state.exposure.toFixed(2); state.sensorDirty = true;
});
$('lightRange').addEventListener('input', event => {
  state.light = Number(event.target.value); sunlight.intensity = state.light;
  $('lightValue').textContent = state.light.toFixed(2); state.sensorDirty = true;
});
$('raysToggle').addEventListener('change', event => { state.rays = event.target.checked; rayGroup.visible = spotGroup.visible = state.rays; });
$('axisToggle').addEventListener('change', event => { state.axis = event.target.checked; axisGroup.visible = state.axis; });
$('shellToggle').addEventListener('change', event => { state.shell = event.target.checked; shellParts.visible = state.shell; });
$('languageButton').addEventListener('click', () => { state.language = state.language === 'en' ? 'pt' : 'en'; applyLanguage(); });
$('collapseButton').addEventListener('click', () => {
  const collapsed = $('sidebar').classList.toggle('collapsed');
  $('workspace').classList.toggle('controls-collapsed', collapsed);
  $('collapseButton').textContent = collapsed ? '+' : '−';
  $('collapseButton').setAttribute('aria-expanded', String(!collapsed));
  $('collapseButton').setAttribute('aria-label', t(collapsed ? 'expandControls' : 'minimizeControls'));
});
$('resetButton').addEventListener('click', () => {
  state.focalMM = 50; state.rays = state.axis = state.shell = true;
  state.exposure = 1.3; state.light = 2.35;
  $('focalRange').value = '50'; $('exposureRange').value = '1.3'; $('lightRange').value = '2.35';
  $('exposureValue').textContent = '1.30'; $('lightValue').textContent = '2.35';
  $('raysToggle').checked = $('axisToggle').checked = $('shellToggle').checked = true;
  axisGroup.visible = shellParts.visible = true;
  renderer.toneMappingExposure = state.exposure; sunlight.intensity = state.light;
  pose.x = pose.y = pose.z = 0; updateCameraPose(); setView('overview');
  announce('resetDone');
});
$('infoButton').addEventListener('click', () => $('infoDialog').showModal());
$('captureButton').addEventListener('click', takePhotograph);
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => renderPhotoMode(button.dataset.mode)));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
$('downloadPhoto').addEventListener('click', () => {
  const photo = state.photo, mode = state.photoMode;
  if (!photo) return;
  const blob = photo.blobs[mode];
  const link = document.createElement('a');
  link.href = blob ? URL.createObjectURL(blob) : $('capturePreview').toDataURL('image/png');
  link.download = 'ImageProcessing_' + photo.focalMM + 'mm_' + mode.toLowerCase() + '_' + photo.width + 'x' + photo.height + '.png';
  document.body.appendChild(link); link.click(); link.remove();
  if (blob) setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  announce('photoDownloaded');
});

const resizer = new ResizeObserver(() => {
  const width = stage.clientWidth, height = stage.clientHeight;
  if (width && height) {
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
});
resizer.observe(stage);
applyLanguage();
function animate() {
  requestAnimationFrame(animate);
  if (desiredView) {
    camera.position.lerp(desiredView.position, .095);
    controls.target.lerp(desiredView.target, .095);
    if (camera.position.distanceTo(desiredView.position) < .012 && controls.target.distanceTo(desiredView.target) < .012) desiredView = null;
  }
  controls.update();
  if (state.sensorDirty) updateSensor();
  renderer.render(scene, camera);
}
animate();
