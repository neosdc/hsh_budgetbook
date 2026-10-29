import { SEARCH_LIMIT, fetchAll, fetchMonth, removeTx, saveTx, searchTx } from './api';
import { $, downloadText, formatAmountField, toast } from './dom';
import { describeError } from './errors';
import { BudgetManager } from './budgets';
import { RecurringManager } from './recurring';
import { CategoryManager, type CategoryChange } from './categories';
import type { Tx, TxInput, TxType } from './types';
import { OVERALL, budgetStatuses, worsened, type BudgetStatus } from './util/budget';
import { categoryOptions } from './util/categories';
import { placeOptionsHtml } from './util/places';
import { toCsv, safeFileName } from './util/csv';
import { dayLabel, fullDateLabel, monthLabel, monthOf, shiftMonth, todayStr } from './util/dates';
import { digitsOnly, esc, won } from './util/format';
import { expenseByCategory, filterByType, groupByDate, sums } from './util/summary';

type Filter = 'all' | TxType;

interface State {
  month: string;
  tx: Tx[];
  filter: Filter;
  loading: boolean;
  error: string;
  editing: Tx | null;
  /** 적용된 검색어. 비어 있지 않으면 월 보기 대신 전체 기간 검색 결과를 보여 준다. */
  query: string;
  /** 검색 결과가 SEARCH_LIMIT건을 넘어 잘렸는지 */
  truncated: boolean;
}

/** 로그인 후 보이는 가계부 화면 전체(요약, 목록, 분류, 입력 대화상자)를 담당한다. */
/** 주소의 ?month=YYYY-MM 을 읽고 주소창에서 지운다. 형식이 틀리면 null */
function consumeMonthParam(): string | null {
  const url = new URL(window.location.href);
  const v = url.searchParams.get('month');
  if (v === null) return null;
  url.searchParams.delete('month');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

export class Ledger {
  private readonly currentMonth = monthOf(todayStr());
  private s: State = this.initialState();
  /** 늦게 도착한 이전 요청의 응답을 버리기 위한 순번 */
  private seq = 0;
  private saving = false;
  private exporting = false;
  private searchTimer: number | undefined;
  private deleteArmed = false;
  private deleteTimer: number | undefined;

  private readonly cats = new CategoryManager((change) => this.onCategoriesChanged(change));
  private readonly recurring = new RecurringManager(
    (type) => this.cats.names(type),
    (count) => this.onRecurringGenerated(count),
  );
  private readonly budgets = new BudgetManager(() => this.renderBudget());
  private readonly dlg = $<HTMLDialogElement>('dlg');
  private readonly amountInput = $<HTMLInputElement>('f-amount');

  constructor() {
    this.bind();
  }

  private initialState(): State {
    return {
      month: this.currentMonth,
      tx: [],
      filter: 'all',
      loading: true,
      error: '',
      editing: null,
      query: '',
      truncated: false,
    };
  }

  /** 로그인한 사용자로 화면을 시작한다. */
  start(email: string): void {
    this.s = this.initialState();
    $('who').textContent = email;
    $<HTMLInputElement>('search-input').value = '';
    this.setFilterButtons();
    void this.cats.load();
    void this.budgets.load();
    // 대시보드의 월별 표에서 달을 누르면 ./?month=YYYY-MM 으로 들어온다.
    const linked = consumeMonthParam();
    if (linked) this.s.month = linked;
    void this.load();
    // 오늘까지 기록되어야 하는 반복 내역을 만든다. 만들어지면 onRecurringGenerated가 화면을 갱신한다.
    void this.recurring.generate();
  }

  /** 로그아웃 등으로 화면을 정리한다. */
  stop(): void {
    this.seq++;
    window.clearTimeout(this.searchTimer);
    this.closeDialog();
    this.cats.reset();
    this.budgets.reset();
    this.recurring.reset();
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
      if (this.s.query) {
        const result = await searchTx(this.s.query);
        if (seq !== this.seq) return;
        this.s.tx = result.rows;
        this.s.truncated = result.truncated;
      } else {
        const rows = await fetchMonth(this.s.month);
        if (seq !== this.seq) return;
        this.s.tx = rows;
        this.s.truncated = false;
      }
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

  /** 분류 목록이 바뀌면(불러오기, 추가, 이름 변경 등) 열려 있는 입력창의 선택지를 갱신한다. */
  private onCategoriesChanged(change: CategoryChange): void {
    if (this.dlg.open) {
      const sel = $<HTMLSelectElement>('f-category');
      const r = change.renamed;
      const keep = r && r.type === this.selectedType() && sel.value === r.from ? r.to : sel.value;
      this.fillCategories(keep);
    }
    if (change.renamed) {
      // 이름이 바뀐 분류의 내역도 서버에서 함께 바뀌었으므로 화면의 내역을 다시 불러온다.
      const { type, from, to } = change.renamed;
      const editing = this.s.editing;
      if (editing && editing.type === type && editing.category === from) editing.category = to;
      // 지출 분류의 예산도 서버에서 새 이름으로 옮겨졌다.
      if (type === 'expense') void this.budgets.load();
      void this.load(true);
    }
  }

  private setMonth(month: string): void {
    if (month === this.s.month) return;
    this.s.month = month;
    void this.load();
  }

  /** 검색어를 적용한다. 비우면 월 보기로 돌아간다. */
  private applyQuery(raw: string): void {
    $('search-clear').hidden = raw === '';
    const query = raw.trim();
    if (query === this.s.query) return;
    this.s.query = query;
    void this.load();
  }

  /* ---------- 내보내기 ---------- */

  /** 지금 보이는 목록(월 또는 검색 결과, 구분 필터 적용)을 CSV로 저장한다. */
  private exportCurrent(): void {
    const rows = this.visibleRows();
    if (rows.length === 0) return;
    const label = this.s.query ? `검색_${this.s.query}` : this.s.month;
    downloadText(`${safeFileName(`가계부_${label}`)}.csv`, toCsv(rows));
    toast(`${rows.length}건을 CSV로 저장했습니다.`);
  }

  /** 모든 기간의 내역을 CSV로 저장한다. */
  private async exportAll(): Promise<void> {
    if (this.exporting) return;
    this.exporting = true;
    this.updateExportButtons();
    try {
      const rows = await fetchAll();
      if (rows.length === 0) {
        toast('내보낼 내역이 없습니다.');
        return;
      }
      downloadText(`가계부_전체_${todayStr()}.csv`, toCsv(rows));
      toast(`전체 ${rows.length}건을 CSV로 저장했습니다.`);
    } catch (e) {
      toast(describeError(e, '불러오기'));
    } finally {
      this.exporting = false;
      this.updateExportButtons();
    }
  }

  /* ---------- 렌더링 ---------- */

  private render(): void {
    this.renderMonth();
    this.renderSummary();
    this.renderList();
    this.renderCategories();
    this.renderBudget();
  }

  private renderMonth(): void {
    $('month-label').textContent = monthLabel(this.s.month);
    $('today-btn').hidden = this.s.month === this.currentMonth;
    // 검색 결과는 기간 전체이므로 월 이동은 숨긴다.
    $('month-nav').hidden = this.s.query !== '';
  }

  /** 목록 위쪽에 보이는 내역(구분 필터 적용) */
  private visibleRows(): Tx[] {
    return filterByType(this.s.tx, this.s.filter);
  }

  private updateExportButtons(): void {
    const noData = this.s.loading || this.s.error !== '' || this.visibleRows().length === 0;
    $<HTMLButtonElement>('export-btn').disabled = noData || this.exporting;
    $<HTMLButtonElement>('export-all-btn').disabled = this.exporting;
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
    const rows = this.visibleRows();
    const searching = this.s.query !== '';
    $('list-title').firstChild!.textContent = searching ? `'${this.s.query}' 검색 결과` : '내역';
    $('list-count').textContent =
      this.s.loading || this.s.error
        ? ''
        : this.s.truncated
          ? `최근 ${SEARCH_LIMIT}건`
          : `${rows.length}건`;
    this.updateExportButtons();

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
      if (searching && this.s.tx.length === 0) {
        list.innerHTML =
          `<p class="empty"><strong>검색 결과가 없습니다</strong>` +
          `메모, 분류, 금액(숫자만 입력하면 같은 금액)에서 찾습니다. 다른 검색어를 입력해 보세요.</p>`;
      } else if (this.s.tx.length === 0) {
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
          `<div class="day-head"><span>${esc(searching ? fullDateLabel(g.date) : dayLabel(g.date))}</span><span class="day-sums">` +
          (day.income ? `<span>수입 ${won(day.income)}</span>` : '') +
          (day.expense ? `<span>지출 ${won(day.expense)}</span>` : '') +
          `</span></div>`;
        const items = g.rows
          .map((t) => {
            const sign = t.type === 'income' ? '+' : '−';
            const title = t.memo || t.category;
            const sub = [t.memo ? t.category : t.type === 'income' ? '수입' : '지출', t.place].filter(Boolean).join(' · ');
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

  /* ---------- 반복 내역 ---------- */

  private onRecurringGenerated(count: number): void {
    toast(`반복 내역 ${count}건을 기록했습니다.`);
    void this.load(true);
  }

  /** 이 달 지출 현황. 검색 결과 화면에서는 월 데이터가 아니므로 빈 목록이다. */
  private budgetStatuses(): BudgetStatus[] {
    if (this.s.query || this.s.loading || this.s.error) return [];
    return budgetStatuses(this.budgets.list(), this.s.tx, this.cats.names('expense'));
  }

  private renderBudget(): void {
    const section = $('budget');
    // 검색 결과는 기간 전체라 월 예산과 비교할 수 없다.
    section.hidden = this.s.query !== '';
    const body = $('budget-body');
    if (this.budgets.failed) {
      body.innerHTML =
        '<p class="hint">예산을 불러오지 못했습니다. 데이터베이스 설정(마이그레이션)이 아직 적용되지 않았거나 네트워크 문제일 수 있습니다.</p>';
      return;
    }
    if (!this.budgets.loaded) {
      body.innerHTML = '<p class="hint">불러오는 중입니다.</p>';
      return;
    }
    if (this.budgets.list().length === 0) {
      body.innerHTML = '<p class="hint">월 예산을 정하면 지출이 예산에 가까워지거나 넘을 때 여기에 표시하고 알려 드립니다.</p>';
      return;
    }
    if (this.s.loading || this.s.error) {
      body.innerHTML = '<p class="hint">내역을 불러온 뒤 표시합니다.</p>';
      return;
    }
    const list = this.budgetStatuses();
    const over = list.filter((x) => x.state === 'over').length;
    const warn = list.filter((x) => x.state === 'warn').length;
    const alert =
      over > 0
        ? `<p class="bud-alert over" role="status">예산을 초과한 항목이 ${over}개 있습니다.</p>`
        : warn > 0
          ? `<p class="bud-alert warn" role="status">예산의 80%에 이른 항목이 ${warn}개 있습니다.</p>`
          : '';
    const items = list
      .map((x) => {
        const label = x.key === OVERALL ? '전체 지출' : x.key;
        const text =
          x.state === 'over'
            ? `${won(-x.remaining)}원 초과`
            : x.state === 'warn'
              ? `경고 · ${won(x.remaining)}원 남음`
              : `${won(x.remaining)}원 남음`;
        const pct = Math.min(100, x.ratio * 100);
        return (
          `<div class="bud-item${x.key === OVERALL ? ' overall' : ''} ${x.state}">` +
          `<div class="bud-top"><span>${esc(label)}</span>` +
          `<span class="bud-amts"><strong>${won(x.spent)}</strong> / ${won(x.budget)}원 · ${Math.round(x.ratio * 100)}%</span></div>` +
          `<div class="bud-bar"><div class="bud-fill" data-w="${pct.toFixed(1)}"></div></div>` +
          `<div class="bud-state">${esc(text)}</div></div>`
        );
      })
      .join('');
    body.innerHTML = `${alert}<div class="bud-items">${items}</div>`;
    body.querySelectorAll<HTMLElement>('.bud-fill').forEach((el) => {
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
    const options = categoryOptions(this.cats.names(this.selectedType()), selected);
    const sel = $<HTMLSelectElement>('f-category');
    sel.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    sel.value = selected !== null && options.some((o) => o.value === selected) ? selected : options[0].value;
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
    $<HTMLSelectElement>('f-place').innerHTML = placeOptionsHtml(tx?.place ?? '', esc);
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
      place: $<HTMLSelectElement>('f-place').value,
    };

    this.showFormError('');
    this.saving = true;
    $<HTMLButtonElement>('save-btn').disabled = true;
    // 지금 보고 있는 달에 지출을 저장하면, 저장 전후의 예산 현황을 비교해 초과/경고를 알려 준다.
    const watch = input.type === 'expense' || this.s.editing?.type === 'expense';
    const before = watch && monthOf(date) === this.s.month ? this.budgetStatuses() : null;
    try {
      await saveTx(this.s.editing?.id ?? null, input);
      this.saving = false;
      this.closeDialog();
      const m = monthOf(date);
      toast(
        this.s.query !== '' || m === this.s.month
          ? '저장했습니다.'
          : `${Number(m.split('-')[1])}월 내역으로 저장했습니다.`,
      );
      await this.load(true);
      if (before) this.notifyBudget(before);
    } catch (err) {
      this.saving = false;
      $<HTMLButtonElement>('save-btn').disabled = false;
      this.showFormError(describeError(err, '저장'));
    }
  }

  /** 저장 후 새로 경고/초과가 된 예산이 있으면 알린다. */
  private notifyBudget(before: readonly BudgetStatus[]): void {
    const hits = worsened(before, this.budgetStatuses());
    if (hits.length === 0) return;
    const first = hits[0];
    const name = first.key === OVERALL ? '이번 달 전체 지출' : `'${first.key}'`;
    const msg =
      first.state === 'over'
        ? `${name} 예산을 ${won(-first.remaining)}원 초과했습니다.`
        : `${name} 예산의 ${Math.round(first.ratio * 100)}%를 썼습니다. ${won(first.remaining)}원 남았습니다.`;
    toast(hits.length > 1 ? `${msg} (외 ${hits.length - 1}건)` : msg);
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

    const searchInput = $<HTMLInputElement>('search-input');
    searchInput.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.applyQuery(searchInput.value), 350);
    });
    $('search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      window.clearTimeout(this.searchTimer);
      this.applyQuery(searchInput.value);
    });
    $('search-clear').addEventListener('click', () => {
      window.clearTimeout(this.searchTimer);
      searchInput.value = '';
      this.applyQuery('');
      searchInput.focus();
    });
    $('cat-manage-btn').addEventListener('click', () => void this.cats.open('expense'));
    $('cat-manage-link').addEventListener('click', () => void this.cats.open(this.selectedType()));
    $('rec-btn').addEventListener('click', () => void this.recurring.open());
    $('budget-btn').addEventListener('click', () => void this.budgets.open(this.cats.names('expense')));
    $('export-btn').addEventListener('click', () => this.exportCurrent());
    $('export-all-btn').addEventListener('click', () => void this.exportAll());

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
    // 구분을 바꾸면 선택한 분류는 다른 구분의 것이므로, 수정 중인 내역과 같은 구분일 때만 원래 분류를 유지한다.
    const refill = (): void =>
      this.fillCategories(
        this.s.editing && this.s.editing.type === this.selectedType() ? this.s.editing.category : null,
      );
    $('type-expense').addEventListener('change', refill);
    $('type-income').addEventListener('change', refill);
    this.amountInput.addEventListener('input', () => formatAmountField(this.amountInput));
  }
}
