import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { HeightScale } from '../../util/dashboard';
import { esc, won } from '../../util/format';
import { percentLabel, PLACES, type Place, type PlaceGroup } from '../../util/places';
import { buildHouseModel, mx, mz, type HouseModel } from './model';

/*
 * "우리 집" 보기: 집 모형 위 일곱 자리에 지출 막대를 세운다.
 * 자리마다 분류별 막대를 금액이 큰 순서로 늘어놓고, 그 위에 자리 이름·합계·비율·분류 금액 카드를 띄운다.
 * 막대와 카드는 house 그룹 안(평면 좌표)에 있어 모형의 좌우 반전을 그대로 따른다.
 */

/** 막대를 세울 바닥 자리(평면 픽셀), 늘어놓는 방향, 한 줄에 놓을 막대 수. 가구 예시를 피해 빈 바닥을 골랐다. */
const SPOTS: Record<Place, { at: [number, number]; axis: 'x' | 'y'; cap: number }> = {
  거실: { at: [163, 452], axis: 'x', cap: 4 },
  부엌: { at: [157, 300], axis: 'y', cap: 4 },
  서재: { at: [224, 298], axis: 'x', cap: 4 },
  안방: { at: [226, 410], axis: 'y', cap: 3 },
  윤지방: { at: [80, 445], axis: 'y', cap: 3 },
  드레스룸: { at: [270, 365], axis: 'y', cap: 3 }, // 화장대와 욕실2 벽 사이
  현관: { at: [55, 370], axis: 'y', cap: 3 }, // 신발장과 덕트 사이
};

const STEP = 0.5; // 막대 간격(m)
const BAR_W = 0.32;
const H_MAX = 1.9; // 가장 큰 막대 높이(m). 천장은 2.3m
const MIN_H = 0.03;
const ANIM_MS = 900;
// 처음 시점: 남동쪽 위에서 거의 내려다보아 방들이 화면에 넓게 펼쳐지게 한다.
const HOME = new THREE.Vector3(4.6, 15.8, 10.3);
const HOME_TARGET = new THREE.Vector3(0.2, 0, 0.2);

interface Bar {
  key: string;
  place: Place;
  mesh: THREE.Mesh;
  from: { x: number; z: number; h: number };
  to: { x: number; z: number; h: number };
  t0: number;
  delay: number;
  dying: boolean;
}

/** 카드에 쓰는 짧은 금액: 205만, 4.4만, 6,600원 */
function shortWon(n: number): string {
  if (n >= 100_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`;
  if (n >= 10_000) return `${Math.round(n / 1_000) / 10}만`;
  return `${won(n)}원`;
}

function cssColor(name: string, fallback: string): THREE.Color {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
}

/** 오늘 날짜 14시의 해 방향(부천, 북위 37.5°·동경 126.78°). 월드 좌표의 단위 벡터 */
function afternoonSun(): THREE.Vector3 {
  const D2R = Math.PI / 180;
  const today = new Date();
  const doy = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 864e5);
  const decl = 23.44 * D2R * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const b = (2 * Math.PI * (doy - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const lat = 37.5 * D2R;
  const ha = (14 + (126.78 - 135) / 15 + eot / 60 - 12) * 15 * D2R;
  const e = -Math.cos(decl) * Math.sin(ha);
  const n = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(ha);
  const u = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  return new THREE.Vector3(e, Math.max(u, 0.15), -n).normalize();
}

export interface HouseEvents {
  /** 막대 위에 포인터가 올라가거나(group) 벗어남(null). 터치에서는 오지 않는다. */
  onHover(group: PlaceGroup | null, clientX: number, clientY: number): void;
  /** 자리 카드나 막대를 누름(자리), 빈 곳을 누름(null) */
  onPick(place: Place | null, category: string | null): void;
}

export class HouseScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 300);
  private readonly controls: OrbitControls;
  private readonly model: HouseModel;
  private readonly expGroup = new THREE.Group();
  private readonly barGeo = new THREE.BoxGeometry(BAR_W, 1, BAR_W).translate(0, 0.5, 0);
  private readonly barMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 });
  private readonly barDim = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false });
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  private readonly bars = new Map<string, Bar>();
  private readonly cards = new Map<Place, CSS2DObject>();
  private groups = new Map<Place, PlaceGroup[]>();
  private total = 0;
  private scale: HeightScale = 'linear';
  private max = 1;
  private selected: { place: Place; category: string | null } | null = null;
  private hovered: string | null = null;
  private frame = 0;
  private downAt: { x: number; y: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: HouseEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'stage-canvas';
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'stage-labels';
    host.appendChild(this.labels.domElement);

    const env = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.model = buildHouseModel(env, this.renderer.capabilities.getMaxAnisotropy());
    this.model.setCutaway(true);
    this.model.house.add(this.expGroup);
    this.scene.add(this.model.house);
    this.buildSurroundings();

    const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x8a7f70, 1.5);
    const sun = new THREE.DirectionalLight(0xfff3e0, 5.2);
    sun.position.copy(afternoonSun()).multiplyScalar(40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 80 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(hemi, sun, sun.target);

    for (const p of PLACES) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'room-card';
      el.addEventListener('click', () => this.pick(p, null));
      const obj = new CSS2DObject(el);
      obj.center.set(0.5, 1); // 카드 아래 가운데를 기준점에 맞춘다
      const [x, y] = SPOTS[p].at;
      obj.position.set(mx(x), 0.3, mz(y));
      this.expGroup.add(obj);
      this.cards.set(p, obj);
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 48;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.invalidate());

    this.applyTheme();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(host);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    this.resize();
    this.resetView();
  }

  /* ---------- 공개 API ---------- */

  /** 자리 × 분류 묶음과 기간 지출 합계로 막대와 카드를 다시 그린다. */
  setData(groups: Map<Place, PlaceGroup[]>, total: number, scale: HeightScale): void {
    this.groups = groups;
    this.total = total;
    this.scale = scale;
    this.selected = null;
    this.layout(true);
    this.renderCards();
    this.paint();
  }

  setScale(scale: HeightScale): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.layout(false);
  }

  setCutaway(cut: boolean): void {
    this.model.setCutaway(cut);
    this.invalidate();
  }

  setFurniture(visible: boolean): void {
    this.model.setFurniture(visible);
    this.invalidate();
  }

  resetView(): void {
    this.camera.position.copy(HOME);
    this.controls.target.copy(HOME_TARGET);
    this.controls.update();
    this.invalidate();
  }

  /** 선택(강조)을 바꾼다. 목록 패널을 닫을 때는 null */
  select(place: Place | null, category: string | null = null): void {
    this.selected = place ? { place, category } : null;
    this.paint();
  }

  /* ---------- 막대 ---------- */

  private heightOf(v: number): number {
    if (v <= 0) return 0;
    const r = Math.min(v / this.max, 1);
    return Math.max(H_MAX * (this.scale === 'sqrt' ? Math.sqrt(r) : r), MIN_H);
  }

  private slot(p: Place, i: number, n: number): { x: number; z: number } {
    const { at, axis, cap } = SPOTS[p];
    const rows = Math.ceil(n / cap);
    const row = Math.floor(i / cap);
    const col = i % cap;
    const inRow = Math.min(cap, n - row * cap);
    const along = (col - (inRow - 1) / 2) * STEP;
    const across = (row - (rows - 1) / 2) * STEP;
    return axis === 'x' ? { x: mx(at[0]) + along, z: mz(at[1]) + across } : { x: mx(at[0]) + across, z: mz(at[1]) + along };
  }

  /** 새 묶음에 맞춰 막대를 만들거나 옮기고, 없어진 묶음의 막대는 줄여서 없앤다. */
  private layout(initial: boolean): void {
    const all = [...this.groups.values()].flat();
    this.max = Math.max(1, ...all.map((g) => g.total));
    const now = performance.now();
    const live = new Set<string>();
    PLACES.forEach((p, pi) => {
      const list = this.groups.get(p) ?? [];
      list.forEach((g, i) => {
        const key = `${p}|${g.category}`;
        const pos = this.slot(p, i, list.length);
        live.add(key);
        let bar = this.bars.get(key);
        if (!bar) {
          const mesh = new THREE.Mesh(this.barGeo, this.barMat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.scale.y = 0.0001;
          mesh.position.set(pos.x, 0, pos.z);
          mesh.userData.key = key;
          this.expGroup.add(mesh);
          bar = { key, place: p, mesh, from: { ...pos, h: 0 }, to: { ...pos, h: 0 }, t0: now, delay: 0, dying: false };
          this.bars.set(key, bar);
        }
        const m = bar.mesh;
        bar.from = { x: m.position.x, z: m.position.z, h: m.scale.y };
        bar.to = { ...pos, h: this.heightOf(g.total) };
        bar.dying = false;
        bar.t0 = now;
        bar.delay = initial ? pi * 90 + i * 60 : 0; // 처음에는 자리마다 조금씩 늦게 자란다
      });
    });
    for (const bar of this.bars.values()) {
      if (live.has(bar.key) || bar.dying) continue;
      bar.dying = true;
      bar.from = { x: bar.mesh.position.x, z: bar.mesh.position.z, h: bar.mesh.scale.y };
      bar.to = { ...bar.from, h: 0 };
      bar.t0 = now;
      bar.delay = 0;
    }
    if (this.reducedMotion.matches) {
      for (const bar of this.bars.values()) bar.delay = -ANIM_MS;
    }
    this.invalidate();
  }

  /** 막대 높이·위치 보간. 아직 움직이는 막대가 있으면 true */
  private step(now: number): boolean {
    let moving = false;
    for (const bar of [...this.bars.values()]) {
      const t = Math.min(Math.max((now - bar.t0 - bar.delay) / ANIM_MS, 0), 1);
      const e = 1 - (1 - t) ** 3;
      bar.mesh.scale.y = Math.max(bar.from.h + (bar.to.h - bar.from.h) * e, 0.0001);
      bar.mesh.position.set(bar.from.x + (bar.to.x - bar.from.x) * e, 0, bar.from.z + (bar.to.z - bar.from.z) * e);
      if (t < 1) moving = true;
      else if (bar.dying) {
        this.expGroup.remove(bar.mesh);
        this.bars.delete(bar.key);
      }
    }
    // 카드는 그 자리에서 가장 높은 막대 바로 위에 띄운다.
    const top = new Map<Place, number>();
    for (const bar of this.bars.values()) top.set(bar.place, Math.max(top.get(bar.place) ?? 0, bar.mesh.scale.y));
    for (const [p, card] of this.cards) card.position.y = (top.get(p) ?? 0) + 0.22;
    return moving;
  }

  private renderCards(): void {
    for (const p of PLACES) {
      const list = this.groups.get(p) ?? [];
      const sum = list.reduce((a, g) => a + g.total, 0);
      const pct = percentLabel(sum, this.total);
      // 분류 목록은 막대와 같은 순서(큰 금액부터)로 세 개까지 적는다. 카드끼리 덜 겹치도록 평소에는 숨기고,
      // 카드에 마우스를 올리거나 자리를 고르면 보인다(dashboard.css). 좁은 화면에서는 짧은 금액 한 줄만 보인다.
      const rows =
        list
          .slice(0, 3)
          .map((g) => `<span class="rc-row"><span>${esc(g.category)}</span><span>${shortWon(g.total)}</span></span>`)
          .join('') + (list.length > 3 ? `<span class="rc-row more"><span>외 ${list.length - 3}개 분류</span><span></span></span>` : '');
      const el = this.cards.get(p)!.element as HTMLButtonElement;
      el.innerHTML =
        `<span class="rc-name">${p}</span><span class="rc-amt${sum ? '' : ' zero'}">${won(sum)}원</span>` +
        `<span class="rc-short${sum ? '' : ' zero'}">${sum ? shortWon(sum) : '0원'} · ${pct}</span>` +
        `<span class="rc-pct">${pct}</span>${rows ? `<span class="rc-list">${rows}</span>` : ''}`;
      el.setAttribute('aria-label', `${p} 지출 ${won(sum)}원, 전체 지출의 ${pct}. 누르면 내역`);
    }
  }

  /** 선택한 자리(분류)의 막대만 진하게, 나머지는 흐리게 */
  private paint(): void {
    const sel = this.selected;
    for (const bar of this.bars.values()) {
      const lit = !sel || (bar.place === sel.place && (!sel.category || bar.key === `${sel.place}|${sel.category}`));
      bar.mesh.material = lit ? this.barMat : this.barDim;
      bar.mesh.castShadow = lit;
    }
    for (const [p, card] of this.cards) card.element.classList.toggle('on', sel?.place === p);
    this.invalidate();
  }

  private pick(place: Place | null, category: string | null): void {
    this.select(place, category);
    this.events.onPick(place, category);
  }

  /* ---------- 장면 ---------- */

  /** 잔디 바닥과 나무(그림자로 해 방향을 느끼게 한다) */
  private buildSurroundings(): void {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: 0x7f9a6e, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.26;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.85 });
    const leaves = [0x58784a, 0x6f8e57, 0x46663f].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }));
    let seed = 84;
    const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [x, z, s] of [[-5.6, 7.6, 0.85], [3.6, 9.0, 0.8], [-9.5, 3.5, 1.0], [10, 6.5, 0.95], [9.6, -4.5, 0.9], [-8.6, -7.0, 1.0], [2.5, -9.5, 0.85], [-2.5, 11.5, 0.9]]) {
      const tree = new THREE.Group();
      tree.position.set(x, -0.25, z);
      tree.scale.setScalar(s);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 2.6, 8), trunk);
      t.position.y = 1.3;
      t.castShadow = true;
      tree.add(t);
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0 + rand() * 0.4, 0), leaves[i % 3]);
        c.position.set((rand() - 0.5) * 1.2, 3.0 + rand() * 1.3, (rand() - 0.5) * 1.2);
        c.castShadow = true;
        tree.add(c);
      }
      this.scene.add(tree);
    }
  }

  private applyTheme(): void {
    // 햇빛과 톤 매핑이 색을 밝게 띄우므로, 화면에서 앱의 지출 색에 가깝게 보이도록 재질 색을 조금 어둡게 둔다.
    const c = cssColor('--c-expense', '#b43a28').multiplyScalar(0.62);
    this.barMat.color.copy(c);
    this.barDim.color.copy(c);
    // 먼 바닥이 무대 배경색으로 스며들게 한다.
    this.scene.fog = new THREE.Fog(cssColor('--surface-2', '#eaf0ed'), 34, 75);
    this.invalidate();
  }

  private invalidate(): void {
    if (this.frame === 0) this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number): void {
    this.frame = 0;
    const moving = this.step(now);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    if (moving) this.invalidate();
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    // 세로로 긴 화면에서는 시야각을 넓혀 집 전체가 들어오게 한다.
    this.camera.fov = this.camera.aspect >= 1.15 ? 40 : Math.min(66, ((40 * 1.15) / this.camera.aspect) * 0.8);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.invalidate();
  }

  /* ---------- 포인터 ---------- */

  private barAt(clientX: number, clientY: number): Bar | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.bars.values()].filter((b) => !b.dying).map((b) => b.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? (this.bars.get(hit.object.userData.key as string) ?? null) : null;
  }

  private groupOf(bar: Bar): PlaceGroup | null {
    return (this.groups.get(bar.place) ?? []).find((g) => `${bar.place}|${g.category}` === bar.key) ?? null;
  }

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || e.buttons !== 0) return;
      const bar = this.barAt(e.clientX, e.clientY);
      el.style.cursor = bar ? 'pointer' : '';
      this.hovered = bar?.key ?? null;
      this.events.onHover(bar ? this.groupOf(bar) : null, e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', () => {
      if (this.hovered) this.hovered = null;
      this.events.onHover(null, 0, 0);
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.downAt;
      this.downAt = null;
      // 끌어서 돌린 경우는 누름으로 치지 않는다.
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      const bar = this.barAt(e.clientX, e.clientY);
      if (bar) {
        const g = this.groupOf(bar);
        this.pick(bar.place, g?.category ?? null);
      } else if (this.selected) {
        this.pick(null, null);
      }
    });
  }
}
