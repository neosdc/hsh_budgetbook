import {
  addCategory,
  deleteCategory,
  fetchCategories,
  renameCategory,
  seedDefaultCategories,
  setCategoryOrder,
} from './api';
import { $ } from './dom';
import { describeError } from './errors';
import { DEFAULT_CATEGORIES, type Category, type TxType } from './types';
import { moveItem, normalizeOrder, validateCategoryName } from './util/categories';
import { esc } from './util/format';

export interface CategoryChange {
  /** 이름이 바뀐 분류. 이 분류로 기록된 내역도 함께 바뀌었으므로 화면의 내역을 다시 불러와야 한다. */
  renamed?: { type: TxType; from: string; to: string };
}

/** 분류 목록을 들고 있고, "분류 관리" 대화상자(추가, 이름 변경, 순서 변경, 삭제)를 담당한다. */
export class CategoryManager {
  private items: Category[] = [];
  private loaded = false;
  private type: TxType = 'expense';
  private editingId: string | null = null;
  private armedId: string | null = null;
  private armTimer: number | undefined;
  private busy = false;

  private readonly dlg = $<HTMLDialogElement>('cat-dlg');

  constructor(private readonly onChange: (change: CategoryChange) => void) {
    this.bind();
  }

  /** 지정한 구분의 분류 이름들(정렬 순서대로). 아직 못 불러왔거나 비었으면 기본 목록을 쓴다. */
  names(type: TxType): string[] {
    const list = this.items.filter((c) => c.type === type).map((c) => c.name);
    return list.length > 0 ? list : [...DEFAULT_CATEGORIES[type]];
  }

  /** 로그인 후 분류를 불러온다. 처음 쓰는 계정이면 기본 분류를 채운다. 실패해도 기본 목록으로 동작한다. */
  async load(): Promise<boolean> {
    try {
      let rows = await fetchCategories();
      if (rows.length === 0) {
        await seedDefaultCategories();
        rows = await fetchCategories();
      }
      this.items = rows;
      this.loaded = true;
    } catch {
      this.items = [];
      this.loaded = false;
    }
    this.onChange({});
    return this.loaded;
  }

  reset(): void {
    this.items = [];
    this.loaded = false;
    this.editingId = null;
    this.clearArm();
    if (this.dlg.open) this.dlg.close();
  }

  async open(type: TxType): Promise<void> {
    this.type = type;
    this.editingId = null;
    this.clearArm();
    this.showError('');
    this.syncTypeRadios();
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
    if (!this.loaded) {
      const ok = await this.load();
      if (!ok) this.showError('분류를 불러오지 못했습니다. 데이터베이스 설정이 적용되지 않았거나 네트워크 문제일 수 있습니다.');
      this.render();
    }
    $<HTMLInputElement>('cat-new').focus();
  }

  /* ---------- 렌더링 ---------- */

  private current(): Category[] {
    return this.items.filter((c) => c.type === this.type);
  }

  private render(): void {
    const list = this.current();
    const box = $('cat-list');
    if (!this.loaded) {
      box.innerHTML = '<p class="hint">분류를 불러오는 중이거나 불러오지 못했습니다.</p>';
      this.setBusyState();
      return;
    }
    box.innerHTML = list
      .map((c, i) => {
        if (c.id === this.editingId) {
          return (
            `<li class="cat-row editing" data-id="${esc(c.id)}">` +
            `<input type="text" class="cat-edit" maxlength="40" value="${esc(c.name)}" aria-label="새 분류 이름" autocomplete="off" />` +
            `<span class="cat-btns">` +
            `<button type="button" class="btn primary small" data-act="save">저장</button>` +
            `<button type="button" class="btn ghost small" data-act="cancel">취소</button>` +
            `</span></li>`
          );
        }
        const armed = c.id === this.armedId;
        return (
          `<li class="cat-row" data-id="${esc(c.id)}">` +
          `<span class="cat-name">${esc(c.name)}</span>` +
          `<span class="cat-btns">` +
          `<button type="button" class="icon-btn small" data-act="up" aria-label="${esc(c.name)} 위로"${i === 0 ? ' disabled' : ''}>↑</button>` +
          `<button type="button" class="icon-btn small" data-act="down" aria-label="${esc(c.name)} 아래로"${i === list.length - 1 ? ' disabled' : ''}>↓</button>` +
          `<button type="button" class="btn ghost small" data-act="rename">이름 변경</button>` +
          `<button type="button" class="btn danger small" data-act="delete">${armed ? '삭제 확인' : '삭제'}</button>` +
          `</span></li>`
        );
      })
      .join('');
    this.setBusyState();
    const edit = box.querySelector<HTMLInputElement>('.cat-edit');
    if (edit) {
      edit.focus();
      edit.select();
    }
  }

  private setBusyState(): void {
    this.dlg.querySelectorAll<HTMLButtonElement>('button[data-act], #cat-add-btn').forEach((b) => {
      if (this.busy) b.disabled = true;
    });
    $<HTMLButtonElement>('cat-add-btn').disabled = this.busy || !this.loaded;
  }

  private showError(message: string): void {
    const el = $('cat-error');
    el.textContent = message;
    el.hidden = message === '';
  }

  private syncTypeRadios(): void {
    $<HTMLInputElement>('cat-type-expense').checked = this.type === 'expense';
    $<HTMLInputElement>('cat-type-income').checked = this.type === 'income';
  }

  private clearArm(): void {
    this.armedId = null;
    window.clearTimeout(this.armTimer);
  }

  /* ---------- 동작 ---------- */

  /** 서버 작업을 실행하고 목록을 다시 불러온다. 실패하면 오류를 보여 준다. */
  private async run(task: () => Promise<void>, change: CategoryChange = {}): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.showError('');
    this.render();
    try {
      await task();
      this.items = await fetchCategories();
      this.busy = false;
      this.onChange(change);
      this.render();
      return true;
    } catch (e) {
      this.busy = false;
      this.showError(describeError(e, '저장'));
      // 실패 원인이 다른 탭의 변경일 수 있으므로 목록을 다시 맞춰 둔다.
      try {
        this.items = await fetchCategories();
      } catch {
        /* 목록을 못 불러오면 기존 화면을 유지한다. */
      }
      this.render();
      return false;
    }
  }

  private async add(): Promise<void> {
    const input = $<HTMLInputElement>('cat-new');
    const check = validateCategoryName(input.value, this.current().map((c) => c.name));
    if (!check.ok) {
      this.showError(check.error);
      input.focus();
      return;
    }
    const last = this.current().reduce((max, c) => Math.max(max, c.sort_order), -1);
    const ok = await this.run(() => addCategory(this.type, check.name, last + 1));
    if (ok) {
      input.value = '';
      input.focus();
    }
  }

  private async rename(category: Category, raw: string): Promise<void> {
    const others = this.current().map((c) => c.name);
    const check = validateCategoryName(raw, others, category.name);
    if (!check.ok) {
      this.showError(check.error);
      return;
    }
    if (check.name === category.name) {
      this.editingId = null;
      this.render();
      return;
    }
    const ok = await this.run(() => renameCategory(category.type, category.name, check.name), {
      renamed: { type: category.type, from: category.name, to: check.name },
    });
    if (ok) this.editingId = null;
    this.render();
  }

  private async remove(category: Category): Promise<void> {
    if (this.current().length <= 1) {
      this.showError('분류는 구분마다 하나 이상 있어야 합니다.');
      return;
    }
    if (this.armedId !== category.id) {
      this.armedId = category.id;
      window.clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => {
        this.armedId = null;
        this.render();
      }, 3500);
      this.showError('');
      this.render();
      return;
    }
    this.clearArm();
    await this.run(() => deleteCategory(category.id));
  }

  private async move(category: Category, delta: -1 | 1): Promise<void> {
    const list = this.current();
    const next = moveItem(list, list.findIndex((c) => c.id === category.id), delta);
    if (!next) return;
    const changes = normalizeOrder(next);
    await this.run(() => setCategoryOrder(changes));
  }

  /* ---------- 이벤트 ---------- */

  private bind(): void {
    $('cat-close').addEventListener('click', () => this.dlg.close());
    $('cat-done').addEventListener('click', () => this.dlg.close());
    this.dlg.addEventListener('click', (e) => {
      if (e.target === this.dlg) this.dlg.close();
    });
    this.dlg.addEventListener('close', () => {
      this.editingId = null;
      this.clearArm();
    });

    const onType = (type: TxType): void => {
      this.type = type;
      this.editingId = null;
      this.clearArm();
      this.showError('');
      this.render();
    };
    $('cat-type-expense').addEventListener('change', () => onType('expense'));
    $('cat-type-income').addEventListener('change', () => onType('income'));

    $('cat-add-form').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.add();
    });

    const list = $('cat-list');
    list.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      const row = button?.closest<HTMLElement>('.cat-row');
      const category = this.items.find((c) => c.id === row?.dataset.id);
      if (!button || !category || this.busy) return;
      switch (button.dataset.act) {
        case 'up':
          return void this.move(category, -1);
        case 'down':
          return void this.move(category, 1);
        case 'rename':
          this.editingId = category.id;
          this.clearArm();
          this.showError('');
          return this.render();
        case 'cancel':
          this.editingId = null;
          this.showError('');
          return this.render();
        case 'save':
          return void this.rename(category, row?.querySelector<HTMLInputElement>('.cat-edit')?.value ?? '');
        case 'delete':
          return void this.remove(category);
      }
    });
    list.addEventListener('keydown', (e) => {
      const input = (e.target as HTMLElement).closest<HTMLInputElement>('.cat-edit');
      if (!input || this.busy) return;
      const category = this.items.find((c) => c.id === input.closest<HTMLElement>('.cat-row')?.dataset.id);
      if (!category) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.rename(category, input.value);
      } else if (e.key === 'Escape') {
        // Esc는 이름 변경만 취소하고 대화상자는 닫지 않는다.
        e.preventDefault();
        e.stopPropagation();
        this.editingId = null;
        this.showError('');
        this.render();
      }
    });
  }
}
