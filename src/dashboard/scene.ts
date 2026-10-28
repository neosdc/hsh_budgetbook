import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { heightRatio, heightTicks, tickLabel, type Cell, type Grid, type HeightScale } from '../util/dashboard';

/*
 * 좌표계: X축 = 열(날짜/달), Z축 = 줄(분류), Y축 = 금액.
 * 수입 줄을 뒤쪽(작은 Z)에, 지출 줄을 앞쪽(큰 Z)에 둔다. 급여처럼 큰 수입 막대가 지출 막대를 가리지 않게 하려는 배치다.
 * 카메라는 오른쪽 앞 위에서 내려다보므로, 분류 이름은 오른쪽 끝, 날짜는 앞쪽 끝, 금액 눈금은 왼쪽 뒤 모서리에 붙인다.
 */

const LANE = 1.1; // 줄 간격(Z)
const GROUP_GAP = 0.9; // 수입 줄과 지출 줄 사이 간격
const BAR_FILL = 0.62; // 칸 폭 중 막대가 차지하는 비율(나머지는 막대 사이 틈)
const MIN_H = 0.04; // 아주 작은 금액도 보이도록 하는 최소 높이
const ANIM_MS = 650;
const PORTRAIT = 0.9; // 이보다 가로/세로 비율이 작으면 세로 화면용 시점을 쓴다.

interface Theme {
  income: THREE.Color;
  expense: THREE.Color;
  floor: THREE.Color;
  line: THREE.Color;
  axis: THREE.Color;
}

interface Bar {
  mesh: THREE.Mesh;
  cell: Cell;
  type: 'income' | 'expense';
  from: number;
  to: number;
}

interface Materials {
  base: THREE.MeshStandardMaterial;
  hot: THREE.MeshStandardMaterial;
  dim: THREE.MeshStandardMaterial;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readTheme(): Theme {
  return {
    income: new THREE.Color(cssVar('--c-income') || '#1c5fa6'),
    expense: new THREE.Color(cssVar('--c-expense') || '#b43a28'),
    floor: new THREE.Color(cssVar('--surface') || '#ffffff'),
    line: new THREE.Color(cssVar('--line') || '#d6dfda'),
    axis: new THREE.Color(cssVar('--muted') || '#5a6963'),
  };
}

function makeMaterials(color: THREE.Color): Materials {
  const base = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  const hot = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05, emissive: color, emissiveIntensity: 0.45 });
  const dim = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.22, depthWrite: false });
  return { base, hot, dim };
}

function setMaterialColor(m: Materials, color: THREE.Color): void {
  m.base.color.copy(color);
  m.hot.color.copy(color);
  m.hot.emissive.copy(color);
  m.dim.color.copy(color);
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

function label(text: string, className: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = `lbl ${className}`;
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  return new CSS2DObject(el);
}

export interface SceneEvents {
  /** 막대 위에 포인터가 올라가거나(cell) 벗어남(null). 터치에서는 오지 않는다. */
  onHover(cell: Cell | null, clientX: number, clientY: number): void;
  /** 막대를 누름(cell) 또는 빈 곳을 누름(null) */
  onPick(cell: Cell | null): void;
}

export class LedgerScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.9);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  /** 열 간격(X). 일별 31칸은 좁게, 월별 12칸은 넓게 */
  private colW = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  private theme = readTheme();
  private readonly mats: Record<'income' | 'expense', Materials>;
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly axisMat: THREE.LineBasicMaterial;
  private readonly floorMat: THREE.MeshStandardMaterial;

  private world = new THREE.Group();
  private bars: Bar[] = [];
  private grid: Grid | null = null;
  private scale: HeightScale = 'linear';
  private height = 8;
  private tickGroup = new THREE.Group();
  /** 바닥 격자의 경계 */
  private extent = { x0: 0, x1: 1, z0: 0, z1: 1 };

  private animStart = 0;
  private frame = 0;
  private hovered: Bar | null = null;
  private selected: Bar | null = null;
  private downAt: { x: number; y: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: SceneEvents,
  ) {
    // WebGL을 쓸 수 없는 환경이면 여기서 예외가 나고, 호출한 쪽에서 안내 문구를 보여 준다.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'stage-canvas';
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'stage-labels';
    host.appendChild(this.labels.domElement);

    this.mats = { income: makeMaterials(this.theme.income), expense: makeMaterials(this.theme.expense) };
    this.lineMat = new THREE.LineBasicMaterial({ color: this.theme.line });
    this.axisMat = new THREE.LineBasicMaterial({ color: this.theme.axis });
    this.floorMat = new THREE.MeshStandardMaterial({ color: this.theme.floor, roughness: 1, metalness: 0 });

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.world);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.invalidate());

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(host);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    this.resize();
  }

  /* ---------- 공개 API ---------- */

  /** 그리드를 새로 그린다. 시점은 그리드 크기에 맞게 다시 잡는다. */
  setGrid(grid: Grid, scale: HeightScale): void {
    const sameShape = this.grid !== null && this.grid.mode === grid.mode && this.grid.lanes.length === grid.lanes.length;
    this.grid = grid;
    this.scale = scale;
    this.height = grid.mode === 'days' ? 8 : 6.5;
    this.colW = grid.mode === 'days' ? 0.8 : grid.mode === 'category' ? 1.7 : 1.5;
    this.clearSelection(false);
    // 분류별 막대 한 줄은 낮은 무대가 알맞다(dashboard.css .stage.flat). 크기를 먼저 맞춘 뒤 시점을 잡는다.
    const flatChanged = this.host.classList.contains('flat') !== (grid.mode === 'category');
    this.host.classList.toggle('flat', grid.mode === 'category');
    if (flatChanged) this.resize();
    this.rebuild();
    if (!sameShape || flatChanged) this.fitCamera();
    this.startAnimation();
  }

  /** 높이 축척만 바꾼다. 막대가 지금 높이에서 새 높이로 자라거나 줄어든다. */
  setScale(scale: HeightScale): void {
    if (!this.grid || scale === this.scale) return;
    this.scale = scale;
    for (const b of this.bars) {
      b.from = b.mesh.scale.y;
      b.to = this.barHeight(b.cell.total);
    }
    this.buildTicks();
    this.startAnimation();
  }

  /** 처음 시점으로 되돌린다. */
  resetView(): void {
    this.fitCamera();
  }

  /** 선택을 해제한다(목록 패널을 닫을 때). */
  clearSelection(notify = true): void {
    if (!this.selected) return;
    this.selected = null;
    this.paint();
    if (notify) this.events.onPick(null);
  }

  /* ---------- 장면 구성 ---------- */

  private barHeight(total: number): number {
    if (!this.grid) return MIN_H;
    return Math.max(heightRatio(total, this.grid.max, this.scale) * this.height, MIN_H);
  }

  /** 줄 번호 → Z 좌표. 수입 줄과 지출 줄 사이에 간격을 둔다. */
  private laneZ(lane: number): number {
    const grid = this.grid!;
    const firstExpense = grid.lanes.findIndex((l) => l.type === 'expense');
    const gap = firstExpense !== -1 && firstExpense > 0 && lane >= firstExpense ? GROUP_GAP : 0;
    return lane * LANE + gap;
  }

  /** category 모드: 분류(줄)를 가로축으로 펼친다. 수입 분류와 지출 분류 사이에 간격을 둔다. */
  private flatX(lane: number): number {
    const grid = this.grid!;
    const firstExpense = grid.lanes.findIndex((l) => l.type === 'expense');
    const gap = firstExpense > 0 && lane >= firstExpense ? this.colW * 0.6 : 0;
    return lane * this.colW + gap;
  }

  private rebuild(): void {
    const grid = this.grid!;
    if (grid.mode === 'category') {
      this.rebuildFlat();
      return;
    }
    this.scene.remove(this.world);
    this.world.traverse((o) => {
      if ((o instanceof THREE.LineSegments || o instanceof THREE.Mesh) && o.geometry !== this.unitBox) o.geometry.dispose();
      // 그룹째 떼어 내면 자식 라벨의 DOM 요소는 남으므로 직접 지운다.
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.bars = [];
    this.hovered = null;

    const nCols = grid.columns.length;
    const cw = this.colW;
    const half = LANE / 2;
    const x0 = -cw / 2;
    const x1 = (nCols - 0.5) * cw;
    const z0 = -half;
    const z1 = (grid.lanes.length > 0 ? this.laneZ(grid.lanes.length - 1) : 0) + half;
    this.extent = { x0, x1, z0, z1 };
    const barW = Math.min(cw, LANE) * BAR_FILL;

    // 바닥
    const pad = 0.35;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + pad * 2, z1 - z0 + pad * 2), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    floor.receiveShadow = true;
    this.world.add(floor);

    // 바닥 격자: 줄 경계와 열 경계(헤어라인)
    const pts: number[] = [];
    const laneEdges = new Set<number>();
    grid.lanes.forEach((_, i) => {
      const z = this.laneZ(i);
      laneEdges.add(z - half);
      laneEdges.add(z + half);
    });
    for (const z of laneEdges) pts.push(x0, 0.002, z, x1, 0.002, z);
    const zRanges = this.laneRanges();
    for (let c = 0; c <= nCols; c++) {
      const x = (c - 0.5) * cw;
      for (const [a, b] of zRanges) pts.push(x, 0.002, a, x, 0.002, b);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.world.add(new THREE.LineSegments(gridGeo, this.lineMat));

    // 막대
    for (const cell of grid.cells) {
      const type = grid.lanes[cell.lane].type;
      const mesh = new THREE.Mesh(this.unitBox, this.mats[type].base);
      mesh.position.set(cell.col * cw, 0, this.laneZ(cell.lane));
      mesh.scale.set(barW, MIN_H, barW);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.index = this.bars.length;
      this.world.add(mesh);
      this.bars.push({ mesh, cell, type, from: MIN_H, to: this.barHeight(cell.total) });
    }

    // 분류 이름(오른쪽 끝)
    grid.lanes.forEach((lane, i) => {
      const obj = label(lane.category, `lane ${lane.type}`);
      obj.position.set(x1 + 0.35, 0, this.laneZ(i));
      this.world.add(obj);
    });

    // 날짜/달 이름(앞쪽 끝)
    grid.columns.forEach((col, i) => {
      if (!col.showLabel) return;
      const obj = label(col.label, 'col');
      obj.position.set(i * cw, 0, z1 + 0.75);
      this.world.add(obj);
    });

    // 그림자 범위를 그리드에 맞춘다.
    const span = Math.max(x1 - x0, z1 - z0) / 2 + 2;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = 120;
    cam.updateProjectionMatrix();
    this.sun.position.set(cx - span * 0.6, 40, cz + span * 0.9);
    this.sun.target.position.set(cx, 0, cz);

    this.tickGroup = new THREE.Group();
    this.world.add(this.tickGroup);
    this.buildTicks();
  }

  /** 한 달 · 분류별: 축은 분류(가로)와 금액(높이) 둘뿐, 앞뒤 깊이는 막대 한 줄 */
  private rebuildFlat(): void {
    const grid = this.grid!;
    this.scene.remove(this.world);
    this.world.traverse((o) => {
      if ((o instanceof THREE.LineSegments || o instanceof THREE.Mesh) && o.geometry !== this.unitBox) o.geometry.dispose();
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.bars = [];
    this.hovered = null;

    const cw = this.colW;
    const n = grid.lanes.length;
    const x0 = -cw / 2;
    const x1 = (n > 0 ? this.flatX(n - 1) : 0) + cw / 2;
    const z0 = -LANE / 2;
    const z1 = LANE / 2;
    this.extent = { x0, x1, z0, z1 };
    const barW = Math.min(cw, LANE) * BAR_FILL;

    const pad = 0.35;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + pad * 2, z1 - z0 + pad * 2), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((x0 + x1) / 2, 0, 0);
    floor.receiveShadow = true;
    this.world.add(floor);

    // 바닥 격자: 앞뒤 경계와, 분류마다 좌우 경계
    const pts: number[] = [];
    const firstExpense = grid.lanes.findIndex((l) => l.type === 'expense');
    const groups: [number, number][] = [];
    if (firstExpense !== 0) groups.push([0, (firstExpense === -1 ? n : firstExpense) - 1]);
    if (firstExpense !== -1) groups.push([firstExpense, n - 1]);
    for (const [a, b] of groups) {
      if (b < a) continue;
      const ga = this.flatX(a) - cw / 2;
      const gb = this.flatX(b) + cw / 2;
      pts.push(ga, 0.002, z0, gb, 0.002, z0, ga, 0.002, z1, gb, 0.002, z1);
      for (let i = a; i <= b + 1; i++) {
        const x = i <= b ? this.flatX(i) - cw / 2 : gb;
        pts.push(x, 0.002, z0, x, 0.002, z1);
      }
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.world.add(new THREE.LineSegments(gridGeo, this.lineMat));

    for (const cell of grid.cells) {
      const type = grid.lanes[cell.lane].type;
      const mesh = new THREE.Mesh(this.unitBox, this.mats[type].base);
      mesh.position.set(this.flatX(cell.lane), 0, 0);
      mesh.scale.set(barW, MIN_H, barW);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.index = this.bars.length;
      this.world.add(mesh);
      this.bars.push({ mesh, cell, type, from: MIN_H, to: this.barHeight(cell.total) });
    }

    // 분류 이름: 막대 앞쪽 바닥에
    grid.lanes.forEach((lane, i) => {
      const obj = label(lane.category, `col catname ${lane.type}`);
      obj.position.set(this.flatX(i), 0, z1 + 0.55);
      this.world.add(obj);
    });

    const span = (x1 - x0) / 2 + 2;
    const cx = (x0 + x1) / 2;
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = 120;
    cam.updateProjectionMatrix();
    this.sun.position.set(cx - span * 0.6, 40, span * 0.9);
    this.sun.target.position.set(cx, 0, 0);

    this.tickGroup = new THREE.Group();
    this.world.add(this.tickGroup);
    this.buildTicks();
  }

  /** 줄들이 차지하는 Z 구간(수입 묶음, 지출 묶음). 두 묶음 사이 빈 칸에는 세로 격자를 긋지 않는다. */
  private laneRanges(): [number, number][] {
    const grid = this.grid!;
    const out: [number, number][] = [];
    for (const type of ['income', 'expense'] as const) {
      const idx = grid.lanes.map((l, i) => (l.type === type ? i : -1)).filter((i) => i >= 0);
      if (idx.length === 0) continue;
      out.push([this.laneZ(idx[0]) - LANE / 2, this.laneZ(idx[idx.length - 1]) + LANE / 2]);
    }
    return out;
  }

  /** 금액 눈금: 뒤쪽 모서리를 따라 가로선을 긋고, 왼쪽 뒤 모서리 기둥에 금액을 붙인다. */
  private buildTicks(): void {
    const grid = this.grid!;
    for (const child of [...this.tickGroup.children]) {
      this.tickGroup.remove(child);
      if (child instanceof THREE.LineSegments) child.geometry.dispose();
    }
    const { x0, x1, z0 } = this.extent;
    const pts: number[] = [x0, 0, z0, x0, this.height, z0]; // 모서리 기둥
    const ticks = heightTicks(grid.max, this.scale);
    for (const v of ticks) {
      const y = heightRatio(v, grid.max, this.scale) * this.height;
      pts.push(x0, y, z0, x1, y, z0);
      const obj = label(tickLabel(v), 'tick');
      obj.position.set(x0 - 0.25, y, z0);
      this.tickGroup.add(obj);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.tickGroup.add(new THREE.LineSegments(geo, this.lineMat));
    const axis = new THREE.BufferGeometry();
    axis.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x0, this.height, z0], 3));
    this.tickGroup.add(new THREE.LineSegments(axis, this.axisMat));
    this.invalidate();
  }

  /**
   * 그리드와 라벨이 화면에 꽉 차도록 카메라 거리를 정한다.
   * 상자 꼭짓점을 화면 좌표로 투영해 보면서 거리를 이분 탐색하고, 투영된 범위가 가운데 오도록 바라보는 점을 옮긴다.
   */
  private fitCamera(): void {
    const { x0, x1, z0, z1 } = this.extent;
    // 분류 이름(오른쪽)과 날짜(앞쪽), 금액 눈금(왼쪽)이 들어갈 여유
    // 금액 눈금(왼쪽)과 분류 이름(오른쪽 또는 앞쪽)이 들어갈 여유. 분류별 한 줄은 오른쪽 이름이 없다.
    const xs = this.grid?.mode === 'category' ? [x0 - 2.4, x1 + 0.6] : [x0 - 1.6, x1 + 2.6];
    const ys = [0, this.height];
    const zs = [z0, z1 + 1.1];
    const corners: THREE.Vector3[] = [];
    for (const x of xs) for (const y of ys) for (const z of zs) corners.push(new THREE.Vector3(x, y, z));

    // 세로로 긴 화면(휴대폰)에서는 오른쪽 옆에서 내려다본다. 긴 날짜 축이 화면 위아래로 놓이고(1일이 위),
    // 분류 줄이 화면 가로로 펼쳐지며, 분류 이름은 아래쪽 끝에 세로쓰기로 붙는다.
    const portrait = this.camera.aspect < PORTRAIT;
    this.host.classList.toggle('portrait', portrait);
    // 한 달 · 분류별(막대 한 줄)은 세로 화면에서도 앞에서 본다. 옆에서 보면 막대 높이가 줄과 겹쳐 읽기 어렵다.
    const flat = this.grid?.mode === 'category';
    const dir = (portrait && !flat ? new THREE.Vector3(1, 1.25, 0.2) : flat ? new THREE.Vector3(0.22, 0.6, 1) : new THREE.Vector3(0.32, 0.78, 1)).normalize();
    const target = new THREE.Vector3((x0 + x1) / 2, this.height * 0.3, (z0 + z1) / 2);
    const p = new THREE.Vector3();
    const bounds = (d: number): { minX: number; maxX: number; minY: number; maxY: number } => {
      this.camera.position.copy(target).addScaledVector(dir, d);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      for (const c of corners) {
        p.copy(c).project(this.camera);
        b.minX = Math.min(b.minX, p.x);
        b.maxX = Math.max(b.maxX, p.x);
        b.minY = Math.min(b.minY, p.y);
        b.maxY = Math.max(b.maxY, p.y);
      }
      return b;
    };
    const fits = (d: number): boolean => {
      const b = bounds(d);
      return b.minX > -0.96 && b.maxX < 0.96 && b.minY > -0.94 && b.maxY < 0.94;
    };

    let dist = 30;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 1;
      let hi = 400;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      dist = hi;
      // 투영 범위의 가운데를 화면 가운데로: 카메라의 오른쪽·위쪽 방향으로 바라보는 점을 옮긴다.
      const b = bounds(dist);
      const halfH = dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
      const halfW = halfH * this.camera.aspect;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      target.addScaledVector(right, ((b.minX + b.maxX) / 2) * halfW);
      target.addScaledVector(up, ((b.minY + b.maxY) / 2) * halfH);
    }

    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.minDistance = dist * 0.15;
    this.controls.maxDistance = dist * 3;
    this.controls.update();
    this.invalidate();
  }

  private applyTheme(): void {
    this.theme = readTheme();
    setMaterialColor(this.mats.income, this.theme.income);
    setMaterialColor(this.mats.expense, this.theme.expense);
    this.lineMat.color.copy(this.theme.line);
    this.axisMat.color.copy(this.theme.axis);
    this.floorMat.color.copy(this.theme.floor);
    this.invalidate();
  }

  /** 강조 상태에 맞춰 막대 재질을 정한다. 선택한 막대가 있으면 나머지는 흐리게 한다. */
  private paint(): void {
    for (const b of this.bars) {
      const m = this.mats[b.type];
      if (b === this.selected || b === this.hovered) b.mesh.material = m.hot;
      else b.mesh.material = this.selected ? m.dim : m.base;
      b.mesh.castShadow = !this.selected || b === this.selected;
    }
    this.invalidate();
  }

  /* ---------- 그리기 ---------- */

  private startAnimation(): void {
    if (this.reducedMotion.matches) {
      for (const b of this.bars) b.mesh.scale.y = b.from = b.to;
    }
    this.animStart = performance.now();
    this.invalidate();
  }

  /** 막대 높이 보간. 아직 움직이는 막대가 있으면 true */
  private stepAnimation(now: number): boolean {
    const t = Math.min((now - this.animStart) / ANIM_MS, 1);
    let moving = false;
    for (const b of this.bars) {
      if (b.mesh.scale.y === b.to) continue;
      // 열 순서대로 조금씩 늦게 자라게 해서 물결처럼 보이게 한다.
      const delay = this.grid ? (b.cell.col / Math.max(this.grid.columns.length, 1)) * 0.35 : 0;
      const local = Math.min(Math.max((t * 1.35 - delay) / 1, 0), 1);
      b.mesh.scale.y = local >= 1 ? b.to : b.from + (b.to - b.from) * easeOutCubic(local);
      if (b.mesh.scale.y !== b.to) moving = true;
    }
    return moving;
  }

  private invalidate(): void {
    if (this.frame === 0) this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number): void {
    this.frame = 0;
    const moving = this.stepAnimation(now);
    this.controls.update(); // 감속 중이면 change 이벤트로 다음 프레임을 요청한다.
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    if (moving) this.invalidate();
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w === 0 || h === 0) return;
    // 처음 크기가 정해질 때, 또는 화면 방향이 바뀌어 세로/가로가 뒤집힐 때 시점을 다시 잡는다.
    const portrait = (a: number): boolean => a < PORTRAIT;
    const refit = this.grid !== null && (this.camera.aspect === 1 || portrait(this.camera.aspect) !== portrait(w / h));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    if (refit) this.fitCamera();
    this.invalidate();
  }

  /* ---------- 포인터 ---------- */

  private hit(clientX: number, clientY: number): Bar | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.bars.map((b) => b.mesh),
      false,
    );
    if (hits.length === 0) return null;
    return this.bars[hits[0].object.userData.index as number] ?? null;
  }

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || e.buttons !== 0) return;
      const bar = this.hit(e.clientX, e.clientY);
      el.style.cursor = bar ? 'pointer' : '';
      if (bar !== this.hovered) {
        this.hovered = bar;
        this.paint();
      }
      this.events.onHover(bar?.cell ?? null, e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', () => {
      if (this.hovered) {
        this.hovered = null;
        this.paint();
      }
      this.events.onHover(null, 0, 0);
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.downAt;
      this.downAt = null;
      // 끌어서 돌린 경우는 누름으로 치지 않는다.
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      const bar = this.hit(e.clientX, e.clientY);
      this.selected = bar && bar !== this.selected ? bar : null;
      this.paint();
      this.events.onPick(this.selected?.cell ?? null);
    });
  }
}
