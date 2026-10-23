import { fetchBudgets, saveBudgets } from './api';
import { $, formatAmountField, toast } from './dom';
import { describeError } from './errors';
import type { Budget } from './types';
import { BUDGET_MAX, OVERALL, diffBudgets, parseBudgetInput, type BudgetEdit } from './util/budget';
import { esc, won } from './util/format';

/** 월 예산 목록을 들고 있고, "예산 설정" 대화상자를 담당한다. */
export class BudgetManager {
  private items: Budget[] = [];
  /** 예산을 불러왔는지. 못 불러왔으면 화면에 안내만 보이고 설정은 막는다. */
  loaded = false;
  /** 마지막 불러오기가 실패했는지(아직 시도 중이면 false) */
  failed = false;
  private saving = false;
  private categories: string[] = [];

  private readonly dlg = $<HTMLDialogElement>('bud-dlg');

  constructor(private readonly onChange: () => void) {
    this.bind();
  }

  list(): readonly Budget[] {
    return this.items;
  }

  async load(): Promise<void> {
    try {
      this.items = await fetchBudgets();
      this.loaded = true;
      this.failed = false;
    } catch {
      this.items = [];
      this.loaded = false;
      this.failed = true;
    }
    this.onChange();
  }

  reset(): void {
    this.items = [];
    this.loaded = false;
    this.failed = false;
    this.saving = false;
    if (this.dlg.open) this.dlg.close();
  }

  /** 대화상자를 연다. `categories`는 현재 지출 분류 이름들(표시 순서). */
  async open(categories: readonly string[]): Promise<void> {
    this.categories = [...categories];
    this.showError('');
    if (!this.loaded) await this.load();
    if (!this.loaded) {
      toast('예산을 불러오지 못했습니다. 데이터베이스 설정이 적용되지 않았거나 네트워크 문제일 수 있습니다.');
      return;
    }
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
    this.dlg.querySelector<HTMLInputElement>('input')?.focus();
  }

  /* ---------- 렌더링 ---------- */

  private rows(): { key: string; label: string; note: string }[] {
    const known = new Set(this.categories);
    const orphans = this.items
      .map((b) => b.category)
      .filter((c) => c !== OVERALL && !known.has(c))
      .sort((a, b) => a.localeCompare(b, 'ko'));
    return [
      { key: OVERALL, label: '전체 지출', note: '한 달 지출 합계' },
      ...this.categories.map((c) => ({ key: c, label: c, note: '' })),
      ...orphans.map((c) => ({ key: c, label: c, note: '삭제된 분류' })),
    ];
  }

  private render(): void {
    const byKey = new Map(this.items.map((b) => [b.category, b.amount]));
    $('bud-list').innerHTML = this.rows()
      .map((r, i) => {
        const amount = byKey.get(r.key);
        return (
          `<li class="bud-row${r.key === OVERALL ? ' overall' : ''}">` +
          `<label for="bud-in-${i}"><span class="bud-name">${esc(r.label)}</span>` +
          (r.note ? `<span class="bud-note">${esc(r.note)}</span>` : '') +
          `</label>` +
          `<span class="bud-field"><input type="text" id="bud-in-${i}" data-key="${esc(r.key)}" inputmode="numeric" ` +
          `autocomplete="off" placeholder="설정 안 함" value="${amount === undefined ? '' : won(amount)}" />` +
          `<span aria-hidden="true">원</span></span></li>`
        );
      })
      .join('');
  }

  private showError(message: string): void {
    const el = $('bud-error');
    el.textContent = message;
    el.hidden = message === '';
  }

  /* ---------- 저장 ---------- */

  private async save(): Promise<void> {
    if (this.saving) return;
    const edits: BudgetEdit[] = [];
    for (const input of this.dlg.querySelectorAll<HTMLInputElement>('#bud-list input')) {
      const amount = parseBudgetInput(input.value);
      if (amount !== null && amount > BUDGET_MAX) {
        this.showError('예산이 너무 큽니다. 10조 원 이하로 입력하세요.');
        input.focus();
        return;
      }
      edits.push({ key: input.dataset.key ?? '', amount });
    }
    const changes = diffBudgets(this.items, edits);
    if (changes.upserts.length === 0 && changes.deletes.length === 0) {
      this.dlg.close();
      return;
    }
    this.saving = true;
    $<HTMLButtonElement>('bud-save').disabled = true;
    this.showError('');
    try {
      await saveBudgets(changes);
      this.items = await fetchBudgets();
      this.dlg.close();
      toast('예산을 저장했습니다.');
      this.onChange();
    } catch (e) {
      this.showError(describeError(e, '저장'));
      // 일부만 반영됐을 수 있으므로 서버 상태에 맞춰 둔다.
      try {
        this.items = await fetchBudgets();
        this.onChange();
      } catch {
        /* 기존 화면 유지 */
      }
    } finally {
      this.saving = false;
      $<HTMLButtonElement>('bud-save').disabled = false;
    }
  }

  /* ---------- 이벤트 ---------- */

  private bind(): void {
    $('bud-close').addEventListener('click', () => this.dlg.close());
    $('bud-cancel').addEventListener('click', () => this.dlg.close());
    this.dlg.addEventListener('click', (e) => {
      if (e.target === this.dlg) this.dlg.close();
    });
    $('bud-form').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.save();
    });
    $('bud-list').addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.matches('input')) formatAmountField(el);
    });
  }
}
