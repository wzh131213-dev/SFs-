import * as THREE from "three";
import { PartDatabase } from "./core/parts/PartDatabase.js";
import { GridSnap } from "./core/parts/GridSnap.js";
import catalog from "./core/parts/part-catalog.json";

const stage = document.querySelector("#stage");
const status = document.querySelector("#status");
if (!stage || !status) throw new Error("Required application DOM elements are missing.");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#080e18");
const camera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 100);
camera.position.set(0, 0, 30);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stage.clientWidth || 640, stage.clientHeight || 480);
stage.appendChild(renderer.domElement);

const grid = new THREE.GridHelper(24, 24, 0x36516f, 0x1b2c43);
grid.rotation.x = Math.PI / 2;
scene.add(grid);
scene.add(new THREE.AmbientLight(0xffffff, 1.5));

const database = new PartDatabase();
database.registerMany(catalog.parts);
const snap = new GridSnap({
  cellSize: 0.5,
  bounds: { minX: -10, maxX: 10, minY: -12, maxY: 12 }
});

const tank = database.get("fuel-tank-01");
const engine = database.get("engine-01");
const placedTank = snap.snapPart(tank, { x: 0.12, y: 1.13 });
const placedEngine = snap.snapPart(engine, { x: 0.12, y: -2.12 });

const makePartMesh = (part, placement) => {
  const geometry = new THREE.BoxGeometry(placement.size.width, placement.size.height, 0.35);
  const material = new THREE.MeshStandardMaterial({
    color: part.color, roughness: 0.72, metalness: 0.15
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(placement.position.x, placement.position.y, 0);
  mesh.rotation.z = placement.rotation;
  scene.add(mesh);
  return mesh;
};
makePartMesh(tank, placedTank);
makePartMesh(engine, placedEngine);

const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(2.5, 0.12, 0.4)),
  new THREE.LineBasicMaterial({ color: 0xffad55 })
);
outline.position.set(0, -3.15, 0);
scene.add(outline);

const resize = () => {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  const aspect = width / height;
  const viewHeight = 16;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
};
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(stage);
resize();

let frameId = 0;
const render = () => {
  frameId = requestAnimationFrame(render);
  renderer.render(scene, camera);
};
render();

status.textContent = `Module 1 ready · ${database.size} parts · grid ${snap.cellSize} m · Three.js ${THREE.REVISION}`;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    scene.traverse(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose?.();
    });
    renderer.dispose();
    renderer.domElement.remove();
  });
}