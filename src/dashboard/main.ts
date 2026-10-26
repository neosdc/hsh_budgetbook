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
  topExpenseLane,
  windowRange,
  type Cell,
  type DashMode,
  type Grid,
  type HeightScale,
} from '../util/dashboard';
import { fullDateLabel, monthLabel, shiftMonth, todayStr } from '../util/dates';
import { esc, won } from '../util/format';
import type { LedgerScene } from './scene';

const PREF_KEY = 'hsh-dash-prefs';

interface Prefs {
  mode: DashMode;
  scale: HeightScale;
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Prefs>;
    return { mode: p.mode === 'months' ? 'months' : 'days', scale: p.scale === 'sqrt' ? 'sqrt' : 'linear' };
  } catch {
    return { mode: 'days', scale: 'linear' };
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

class Dashboard {
  private prefs = loadPrefs();
  private anchor = todayStr().slice(0, 7);
  private categories: Category[] | null = null;
  private cache = new Map<string, Tx[]>();
  private grid: Grid | null = null;
  private scene: LedgerScene | null = null;
  private request = 0;
  private readonly tip = $('stage-tip');

  async start(): Promise<void> {
    this.bind();
    this.syncControls();
    try {
      // three.js는 크기가 커서 대시보드 데이터와 나란히 따로 불러온다.
      const { LedgerScene } = await import('./scene');
      this.scene = new LedgerScene($('stage'), {
        onHover: (cell, x, y) => this.showTip(cell, x, y),
        onPick: (cell) => this.showPick(cell),
      });
    } catch {
      this.stageMessage('이 브라우저에서는 3D 화면을 그릴 수 없습니다(WebGL 미지원). 아래 표에서 금액을 확인할 수 있습니다.');
      $<HTMLDetailsElement>('table-view').open = true;
    }
    await this.load();
  }

  stop(): void {
    this.cache.clear();
    this.categories = null;
  }

  private async load(): Promise<void> {
    const id = ++this.request;
    const anchor = this.anchor;
    $('stage').classList.add('loading');
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
      if (id === this.request) $('stage').classList.remove('loading');
    }
  }

  private render(windowRows: readonly Tx[]): void {
    const mode = this.prefs.mode;
    const columns = mode === 'days' ? dayColumns(this.anchor) : monthColumns(this.anchor);
    const rows = mode === 'days' ? windowRows.filter((t) => t.occurred_on.startsWith(this.anchor)) : windowRows;
    const lanes = buildLanes(this.categories ?? [], rows);
    const grid = buildGrid(mode, rows, columns, lanes);
    this.grid = grid;

    this.renderStats(grid);
    this.renderTable(grid);
    this.showPick(null);
    this.scene?.setGrid(grid, this.prefs.scale);
    if (this.scene) {
      if (grid.cells.length === 0) this.stageMessage(mode === 'days' ? '이 달에는 기록된 내역이 없습니다.' : '이 기간에는 기록된 내역이 없습니다.');
      else $('stage-msg').hidden = true;
    }
  }

  private renderStats(grid: Grid): void {
    const balance = grid.income - grid.expense;
    const top = topExpenseLane(grid);
    $('dash-stats').innerHTML =
      `<div class="sum-item"><div class="sum-label">수입</div><div class="sum-value" style="color:var(--income)">${won(grid.income)}<span class="unit">원</span></div></div>` +
      `<div class="sum-item"><div class="sum-label">지출</div><div class="sum-value" style="color:var(--expense)">${won(grid.expense)}<span class="unit">원</span></div></div>` +
      `<div class="sum-item"><div class="sum-label">잔액</div><div class="sum-value${balance < 0 ? ' neg' : ''}">${signed(balance)}<span class="unit">원</span></div></div>` +
      `<div class="sum-item"><div class="sum-label">가장 큰 지출 분류</div><div class="sum-value top-cat">${
        top ? `${esc(top.category)}<span class="top-amt">${won(top.total)}원</span>` : '<span class="top-amt">없음</span>'
      }</div></div>`;
  }

  private renderTable(grid: Grid): void {
    $('table-col-head').textContent = grid.mode === 'days' ? '날짜' : '달';
    const body = $('table-rows');
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

  /* ---------- 막대 정보 ---------- */

  private showTip(cell: Cell | null, clientX: number, clientY: number): void {
    const grid = this.grid;
    if (!cell || !grid) {
      this.tip.hidden = true;
      return;
    }
    const lane = grid.lanes[cell.lane];
    this.tip.innerHTML =
      `<strong>${esc(cellPeriod(grid, cell))}</strong>` +
      `<span class="tip-row ${lane.type}">${esc(lane.category)} · ${lane.type === 'income' ? '수입' : '지출'}</span>` +
      `<span class="tip-amt">${won(cell.total)}원${cell.rows.length > 1 ? ` <span class="tip-n">(${cell.rows.length}건)</span>` : ''}</span>`;
    this.tip.hidden = false;
    const box = $('stage').getBoundingClientRect();
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    let x = clientX - box.left + 14;
    let y = clientY - box.top + 14;
    if (x + tw > box.width - 8) x = clientX - box.left - tw - 14;
    if (y + th > box.height - 8) y = clientY - box.top - th - 14;
    this.tip.style.left = `${Math.max(8, x)}px`;
    this.tip.style.top = `${Math.max(8, y)}px`;
  }

  private showPick(cell: Cell | null): void {
    const panel = $('pick');
    const grid = this.grid;
    if (!cell || !grid) {
      panel.hidden = true;
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
    panel.hidden = false;
  }

  private stageMessage(text: string): void {
    const msg = $('stage-msg');
    msg.textContent = text;
    msg.hidden = false;
  }

  /* ---------- 조작 ---------- */

  private syncControls(): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.prefs.mode));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scale]')) {
      b.setAttribute('aria-pressed', String(b.dataset.scale === this.prefs.scale));
    }
    const label =
      this.prefs.mode === 'days' ? monthLabel(this.anchor) : `${monthLabel(shiftMonth(this.anchor, -11))} – ${monthLabel(this.anchor)}`;
    $('period-label').textContent = label;
    $('scale-note').hidden = this.prefs.scale !== 'sqrt';
  }

  private bind(): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      b.addEventListener('click', () => {
        const mode = b.dataset.mode as DashMode;
        if (mode === this.prefs.mode) return;
        this.prefs.mode = mode;
        savePrefs(this.prefs);
        this.syncControls();
        void this.load();
      });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scale]')) {
      b.addEventListener('click', () => {
        const scale = b.dataset.scale as HeightScale;
        if (scale === this.prefs.scale) return;
        this.prefs.scale = scale;
        savePrefs(this.prefs);
        this.syncControls();
        this.scene?.setScale(scale);
      });
    }
    const move = (delta: number): void => {
      this.anchor = shiftMonth(this.anchor, delta);
      this.syncControls();
      void this.load();
    };
    $('prev-btn').addEventListener('click', () => move(-1));
    $('next-btn').addEventListener('click', () => move(1));
    $('reset-view').addEventListener('click', () => this.scene?.resetView());
    $('pick-close').addEventListener('click', () => {
      this.scene?.clearSelection(false);
      this.showPick(null);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('pick').hidden) {
        this.scene?.clearSelection(false);
        this.showPick(null);
      }
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
