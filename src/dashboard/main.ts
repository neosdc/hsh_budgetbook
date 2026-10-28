import '../style.css';
import './dashboard.css';
import { fetchCategories, fetchRange } from '../api';
import { $ } from '../dom';
import { describeError } from '../errors';
import { supabase } from '../supabase';
import { DEFAULT_CATEGORIES, type Category, type Tx } from '../types';
import {
  buildGrid,
  buildLanes,
  dayColumns,
  monthColumns,
  windowRange,
  type Cell,
  type DashMode,
  type Grid,
  type HeightScale,
} from '../util/dashboard';
import { fullDateLabel, monthLabel, shiftMonth, todayStr } from '../util/dates';
import { esc, won } from '../util/format';
import { groupByPlace, incomeRatioLabel, percentLabel, PERSONS, PLACES, resolvePlace, type Place, type PlaceGroup } from '../util/places';
import { slicesByCategory, slicesByPerson, type Slice } from '../util/pies';
import type { HouseScene } from './house/scene';
import { PieChart } from './pies';
import type { LedgerScene } from './scene';

const PREF_KEY = 'hsh-dash-prefs';

/** 보기: 집 모형 위 자리별 막대(house) 또는 통계로 보기(grid: 인원별·분류별 원형 그래프와 날짜×분류 3D 막대 그래프) */
type View = 'grid' | 'house';

interface Prefs {
  view: View;
  mode: DashMode;
  scale: HeightScale;
  cutaway: boolean;
  furniture: boolean;
  /** 수입·지출·잔액 요약을 펼쳐 둘지. 다른 사람 앞에서 금액이 바로 보이지 않도록 기본은 접힘 */
  summaryOpen: boolean;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { view: 'house', mode: 'days', scale: 'linear', cutaway: true, furniture: true, summaryOpen: false };
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Prefs>;
    return {
      view: p.view === 'grid' ? 'grid' : 'house',
      mode: p.mode === 'months' ? 'months' : 'days',
      scale: p.scale === 'sqrt' ? 'sqrt' : 'linear',
      cutaway: p.cutaway !== false,
      furniture: p.furniture !== false,
      summaryOpen: p.summaryOpen === true,
    };
  } catch {
    return fallback;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)이면 기억하지 않는다.
  }
}

function signed(n: number): string {
  return `${n < 0 ? '−' : ''}${won(Math.abs(n))}`;
}

/** 칸이 가리키는 기간 이름: 일별이면 '10월 15일 목요일', 월별이면 '2026년 10월' */
function cellPeriod(grid: Grid, cell: Cell): string {
  const key = grid.columns[cell.col].key;
  return grid.mode === 'days' ? fullDateLabel(key).replace(/^\d+년 /, '') : monthLabel(key);
}

/** 내역 하나의 날짜: 한 달 보기면 '15일', 12개월 보기면 '10.15' */
function shortDate(mode: DashMode, date: string): string {
  return mode === 'days' ? `${Number(date.slice(8))}일` : `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;
}

/** 위치·사람 값이 어떻게 자리로 읽혔는지 보여 주는 표시 */
function placeChip(t: Tx): string {
  const r = resolvePlace(t.place);
  if (r.kind === 'empty') return '<span class="chip">미지정 → 거실</span>';
  if (r.kind === 'person') return `<span class="chip">${esc(t.place.trim())} → ${r.place}</span>`;
  if (r.kind === 'unknown') return `<span class="chip warn">알 수 없는 값 “${esc(t.place.trim())}” → 거실</span>`;
  return `<span class="chip">${r.place}</span>`;
}

class Dashboard {
  private prefs = loadPrefs();
  private anchor = todayStr().slice(0, 7);
  private categories: Category[] | null = null;
  private cache = new Map<string, Tx[]>();
  private grid: Grid | null = null;
  private places = new Map<Place, PlaceGroup[]>();
  private scene: LedgerScene | null = null;
  private house: HouseScene | null = null;
  private houseFailed = false;
  private gridFailed = false;
  private request = 0;
  private readonly tip = $('stage-tip');
  // 사람은 달이 바뀌어도 같은 색이 되도록 사람 목록 순서로 색을 정한다.
  private readonly personPie = new PieChart($('pie-person'), '인원별 지출 원형 그래프', {
    color: (s) => PERSONS.indexOf(s.key) + 1,
    onPick: (s) => this.showSlicePick('person', s),
  });
  // 분류는 그 기간의 금액 순위대로 1~5번 색을 쓴다(범례에 이름·금액이 함께 있어 색만으로 읽지 않는다).
  private readonly categoryPie = new PieChart($('pie-category'), '분류별 지출 원형 그래프', {
    color: (_s, i) => i + 1,
    onPick: (s) => this.showSlicePick('category', s),
  });

  async start(): Promise<void> {
    this.bind();
    this.syncControls();
    await Promise.all([this.ensureScene(), this.load()]);
  }

  stop(): void {
    this.cache.clear();
    this.categories = null;
  }

  /** 지금 보기의 3D 장면을 처음 열 때 만든다. three.js는 커서 데이터와 나란히 따로 불러온다. */
  private async ensureScene(): Promise<void> {
    try {
      if (this.prefs.view === 'grid' && !this.scene && !this.gridFailed) {
        const { LedgerScene } = await import('./scene');
        this.scene = new LedgerScene($('stage'), {
          onHover: (cell, x, y) => this.showGridTip(cell, x, y),
          onPick: (cell) => this.showGridPick(cell),
        });
        if (this.grid) this.scene.setGrid(this.grid, this.prefs.scale);
      }
      if (this.prefs.view === 'house' && !this.house && !this.houseFailed) {
        const { HouseScene } = await import('./house/scene');
        this.house = new HouseScene($('house-stage'), {
          onHover: (group, x, y) => this.showHouseTip(group, x, y),
          onPick: (place, category) => this.showHousePick(place, category),
        });
        this.house.setCutaway(this.prefs.cutaway);
        this.house.setFurniture(this.prefs.furniture);
        if (this.grid) this.house.setData(this.places, this.grid.expense, this.prefs.scale);
      }
    } catch {
      if (this.prefs.view === 'grid') this.gridFailed = true;
      else this.houseFailed = true;
      this.stageMessage('이 브라우저에서는 3D 화면을 그릴 수 없습니다(WebGL 미지원). 아래 표에서 금액을 확인할 수 있습니다.');
      $<HTMLDetailsElement>('table-view').open = true;
    }
  }

  private async load(): Promise<void> {
    const id = ++this.request;
    const anchor = this.anchor;
    $('stage-wrap').classList.add('loading');
    try {
      if (!this.categories) {
        try {
          this.categories = await fetchCategories();
        } catch {
          this.categories = (['expense', 'income'] as const).flatMap((type) =>
            DEFAULT_CATEGORIES[type].map((name, sort_order) => ({ id: `${type}-${name}`, type, name, sort_order })),
          );
        }
      }
      let rows = this.cache.get(anchor);
      if (!rows) {
        const [from, to] = windowRange(anchor);
        rows = await fetchRange(from, to);
        this.cache.set(anchor, rows);
      }
      if (id !== this.request) return;
      this.render(rows);
    } catch (e) {
      if (id !== this.request) return;
      this.stageMessage(describeError(e, '불러오기'));
    } finally {
      if (id === this.request) $('stage-wrap').classList.remove('loading');
    }
  }

  private render(windowRows: readonly Tx[]): void {
    const mode = this.prefs.mode;
    const columns = mode === 'days' ? dayColumns(this.anchor) : monthColumns(this.anchor);
    const rows = mode === 'days' ? windowRows.filter((t) => t.occurred_on.startsWith(this.anchor)) : windowRows;
    const lanes = buildLanes(this.categories ?? [], rows);
    const grid = buildGrid(mode, rows, columns, lanes);
    this.grid = grid;
    this.places = groupByPlace(rows);

    this.renderStats();
    this.renderTable();
    this.closePick();
    this.personPie.render(slicesByPerson(rows), grid.expense);
    this.categoryPie.render(slicesByCategory(rows), grid.expense);
    this.scene?.setGrid(grid, this.prefs.scale);
    this.house?.setData(this.places, grid.expense, this.prefs.scale);
    this.updateStageMessage();
  }

  private updateStageMessage(): void {
    const grid = this.grid;
    if (!grid) return;
    if (this.prefs.view === 'grid' ? this.gridFailed : this.houseFailed) return;
    const empty = this.prefs.view === 'grid' ? grid.cells.length === 0 : grid.expense === 0;
    const what = this.prefs.view === 'grid' ? '내역' : '지출';
    if (empty) this.stageMessage(this.prefs.mode === 'days' ? `이 달에는 기록된 ${what}이 없습니다.` : `이 기간에는 기록된 ${what}이 없습니다.`);
    else $('stage-msg').hidden = true;
  }

  /** 지출이 가장 많은 자리. 지출이 없으면 null */
  private topPlace(): { place: Place; total: number } | null {
    let best: { place: Place; total: number } | null = null;
    for (const p of PLACES) {
      const total = (this.places.get(p) ?? []).reduce((a, g) => a + g.total, 0);
      if (total > 0 && (!best || total > best.total)) best = { place: p, total };
    }
    return best;
  }

  private renderStats(): void {
    const grid = this.grid!;
    const balance = grid.income - grid.expense;
    // 우리 집 보기에만 "가장 많이 쓴 곳"을 붙인다. 통계로 보기는 수입·지출·잔액 세 칸.
    let last = '';
    if (this.prefs.view === 'house') {
      const top = this.topPlace();
      last =
        `<div class="sum-item"><div class="sum-label">가장 많이 쓴 곳</div><div class="sum-value top-cat">` +
        (top ? `${top.place}<span class="top-amt">${won(top.total)}원 · ${percentLabel(top.total, grid.expense)}</span>` : '<span class="top-amt">없음</span>') +
        `</div></div>`;
    }
    $('dash-stats').classList.toggle('stats3', !last);
    // 지출과 잔액에는 수입 대비 비율을 붙인다(수입 100만, 지출 70만 → 지출 70.0%, 잔액 30.0%).
    const ratio = (v: number): string => `<span class="sum-ratio">수입 대비 ${incomeRatioLabel(v, grid.income) ?? '— (수입 없음)'}</span>`;
    $('dash-stats').innerHTML =
      `<div class="sum-item"><div class="sum-label">수입</div><div class="sum-value" style="color:var(--income)">${won(grid.income)}<span class="unit">원</span></div></div>` +
      `<div class="sum-item"><div class="sum-label">지출</div><div class="sum-value" style="color:var(--expense)">${won(grid.expense)}<span class="unit">원</span></div>${ratio(grid.expense)}</div>` +
      `<div class="sum-item"><div class="sum-label">잔액</div><div class="sum-value${balance < 0 ? ' neg' : ''}">${signed(balance)}<span class="unit">원</span></div>${ratio(balance)}</div>` +
      last;
  }

  private renderTable(): void {
    const grid = this.grid!;
    const head = $('table-head');
    const body = $('table-rows');
    if (this.prefs.view === 'house') {
      head.innerHTML = '<tr><th scope="col">위치</th><th scope="col">분류</th><th scope="col">건수</th><th scope="col">금액</th><th scope="col">비율</th></tr>';
      const rows = PLACES.flatMap((p) => (this.places.get(p) ?? []).map((g) => ({ p, g })));
      body.innerHTML = rows.length
        ? rows
            .map(
              ({ p, g }) =>
                `<tr><th scope="row">${p}</th><td class="cat-cell">${esc(g.category)}</td><td>${g.rows.length}</td>` +
                `<td class="expense">${won(g.total)}</td><td>${percentLabel(g.total, grid.expense)}</td></tr>`,
            )
            .join('')
        : '<tr><td colspan="5" class="none">지출 내역이 없습니다.</td></tr>';
      return;
    }
    head.innerHTML =
      `<tr><th scope="col">${grid.mode === 'days' ? '날짜' : '달'}</th><th scope="col">구분</th><th scope="col">분류</th>` +
      `<th scope="col">건수</th><th scope="col">금액</th></tr>`;
    if (grid.cells.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="none">내역이 없습니다.</td></tr>';
      return;
    }
    body.innerHTML = grid.cells
      .map((c) => {
        const lane = grid.lanes[c.lane];
        return (
          `<tr><th scope="row">${esc(cellPeriod(grid, c))}</th>` +
          `<td class="kind ${lane.type}">${lane.type === 'income' ? '수입' : '지출'}</td>` +
          `<td class="cat-cell">${esc(lane.category)}</td><td>${c.rows.length}</td>` +
          `<td class="${lane.type}">${won(c.total)}</td></tr>`
        );
      })
      .join('');
  }

  /* ---------- 툴팁과 내역 목록 ---------- */

  private placeTip(html: string, clientX: number, clientY: number): void {
    this.tip.innerHTML = html;
    this.tip.hidden = false;
    const box = $('stage-wrap').getBoundingClientRect();
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    let x = clientX - box.left + 14;
    let y = clientY - box.top + 14;
    if (x + tw > box.width - 8) x = clientX - box.left - tw - 14;
    if (y + th > box.height - 8) y = clientY - box.top - th - 14;
    this.tip.style.left = `${Math.max(8, x)}px`;
    this.tip.style.top = `${Math.max(8, y)}px`;
  }

  private showGridTip(cell: Cell | null, clientX: number, clientY: number): void {
    const grid = this.grid;
    if (!cell || !grid) {
      this.tip.hidden = true;
      return;
    }
    const lane = grid.lanes[cell.lane];
    this.placeTip(
      `<strong>${esc(cellPeriod(grid, cell))}</strong>` +
        `<span class="tip-row ${lane.type}">${esc(lane.category)} · ${lane.type === 'income' ? '수입' : '지출'}</span>` +
        `<span class="tip-amt">${won(cell.total)}원${cell.rows.length > 1 ? ` <span class="tip-n">(${cell.rows.length}건)</span>` : ''}</span>`,
      clientX,
      clientY,
    );
  }

  private showHouseTip(group: PlaceGroup | null, clientX: number, clientY: number): void {
    if (!group || !this.grid) {
      this.tip.hidden = true;
      return;
    }
    this.placeTip(
      `<strong>${group.place}</strong>` +
        `<span class="tip-row expense">${esc(group.category)}</span>` +
        `<span class="tip-amt">${won(group.total)}원 <span class="tip-n">${percentLabel(group.total, this.grid.expense)}${group.rows.length > 1 ? ` · ${group.rows.length}건` : ''}</span></span>`,
      clientX,
      clientY,
    );
  }

  private showGridPick(cell: Cell | null): void {
    const grid = this.grid;
    if (!cell || !grid) {
      $('pick').hidden = true;
      return;
    }
    this.tip.hidden = true;
    const lane = grid.lanes[cell.lane];
    $('pick-title').innerHTML =
      `<span class="lg ${lane.type}"></span>${esc(cellPeriod(grid, cell))} · ${esc(lane.category)}` +
      `<span class="pick-total ${lane.type}">${won(cell.total)}원</span>`;
    $('pick-list').innerHTML = cell.rows
      .map(
        (t) =>
          `<li>${grid.mode === 'days' ? '' : `<span class="pick-date">${Number(t.occurred_on.slice(8))}일</span>`}` +
          `<span class="pick-memo">${t.memo ? esc(t.memo) : '<span class="muted">메모 없음</span>'}</span>` +
          `<span class="amt ${t.type}">${won(t.amount)}원</span></li>`,
      )
      .join('');
    this.personPie.clearPick();
    this.categoryPie.clearPick();
    this.openPick('stage');
  }

  /** 자리를 누르면 그 자리의 분류별 내역을 보여 준다. 막대로 고른 분류가 있으면 그 분류만. */
  private showHousePick(place: Place | null, category: string | null): void {
    const grid = this.grid;
    if (!place || !grid) {
      $('pick').hidden = true;
      return;
    }
    this.tip.hidden = true;
    const all = this.places.get(place) ?? [];
    const groups = category ? all.filter((g) => g.category === category) : all;
    const total = all.reduce((a, g) => a + g.total, 0);
    $('pick-title').innerHTML =
      `<span class="lg expense"></span>${place}${category ? ` · ${esc(category)}` : ''}` +
      `<span class="pick-total expense">${won(category ? (groups[0]?.total ?? 0) : total)}원</span>` +
      `<span class="pick-pct">${percentLabel(category ? (groups[0]?.total ?? 0) : total, grid.expense)}</span>`;
    $('pick-list').innerHTML = groups.length
      ? groups
          .map(
            (g) =>
              `<li class="pick-group"><span class="pick-cat">${esc(g.category)}</span><span class="amt expense">${won(g.total)}원</span></li>` +
              g.rows
                .map(
                  (t) =>
                    `<li><span class="pick-date">${shortDate(grid.mode, t.occurred_on)}</span>` +
                    `<span class="pick-memo">${t.memo ? esc(t.memo) : '<span class="muted">메모 없음</span>'} ${placeChip(t)}</span>` +
                    `<span class="amt expense">${won(t.amount)}원</span></li>`,
                )
                .join(''),
          )
          .join('')
      : '<li><span class="pick-memo muted">이곳으로 정해진 지출이 없습니다. 내역의 "위치·사람"에서 고르면 이 자리에 놓입니다.</span></li>';
    this.personPie.clearPick();
    this.categoryPie.clearPick();
    this.openPick('stage');
  }

  /**
   * 내역 목록을 연다. 목록 상자는 하나를 함께 쓰고, 누른 그래프 바로 아래로 옮겨서
   * 원형 그래프를 누르면 원형 그래프 아래에, 3D 화면을 누르면 3D 화면 아래에 보인다.
   */
  private openPick(after: 'pies' | 'stage'): void {
    const pick = $('pick');
    $(after === 'pies' ? 'pies' : 'stage-card').after(pick);
    pick.hidden = false;
  }

  /** 원형 그래프 조각을 누르면 그 조각의 내역을 보여 준다. */
  private showSlicePick(kind: 'person' | 'category', slice: Slice | null): void {
    const grid = this.grid;
    (kind === 'person' ? this.categoryPie : this.personPie).clearPick();
    this.scene?.clearSelection(false);
    this.house?.select(null);
    if (!slice || !grid) {
      $('pick').hidden = true;
      return;
    }
    this.tip.hidden = true;
    const what = kind === 'person' ? '인원' : '분류';
    const sub = slice.members ? ` <span class="pick-pct">${slice.members.map(esc).join(', ')}</span>` : '';
    $('pick-title').innerHTML =
      `<span class="lg expense"></span>${what} · ${esc(slice.key)}` +
      `<span class="pick-total expense">${won(slice.total)}원</span>` +
      `<span class="pick-pct">${percentLabel(slice.total, grid.expense)} · ${slice.rows.length}건</span>${sub}`;
    $('pick-list').innerHTML = slice.rows
      .map(
        (t) =>
          `<li><span class="pick-date">${shortDate(grid.mode, t.occurred_on)}</span>` +
          `<span class="pick-memo">${t.memo ? esc(t.memo) : '<span class="muted">메모 없음</span>'} ` +
          `<span class="chip">${esc(kind === 'person' ? t.category : t.place.trim() || '미지정')}</span></span>` +
          `<span class="amt expense">${won(t.amount)}원</span></li>`,
      )
      .join('');
    this.openPick('pies');
  }

  private closePick(): void {
    this.scene?.clearSelection(false);
    this.house?.select(null);
    this.personPie.clearPick();
    this.categoryPie.clearPick();
    $('pick').hidden = true;
  }

  private stageMessage(text: string): void {
    const msg = $('stage-msg');
    msg.textContent = text;
    msg.hidden = false;
  }

  /* ---------- 조작 ---------- */

  private syncControls(): void {
    const p = this.prefs;
    const press = (sel: string, on: (b: HTMLButtonElement) => boolean): void => {
      for (const b of document.querySelectorAll<HTMLButtonElement>(sel)) b.setAttribute('aria-pressed', String(on(b)));
    };
    press('[data-view]', (b) => b.dataset.view === p.view);
    press('[data-mode]', (b) => b.dataset.mode === p.mode);
    press('[data-scale]', (b) => b.dataset.scale === p.scale);
    press('[data-wall]', (b) => (b.dataset.wall === 'cut') === p.cutaway);
    $('furn-btn').setAttribute('aria-pressed', String(p.furniture));
    $('sum-toggle').setAttribute('aria-expanded', String(p.summaryOpen));
    $('sum-toggle-state').textContent = p.summaryOpen ? '접기' : '숨김 · 눌러서 보기';
    $('dash-stats').hidden = !p.summaryOpen;
    $('period-label').textContent = p.mode === 'days' ? monthLabel(this.anchor) : `${monthLabel(shiftMonth(this.anchor, -11))} – ${monthLabel(this.anchor)}`;
    $('scale-note').hidden = p.scale !== 'sqrt';
    const house = p.view === 'house';
    $('stage').hidden = house;
    $('pies').hidden = house; // 원형 그래프는 통계로 보기에서만
    $('house-stage').hidden = !house;
    $('house-tools').hidden = !house;
    $('lg-income').hidden = house;
    $('hint-grid').hidden = house;
    $('hint-house').hidden = !house;
    $('stage-card').setAttribute('aria-label', house ? '우리 집 3D 모형 위 자리별 지출 막대' : '날짜와 분류별 3D 막대 그래프');
  }

  private bind(): void {
    const update = (change: Partial<Prefs>): void => {
      Object.assign(this.prefs, change);
      savePrefs(this.prefs);
      this.syncControls();
    };
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      b.addEventListener('click', () => {
        const view = b.dataset.view as View;
        if (view === this.prefs.view) return;
        this.closePick();
        this.tip.hidden = true;
        $('stage-msg').hidden = true;
        update({ view });
        if (this.grid) {
          this.renderStats();
          this.renderTable();
          this.updateStageMessage();
        }
        void this.ensureScene();
      });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      b.addEventListener('click', () => {
        const mode = b.dataset.mode as DashMode;
        if (mode === this.prefs.mode) return;
        update({ mode });
        void this.load();
      });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scale]')) {
      b.addEventListener('click', () => {
        const scale = b.dataset.scale as HeightScale;
        if (scale === this.prefs.scale) return;
        update({ scale });
        this.scene?.setScale(scale);
        this.house?.setScale(scale);
      });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-wall]')) {
      b.addEventListener('click', () => {
        const cutaway = b.dataset.wall === 'cut';
        if (cutaway === this.prefs.cutaway) return;
        update({ cutaway });
        this.house?.setCutaway(cutaway);
      });
    }
    // 접힘 여부는 다른 보기 설정과 함께 이 기기(브라우저)에 저장된다.
    $('sum-toggle').addEventListener('click', () => update({ summaryOpen: !this.prefs.summaryOpen }));
    $('furn-btn').addEventListener('click', () => {
      update({ furniture: !this.prefs.furniture });
      this.house?.setFurniture(this.prefs.furniture);
    });
    const move = (delta: number): void => {
      this.anchor = shiftMonth(this.anchor, delta);
      this.syncControls();
      void this.load();
    };
    $('prev-btn').addEventListener('click', () => move(-1));
    $('next-btn').addEventListener('click', () => move(1));
    $('reset-view').addEventListener('click', () => (this.prefs.view === 'house' ? this.house?.resetView() : this.scene?.resetView()));
    $('pick-close').addEventListener('click', () => this.closePick());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('pick').hidden) this.closePick();
    });
  }
}

function show(view: 'boot' | 'login' | 'app'): void {
  $('boot').hidden = view !== 'boot';
  $('need-login').hidden = view !== 'login';
  $('dash-view').hidden = view !== 'app';
}

async function main(): Promise<void> {
  const dash = new Dashboard();
  // 로그인은 가계부 첫 화면에서 한다. 같은 주소(origin)라 로그인 세션을 그대로 함께 쓴다.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      dash.stop();
      show('login');
    }
  });
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    show('login');
    return;
  }
  show('app');
  await dash.start();
}

main().catch(() => {
  $('boot').textContent = '대시보드를 시작하지 못했습니다. 페이지를 새로 고쳐 주세요.';
});
