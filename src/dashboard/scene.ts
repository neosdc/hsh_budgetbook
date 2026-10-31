import { heightRatio, heightTicks, tickLabel, type Cell, type Grid, type HeightScale } from '../util/dashboard';

/*
 * 분류별 막대 그래프(2D, SVG). 가로축 = 분류(수입 분류 다음 지출 분류), 세로축 = 금액.
 * 한 달이면 그 달 합계, 12개월이면 12개월 합계가 분류마다 막대 하나로 나온다.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = { top: 22, right: 12, left: 52 };
const GROUP_GAP = 14; // 수입 묶음과 지출 묶음 사이 간격(px)
const BAR_FILL = 0.66; // 칸 폭 중 막대가 차지하는 비율
const MAX_BAR_W = 64;
const CHAR_W = 12; // 분류 이름 글자 하나의 대략적인 폭(px)

export interface SceneEvents {
  /** 막대 위에 포인터가 올라가거나(cell) 벗어남(null). 터치에서는 오지 않는다. */
  onHover(cell: Cell | null, clientX: number, clientY: number): void;
  /** 막대를 누름(cell) 또는 같은 막대를 다시 눌러 해제함(null) */
  onPick(cell: Cell | null): void;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, className?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (className) node.setAttribute('class', className);
  return node;
}

export class LedgerScene {
  private readonly svg = el('svg', { role: 'img', 'aria-label': '분류별 막대 그래프' }, 'bar2d');
  private grid: Grid | null = null;
  private scale: HeightScale = 'linear';
  private bars: { cell: Cell; node: SVGGElement }[] = [];
  private hovered: number | null = null;
  private selected: number | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: SceneEvents,
  ) {
    host.classList.add('flat');
    host.appendChild(this.svg);
    new ResizeObserver(() => this.draw()).observe(host);
  }

  /* ---------- 공개 API ---------- */

  setGrid(grid: Grid, scale: HeightScale): void {
    this.grid = grid;
    this.scale = scale;
    this.selected = null;
    this.hovered = null;
    this.draw();
  }

  setScale(scale: HeightScale): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.draw();
  }

  /** 선택을 해제한다(목록 패널을 닫을 때). */
  clearSelection(notify = true): void {
    if (this.selected === null) return;
    this.selected = null;
    this.paint();
    if (notify) this.events.onPick(null);
  }

  /* ---------- 그리기 ---------- */

  private draw(): void {
    const grid = this.grid;
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    if (!grid || W === 0 || H === 0) return;
    this.svg.replaceChildren();
    this.bars = [];
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const n = grid.lanes.length;
    const firstExpense = grid.lanes.findIndex((l) => l.type === 'expense');
    const gap = firstExpense > 0 ? GROUP_GAP : 0;
    const plotW = W - MARGIN.left - MARGIN.right - gap;
    const slot = n > 0 ? plotW / n : plotW;
    const longest = grid.lanes.reduce((m, l) => Math.max(m, l.category.length), 0);
    const rotated = slot < longest * CHAR_W + 6;
    const bottom = rotated ? Math.min(longest, 8) * CHAR_W + 22 : 30;
    const plotH = Math.max(H - MARGIN.top - bottom, 40);
    const baseY = MARGIN.top + plotH;
    const xOf = (lane: number): number => MARGIN.left + lane * slot + (firstExpense > 0 && lane >= firstExpense ? gap : 0);
    const yOf = (v: number): number => baseY - heightRatio(v, grid.max, this.scale) * plotH;

    // 금액 눈금과 가로 격자선
    for (const v of heightTicks(grid.max, this.scale)) {
      const y = yOf(v);
      this.svg.appendChild(el('line', { x1: MARGIN.left, x2: W - MARGIN.right, y1: y, y2: y }, 'g-line'));
      const t = el('text', { x: MARGIN.left - 6, y, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, 'g-tick');
      t.textContent = tickLabel(v);
      this.svg.appendChild(t);
    }
    this.svg.appendChild(el('line', { x1: MARGIN.left, x2: W - MARGIN.right, y1: baseY, y2: baseY }, 'g-axis'));

    // 분류 이름
    grid.lanes.forEach((lane, i) => {
      const cx = xOf(i) + slot / 2;
      // 칸이 좁으면 위에서 아래로 세워 쓴다.
      const t = rotated
        ? el('text', { transform: `translate(${cx} ${baseY + 8}) rotate(90)`, 'text-anchor': 'start', 'dominant-baseline': 'middle' }, `g-cat ${lane.type}`)
        : el('text', { x: cx, y: baseY + 8, 'text-anchor': 'middle', 'dominant-baseline': 'hanging' }, `g-cat ${lane.type}`);
      t.textContent = lane.category;
      this.svg.appendChild(t);
    });

    // 막대
    const barW = Math.min(slot * BAR_FILL, MAX_BAR_W);
    grid.cells.forEach((cell, index) => {
      const lane = grid.lanes[cell.lane];
      const cx = xOf(cell.lane) + slot / 2;
      const top = Math.min(yOf(cell.total), baseY - 2);
      const g = el('g', {}, `g-bar ${lane.type}`);
      g.appendChild(el('rect', { x: xOf(cell.lane), y: MARGIN.top, width: slot, height: plotH }, 'g-hit'));
      g.appendChild(el('rect', { x: cx - barW / 2, y: top, width: barW, height: baseY - top, rx: 2 }, 'g-fill'));
      if (slot >= 38) {
        const v = el('text', { x: cx, y: top - 4, 'text-anchor': 'middle' }, 'g-val');
        v.textContent = tickLabel(cell.total);
        g.appendChild(v);
      }
      g.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        if (this.hovered !== index) {
          this.hovered = index;
          this.paint();
        }
        this.events.onHover(cell, e.clientX, e.clientY);
      });
      g.addEventListener('pointerleave', () => {
        if (this.hovered === index) {
          this.hovered = null;
          this.paint();
        }
        this.events.onHover(null, 0, 0);
      });
      g.addEventListener('click', () => {
        this.selected = this.selected === index ? null : index;
        this.paint();
        this.events.onPick(this.selected === null ? null : cell);
      });
      this.svg.appendChild(g);
      this.bars.push({ cell, node: g });
    });
    this.paint();
  }

  /** 강조 상태에 맞춰 막대 모양을 정한다. 선택한 막대가 있으면 나머지는 흐리게 한다. */
  private paint(): void {
    this.bars.forEach((b, i) => {
      b.node.classList.toggle('hot', i === this.hovered || i === this.selected);
      b.node.classList.toggle('dim', this.selected !== null && i !== this.selected);
    });
  }
}
