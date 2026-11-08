import * as THREE from "three";
import { PartDatabase } from "./core/parts/PartDatabase.js";
import { GridSnap } from "./core/parts/GridSnap.js";
import { RocketAssembly } from "./core/vab/RocketAssembly.js";
import { Blueprint } from "./core/vab/Blueprint.js";
import catalog from "./core/parts/part-catalog.json";

const $ = selector => document.querySelector(selector);
const stage = $("#stage");
const status = $("#status");
const palette = $("#parts");
if (!stage || !status || !palette) throw new Error("VAB application elements are missing.");

const database = new PartDatabase();
database.registerMany(catalog.parts);
const grid = new GridSnap({ cellSize: 0.5,
  bounds: { minX: -9, maxX: 9, minY: -11, maxY: 11 } });
let assembly = new RocketAssembly({ database, grid });
let selectedPartId = "fuel-tank-01";
let selectedInstanceId = null;
let palettePointerDown = false;
let blankStagePointerDown = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#080e18");
const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 100);
camera.position.set(0, 0, 30);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stage.clientWidth || 640, stage.clientHeight || 480);
renderer.domElement.setAttribute("aria-label", "火箭建造三维画布");
stage.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 1.65));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(-4, 8, 12);
scene.add(keyLight);
const gridHelper = new THREE.GridHelper(36, 72, 0x36516f, 0x1b2c43);
gridHelper.rotation.x = Math.PI / 2;
gridHelper.position.z = -0.3;
scene.add(gridHelper);
const partsGroup = new THREE.Group();
scene.add(partsGroup);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const meshById = new Map();
let selectedOutline = null;

const formatMass = value => `${value.toFixed(2)} kg`;
const setStatus = (message, error = false) => {
  status.textContent = message;
  status.style.color = error ? "#ff9a9a" : "#91cfff";
};

function renderPalette() {
  palette.replaceChildren();
  for (const part of database.getAll()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `part-card${selectedPartId === part.id ? " selected" : ""}`;
    button.dataset.partId = part.id;
    button.innerHTML = `<span class="swatch" style="background:${part.color}"></span><span>${part.name}<small>${part.size.width} × ${part.size.height} m · ${part.mass} kg</small></span>`;
    button.addEventListener("click", () => selectPart(part.id));
    button.addEventListener("pointerdown", event => {
      if (event.pointerType !== "mouse" || event.button === 0) {
        selectPart(part.id);
        palettePointerDown = true;
      }
    });
    palette.append(button);
  }
}

function selectPart(partId) {
  selectedPartId = partId;
  selectedInstanceId = null;
  renderPalette();
  updateInspector();
}

function selectPlacedPart(instanceId) {
  selectedInstanceId = instanceId;
  const item = assembly.getPart(instanceId);
  if (item) selectedPartId = item.partId;
  renderPalette();
  rebuildScene();
  updateInspector();
}

function worldFromPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  const point = new THREE.Vector3(pointer.x, pointer.y, 0).unproject(camera);
  return { x: point.x, y: point.y };
}

function placeSelected(position) {
  if (!selectedPartId) return;
  try {
    const item = assembly.addPart(selectedPartId, position);
    selectedInstanceId = item.instanceId;
    rebuildScene();
    updateInspector();
    setStatus(`已放置：${database.get(item.partId).name} · 网格吸附 0.5 m`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function disposeObject(object) {
  object.geometry?.dispose?.();
  if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
  else object.material?.dispose?.();
}

function rebuildScene() {
  while (partsGroup.children.length) {
    const child = partsGroup.children.pop();
    disposeObject(child);
  }
  meshById.clear();
  selectedOutline = null;
  for (const item of assembly.parts) {
    const part = database.get(item.partId);
    const size = grid.getRotatedSize(part, item.rotation);
    const geometry = new THREE.BoxGeometry(size.width, size.height, 0.42);
    const material = new THREE.MeshStandardMaterial({
      color: part.color, roughness: 0.68, metalness: 0.18
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(item.position.x, item.position.y, 0);
    mesh.rotation.z = item.rotation;
    mesh.userData.instanceId = item.instanceId;
    partsGroup.add(mesh);
    meshById.set(item.instanceId, mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: item.instanceId === selectedInstanceId ? 0xffad55 : 0x263c55 }));
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    partsGroup.add(edges);
    if (item.instanceId === selectedInstanceId) {
      selectedOutline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xffad55, linewidth: 2 }));
      selectedOutline.position.copy(mesh.position);
      selectedOutline.rotation.copy(mesh.rotation);
      selectedOutline.scale.set(1.06, 1.06, 1.06);
      partsGroup.add(selectedOutline);
    }
  }
}

function updateInspector() {
  const mass = assembly.getMassProperties();
  $("#total-mass").textContent = formatMass(mass.totalMass);
  $("#dry-mass").textContent = formatMass(mass.dryMass);
  $("#fuel-mass").textContent = formatMass(mass.propellantMass);
  $("#com").textContent = `(${mass.centerOfMass.x.toFixed(2)}, ${mass.centerOfMass.y.toFixed(2)})`;
  $("#part-count").textContent = String(assembly.parts.length);
  const selected = selectedInstanceId ? assembly.getPart(selectedInstanceId) : null;
  $("#selection").textContent = selected
    ? `${database.get(selected.partId).name}\n位置: ${selected.position.x.toFixed(1)}, ${selected.position.y.toFixed(1)} m\n旋转: ${Math.round(selected.rotation * 180 / Math.PI)}°`
    : selectedPartId ? `待放置：${database.get(selectedPartId).name}` : "尚未选择零件";
  const validation = assembly.validate();
  $("#validation").textContent = validation.valid
    ? "✓ 结构连通，指令舱已安装" : validation.errors.join("\n");
  $("#validation").style.color = validation.valid ? "#83d6a4" : "#ffbd75";
}

function resize() {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  const viewHeight = 24;
  const aspect = width / height;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  renderer.render(scene, camera);
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(stage);

renderer.domElement.addEventListener("pointerdown", event => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...meshById.values()], false);
  if (hits.length) {
    blankStagePointerDown = false;
    selectPlacedPart(hits[0].object.userData.instanceId);
  } else {
    blankStagePointerDown = true;
  }
});
window.addEventListener("pointerup", event => {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const droppedOnStage = target && (target === stage || stage.contains(target));
  if (palettePointerDown && droppedOnStage) placeSelected(worldFromPointer(event));
  else if (!palettePointerDown && blankStagePointerDown && droppedOnStage && selectedPartId) {
    placeSelected(worldFromPointer(event));
  }
  palettePointerDown = false;
  blankStagePointerDown = false;
});

$("#rotate").addEventListener("click", () => {
  if (!selectedInstanceId) return setStatus("请先点击画布中的一个零件。", true);
  if (!assembly.rotatePart(selectedInstanceId, 1)) return setStatus("该位置旋转后会越界或与其他零件重叠。", true);
  rebuildScene(); updateInspector(); setStatus("零件已旋转 90°。");
});
$("#delete").addEventListener("click", () => {
  if (!selectedInstanceId || !assembly.removePart(selectedInstanceId)) return setStatus("请先选择要删除的零件。", true);
  selectedInstanceId = null; rebuildScene(); updateInspector(); setStatus("零件已删除。");
});
$("#clear").addEventListener("click", () => {
  assembly = new RocketAssembly({ database, grid });
  selectedInstanceId = null; rebuildScene(); updateInspector(); setStatus("建造区已清空。");
});
$("#save").addEventListener("click", () => {
  try {
    const json = Blueprint.stringify(assembly.exportBlueprint());
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "sfs-rocket-blueprint.json"; link.click();
    URL.revokeObjectURL(url);
    setStatus("蓝图 JSON 已导出。");
  } catch (error) { setStatus(error.message, true); }
});
const fileInput = $("#file-input");
$("#load").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const blueprint = Blueprint.parse(await file.text());
    const restored = RocketAssembly.fromBlueprint({ database, blueprint, grid });
    assembly = restored; selectedInstanceId = null; rebuildScene(); updateInspector();
    setStatus(`蓝图加载成功：${assembly.parts.length} 个零件。`);
  } catch (error) { setStatus(`蓝图加载失败：${error.message}`, true); }
  finally { fileInput.value = ""; }
});

function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

renderPalette();
// A small connected starter stack makes the attachment workflow immediately visible.
try {
  assembly.addPart("command-pod-01", { x: 0, y: 6 });
  assembly.addPart("fuel-tank-01", { x: 0, y: 3 });
  assembly.addPart("engine-01", { x: 0, y: 0 });
} catch (error) { setStatus(error.message, true); }
rebuildScene();
updateInspector();
resize();
animate();
setStatus(`VAB 已就绪 · ${database.size} 种零件 · 0.5 m 网格 · Three.js ${THREE.REVISION}`);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resizeObserver.disconnect();
    scene.traverse(disposeObject);
    renderer.dispose();
    renderer.domElement.remove();
  });
}
