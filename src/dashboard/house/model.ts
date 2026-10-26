import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
 * "우리 집" 3D 모형(부천일루미스테이트 84A 확장형 평면).
 * 모든 좌표는 분양 평면도 이미지의 픽셀로 적고 1px = 4.2cm로 줄인다(거실 100px ≈ 4.2m).
 * 평면 x → 월드 +X(동), 평면 y → 월드 +Z(남, 거실 창 쪽).
 * 실제 집은 분양 평면의 좌우 반전이라 house 그룹의 scale.x = -1로 뒤집는다(그룹 안의 좌표는 평면 그대로).
 */

export const S = 0.042;
const PCX = (31 + 293) / 2;
const PCY = (258 + 494) / 2;
/** 평면 x(px) → 그룹 안 X(m) */
export const mx = (x: number): number => (x - PCX) * S;
/** 평면 y(px) → 그룹 안 Z(m) */
export const mz = (y: number): number => (y - PCY) * S;
/** 천장 높이(m) */
export const CEILING = 2.3;
/** "벽 낮게"일 때 벽 높이(m) */
export const CUT_HEIGHT = 1.15;

type Mat = THREE.Material;

interface Opening {
  s: number;
  e: number;
  lo: number;
  hi: number;
  k: 'win' | 'door' | 'front' | 'glassdoor' | 'slide';
  swing?: number;
}

interface WallDef {
  a: [number, number];
  b: [number, number];
  t: number;
  o: Opening[];
}

export interface HouseModel {
  /** 장면에 넣을 그룹(좌우 반전 포함) */
  house: THREE.Group;
  /** 벽 높이를 바꾼다(true면 낮게). 벽·문·천장을 다시 만든다. */
  setCutaway(cut: boolean): void;
  /** 가구 예시를 보이거나 숨긴다. */
  setFurniture(visible: boolean): void;
  dispose(): void;
}

/** 평면 이미지 기준의 집 모형을 만든다. envMap은 크롬·거울 같은 반사 재질에 쓴다. */
export function buildHouseModel(envMap: THREE.Texture | null, anisotropy: number): HouseModel {
  let cut = CEILING;
  const house = new THREE.Group();
  house.scale.x = -1;
  const built = new THREE.Group();
  const furn = new THREE.Group();
  house.add(built, furn);

  /* ---------- 질감 ---------- */
  let seed = 84;
  const srand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const textures: THREE.Texture[] = [];
  function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    textures.push(t);
    return t;
  }
  function tileTex(n: number, base: [number, number, number], vary: number, grout: string, veins: boolean): THREE.CanvasTexture {
    return canvasTex(
      512,
      512,
      (g, w) => {
        const s = w / n;
        g.fillStyle = grout;
        g.fillRect(0, 0, w, w);
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const l = base[2] + (srand() - 0.5) * vary;
            g.fillStyle = `hsl(${base[0]} ${base[1]}% ${l}%)`;
            g.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
            for (let k = 0; k < 30; k++) {
              g.fillStyle = `rgba(${srand() < 0.5 ? '255,255,255' : '90,80,70'},${0.03 + srand() * 0.04})`;
              g.beginPath();
              g.arc(i * s + srand() * s, j * s + srand() * s, 2 + srand() * 10, 0, 7);
              g.fill();
            }
            if (veins) {
              g.strokeStyle = `rgba(120,115,110,${0.18 + srand() * 0.15})`;
              g.lineWidth = 1 + srand();
              g.beginPath();
              let x = i * s + srand() * s;
              let y = j * s;
              g.moveTo(x, y);
              for (let q = 0; q < 6; q++) {
                x += (srand() - 0.4) * s * 0.3;
                y += s / 6;
                g.lineTo(x, y);
              }
              g.stroke();
            }
          }
      },
      true,
    );
  }
  // 600×600 포세린 타일: 질감 하나에 4×4장 = 2.4m
  const floorTex = tileTex(4, [36, 22, 86], 3, '#bdb3a6', false);
  const marbleTex = tileTex(4, [30, 8, 93], 2, '#cfcac3', true);
  const bathTex = tileTex(8, [30, 4, 42], 4, '#34322f', false);
  const balcTex = tileTex(8, [210, 4, 66], 5, '#8f9296', false);
  const wallTileTex = tileTex(6, [33, 18, 82], 3, '#c6bcae', false);
  const stoneTex = canvasTex(
    512,
    512,
    (g, w, h) => {
      // 거실 아트월: 큰 석재 느낌 판
      g.fillStyle = '#9d9283';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const x = i * 256;
          const y = j * 256;
          g.fillStyle = `hsl(34 ${12 + srand() * 4}% ${66 + srand() * 5}%)`;
          g.fillRect(x + 2, y + 2, 252, 252);
          for (let k = 0; k < 140; k++) {
            g.fillStyle = `rgba(${srand() < 0.5 ? '255,250,240' : '110,98,84'},${0.04 + srand() * 0.05})`;
            g.fillRect(x + srand() * 250, y + srand() * 250, 2 + srand() * 30, 1 + srand() * 3);
          }
        }
    },
    true,
  );
  const graniteTex = tileTex(3, [25, 6, 30], 4, '#1d1c1b', false);
  const nicheTex = canvasTex(256, 192, (g, w, h) => {
    // 조명이 들어간 나무 니치(정면)
    g.fillStyle = '#6e4a24';
    g.fillRect(0, 0, w, h);
    const inner = g.createLinearGradient(0, 0, 0, h);
    inner.addColorStop(0, '#d79c55');
    inner.addColorStop(1, '#8b5a2b');
    g.fillStyle = inner;
    g.fillRect(16, 16, w - 32, h - 32);
    const spot = g.createRadialGradient(w / 2, h - 30, 4, w / 2, h - 30, 110);
    spot.addColorStop(0, 'rgba(255,236,190,0.95)');
    spot.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = spot;
    g.fillRect(16, 16, w - 32, h - 32);
    g.fillStyle = 'rgba(255,245,215,0.95)';
    g.beginPath();
    g.arc(w / 2, 24, 7, 0, 7);
    g.fill();
  });

  /* ---------- 재질 ---------- */
  const M = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
  const mats = {
    wall: M(0xf2f0eb, { roughness: 0.92 }),
    ceiling: M(0xf6f5f2, { roughness: 0.95 }),
    floor: M(0xffffff, { map: floorTex, roughness: 0.38 }),
    marble: M(0xffffff, { map: marbleTex, roughness: 0.22 }),
    bath: M(0xffffff, { map: bathTex, roughness: 0.6 }),
    balc: M(0xffffff, { map: balcTex, roughness: 0.8 }),
    wallTile: M(0xffffff, { map: wallTileTex, roughness: 0.4 }),
    stone: M(0xffffff, { map: stoneTex, roughness: 0.55 }),
    granite: M(0xffffff, { map: graniteTex, roughness: 0.35 }),
    cream: M(0xeae5db, { roughness: 0.6 }),
    white: M(0xf4f2ee, { roughness: 0.5 }),
    greige: M(0xc9c0b3, { roughness: 0.55 }),
    quartz: M(0xf0ece4, { roughness: 0.25 }),
    frame: M(0x9a8c74, { roughness: 0.35, metalness: 0.6 }),
    steel: M(0x5c6064, { roughness: 0.45, metalness: 0.6 }),
    mirror: M(0x8e959b, { roughness: 0.04, metalness: 1, envMap, envMapIntensity: 0.8 }),
    bronzeMirror: M(0x6e6358, { roughness: 0.05, metalness: 1, envMap, envMapIntensity: 0.6 }),
    porcelain: M(0xfbfbfa, { roughness: 0.14, envMap, envMapIntensity: 0.35 }),
    chrome: M(0xe4e7ea, { roughness: 0.12, metalness: 1, envMap, envMapIntensity: 0.9 }),
    black: M(0x1c1c1d, { roughness: 0.3 }),
    sink: M(0xc7cacd, { roughness: 0.2, metalness: 0.9, envMap, envMapIntensity: 0.7 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xd8ecf2,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    slab: M(0x8b8e90, { roughness: 0.95 }),
    fabric: M(0x8d9096, { roughness: 1 }),
    linen: M(0xe8e4dc, { roughness: 1 }),
    wood: M(0xa27b52, { roughness: 0.6 }),
    rug: M(0xc8c0b3, { roughness: 1 }),
    washer: M(0xeceeef, { roughness: 0.3 }),
    unit: M(0xb9bcbf, { roughness: 0.6 }),
  };
  // 낮 시간 기준의 LED 띠·천장 패널·니치(조명은 꺼진 상태)
  const glowWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.78, 0.5).multiplyScalar(0.12), toneMapped: false });
  const glowPanel = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.86).multiplyScalar(0.55), toneMapped: false });
  const nicheMat = new THREE.MeshBasicMaterial({ map: nicheTex, color: new THREE.Color().setScalar(0.45), toneMapped: false });

  /* ---------- 만들기 도우미(평면 픽셀 좌표) ---------- */
  const shadowy = <T extends THREE.Mesh>(m: T): T => {
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  /** 평면의 사각형 (x1,y1)-(x2,y2)과 높이 ya..yb로 상자를 만든다. clip이면 지금 벽 높이에서 자른다. */
  function B(x1: number, y1: number, x2: number, y2: number, ya: number, yb: number, mat: Mat, parent: THREE.Object3D = built, clip = true): THREE.Mesh | null {
    if (clip) yb = Math.min(yb, cut);
    if (yb - ya <= 0.004) return null;
    const w = Math.abs(x2 - x1) * S;
    const d = Math.abs(y2 - y1) * S;
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.004), yb - ya, Math.max(d, 0.004)), mat);
    m.position.set(mx((x1 + x2) / 2), (ya + yb) / 2, mz((y1 + y2) / 2));
    shadowy(m);
    if (mat === mats.glass || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) m.castShadow = false;
    parent.add(m);
    return m;
  }
  /** 위(바닥)나 아래(천장)를 보는 평면 */
  function flat(x1: number, y1: number, x2: number, y2: number, y: number, mat: Mat, down = false): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry((x2 - x1) * S, (y2 - y1) * S), mat);
    m.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
    m.position.set(mx((x1 + x2) / 2), y, mz((y1 + y2) / 2));
    m.receiveShadow = true;
    built.add(m);
    return m;
  }
  /** 타일 질감이 실제 크기(600mm)를 유지하도록 미터 단위 UV */
  function meterUV(geo: THREE.BufferGeometry, size: number): void {
    const p = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / size, p.getY(i) / size);
    uv.needsUpdate = true;
  }
  function floorRect(x1: number, y1: number, x2: number, y2: number, mat: Mat, y = 0.004, size = 2.4): void {
    const g = new THREE.PlaneGeometry((x2 - x1) * S, (y2 - y1) * S);
    g.translate(mx((x1 + x2) / 2), -mz((y1 + y2) / 2), 0);
    meterUV(g, size);
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    built.add(m);
  }
  /** 벽면에 붙이는 타일·석재 판 */
  function liner(x1: number, y1: number, x2: number, y2: number, ya: number, yb: number, mat: Mat, size: number): void {
    yb = Math.min(yb, cut);
    if (yb <= ya) return;
    const m = B(x1, y1, x2, y2, ya, yb, mat);
    if (!m) return;
    const len = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * S;
    const uv = m.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / size, (uv.getY(i) * (yb - ya)) / size);
    uv.needsUpdate = true;
  }

  /* ---------- 벽과 개구부 ---------- */
  const T_OUT = 6;
  const T_IN = 3;
  const W = (a: [number, number], b: [number, number], t: number, o: Opening[] = []): WallDef => ({ a, b, t, o });
  const win = (s: number, e: number, lo: number, hi: number): Opening => ({ s, e, lo, hi, k: 'win' });
  const door = (s: number, e: number, swing: number, k: Opening['k'] = 'door'): Opening => ({ s, e, lo: 0, hi: 2.1, k, swing });
  const WALLS: WallDef[] = [
    // 외벽
    W([83, 258], [293, 258], T_OUT, [win(118, 131, 1.0, 2.0), win(149, 177, 1.05, 1.85), win(210, 240, 0.9, 2.1), win(264, 282, 0.9, 2.1)]),
    W([293, 258], [293, 494], T_OUT),
    W([83, 258], [83, 350], T_OUT),
    W([31, 350], [83, 350], T_OUT, [door(45, 66, 1, 'front')]),
    W([31, 350], [31, 479], T_OUT),
    W([31, 479], [208, 479], T_OUT, [win(50, 86, 0.9, 2.15), win(118, 194, 0.35, 2.15)]),
    W([208, 494], [293, 494], T_OUT, [win(213, 253, 0.9, 2.1), win(261, 289, 1.0, 2.1)]),
    // 내벽
    W([83, 304], [142, 304], T_IN), // 다용도 발코니 | 욕실1·팬트리
    W([142, 258], [142, 304], T_IN, [door(282, 300, -1, 'glassdoor')]),
    W([125, 304], [125, 361], T_IN), // 욕실1 | 팬트리
    W([83, 361], [125, 361], T_IN, [door(88, 105, 1)]), // 욕실1 문
    W([31, 396], [102, 396], T_IN, [door(73, 95, 1)]), // 윤지방 문
    W([102, 387], [102, 479], 4), // 윤지방 | 거실
    W([197, 258], [197, 338], T_IN), // 주방 | 서재
    W([197, 338], [259, 338], T_IN, [door(200, 217, -1)]), // 서재 문
    W([252, 258], [252, 338], T_IN), // 서재 | 알파룸
    W([225, 338], [225, 389], T_IN), // 복도 끝(붙박이 벽)
    W([259, 338], [259, 389], T_IN, [door(366, 384, 1)]), // 드레스룸에서 욕실2로 가는 문
    W([205, 389], [261, 389], T_IN), // 안방 위쪽
    W([208, 389], [208, 494], 4, [door(391, 409, 1)]), // 안방 문
    W([208, 461], [293, 461], 4, [{ s: 214, e: 254, lo: 0, hi: 2.15, k: 'slide' }]),
    W([256, 461], [256, 494], T_IN, [door(466, 482, 1)]), // 실외기실 문
  ];

  function along(horiz: boolean, fixed: number, u1: number, u2: number, off1: number, off2: number, ya: number, yb: number, mat: Mat): void {
    if (horiz) B(u1, fixed + off1, u2, fixed + off2, ya, yb, mat);
    else B(fixed + off1, u1, fixed + off2, u2, ya, yb, mat);
  }

  function buildOpening(o: Opening, horiz: boolean, fixed: number, t: number): void {
    const top = Math.min(o.hi, cut);
    if (o.k === 'win' || o.k === 'slide' || o.k === 'glassdoor') {
      if (o.lo >= cut) return;
      const f = 0.06 / S;
      const d = Math.min(t, 4) / 2;
      along(horiz, fixed, o.s, o.e, -0.3, 0.3, o.lo + 0.02, top - 0.02, mats.glass);
      along(horiz, fixed, o.s, o.e, -d, d, o.lo, o.lo + 0.05, mats.frame);
      if (o.hi <= cut) along(horiz, fixed, o.s, o.e, -d, d, o.hi - 0.05, o.hi, mats.frame);
      along(horiz, fixed, o.s, o.s + f, -d, d, o.lo, top, mats.frame);
      along(horiz, fixed, o.e - f, o.e, -d, d, o.lo, top, mats.frame);
      const panes = Math.max(2, Math.round(((o.e - o.s) * S) / 1.0));
      for (let i = 1; i < panes; i++) {
        const u = o.s + ((o.e - o.s) * i) / panes;
        along(horiz, fixed, u - f / 2, u + f / 2, -d * 0.6, d * 0.6, o.lo, top, mats.frame);
      }
      if (o.k === 'win' && o.hi - o.lo > 1.2 && o.lo + 0.9 < cut) {
        const yb = o.lo + 0.9;
        along(horiz, fixed, o.s, o.e, -d * 0.6, d * 0.6, yb, yb + 0.04, mats.frame);
      }
      return;
    }
    // 여닫이문: 경첩(o.s)을 축으로 연 상태(현관문만 닫힘)로 둔다.
    const wM = (o.e - o.s) * S;
    const hgt = Math.min(2.05, cut);
    const pivot = new THREE.Group();
    const leaf = shadowy(new THREE.Mesh(new THREE.BoxGeometry(wM - 0.02, hgt, 0.04), o.k === 'front' ? mats.steel : mats.cream));
    leaf.position.set(wM / 2, hgt / 2, 0);
    pivot.add(leaf);
    if (hgt > 1.0) {
      for (const z of [-0.045, 0.045]) {
        const knob = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.03), mats.chrome);
        knob.position.set(wM - 0.1, 1.0, z);
        pivot.add(knob);
      }
    }
    const open = o.k === 'front' ? 0 : 1;
    const a = (o.k === 'front' ? 85 : 80) * (Math.PI / 180) * (o.swing ?? 1) * open;
    pivot.rotation.y = horiz ? -a : -Math.PI / 2 + a;
    pivot.position.set(horiz ? mx(o.s) : mx(fixed), 0, horiz ? mz(fixed) : mz(o.s));
    built.add(pivot);
    const d = t / 2 + 0.4;
    along(horiz, fixed, o.s - 1, o.s, -d, d, 0, Math.min(2.12, cut), mats.cream);
    along(horiz, fixed, o.e, o.e + 1, -d, d, 0, Math.min(2.12, cut), mats.cream);
  }

  function buildWall(wd: WallDef): void {
    const horiz = wd.a[1] === wd.b[1];
    const fixed = horiz ? wd.a[1] : wd.a[0];
    let p0 = Math.min(horiz ? wd.a[0] : wd.a[1], horiz ? wd.b[0] : wd.b[1]) - wd.t / 2;
    const p1 = Math.max(horiz ? wd.a[0] : wd.a[1], horiz ? wd.b[0] : wd.b[1]) + wd.t / 2;
    const seg = (s: number, e: number, ya: number, yb: number): void => {
      if (horiz) B(s, fixed - wd.t / 2, e, fixed + wd.t / 2, ya, yb, mats.wall);
      else B(fixed - wd.t / 2, s, fixed + wd.t / 2, e, ya, yb, mats.wall);
    };
    for (const o of [...wd.o].sort((a, b) => a.s - b.s)) {
      seg(p0, o.s, 0, CEILING);
      if (o.lo > 0) seg(o.s, o.e, 0, o.lo);
      if (o.hi < CEILING) seg(o.s, o.e, o.hi, CEILING);
      buildOpening(o, horiz, fixed, wd.t);
      p0 = o.e;
    }
    seg(p0, p1, 0, CEILING);
  }

  /* ---------- 바닥과 천장 ---------- */
  const OUTLINE: [number, number][] = [
    [83, 258],
    [293, 258],
    [293, 461],
    [208, 461],
    [208, 479],
    [31, 479],
    [31, 350],
    [83, 350],
  ];
  function shapeFrom(points: [number, number][], flipZ: boolean): THREE.Shape {
    const s = new THREE.Shape();
    points.forEach(([x, y], i) => {
      const X = mx(x);
      const Z = flipZ ? -mz(y) : mz(y);
      if (i) s.lineTo(X, Z);
      else s.moveTo(X, Z);
    });
    return s;
  }
  function buildFloorsAndCeilings(): void {
    const fg = new THREE.ShapeGeometry(shapeFrom(OUTLINE, true));
    meterUV(fg, 2.4);
    const floor = new THREE.Mesh(fg, mats.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    floor.receiveShadow = true;
    built.add(floor);
    floorRect(34, 352, 69, 387, mats.marble); // 현관
    floorRect(86, 305, 124, 360, mats.bath, 0.004, 1.2); // 욕실1
    floorRect(227, 339, 258, 388, mats.bath, 0.004, 1.2); // 욕실2
    floorRect(85, 260, 141, 303, mats.balc, 0.004, 1.2); // 다용도 발코니
    floorRect(208, 461, 293, 494, mats.balc, -0.03, 1.2); // 발코니1·실외기실(한 단 낮음)
    B(208, 461, 293, 494, -0.2, -0.03, mats.slab, built, false);

    if (cut < CEILING) return; // 벽을 낮추면 천장은 없앤다
    // 천장은 아래쪽만 보이므로 위에서 내려다보면 투명하다.
    const ceil = new THREE.Mesh(new THREE.ShapeGeometry(shapeFrom(OUTLINE, false)), mats.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = CEILING;
    ceil.castShadow = true;
    built.add(ceil);
    flat(208, 461, 293, 494, CEILING, mats.ceiling, true).castShadow = true;
    for (const [a, b, c, d] of [
      [52, 425, 82, 455],
      [210, 284, 238, 312],
      [236, 410, 270, 440],
      [150, 280, 180, 300],
    ])
      flat(a, b, c, d, CEILING - 0.005, glowPanel, true);
    for (const [x, y] of [
      [60, 366], [120, 375], [160, 376], [200, 376], [212, 360], [270, 360], [272, 300],
      [125, 410], [155, 410], [185, 410], [125, 466], [155, 466], [185, 466],
    ])
      flat(x - 1.5, y - 1.5, x + 1.5, y + 1.5, CEILING - 0.005, glowPanel, true);
  }

  /* ---------- 욕실 기구(벽에 등을 대고 +z를 보는 로컬 좌표) ---------- */
  const RBox = (w: number, h: number, d: number, r: number): THREE.BufferGeometry => new RoundedBoxGeometry(w, h, d, 4, r);
  const part = (geo: THREE.BufferGeometry, mat: Mat, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  function place(obj: THREE.Object3D, px: number, py: number, rotY: number): void {
    obj.position.set(mx(px), 0, mz(py));
    obj.rotation.y = rotY;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    built.add(obj);
  }
  function makeToilet(): THREE.Group {
    const g = new THREE.Group();
    const P = mats.porcelain;
    part(RBox(0.37, 0.3, 0.19, 0.035), P, 0, 0.565, 0.105, g);
    part(RBox(0.385, 0.035, 0.205, 0.016), P, 0, 0.73, 0.105, g);
    part(RBox(0.3, 0.4, 0.25, 0.07), P, 0, 0.2, 0.17, g);
    const prof = [[0, 0], [0.122, 0], [0.126, 0.018], [0.106, 0.11], [0.108, 0.21], [0.135, 0.29], [0.165, 0.35], [0.177, 0.378], [0.172, 0.392], [0, 0.392]].map(
      ([r, y]) => new THREE.Vector2(r, y),
    );
    part(new THREE.LatheGeometry(prof, 48), P, 0, 0, 0.47, g).scale.z = 1.32;
    part(new THREE.CylinderGeometry(0.174, 0.178, 0.036, 48), P, 0, 0.41, 0.47, g).scale.z = 1.32;
    part(new THREE.SphereGeometry(0.172, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2), P, 0, 0.428, 0.47, g).scale.set(1, 0.13, 1.32);
    part(RBox(0.27, 0.045, 0.06, 0.015), P, 0, 0.42, 0.235, g);
    part(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 16), mats.chrome, -0.198, 0.655, 0.16, g).rotation.z = Math.PI / 2;
    part(RBox(0.012, 0.016, 0.06, 0.005), mats.chrome, -0.21, 0.655, 0.18, g);
    return g;
  }
  function makeBasin(): THREE.Group {
    const g = new THREE.Group();
    const P = mats.porcelain;
    const w = 0.54;
    const d = 0.44;
    const top = 0.845;
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0);
    sh.lineTo(w / 2, 0);
    sh.lineTo(w / 2, d * 0.42);
    sh.bezierCurveTo(w / 2, d * 0.96, w * 0.26, d, 0, d);
    sh.bezierCurveTo(-w * 0.26, d, -w / 2, d * 0.96, -w / 2, d * 0.42);
    sh.lineTo(-w / 2, 0);
    const bx = w * 0.37;
    const bz = d * 0.33;
    const bc = d * 0.57;
    const hole = new THREE.Path();
    hole.absellipse(0, bc, bx, bz, 0, Math.PI * 2, true, 0);
    sh.holes.push(hole);
    const slab = part(
      new THREE.ExtrudeGeometry(sh, { depth: 0.11, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 3, curveSegments: 28 }),
      P,
      0,
      top - 0.014,
      0,
      g,
    );
    slab.rotation.x = Math.PI / 2;
    const inner = new THREE.MeshStandardMaterial({ color: 0xf7f8f8, roughness: 0.12, side: THREE.BackSide, envMap, envMapIntensity: 0.4 });
    part(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), inner, 0, top - 0.01, bc, g).scale.set(bx, 0.13, bz);
    part(new THREE.CylinderGeometry(0.019, 0.019, 0.004, 20), mats.chrome, 0, top - 0.138, bc, g);
    part(new THREE.CylinderGeometry(0.006, 0.006, 0.003, 12), mats.black, -w * 0.3, top + 0.001, d * 0.2, g);
    part(new THREE.CylinderGeometry(0.024, 0.026, 0.13, 24), mats.chrome, 0, top + 0.065, 0.055, g);
    part(RBox(0.042, 0.026, 0.12, 0.008), mats.chrome, 0, top + 0.118, 0.11, g);
    part(RBox(0.034, 0.012, 0.085, 0.005), mats.chrome, 0, top + 0.145, 0.03, g).rotation.x = 0.25;
    const pp = [[0, 0], [0.105, 0], [0.104, 0.03], [0.086, 0.25], [0.074, 0.55], [0.078, top - 0.13], [0, top - 0.13]].map(([r, y]) => new THREE.Vector2(r, y));
    part(new THREE.LatheGeometry(pp, 40), P, 0, 0, 0.085, g).scale.z = 0.78;
    return g;
  }

  /* ---------- 붙박이 가구(리모델링 사진 기준) ---------- */
  function buildJoinery(): void {
    // 현관: 브론즈 거울 신발장, 정면 흰 수납장, 아래 센서 LED
    B(34, 352, 41, 386, 0.18, CEILING, mats.bronzeMirror);
    B(35, 387.5, 69, 395, 0.18, CEILING, mats.white);
    B(34.5, 352, 40, 386, 0.02, 0.05, glowWarm);
    B(35, 388, 69, 394, 0.02, 0.05, glowWarm);
    // 거실 아트월(안방 쪽 벽)
    liner(205.6, 410, 206, 477, 0, CEILING, mats.stone, 1.2);
    // 복도 끝 붙박이장과 조명 니치 네 개
    B(215.5, 340, 223.5, 388, 0, CEILING, mats.white);
    const niches: [number, number, number, number][] = [
      [0.08, 0.3, 1.05, 1.42],
      [0.31, 0.47, 0.62, 0.95],
      [0.48, 0.64, 1.55, 1.9],
      [0.66, 0.92, 1.05, 1.42],
    ];
    for (const [u1, u2, ya, yb] of niches) {
      if (yb > cut) continue;
      const n = new THREE.Mesh(new THREE.PlaneGeometry((u2 - u1) * 48 * S, yb - ya), nicheMat);
      n.rotation.y = -Math.PI / 2;
      n.position.set(mx(215.4), (ya + yb) / 2, mz(340 + ((u1 + u2) / 2) * 48));
      built.add(n);
    }
    for (let i = 1; i < 6; i++) B(215.3, 340 + i * 8 - 0.15, 215.5, 340 + i * 8 + 0.15, 0.05, CEILING - 0.05, mats.greige);

    // 주방: ㄷ자 조리대, 동쪽 키큰장, 상부장, 벽 타일
    B(144, 261, 186, 275, 0.1, 0.86, mats.white);
    B(143.5, 260.5, 186, 276, 0.86, 0.9, mats.quartz);
    B(172, 275, 186, 326, 0.1, 0.86, mats.white);
    B(171.5, 275, 186, 326, 0.86, 0.9, mats.quartz);
    B(158, 326, 186, 340, 0.1, 0.86, mats.white);
    B(157.5, 325.5, 186, 340.5, 0.86, 0.9, mats.quartz);
    B(158, 339, 186, 341, 0.1, 1.08, mats.greige);
    B(144, 261, 186, 275, 0, 0.1, mats.black);
    B(172, 275, 186, 340, 0, 0.1, mats.black);
    B(160, 263, 171, 272, 0.895, 0.905, mats.sink);
    B(175, 288, 184.5, 302, 0.9, 0.912, mats.black);
    B(176, 288, 186, 302, 1.55, 1.75, mats.steel);
    B(186, 261, 195.5, 340, 0, CEILING, mats.greige);
    B(185.8, 300, 186, 318, 0.9, 1.35, mats.wood);
    B(144, 261, 149, 269, 1.45, CEILING, mats.white);
    B(177, 261, 186, 269, 1.45, CEILING, mats.white);
    B(149, 261, 177, 269, 1.92, CEILING, mats.white);
    B(176, 269, 186, 288, 1.45, CEILING, mats.white);
    B(176, 302, 186, 326, 1.45, CEILING, mats.white);
    liner(144, 260.6, 186, 261, 0.9, 1.45, mats.wallTile, 1.2);
    B(126, 305, 141.5, 360, 0, CEILING, mats.greige); // 욕실 옆 팬트리

    // 욕실1(공용): 욕조, 세면대, 변기, 거울장
    liner(86, 305, 124, 305.6, 0, CEILING, mats.wallTile, 1.2);
    liner(86, 305, 86.6, 360, 0, CEILING, mats.wallTile, 1.2);
    liner(123.4, 305, 124, 360, 0, CEILING, mats.wallTile, 1.2);
    liner(105, 359.4, 124, 360, 0, CEILING, mats.wallTile, 1.2);
    B(87, 306, 123, 318, 0, 0.55, mats.porcelain);
    place(makeBasin(), 123.4, 330, -Math.PI / 2);
    B(122.6, 322, 123.4, 340, 1.2, 2.0, mats.mirror);
    B(119, 322, 123.4, 340, 1.17, 1.19, glowWarm);
    place(makeToilet(), 113, 359.4, Math.PI);

    // 욕실2(안방): 화강석 샤워벽, 유리 칸막이, 세면대, 변기
    liner(227, 339.4, 258, 340, 0, CEILING, mats.granite, 0.9);
    liner(226.5, 340, 227, 388, 0, CEILING, mats.wallTile, 1.2);
    liner(257.4, 340, 258, 366, 0, CEILING, mats.wallTile, 1.2);
    liner(227, 387.4, 258, 388, 0, CEILING, mats.wallTile, 1.2);
    B(227, 352.5, 246, 353, 0, 2.0, mats.glass);
    place(makeBasin(), 227, 362, Math.PI / 2);
    B(227, 356, 227.8, 372, 1.2, 2.0, mats.mirror);
    B(227, 356, 231, 372, 1.17, 1.19, glowWarm);
    place(makeToilet(), 227, 379, Math.PI / 2);

    // 드레스룸 화장대, 알파룸 선반
    B(281, 345, 290, 384, 0, 0.76, mats.white);
    B(280.5, 345, 290, 384, 0.76, 0.79, mats.quartz);
    B(289.6, 350, 290, 380, 1.0, 1.9, mats.mirror);
    B(254, 262, 262, 336, 0, CEILING, mats.white);
    B(282, 262, 290, 336, 0, CEILING, mats.white);

    // 윤지방 문 옆 옷장
    B(34, 397.5, 67, 411, 0, CEILING, mats.greige);

    // 다용도 발코니 세탁기·건조기, 실외기실 실외기
    B(88, 262, 101, 276, 0, 0.86, mats.washer);
    B(102, 262, 115, 276, 0, 0.86, mats.washer);
    B(262, 479, 288, 492, 0, 0.75, mats.unit);
  }

  function buildShell(): void {
    for (const c of [...built.children]) {
      built.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    WALLS.forEach(buildWall);
    buildFloorsAndCeilings();
    buildJoinery();
    B(31, 258, 293, 479, -0.25, 0, mats.slab, built, false);
    B(69, 350, 86, 362, 0, CEILING, mats.wall); // 현관문 옆 덕트
  }

  /* ---------- 가구 예시 ---------- */
  function buildFurniture(): void {
    const F = (x1: number, y1: number, x2: number, y2: number, ya: number, yb: number, m: Mat): void => {
      B(x1, y1, x2, y2, ya, yb, m, furn, false);
    };
    // 거실: 윤지방 벽에 붙인 소파, 러그, 테이블, TV장
    F(106, 414, 121, 462, 0.05, 0.42, mats.fabric);
    F(106, 414, 110, 462, 0.42, 0.85, mats.fabric);
    F(106, 414, 121, 417, 0.42, 0.6, mats.fabric);
    F(106, 459, 121, 462, 0.42, 0.6, mats.fabric);
    F(126, 414, 178, 462, 0.0, 0.012, mats.rug);
    F(131, 428, 147, 448, 0.0, 0.38, mats.wood);
    F(197, 420, 205.5, 456, 0.0, 0.45, mats.white);
    F(204.8, 423, 205.5, 453, 0.85, 1.6, mats.black);
    // 식탁
    F(150, 346, 182, 362, 0.72, 0.76, mats.wood);
    F(164, 352, 168, 356, 0, 0.72, mats.black);
    for (const [x, y] of [[152, 340.5], [172, 340.5]]) F(x, y + 0.5, x + 9, y + 4.5, 0.44, 0.48, mats.wood);
    for (const [x, y] of [[152, 364], [172, 364]]) {
      F(x, y, x + 9, y + 9, 0.44, 0.48, mats.wood);
      F(x, y + 8, x + 9, y + 9, 0.48, 0.9, mats.wood);
    }
    // 안방: 동쪽 벽 헤드보드의 퀸 침대
    F(240, 411, 287.5, 449, 0.05, 0.48, mats.linen);
    F(286.5, 409, 290, 451, 0, 1.15, mats.wood);
    F(278, 414, 286, 428, 0.48, 0.6, mats.white);
    F(278, 432, 286, 446, 0.48, 0.6, mats.white);
    // 윤지방: 싱글 침대
    F(35, 428, 59, 476, 0.05, 0.45, mats.linen);
    F(35, 474, 59, 476.5, 0, 0.95, mats.wood);
  }

  buildShell();
  buildFurniture();

  return {
    house,
    setCutaway(c: boolean): void {
      const next = c ? CUT_HEIGHT : CEILING;
      if (next === cut) return;
      cut = next;
      buildShell();
    },
    setFurniture(visible: boolean): void {
      furn.visible = visible;
    },
    dispose(): void {
      house.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      textures.forEach((t) => t.dispose());
      for (const m of [...Object.values(mats), glowWarm, glowPanel, nicheMat]) m.dispose();
    },
  };
}
