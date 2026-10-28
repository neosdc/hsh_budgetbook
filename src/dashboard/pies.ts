import { esc, won } from '../util/format';
import { percentLabel } from '../util/places';
import { donutArcs, type Slice } from '../util/pies';

/*
 * 원형(도넛) 그래프 하나: 조각, 가운데 합계, 옆 범례(이름·금액·비율).
 * 조각이나 범례에 마우스를 올리거나 키보드로 고르면 그 조각만 진하게 하고 가운데에 그 금액을 보여 준다.
 * 누르면 onPick으로 알려 대시보드가 내역 목록을 연다.
 * 색은 dashboard.css의 --pie-1..5, --pie-rest 토큰을 쓴다. 범례에 이름과 금액이 함께 있어 색만으로 구분하지 않는다.
 */

const SIZE = 200;
const R_OUT = 92;
const R_IN = 60;

export interface PieOptions {
  /** 조각의 색 번호(1~5). rest 조각은 회색이라 쓰지 않는다. */
  color(slice: Slice, index: number): number;
  onPick(slice: Slice | null): void;
}

export class PieChart {
  private slices: Slice[] = [];
  private total = 0;
  private hot: number | null = null;
  private picked: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly label: string,
    private readonly opts: PieOptions,
  ) {
    root.addEventListener('pointerover', (e) => this.hoverFrom(e.target));
    root.addEventListener('pointerleave', () => this.setHot(null));
    root.addEventListener('focusin', (e) => this.hoverFrom(e.target));
    root.addEventListener('focusout', () => this.setHot(null));
    root.addEventListener('click', (e) => {
      const i = this.indexOf(e.target);
      if (i === null) return;
      this.picked = this.picked === i ? null : i;
      this.paint();
      this.opts.onPick(this.picked === null ? null : this.slices[this.picked]);
    });
  }

  render(slices: Slice[], total: number): void {
    this.slices = slices;
    this.total = total;
    this.hot = null;
    this.picked = null;
    if (slices.length === 0) {
      this.root.innerHTML = '<p class="pie-empty">이 기간에는 지출이 없습니다.</p>';
      return;
    }
    const arcs = donutArcs(
      slices.map((s) => s.total),
      SIZE / 2,
      SIZE / 2,
      R_OUT,
      R_IN,
    );
    const fill = (s: Slice, i: number): string => (s.rest ? 'var(--pie-rest)' : `var(--pie-${this.opts.color(s, i)})`);
    const paths = arcs
      .map(
        (a, i) =>
          `<path class="pie-slice" data-i="${i}" d="${a.d}" fill="${fill(slices[i], i)}" fill-rule="evenodd"><title>${esc(slices[i].key)} ${won(slices[i].total)}원 (${percentLabel(slices[i].total, total)})</title></path>`,
      )
      .join('');
    const legend = slices
      .map(
        (s, i) =>
          `<li><button type="button" class="pie-item" data-i="${i}" aria-pressed="false">` +
          `<span class="pie-sw" style="background:${fill(s, i)}"></span>` +
          `<span class="pie-name">${esc(s.key)}</span>` +
          `<span class="pie-amt">${won(s.total)}원</span><span class="pie-pct">${percentLabel(s.total, total)}</span></button></li>`,
      )
      .join('');
    this.root.innerHTML =
      `<div class="pie-figure"><svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${esc(this.label)}. 조각별 금액은 옆 목록에 있습니다.">${paths}</svg>` +
      `<div class="pie-center" aria-hidden="true"><span class="pie-c-label"></span><span class="pie-c-amt"></span><span class="pie-c-pct"></span></div></div>` +
      `<ul class="pie-legend">${legend}</ul>`;
    this.paint();
  }

  /** 대시보드가 내역 목록을 닫았을 때 선택 표시를 지운다. */
  clearPick(): void {
    if (this.picked === null) return;
    this.picked = null;
    this.paint();
  }

  private indexOf(target: EventTarget | null): number | null {
    const el = (target as Element | null)?.closest?.('[data-i]');
    if (!el || !this.root.contains(el)) return null;
    return Number((el as HTMLElement).dataset.i);
  }

  private hoverFrom(target: EventTarget | null): void {
    this.setHot(this.indexOf(target));
  }

  private setHot(i: number | null): void {
    if (i === this.hot) return;
    this.hot = i;
    this.paint();
  }

  private paint(): void {
    const focus = this.hot ?? this.picked;
    this.root.querySelectorAll<SVGPathElement>('.pie-slice').forEach((p) => {
      const i = Number(p.dataset.i);
      p.classList.toggle('dim', focus !== null && i !== focus);
      p.classList.toggle('on', i === focus);
    });
    this.root.querySelectorAll<HTMLButtonElement>('.pie-item').forEach((b) => {
      const i = Number(b.dataset.i);
      b.classList.toggle('dim', focus !== null && i !== focus);
      b.setAttribute('aria-pressed', String(i === this.picked));
    });
    const c = this.root.querySelector('.pie-center');
    if (!c) return;
    const s = focus === null ? null : this.slices[focus];
    c.querySelector('.pie-c-label')!.textContent = s ? s.key : '지출 합계';
    c.querySelector('.pie-c-amt')!.textContent = `${won(s ? s.total : this.total)}원`;
    c.querySelector('.pie-c-pct')!.textContent = s ? percentLabel(s.total, this.total) : `${this.slices.length}개 항목`;
  }
}
