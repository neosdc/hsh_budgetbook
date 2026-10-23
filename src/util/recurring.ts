import { pad } from './dates';

export interface RuleSchedule {
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  /** 마지막으로 처리한 회차의 달(YYYY-MM-01). 아직 없으면 null */
  generated_through: string | null;
}

export interface Occurrence {
  /** 회차가 속한 달의 1일(YYYY-MM-01). 내역의 recurring_period가 된다. */
  period: string;
  occurred_on: string;
}

export interface Due {
  items: Occurrence[];
  /** 이번에 처리한 마지막 달(YYYY-MM-01). 처리할 회차가 없으면 null */
  through: string | null;
}

/** 한 번에 만들 수 있는 최대 회차 수(실수로 아주 오래된 시작일을 넣었을 때의 안전장치) */
export const MAX_CATCH_UP = 120;

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 그 달의 회차 날짜. 31일 같은 날짜가 없는 달에는 말일로 맞춘다. */
export function occurrenceDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

/**
 * 오늘까지 기록되어야 하지만 아직 처리하지 않은 회차를 구한다.
 * 처리 시작은 generated_through 다음 달(없으면 시작일이 속한 달)이고, 날짜가 아직 오지 않은 회차에서 멈춘다.
 * 시작일 이전이거나 종료일 이후인 회차는 만들지 않지만 "처리한 것"으로 센다.
 */
export function dueOccurrences(rule: RuleSchedule, today: string): Due {
  const base = rule.generated_through ?? null;
  let [y, m] = (base ?? rule.start_date).split('-').map(Number);
  if (base) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  const items: Occurrence[] = [];
  let through: string | null = null;
  for (let i = 0; i < 1200; i++) {
    const date = occurrenceDate(y, m, rule.day_of_month);
    if (date > today) break;
    through = `${y}-${pad(m)}-01`;
    if (date >= rule.start_date && (rule.end_date === null || date <= rule.end_date)) {
      items.push({ period: through, occurred_on: date });
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  // 너무 많이 밀린 경우 가장 최근 회차만 남긴다.
  return { items: items.slice(-MAX_CATCH_UP), through };
}
