import { $ } from '../dom';
import type { Tx } from '../types';
import { won } from '../util/format';
import { compactWon, lastMonths, monthlyTotals, niceMax, type MonthTotal } from '../util/trend';

/*
 * 월별 흐름(2D): 대시보드 "통계로 보기"에 있는 최근 12개월 월별 수입·지출 막대, 월평균 지출, 월별 표.
 * 예전 가계부 "추이" 화면을 옮겨 왔다. 월별 비교는 평면 막대가 정확히 읽혀 2D로 둔다.
 * 표의 달을 누르면 가계부의 그 달 내역 화면(./?month=YYYY-MM)으로 간다.
 */

/** 보여 줄 개월 수 */
export const TREND_MONTHS = 12;

const W = 720;
const H = 280;
const PAD = { l: 52, r: 8, t: 14, b: 38 };
const BAR = 16;
const GAP = 2;

/** 위가 둥근 막대(아래는 기준선에 붙어 직각). 높이가 반지름보다 작으면 둥글림을 줄인다. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function chartSvg(totals: readonly MonthTotal[]): string {
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const max = niceMax(Math.max(...totals.flatMap((t) => [t.income, t.expense])));
  const y = (v: number): number => PAD.t + plotH - (v / max) * plotH;
  const colW = plotW / totals.length;

  const grid = [0, 1, 2, 3, 4]
    .map((i) => {
      const v = (max / 4) * i;
      const yy = y(v);
      return (
        `<line class="grid${i === 0 ? ' base' : ''}" x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}" />` +
        `<text class="tick" x="${PAD.l - 8}" y="${yy + 4}" text-anchor="end">${compactWon(v)}</text>`
      );
    })
    .join('');

  const groups = totals
    .map((t, i) => {
      const cx = PAD.l + colW * i + colW / 2;
      const m = Number(t.month.split('-')[1]);
      const yearLabel = i === 0 || m === 1 ? `<text class="tick" x="${cx}" y="${H - 6}" text-anchor="middle">${t.month.slice(0, 4)}</text>` : '';
      const bars = (
        [
          ['income', t.income, cx - GAP / 2 - BAR],
          ['expense', t.expense, cx + GAP / 2],
        ] as const
      )
        .map(([kind, value, x]) => {
          const h = (value / max) * plotH;
          return h > 0 ? `<path class="bar ${kind}" d="${barPath(x, y(value), BAR, h)}" />` : '';
        })
        .join('');
      return (
        `<g class="grp" data-i="${i}">` +
        `<rect class="hit" x="${PAD.l + colW * i}" y="${PAD.t}" width="${colW}" height="${plotH}" />` +
        bars +
        `<text class="tick" x="${cx}" y="${H - 22}" text-anchor="middle">${m}월</text>${yearLabel}</g>`
      );
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 ${totals.length}개월 월별 수입과 지출 막대 그래프. 정확한 금액은 아래 표에 있습니다.">${grid}${groups}</svg>`;
}

/** 월별 흐름: 막대 그래프, 월평균 지출, 월별 표 */
export class TrendView {
  private totals: MonthTotal[] = [];
  private readonly tip = $('trend-tip');
  private readonly wrap = $('trend-chart');

  constructor() {
    this.bind();
  }

  /** 추이 화면이 다루는 달 목록(오래된 달부터) */
  static months(current: string): string[] {
    return lastMonths(current, TREND_MONTHS);
  }

  render(rows: readonly Tx[], months: readonly string[]): void {
    this.totals = monthlyTotals(rows, months);

    const totals = this.totals;
    const income = totals.reduce((a, t) => a + t.income, 0);
    const expense = totals.reduce((a, t) => a + t.expense, 0);
    // 월평균은 처음 기록이 있는 달부터 센다. 앞쪽의 빈 달이 평균을 깎지 않도록 한다.
    const first = totals.findIndex((t) => t.income > 0 || t.expense > 0);
    const counted = first === -1 ? 0 : totals.length - first;
    const avg = counted > 0 ? Math.round(expense / counted) : 0;
    const balance = income - expense;
    const range = `${totals[0].month.replace('-', '.')} – ${totals[totals.length - 1].month.replace('-', '.')}`;
    $('trend-range').textContent = range;
    $('trend-avg').innerHTML =
      `월평균 지출 <strong>${won(avg)}원</strong>${counted > 0 && counted < totals.length ? ` <span class="count">(기록이 있는 ${counted}개월 기준)</span>` : ''}` +
      ` · 12개월 잔액 <strong class="${balance < 0 ? 'neg' : ''}">${balance < 0 ? '−' : ''}${won(Math.abs(balance))}원</strong>`;

    this.wrap.innerHTML = chartSvg(totals);

    $('trend-rows').innerHTML = [...totals]
      .reverse()
      .map((t) => {
        const [y, m] = t.month.split('-').map(Number);
        return (
          `<tr><th scope="row"><a class="link-btn" href="./?month=${t.month}">${y}년 ${m}월</a></th>` +
          `<td class="income">${won(t.income)}</td><td class="expense">${won(t.expense)}</td>` +
          `<td class="${t.balance < 0 ? 'neg' : ''}">${t.balance < 0 ? '−' : ''}${won(Math.abs(t.balance))}</td></tr>`
        );
      })
      .join('');
  }

  /* ---------- 이벤트 ---------- */

  private showTip(i: number, clientX: number): void {
    const t = this.totals[i];
    if (!t) return;
    const [y, m] = t.month.split('-').map(Number);
    this.tip.innerHTML =
      `<strong>${y}년 ${m}월</strong>` +
      `<span class="tip-row income">수입 ${won(t.income)}원</span>` +
      `<span class="tip-row expense">지출 ${won(t.expense)}원</span>` +
      `<span class="tip-row">잔액 ${t.balance < 0 ? '−' : ''}${won(Math.abs(t.balance))}원</span>`;
    this.tip.hidden = false;
    const box = this.wrap.getBoundingClientRect();
    const half = this.tip.offsetWidth / 2;
    const x = Math.min(Math.max(clientX - box.left, half), box.width - half);
    this.tip.style.left = `${x}px`;
  }

  private bind(): void {
    const move = (e: PointerEvent): void => {
      const g = (e.target as Element).closest<SVGGElement>('.grp');
      if (!g) {
        this.tip.hidden = true;
        return;
      }
      for (const el of this.wrap.querySelectorAll('.grp.on')) el.classList.remove('on');
      g.classList.add('on');
      this.showTip(Number(g.dataset.i), e.clientX);
    };
    this.wrap.addEventListener('pointermove', move);
    this.wrap.addEventListener('pointerdown', move);
    this.wrap.addEventListener('pointerleave', () => {
      this.tip.hidden = true;
      for (const el of this.wrap.querySelectorAll('.grp.on')) el.classList.remove('on');
    });
  }
}
