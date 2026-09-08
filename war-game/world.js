// ============================================================================
// world.js — builds the house level: rooms, walls with door/window gaps,
// furniture, materials, lighting, plus the data other systems need:
// collision boxes, line-of-sight occluders, cover points, floor surface
// zones (for footstep sfx), and spawn points.
// ============================================================================
import * as THREE from 'three';
import { woodTexture, tileTexture, carpetTexture, plasterTexture, AABB } from './utils.js';

const WALL_H = 2.8;
const WALL_T = 0.2;

export function buildHouse(scene, quality){
  const collisionBoxes = [];
  const occluders = [];
  const coverPoints = [];
  const floorZones = []; // { box: AABB, surface: 'wood'|'tile'|'carpet'|'concrete' }
  const group = new THREE.Group();
  group.name = 'house';

  const matWallLiving = new THREE.MeshStandardMaterial({ map: plasterTexture('#cbb8a1'), roughness: 0.92 });
  const matWallKitchen = new THREE.MeshStandardMaterial({ map: plasterTexture('#b9c4c2'), roughness: 0.9 });
  const matWallHall = new THREE.MeshStandardMaterial({ map: plasterTexture('#9b9488'), roughness: 0.95 });
  const matWallBed = new THREE.MeshStandardMaterial({ map: plasterTexture('#a998ab'), roughness: 0.92 });
  const matWallStudy = new THREE.MeshStandardMaterial({ map: plasterTexture('#8f9a86'), roughness: 0.92 });
  const matWallExterior = new THREE.MeshStandardMaterial({ map: plasterTexture('#5c5850'), roughness: 1.0 });
  const matCeiling = new THREE.MeshStandardMaterial({ color: 0xe9e5da, roughness: 1.0 });
  const matWood = new THREE.MeshStandardMaterial({ map: woodTexture('#7a5230', '#5c3c22'), roughness: 0.75 });
  const matTile = new THREE.MeshStandardMaterial({ map: tileTexture('#c9c9c9', '#9a9a9a'), roughness: 0.5, metalness: 0.05 });
  const matCarpet = new THREE.MeshStandardMaterial({ map: carpetTexture('#5a2f3a'), roughness: 1.0 });
  const matConcrete = new THREE.MeshStandardMaterial({ map: tileTexture('#7d7d78', '#666661'), roughness: 0.95 });
  const matGlass = new THREE.MeshPhysicalMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, transmission: 0.6 });
  const matWoodDark = new THREE.MeshStandardMaterial({ map: woodTexture('#4a3421', '#2f1f12'), roughness: 0.6 });
  const matFabricSofa = new THREE.MeshStandardMaterial({ color: 0x3d4a5c, roughness: 1.0 });
  const matFabricBed = new THREE.MeshStandardMaterial({ color: 0x8a3b46, roughness: 1.0 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x888c92, roughness: 0.35, metalness: 0.75 });
  const matCeramic = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.3 });
  const matLampShade = new THREE.MeshStandardMaterial({ color: 0xf4e2b8, emissive: 0xffdca0, emissiveIntensity: 0.4, roughness: 0.6 });

  function addBox(w, h, d, mat, x, y, z, ry = 0, castShadow = true, receiveShadow = true){
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = castShadow && quality.shadows;
    mesh.receiveShadow = receiveShadow && quality.shadows;
    group.add(mesh);
    return mesh;
  }

  function addFloor(x1, z1, x2, z2, mat, surface){
    const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const mesh = addBox(w, 0.1, d, mat, cx, -0.05, cz, 0, false, true);
    floorZones.push({ box: new AABB(Math.min(x1,x2), Math.min(z1,z2), Math.max(x1,x2), Math.max(z1,z2)), surface });
    return mesh;
  }

  function addCeilingPatch(x1, z1, x2, z2){
    const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    addBox(w, 0.1, d, matCeiling, cx, WALL_H + 0.05, cz, 0, false, true);
  }

  // Wall with rectangular gaps (doors/windows) running along X (fixed Z) or Z (fixed X).
  function buildWallWithGaps(orientation, fixed, start, end, gaps, mat, opts = {}){
    const height = opts.height || WALL_H;
    const baseY = opts.baseY || 0;
    const thickness = opts.thickness || WALL_T;
    const sorted = gaps.slice().sort((a, b) => a.from - b.from);
    let cursor = Math.min(start, end);
    const segMax = Math.max(start, end);
    const segs = [];
    for (const g of sorted){
      if (g.from > cursor) segs.push([cursor, g.from]);
      cursor = Math.max(cursor, g.to);
    }
    if (cursor < segMax) segs.push([cursor, segMax]);

    for (const [a, b] of segs){
      const len = b - a;
      if (len <= 0.001) continue;
      const mid = (a + b) / 2;
      if (orientation === 'x'){
        addBox(len, height, thickness, mat, mid, baseY + height / 2, fixed);
      } else {
        addBox(thickness, height, len, mat, fixed, baseY + height / 2, mid);
      }
    }
    // Lintels above doorway gaps (skip window gaps which already have a header via full-height segment logic elsewhere).
    for (const g of sorted){
      if (g.type !== 'door') continue;
      const len = g.to - g.from;
      const mid = (g.from + g.to) / 2;
      const lintelH = height - (g.doorHeight || 2.1);
      if (lintelH <= 0.05) continue;
      if (orientation === 'x'){
        addBox(len, lintelH, thickness, mat, mid, height - lintelH / 2, fixed);
      } else {
        addBox(thickness, lintelH, len, mat, fixed, height - lintelH / 2, mid);
      }
    }
    // Register collision boxes for the solid segments only (doorway gaps are walkable).
    for (const [a, b] of segs){
      if (orientation === 'x'){
        collisionBoxes.push(new AABB(a - thickness/2, fixed - thickness/2, b + thickness/2, fixed + thickness/2));
      } else {
        collisionBoxes.push(new AABB(fixed - thickness/2, a - thickness/2, fixed + thickness/2, b + thickness/2));
      }
    }
  }

  // Track wall meshes as occluders too (everything added via addBox with castShadow already in `group`).
  // We treat the whole `group` children array as the occluder set at the end (walls + big furniture),
  // filtered by a `isOccluder` flag set per-mesh.
  const occluderFlagged = [];
  function markOccluder(mesh){ if (mesh) occluderFlagged.push(mesh); return mesh; }

  // ---------------- Floors ----------------
  addFloor(-7, -5, 0, 0.2, matWood, 'wood');       // living room
  addFloor(0, -5, 7, 0.2, matTile, 'tile');        // kitchen
  addFloor(-7, 0.2, 7, 1.4, matConcrete, 'concrete'); // hallway
  addFloor(-7, 1.4, 0, 5, matCarpet, 'carpet');    // bedroom
  addFloor(0, 1.4, 7, 5, matWood, 'wood');         // study

  addCeilingPatch(-7, -5, 7, 5);

  // ---------------- Exterior perimeter walls ----------------
  // South wall (front, z=-5) with front door + living room window.
  buildWallWithGaps('x', -5, -7, 7, [
    { from: -6.6, to: -5.3, type: 'door', doorHeight: 2.2 }, // front door
  ], matWallExterior);
  // North wall (z=5)
  buildWallWithGaps('x', 5, -7, 7, [], matWallExterior);
  // West wall (x=-7) with living-room + bedroom windows
  buildWallWithGaps('z', -7, -5, 5, [
    { from: -3.6, to: -2.0, type: 'window' },
    { from: 2.0, to: 3.6, type: 'window' },
  ], matWallExterior);
  // East wall (x=7) with kitchen + study windows
  buildWallWithGaps('z', 7, -5, 5, [
    { from: -3.6, to: -2.0, type: 'window' },
    { from: 2.0, to: 3.6, type: 'window' },
  ], matWallExterior);

  // Glass panes for the 4 windows
  const winY = WALL_H * 0.55;
  [[-7,-2.8],[-7,2.8]].forEach(([x,z]) => markOccluder(addBox(0.04, 1.3, 1.5, matGlass, x, winY, z, 0, false, false)));
  [[7,-2.8],[7,2.8]].forEach(([x,z]) => markOccluder(addBox(0.04, 1.3, 1.5, matGlass, x, winY, z, 0, false, false)));

  // ---------------- Interior walls ----------------
  // Living room / kitchen divider (x=0), with a wide open-plan doorway.
  buildWallWithGaps('z', 0, -5, 0.2, [
    { from: -3.2, to: -1.6, type: 'door', doorHeight: 2.4 },
  ], matWallLiving);

  // Hallway south wall (z=0.2): 2 doors into living room, 1 into kitchen.
  buildWallWithGaps('x', 0.2, -7, 7, [
    { from: -5.8, to: -4.7, type: 'door', doorHeight: 2.1 },
    { from: -2.3, to: -1.2, type: 'door', doorHeight: 2.1 },
    { from: 2.5, to: 3.6, type: 'door', doorHeight: 2.1 },
  ], matWallHall);

  // Hallway north wall (z=1.4): 1 door into bedroom, 1 into study.
  buildWallWithGaps('x', 1.4, -7, 7, [
    { from: -4.5, to: -3.4, type: 'door', doorHeight: 2.1 },
    { from: 2.0, to: 3.1, type: 'door', doorHeight: 2.1 },
  ], matWallHall);

  // Bedroom / study divider (x=0) — solid, no direct door (must go via hallway).
  buildWallWithGaps('z', 0, 1.4, 5, [], matWallBed);

  // ---------------- Interior wall decor (paintings) ----------------
  function addPicture(x, y, z, ry, w = 0.7, h = 0.5){
    const frame = addBox(w, h, 0.04, matWoodDark, x, y, z, ry, false, false);
    return frame;
  }
  addPicture(-3.4, 1.7, -4.95, 0);
  addPicture(4.5, 1.6, -4.95, 0);
  addPicture(-6.95, 1.7, 3.6, Math.PI/2);

  // ================= FURNITURE =================

  // ---- Living room: sofa, coffee table, TV stand, rug, floor lamp ----
  function makeSofa(x, z, ry){
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.y = ry;
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.42, 0.9), matFabricSofa);
    base.position.y = 0.21;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 0.22), matFabricSofa);
    back.position.set(0, 0.5, -0.34);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.9), matFabricSofa);
    armL.position.set(-1.1, 0.42, 0);
    const armR = armL.clone(); armR.position.x = 1.1;
    [base, back, armL, armR].forEach(m => { m.castShadow = quality.shadows; m.receiveShadow = quality.shadows; g.add(m); });
    group.add(g);
    markOccluder(base);
    const halfW = 1.15, halfD = 0.5;
    const c = Math.cos(ry), s = Math.sin(ry);
    const corners = [[-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]].map(([lx,lz]) => [x + lx*c - lz*s, z + lx*s + lz*c]);
    const xs = corners.map(p=>p[0]), zs = corners.map(p=>p[1]);
    const box = new AABB(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
    collisionBoxes.push(box);
    coverPoints.push({ x: x + Math.sin(ry) * 0.95, z: z - Math.cos(ry) * 0.95, facing: ry + Math.PI, tag: 'sofa' });
    return box;
  }
  makeSofa(-5.3, -1.3, 0);

  function makeCoffeeTable(x, z){
    const top = addBox(1.0, 0.06, 0.55, matWoodDark, x, 0.42, z);
    [[-0.42,-0.22],[0.42,-0.22],[-0.42,0.22],[0.42,0.22]].forEach(([dx,dz]) => {
      addBox(0.06, 0.4, 0.06, matWoodDark, x+dx, 0.2, z+dz, 0, false, false);
    });
    markOccluder(top);
    collisionBoxes.push(AABB.fromCenter(x, z, 0.55, 0.32));
  }
  makeCoffeeTable(-5.3, -0.1);

  function makeTVStand(x, z, ry){
    const stand = addBox(1.6, 0.5, 0.4, matWoodDark, x, 0.25, z, ry);
    const tv = addBox(1.3, 0.75, 0.06, new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.3, metalness: 0.4 }), x, 0.9, z + (ry === 0 ? -0.18 : 0), ry, false, false);
    markOccluder(stand);
    collisionBoxes.push(AABB.fromCenter(x, z, 0.85, 0.3));
  }
  makeTVStand(-5.3, -3.9, 0);

  addBox(1.6, 0.02, 2.0, new THREE.MeshStandardMaterial({ color: 0x7a2d3a, roughness: 1 }), -5.3, 0.011, -1.4); // rug

  function makeFloorLamp(x, z){
    addBox(0.06, 1.5, 0.06, matMetal, x, 0.75, z, 0, false, false);
    const shade = addBox(0.32, 0.32, 0.32, matLampShade, x, 1.55, z, 0, false, false);
    const light = new THREE.PointLight(0xffcf9e, quality.shadows ? 1.1 : 0.9, 5.5, 2.0);
    light.position.set(x, 1.55, z);
    light.castShadow = false;
    group.add(light);
    collisionBoxes.push(AABB.fromCenter(x, z, 0.18, 0.18));
  }
  makeFloorLamp(-1.2, -4.5);

  // ---- Kitchen: counter (L-shape), island, cabinets, stools ----
  function makeCounter(x1, z1, x2, z2){
    const w = Math.abs(x2-x1), d = Math.abs(z2-z1);
    const cx = (x1+x2)/2, cz=(z1+z2)/2;
    const top = addBox(w, 0.9, d, matCeramic, cx, 0.45, cz);
    markOccluder(top);
    collisionBoxes.push(new AABB(Math.min(x1,x2), Math.min(z1,z2), Math.max(x1,x2), Math.max(z1,z2)));
    return top;
  }
  makeCounter(4.6, -4.85, 6.85, -3.9);
  makeCounter(4.6, -3.9, 5.4, -1.2);

  function makeIsland(x, z){
    const top = addBox(1.6, 0.9, 0.9, matCeramic, x, 0.45, z);
    markOccluder(top);
    collisionBoxes.push(AABB.fromCenter(x, z, 0.85, 0.5));
    coverPoints.push({ x: x, z: z + 0.75, facing: 0, tag: 'island' });
    coverPoints.push({ x: x, z: z - 0.75, facing: Math.PI, tag: 'island' });
  }
  makeIsland(3.0, -2.5);

  function makeCabinetRow(x, z, w){
    const cab = addBox(w, 1.9, 0.4, matWoodDark, x, 0.95, z);
    markOccluder(cab);
    collisionBoxes.push(AABB.fromCenter(x, z, w/2, 0.25));
  }
  makeCabinetRow(6.75, -1.1, 0.5);

  // ---- Bedroom: bed, nightstand, wardrobe, rug ----
  function makeBed(x, z, ry){
    const g = new THREE.Group(); g.position.set(x,0,z); g.rotation.y = ry;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 2.1), matWoodDark);
    frame.position.y = 0.18;
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.24, 2.0), matFabricBed);
    mattress.position.y = 0.47;
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.4), new THREE.MeshStandardMaterial({ color: 0xf2ede0 }));
    pillow.position.set(0, 0.63, -0.75);
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.1), matWoodDark);
    headboard.position.set(0, 0.7, -1.05);
    [frame, mattress, pillow, headboard].forEach(m => { m.castShadow = quality.shadows; m.receiveShadow = quality.shadows; g.add(m); });
    group.add(g);
    markOccluder(frame); markOccluder(headboard);
    const halfW = 0.75, halfD = 1.05;
    const c = Math.cos(ry), s = Math.sin(ry);
    const corners = [[-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]].map(([lx,lz]) => [x + lx*c - lz*s, z + lx*s + lz*c]);
    const xs = corners.map(p=>p[0]), zs = corners.map(p=>p[1]);
    collisionBoxes.push(new AABB(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)));
    coverPoints.push({ x: x + Math.cos(ry)*(halfW+0.4), z: z + Math.sin(ry)*(halfW+0.4), facing: ry - Math.PI/2, tag: 'bed' });
  }
  makeBed(-5.3, 3.6, 0);

  function makeNightstand(x, z){
    const ns = addBox(0.5, 0.55, 0.4, matWoodDark, x, 0.275, z);
    const lamp = addBox(0.16, 0.28, 0.16, matLampShade, x, 0.68, z, 0, false, false);
    const light = new THREE.PointLight(0xffd9a8, quality.shadows ? 0.9 : 0.7, 4.0, 2.0);
    light.position.set(x, 0.68, z);
    group.add(light);
    markOccluder(ns);
    collisionBoxes.push(AABB.fromCenter(x, z, 0.28, 0.22));
  }
  makeNightstand(-4.3, 2.7);

  function makeWardrobe(x, z, ry){
    const w = addBox(1.4, 2.1, 0.55, matWoodDark, x, 1.05, z, ry);
    markOccluder(w);
    const halfW=0.7, halfD=0.3, c=Math.cos(ry), s=Math.sin(ry);
    const corners=[[-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]].map(([lx,lz])=>[x+lx*c-lz*s, z+lx*s+lz*c]);
    const xs=corners.map(p=>p[0]), zs=corners.map(p=>p[1]);
    collisionBoxes.push(new AABB(Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)));
  }
  makeWardrobe(-1.0, 4.5, Math.PI);
  addBox(1.6, 0.02, 1.2, new THREE.MeshStandardMaterial({ color: 0x4a2530, roughness:1 }), -5.3, 0.011, 4.2);

  // ---- Study: desk, chair, bookshelf ----
  function makeDesk(x, z, ry){
    const top = addBox(1.3, 0.06, 0.65, matWoodDark, x, 0.72, z, ry);
    const legOff = 0.55;
    [[-legOff,-0.25],[legOff,-0.25],[-legOff,0.25],[legOff,0.25]].forEach(([dx,dz])=>{
      const lx = x+dx*Math.cos(ry)-dz*Math.sin(ry), lz = z+dx*Math.sin(ry)+dz*Math.cos(ry);
      addBox(0.06, 0.7, 0.06, matWoodDark, lx, 0.35, lz, 0, false, false);
    });
    markOccluder(top);
    collisionBoxes.push(AABB.fromCenter(x, z, 0.7, 0.4));
    coverPoints.push({ x: x, z: z + 0.6, facing: 0, tag: 'desk' });
  }
  makeDesk(4.8, 4.2, 0);

  function makeBookshelf(x, z, ry){
    const shelf = addBox(1.2, 2.0, 0.35, matWoodDark, x, 1.0, z, ry);
    markOccluder(shelf);
    const halfW=0.6, halfD=0.2, c=Math.cos(ry), s=Math.sin(ry);
    const corners=[[-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]].map(([lx,lz])=>[x+lx*c-lz*s, z+lx*s+lz*c]);
    const xs=corners.map(p=>p[0]), zs=corners.map(p=>p[1]);
    collisionBoxes.push(new AABB(Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)));
    coverPoints.push({ x: x - Math.cos(ry)*0.9, z: z - Math.sin(ry)*0.9, facing: ry, tag: 'shelf' });
  }
  makeBookshelf(1.0, 4.7, 0);
  makeBookshelf(6.6, 2.2, Math.PI/2);

  // ---- Hallway console table + cover crate near south doors ----
  function makeCrate(x, z){
    const crate = addBox(0.6, 0.6, 0.6, matWoodDark, x, 0.3, z);
    markOccluder(crate);
    collisionBoxes.push(AABB.fromCenter(x, z, 0.32, 0.32));
    coverPoints.push({ x: x, z: z + 0.7, facing: Math.PI, tag: 'crate' });
    coverPoints.push({ x: x, z: z - 0.7, facing: 0, tag: 'crate' });
  }
  makeCrate(-0.2, 0.8);

  // ---------------- Lighting ----------------
  // Added to `group` (not `scene` directly) so a mission restart's
  // disposeObject3D(houseGroup) tears these down along with everything else
  // instead of leaving an extra hemisphere/sun/shadow-map behind every time.
  const hemi = new THREE.HemisphereLight(0x8fa6c9, 0x1a1712, 0.55);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe9c9, quality.shadows ? 0.9 : 0.7);
  sun.position.set(-10, 9, -6);
  sun.target.position.set(-4, 0, -3);
  if (quality.shadows){
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 30;
    sun.shadow.bias = -0.0015;
  }
  group.add(sun); group.add(sun.target);

  // Warm ambient interior fills per room (kept as low-cost point lights).
  const roomFills = [
    { x: -3.5, z: -2.5, color: 0xffd9ad, intensity: 0.55 }, // living
    { x: 3.5, z: -2.5, color: 0xcfe8ff, intensity: 0.5 },   // kitchen
    { x: -3.5, z: 3.2, color: 0xffc9d6, intensity: 0.45 },  // bedroom
    { x: 3.5, z: 3.2, color: 0xd6e8c9, intensity: 0.4 },    // study
  ];
  roomFills.forEach(r => {
    const l = new THREE.PointLight(r.color, r.intensity, 7, 2.0);
    l.position.set(r.x, 2.3, r.z);
    group.add(l);
  });

  // Darker hallway — deliberately dimmer than the rooms for atmosphere/tension.
  const hallLight = new THREE.PointLight(0xb8b0ff, 0.25, 6, 2.2);
  hallLight.position.set(0, 2.3, 0.8);
  group.add(hallLight);

  scene.add(group);
  return {
    group,
    collisionBoxes,
    occluders: occluderFlagged,
    coverPoints,
    floorZones,
    playerSpawn: new THREE.Vector3(-5.9, 0, -4.3),
    enemySpawns: [
      { x: 4.0, z: -2.0, ry: Math.PI, archetype: 'rifle' },
      { x: -5.0, z: 3.4, ry: 0, archetype: 'defensive' },
      { x: 5.5, z: 4.0, ry: Math.PI, archetype: 'aggressive' },
    ],
  };
}

export function getFloorSurfaceAt(floorZones, x, z){
  for (const fz of floorZones){
    if (fz.box.containsPointXZ(x, z)) return fz.surface;
  }
  return 'wood';
}
