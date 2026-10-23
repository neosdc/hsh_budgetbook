import { fetchMonth, removeTx, saveTx } from './api';
import { $, toast } from './dom';
import { describeError } from './errors';
import { CATEGORIES, type Tx, type TxInput, type TxType } from './types';
import { dayLabel, monthLabel, monthOf, shiftMonth, todayStr } from './util/dates';
import { digitsOnly, esc, won } from './util/format';
import { expenseByCategory, groupByDate, sums } from './util/summary';

type Filter = 'all' | TxType;

interface State {
  month: string;
  tx: Tx[];
  filter: Filter;
  loading: boolean;
  error: string;
  editing: Tx | null;
}

/** 로그인 후 보이는 가계부 화면 전체(요약, 목록, 분류, 입력 대화상자)를 담당한다. */
export class Ledger {
  private readonly currentMonth = monthOf(todayStr());
  private s: State = this.initialState();
  /** 늦게 도착한 이전 요청의 응답을 버리기 위한 순번 */
  private seq = 0;
  private saving = false;
  private deleteArmed = false;
  private deleteTimer: number | undefined;

  private readonly dlg = $<HTMLDialogElement>('dlg');
  private readonly amountInput = $<HTMLInputElement>('f-amount');

  constructor() {
    this.bind();
  }

  private initialState(): State {
    return { month: this.currentMonth, tx: [], filter: 'all', loading: true, error: '', editing: null };
  }

  /** 로그인한 사용자로 화면을 시작한다. */
  start(email: string): void {
    this.s = this.initialState();
    $('who').textContent = email;
    this.setFilterButtons();
    void this.load();
  }

  /** 로그아웃 등으로 화면을 정리한다. */
  stop(): void {
    this.seq++;
    this.closeDialog();
    this.s = this.initialState();
  }

  /* ---------- 데이터 ---------- */

  private async load(silent = false): Promise<void> {
    const seq = ++this.seq;
    if (!silent) {
      this.s.loading = true;
      this.s.error = '';
      this.s.tx = [];
      this.render();
    }
    try {
      const rows = await fetchMonth(this.s.month);
      if (seq !== this.seq) return;
      this.s.tx = rows;
      this.s.loading = false;
      this.s.error = '';
    } catch (e) {
      if (seq !== this.seq) return;
      const message = describeError(e, '불러오기');
      if (silent) {
        toast(message);
      } else {
        this.s.loading = false;
        this.s.error = message;
      }
    }
    this.render();
  }

  private setMonth(month: string): void {
    if (month === this.s.month) return;
    this.s.month = month;
    void this.load();
  }

  /* ---------- 렌더링 ---------- */

  private render(): void {
    this.renderMonth();
    this.renderSummary();
    this.renderList();
    this.renderCategories();
  }

  private renderMonth(): void {
    $('month-label').textContent = monthLabel(this.s.month);
    $('today-btn').hidden = this.s.month === this.currentMonth;
  }

  private renderSummary(): void {
    const { income, expense } = sums(this.s.tx);
    const balance = income - expense;
    $('summary').innerHTML =
      `<div class="sum-item sum-balance"><div class="sum-label">잔액</div>` +
      `<div class="sum-value${balance < 0 ? ' neg' : ''}">${balance < 0 ? '−' : ''}${won(Math.abs(balance))}<span class="unit">원</span></div></div>` +
      `<div class="sum-item sum-income"><div class="sum-label">수입</div>` +
      `<div class="sum-value">${won(income)}<span class="unit">원</span></div></div>` +
      `<div class="sum-item sum-expense"><div class="sum-label">지출</div>` +
      `<div class="sum-value">${won(expense)}<span class="unit">원</span></div></div>`;
  }

  private renderList(): void {
    const list = $('list');
    const rows = this.s.tx.filter((t) => this.s.filter === 'all' || t.type === this.s.filter);
    $('list-count').textContent = this.s.loading || this.s.error ? '' : `${rows.length}건`;

    if (this.s.loading) {
      list.innerHTML = '<p class="empty">불러오는 중입니다.</p>';
      return;
    }
    if (this.s.error) {
      list.innerHTML =
        `<div class="empty"><strong>내역을 불러오지 못했습니다</strong>${esc(this.s.error)}<br>` +
        `<button type="button" class="btn ghost" data-act="retry">다시 시도</button></div>`;
      return;
    }
    if (rows.length === 0) {
      if (this.s.tx.length === 0) {
        const m = Number(this.s.month.split('-')[1]);
        list.innerHTML =
          `<div class="empty"><strong>${m}월 내역이 아직 없습니다</strong>` +
          `수입과 지출을 기록하면 날짜별 목록과 분류별 합계가 여기에 쌓입니다.<br>` +
          `<button type="button" class="btn primary" data-act="add">첫 내역 추가</button></div>`;
      } else {
        list.innerHTML = '<p class="empty">선택한 구분에 해당하는 내역이 없습니다.</p>';
      }
      return;
    }

    list.innerHTML = groupByDate(rows)
      .map((g) => {
        const day = sums(g.rows);
        const head =
          `<div class="day-head"><span>${esc(dayLabel(g.date))}</span><span class="day-sums">` +
          (day.income ? `<span>수입 ${won(day.income)}</span>` : '') +
          (day.expense ? `<span>지출 ${won(day.expense)}</span>` : '') +
          `</span></div>`;
        const items = g.rows
          .map((t) => {
            const sign = t.type === 'income' ? '+' : '−';
            const title = t.memo || t.category;
            const sub = t.memo ? t.category : t.type === 'income' ? '수입' : '지출';
            return (
              `<button type="button" class="row" data-id="${esc(t.id)}">` +
              `<span class="tile ${t.type}" aria-hidden="true">${esc(Array.from(t.category)[0] ?? '')}</span>` +
              `<span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${esc(sub)}</span></span>` +
              `<span class="amt ${t.type}">${sign}${won(t.amount)}원</span></button>`
            );
          })
          .join('');
        return `<div class="day">${head}${items}</div>`;
      })
      .join('');
  }

  private renderCategories(): void {
    const box = $('cats');
    const cats = expenseByCategory(this.s.tx);
    if (cats.length === 0) {
      box.innerHTML = '<p class="hint">이번 달 지출을 기록하면 분류별 비중이 표시됩니다.</p>';
      return;
    }
    box.innerHTML = cats
      .map(
        (c) =>
          `<div class="cat"><div class="cat-top"><span>${esc(c.category)}<span class="pct">${Math.round(c.percent)}%</span></span>` +
          `<span class="amt-sm">${won(c.total)}원</span></div>` +
          `<div class="cat-bar"><div class="cat-fill" data-w="${c.percent.toFixed(1)}"></div></div></div>`,
      )
      .join('');
    box.querySelectorAll<HTMLElement>('.cat-fill').forEach((el) => {
      el.style.width = `${el.dataset.w ?? '0'}%`;
    });
  }

  private setFilterButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('#filters .chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.filter === this.s.filter));
    });
  }

  /* ---------- 입력 대화상자 ---------- */

  private selectedType(): TxType {
    return $<HTMLInputElement>('type-income').checked ? 'income' : 'expense';
  }

  private fillCategories(selected: string | null): void {
    const list = CATEGORIES[this.selectedType()];
    const sel = $<HTMLSelectElement>('f-category');
    sel.innerHTML = list.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = selected !== null && list.includes(selected) ? selected : list[0];
  }

  private formatAmountInput(): void {
    const el = this.amountInput;
    const raw = el.value;
    const pos = el.selectionStart ?? raw.length;
    const digitsBefore = raw.slice(0, pos).replace(/\D/g, '').length;
    const digits = digitsOnly(raw);
    const formatted = digits ? Number(digits).toLocaleString('ko-KR') : '';
    el.value = formatted;
    // 쉼표가 늘어나도 커서가 같은 숫자 뒤에 머물도록 위치를 다시 계산한다.
    let counted = 0;
    let next = 0;
    while (next < formatted.length && counted < digitsBefore) {
      if (/\d/.test(formatted[next])) counted++;
      next++;
    }
    el.setSelectionRange(next, next);
  }

  private resetDelete(): void {
    this.deleteArmed = false;
    window.clearTimeout(this.deleteTimer);
    $('del-btn').textContent = '삭제';
  }

  private showFormError(message: string): void {
    const el = $('form-error');
    el.textContent = message;
    el.hidden = message === '';
  }

  private openDialog(tx: Tx | null): void {
    this.s.editing = tx;
    this.resetDelete();
    this.showFormError('');
    this.saving = false;
    $<HTMLButtonElement>('save-btn').disabled = false;
    $('dlg-title').textContent = tx ? '내역 수정' : '내역 추가';
    $<HTMLInputElement>('type-income').checked = tx?.type === 'income';
    $<HTMLInputElement>('type-expense').checked = tx?.type !== 'income';
    this.fillCategories(tx?.category ?? null);
    this.amountInput.value = tx ? won(tx.amount) : '';
    $<HTMLInputElement>('f-date').value = tx
      ? tx.occurred_on
      : this.s.month === this.currentMonth
        ? todayStr()
        : `${this.s.month}-01`;
    $<HTMLInputElement>('f-memo').value = tx?.memo ?? '';
    $('del-btn').hidden = !tx;
    this.dlg.showModal();
    this.amountInput.focus();
  }

  private closeDialog(): void {
    this.resetDelete();
    if (this.dlg.open) this.dlg.close();
  }

  private async onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (this.saving) return;

    const amount = parseInt(digitsOnly(this.amountInput.value) || '0', 10);
    const date = $<HTMLInputElement>('f-date').value;
    if (!amount) {
      this.showFormError('금액을 입력하세요.');
      this.amountInput.focus();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.showFormError('날짜를 선택하세요.');
      $('f-date').focus();
      return;
    }

    const input: TxInput = {
      type: this.selectedType(),
      amount,
      occurred_on: date,
      category: $<HTMLSelectElement>('f-category').value,
      memo: $<HTMLInputElement>('f-memo').value.trim(),
    };

    this.showFormError('');
    this.saving = true;
    $<HTMLButtonElement>('save-btn').disabled = true;
    try {
      await saveTx(this.s.editing?.id ?? null, input);
      this.saving = false;
      this.closeDialog();
      const m = monthOf(date);
      toast(m === this.s.month ? '저장했습니다.' : `${Number(m.split('-')[1])}월 내역으로 저장했습니다.`);
      await this.load(true);
    } catch (err) {
      this.saving = false;
      $<HTMLButtonElement>('save-btn').disabled = false;
      this.showFormError(describeError(err, '저장'));
    }
  }

  private async onDelete(): Promise<void> {
    const editing = this.s.editing;
    if (!editing) return;
    // 실수로 지우지 않도록 첫 클릭은 확인 단계로만 쓴다.
    if (!this.deleteArmed) {
      this.deleteArmed = true;
      $('del-btn').textContent = '한 번 더 누르면 삭제';
      this.deleteTimer = window.setTimeout(() => this.resetDelete(), 3500);
      return;
    }
    this.resetDelete();
    try {
      await removeTx(editing.id);
      this.closeDialog();
      toast('삭제했습니다.');
      await this.load(true);
    } catch (err) {
      this.showFormError(describeError(err, '삭제'));
    }
  }

  /* ---------- 이벤트 ---------- */

  private bind(): void {
    $('add-btn').addEventListener('click', () => this.openDialog(null));
    $('prev-btn').addEventListener('click', () => this.setMonth(shiftMonth(this.s.month, -1)));
    $('next-btn').addEventListener('click', () => this.setMonth(shiftMonth(this.s.month, 1)));
    $('today-btn').addEventListener('click', () => this.setMonth(this.currentMonth));

    $('filters').addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip');
      if (!button) return;
      this.s.filter = (button.dataset.filter ?? 'all') as Filter;
      this.setFilterButtons();
      this.renderList();
    });

    $('list').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'add') return this.openDialog(null);
      if (act === 'retry') return void this.load();
      const id = target.closest<HTMLElement>('.row')?.dataset.id;
      const tx = this.s.tx.find((t) => t.id === id);
      if (tx) this.openDialog(tx);
    });

    $('tx-form').addEventListener('submit', (e) => void this.onSubmit(e as SubmitEvent));
    $('del-btn').addEventListener('click', () => void this.onDelete());
    $('cancel-btn').addEventListener('click', () => this.closeDialog());
    $('dlg-close').addEventListener('click', () => this.closeDialog());
    this.dlg.addEventListener('click', (e) => {
      if (e.target === this.dlg) this.closeDialog();
    });
    const refill = (): void => this.fillCategories($<HTMLSelectElement>('f-category').value);
    $('type-expense').addEventListener('change', refill);
    $('type-income').addEventListener('change', refill);
    this.amountInput.addEventListener('input', () => this.formatAmountInput());
  }
}
