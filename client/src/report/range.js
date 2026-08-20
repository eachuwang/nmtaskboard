export const REPORT_TYPES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly", "handover"];

export const REPORT_LABELS = {
  daily: "日报",
  weekly: "周报",
  biweekly: "双周报",
  monthly: "月报",
  quarterly: "季报",
  yearly: "年报",
  handover: "离职交接报告"
};

export const PREV_LABELS = {
  daily: "上一日",
  weekly: "上一周",
  biweekly: "上一双周",
  monthly: "上一月",
  quarterly: "上一季",
  yearly: "上一年"
};

export const NEXT_LABELS = {
  daily: "下一日",
  weekly: "下一周",
  biweekly: "下一双周",
  monthly: "下一月",
  quarterly: "下一季",
  yearly: "下一年"
};

const TIME_TYPES = new Set(["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"]);

export function normalizeReportType(value) {
  return REPORT_TYPES.includes(value) ? value : "weekly";
}

export function readReportPreference(key, fallback) {
  try {
    return globalThis.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveReportPreference(key, value) {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Keep the report view usable when storage is unavailable.
  }
}

export function dayString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDay(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function shiftDay(value, days) {
  const date = parseDay(value);
  date.setDate(date.getDate() + days);
  return dayString(date);
}

function mondayOf(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function lastDayOfMonth(value) {
  const [year, month] = value.split("-").map(Number);
  return dayString(new Date(year, month, 0));
}

function addMonths(value, months) {
  const date = parseDay(value);
  const day = date.getDate();
  const shifted = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, last));
  return dayString(shifted);
}

function quarterRange(value) {
  const [year, month] = value.split("-").map(Number);
  const quarter = Math.floor((month - 1) / 3);
  return {
    start: dayString(new Date(year, quarter * 3, 1)),
    end: dayString(new Date(year, quarter * 3 + 3, 0))
  };
}

export function defaultRangeFor(type, anchor = new Date(), includeWeekend = false) {
  switch (type) {
    case "daily": {
      const day = dayString(anchor);
      return { start: day, end: day };
    }
    case "weekly": {
      const start = dayString(mondayOf(anchor));
      return { start, end: shiftDay(start, includeWeekend ? 6 : 4) };
    }
    case "biweekly": {
      const start = dayString(mondayOf(anchor));
      return { start, end: shiftDay(start, 13) };
    }
    case "monthly": {
      const start = dayString(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
      return { start, end: lastDayOfMonth(start) };
    }
    case "quarterly": {
      const quarter = Math.floor(anchor.getMonth() / 3);
      const start = dayString(new Date(anchor.getFullYear(), quarter * 3, 1));
      return { start, end: dayString(new Date(anchor.getFullYear(), quarter * 3 + 3, 0)) };
    }
    case "yearly":
      return {
        start: dayString(new Date(anchor.getFullYear(), 0, 1)),
        end: dayString(new Date(anchor.getFullYear(), 11, 31))
      };
    default:
      return null;
  }
}

export function cycleRange(type, range, direction) {
  if (!TIME_TYPES.has(type) || !range) return range;
  if (type === "daily" || type === "weekly" || type === "biweekly") {
    const days = { daily: 1, weekly: 7, biweekly: 14 }[type] * direction;
    return { start: shiftDay(range.start, days), end: shiftDay(range.end, days) };
  }
  if (type === "monthly") {
    const start = addMonths(range.start, direction);
    return { start, end: lastDayOfMonth(start) };
  }
  if (type === "quarterly") return quarterRange(addMonths(range.start, direction * 3));
  const year = Number(range.start.slice(0, 4)) + direction;
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}
