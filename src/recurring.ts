import { deleteRule, fetchRules, insertGenerated, saveRule, setGeneratedThrough, type GeneratedTx } from './api';
import { $, formatAmountField, toast } from './dom';
import { describeError } from './errors';
import type { RecurringInput, RecurringRule, TxType } from './types';
import { categoryOptions } from './util/categories';
import { placeOptionsHtml } from './util/places';
import { monthOf, shiftMonth, todayStr } from './util/dates';
import { digitsOnly, esc, won } from './util/format';
import { dueOccurrences } from './util/recurring';

const MAX_AMOUNT = 10_000_000_000_000;

/** "2026-08-01" -> "2026.08.01" */
const dotted = (d: string): string => d.replaceAll('-', '.');

/** 반복 내역 규칙 목록과 편집 대화상자를 담당하고, 앱을 열 때 밀린 회차를 내역으로 만든다. */
export class RecurringManager {
  private rules: RecurringRule[] = [];
  private loaded = false;
  private editing: RecurringRule | null = null;
  private armedId: string | null = null;
  private armTimer: number | undefined;
  private busy = false;

  private readonly dlg = $<HTMLDialogElement>('rec-dlg');
  private readonly amountInput = $<HTMLInputElement>('rec-amount');

  /**
   * @param categoryNames 구분별 분류 이름 목록
   * @param onGenerated 내역이 새로 만들어졌을 때 호출된다(화면을 다시 불러오기 위해)
   */
  constructor(
    private readonly categoryNames: (type: TxType) => string[],
    private readonly onGenerated: (count: number) => void,
  ) {
    this.bind();
  }

  reset(): void {
    this.rules = [];
    this.loaded = false;
    this.editing = null;
    this.armedId = null;
    window.clearTimeout(this.armTimer);
    if (this.dlg.open) this.dlg.close();
  }

  /**
   * 오늘까지 기록되어야 하는데 아직 없는 회차를 내역으로 만든다. 앱을 열 때와 규칙을 저장한 뒤에 실행한다.
   * 실패하면 조용히 넘어가며(다음에 열 때 다시 시도), 만든 건수를 돌려준다.
   */
  async generate(): Promise<number> {
    try {
      this.rules = await fetchRules();
      this.loaded = true;
    } catch {
      return 0;
    }
    const today = todayStr();
    const rows: GeneratedTx[] = [];
    const advance: { id: string; through: string }[] = [];
    for (const r of this.rules) {
      const due = dueOccurrences(r, today);
      for (const o of due.items) {
        rows.push({
          type: r.type,
          amount: r.amount,
          occurred_on: o.occurred_on,
          category: r.category,
          memo: r.memo,
          place: r.place,
          recurring_id: r.id,
          recurring_period: o.period,
        });
      }
      if (due.through && due.through !== r.generated_through) advance.push({ id: r.id, through: due.through });
    }
    if (advance.length === 0) return 0;
    let created = 0;
    try {
      created = await insertGenerated(rows);
      // 내역을 만든 뒤에만 진행 표시를 옮긴다. 중간에 실패하면 다음에 다시 시도하고, 중복은 유일 제약이 막는다.
      for (const a of advance) await setGeneratedThrough(a.id, a.through);
      this.rules = await fetchRules();
    } catch {
      /* 진행 표시를 못 옮겼으면 다음에 다시 시도한다. */
    }
    if (created > 0) this.onGenerated(created);
    return created;
  }

  async open(): Promise<void> {
    this.armedId = null;
    this.showError('');
    this.startEdit(null);
    if (!this.dlg.open) this.dlg.showModal();
    this.renderList('불러오는 중입니다.');
    try {
      this.rules = await fetchRules();
      this.loaded = true;
    } catch (e) {
      this.loaded = false;
      this.renderList('');
      this.showError(describeError(e, '불러오기'));
      return;
    }
    this.renderList();
  }

  /* ---------- 렌더링 ---------- */

  private renderList(message = ''): void {
    const box = $('rec-list');
    if (message || !this.loaded) {
      box.innerHTML = message ? `<p class="hint">${esc(message)}</p>` : '';
      return;
    }
    if (this.rules.length === 0) {
      box.innerHTML = '<p class="hint">등록된 반복 내역이 없습니다. 아래에서 월세, 구독료처럼 매달 나가거나 들어오는 항목을 등록하세요.</p>';
      return;
    }
    box.innerHTML = this.rules
      .map((r) => {
        const armed = r.id === this.armedId;
        const period = `${dotted(r.start_date)}부터${r.end_date ? ` ${dotted(r.end_date)}까지` : ''}`;
        const sign = r.type === 'income' ? '+' : '−';
        return (
          `<li class="rec-row" data-id="${esc(r.id)}">` +
          `<div class="rec-main"><div class="rec-title">${esc(r.memo || r.category)}` +
          `<span class="rec-amt ${r.type}">${sign}${won(r.amount)}원</span></div>` +
          `<div class="rec-sub">매월 ${r.day_of_month}일 · ${esc(r.category)}${r.place ? ` · ${esc(r.place)}` : ''} · ${esc(period)}</div></div>` +
          `<span class="cat-btns"><button type="button" class="btn ghost small" data-act="edit">수정</button>` +
          `<button type="button" class="btn danger small" data-act="delete">${armed ? '삭제 확인' : '삭제'}</button></span></li>`
        );
      })
      .join('');
  }

  private fillCategories(type: TxType, selected: string | null): void {
    const options = categoryOptions(this.categoryNames(type), selected);
    const sel = $<HTMLSelectElement>('rec-category');
    sel.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    sel.value = selected !== null && options.some((o) => o.value === selected) ? selected : options[0].value;
  }

  private selectedType(): TxType {
    return $<HTMLInputElement>('rec-type-income').checked ? 'income' : 'expense';
  }

  /** 입력 폼을 새 규칙(null) 또는 수정할 규칙으로 채운다. */
  private startEdit(rule: RecurringRule | null): void {
    this.editing = rule;
    $('rec-form-title').textContent = rule ? '반복 내역 수정' : '새 반복 내역';
    $<HTMLInputElement>('rec-type-income').checked = rule?.type === 'income';
    $<HTMLInputElement>('rec-type-expense').checked = rule?.type !== 'income';
    this.fillCategories(rule?.type ?? 'expense', rule?.category ?? null);
    this.amountInput.value = rule ? won(rule.amount) : '';
    const day = $<HTMLSelectElement>('rec-day');
    if (day.options.length === 0) {
      day.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">매월 ${i + 1}일</option>`).join('');
    }
    day.value = String(rule?.day_of_month ?? new Date().getDate());
    $<HTMLInputElement>('rec-start').value = rule?.start_date ?? todayStr();
    $<HTMLInputElement>('rec-end').value = rule?.end_date ?? '';
    $<HTMLInputElement>('rec-memo').value = rule?.memo ?? '';
    $<HTMLSelectElement>('rec-place').innerHTML = placeOptionsHtml(rule?.place ?? '', esc);
    $('rec-cancel-edit').hidden = rule === null;
    $<HTMLButtonElement>('rec-save').textContent = rule ? '수정 저장' : '추가';
  }

  private showError(message: string): void {
    const el = $('rec-error');
    el.textContent = message;
    el.hidden = message === '';
  }

  /* ---------- 동작 ---------- */

  private readForm(): RecurringInput | string {
    const amount = parseInt(digitsOnly(this.amountInput.value) || '0', 10);
    if (!amount) return '금액을 입력하세요.';
    if (amount > MAX_AMOUNT) return '금액이 너무 큽니다.';
    const start = $<HTMLInputElement>('rec-start').value;
    const end = $<HTMLInputElement>('rec-end').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return '시작일을 선택하세요.';
    if (!this.editing && start < `${shiftMonth(monthOf(todayStr()), -60)}-01`) {
      return '시작일은 5년 이내로 선택하세요.';
    }
    if (end !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '종료일 형식이 올바르지 않습니다.';
    if (end !== '' && end < start) return '종료일은 시작일 이후여야 합니다.';
    return {
      type: this.selectedType(),
      amount,
      category: $<HTMLSelectElement>('rec-category').value,
      memo: $<HTMLInputElement>('rec-memo').value.trim(),
      place: $<HTMLSelectElement>('rec-place').value,
      day_of_month: Number($<HTMLSelectElement>('rec-day').value),
      start_date: start,
      end_date: end === '' ? null : end,
    };
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const input = this.readForm();
    if (typeof input === 'string') {
      this.showError(input);
      return;
    }
    this.busy = true;
    $<HTMLButtonElement>('rec-save').disabled = true;
    this.showError('');
    try {
      await saveRule(this.editing?.id ?? null, input);
      const wasEditing = this.editing !== null;
      this.startEdit(null);
      toast(wasEditing ? '반복 내역을 수정했습니다.' : '반복 내역을 추가했습니다.');
      // 시작일이 과거이거나 오늘이면 바로 해당 회차를 만든다.
      await this.generate();
      this.renderList();
    } catch (e) {
      this.showError(describeError(e, '저장'));
    } finally {
      this.busy = false;
      $<HTMLButtonElement>('rec-save').disabled = false;
    }
  }

  private async remove(rule: RecurringRule): Promise<void> {
    if (this.armedId !== rule.id) {
      this.armedId = rule.id;
      window.clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => {
        this.armedId = null;
        this.renderList();
      }, 3500);
      this.renderList();
      return;
    }
    this.armedId = null;
    window.clearTimeout(this.armTimer);
    try {
      await deleteRule(rule.id);
      this.rules = await fetchRules();
      if (this.editing?.id === rule.id) this.startEdit(null);
      this.renderList();
      toast('반복 내역을 삭제했습니다. 이미 만들어진 내역은 그대로 남습니다.');
    } catch (e) {
      this.showError(describeError(e, '삭제'));
    }
  }

  /* ---------- 이벤트 ---------- */

  private bind(): void {
    $('rec-close').addEventListener('click', () => this.dlg.close());
    $('rec-done').addEventListener('click', () => this.dlg.close());
    this.dlg.addEventListener('click', (e) => {
      if (e.target === this.dlg) this.dlg.close();
    });
    this.dlg.addEventListener('close', () => {
      this.armedId = null;
      window.clearTimeout(this.armTimer);
    });
    $('rec-form').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    $('rec-cancel-edit').addEventListener('click', () => {
      this.showError('');
      this.startEdit(null);
    });
    this.amountInput.addEventListener('input', () => formatAmountField(this.amountInput));
    const refill = (): void =>
      this.fillCategories(
        this.selectedType(),
        this.editing && this.editing.type === this.selectedType() ? this.editing.category : null,
      );
    $('rec-type-expense').addEventListener('change', refill);
    $('rec-type-income').addEventListener('change', refill);
    $('rec-list').addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      const rule = this.rules.find((r) => r.id === button?.closest<HTMLElement>('.rec-row')?.dataset.id);
      if (!button || !rule) return;
      if (button.dataset.act === 'edit') {
        this.armedId = null;
        this.showError('');
        this.startEdit(rule);
        this.renderList();
        $('rec-form').scrollIntoView({ block: 'nearest' });
      } else if (button.dataset.act === 'delete') {
        void this.remove(rule);
      }
    });
  }
}
