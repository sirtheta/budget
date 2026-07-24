import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysInMonth,
  formatDateCH,
  isValidDateString,
  monthRange,
  monthsBetween,
  todayInZone,
  trailingMonths,
  yearRange,
} from "@/lib/date";

describe("isValidDateString", () => {
  it("accepts real calendar days", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true);
  });

  it("rejects malformed strings and impossible days", () => {
    expect(isValidDateString("2026-2-8")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2025-02-29")).toBe(false);
    expect(isValidDateString("")).toBe(false);
  });
});

describe("addMonths", () => {
  it("advances by whole months", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
  });

  it("clamps to the shorter target month instead of rolling over", () => {
    // Without the clamp, JS turns 31.01. + 1 month into 03.03. — which would
    // silently shift every standing order booked on a 29th–31st.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("goes backwards too", () => {
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("daysInMonth", () => {
  it("knows leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("monthRange / yearRange", () => {
  it("produces inclusive bounds", () => {
    expect(monthRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange(2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("monthsBetween", () => {
  it("counts whole months, signed", () => {
    expect(monthsBetween("2026-01-01", "2026-04-01")).toBe(3);
    expect(monthsBetween("2026-04-01", "2026-01-01")).toBe(-3);
    expect(monthsBetween("2026-01-31", "2026-02-01")).toBe(1);
  });
});

describe("trailingMonths", () => {
  it("returns the window oldest-first, ending with the given month", () => {
    const months = trailingMonths(2026, 2, 4);
    expect(months).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });
});

describe("todayInZone", () => {
  it("resolves the calendar day in the app timezone, not the server's", () => {
    // 22:30 UTC on 31.12. is already 31.12. 23:30 in Zurich but still the 31st
    // in UTC — and 14:30 the same day in Los Angeles.
    const moment = new Date("2025-12-31T22:30:00Z");
    expect(todayInZone("Europe/Zurich", moment)).toBe("2025-12-31");
    expect(todayInZone("America/Los_Angeles", moment)).toBe("2025-12-31");
    // 23:30 UTC is already the next day in Zurich.
    const later = new Date("2025-12-31T23:30:00Z");
    expect(todayInZone("Europe/Zurich", later)).toBe("2026-01-01");
  });
});

describe("formatDateCH", () => {
  it("renders Swiss day-first format", () => {
    expect(formatDateCH("2026-02-05")).toBe("05.02.2026");
  });
});
