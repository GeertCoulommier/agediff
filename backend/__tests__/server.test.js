"use strict";

/**
 * Test suite for the AgeDiff backend.
 *
 * Coverage:
 *  – HTTP integration tests via supertest (health, calculate, 404)
 *  – Pure-logic unit tests for calculateAll()
 *  – fmtDate() formatting helper
 *  – writeSummaryFile() output via the API (filesystem assertions)
 *
 * No external HTTP calls are made; calculateAll() is entirely local maths.
 */

// ---------------------------------------------------------------------------
// Set env vars BEFORE requiring the app
// ---------------------------------------------------------------------------
process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.OUTPUT_DIR = "/tmp/agediff-test-jest";

const request = require("supertest");
const fs = require("fs");
const path = require("path");

const { app, calculateAll, fmtDate } = require("../server");

const OUTPUT_DIR = process.env.OUTPUT_DIR;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});

afterAll(() => {
    try {
        fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    } catch {
        // best-effort cleanup; ignore errors
    }
});

// ===========================================================================
// GET /api/health
// ===========================================================================

describe("GET /api/health", () => {
    it("returns 200 with status:ok and a timestamp", async () => {
        const res = await request(app).get("/api/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
        expect(res.body.timestamp).toBeDefined();
        // timestamp must be a valid ISO-8601 date string
        expect(new Date(res.body.timestamp).toString()).not.toBe("Invalid Date");
    });
});

// ===========================================================================
// GET /api/calculate – input validation
// ===========================================================================

describe("GET /api/calculate – validation", () => {
    it("400 when birthday param is missing", async () => {
        const res = await request(app).get("/api/calculate");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/birthday parameter/i);
    });

    it("400 for non-date string", async () => {
        const res = await request(app).get("/api/calculate?birthday=not-a-date");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/YYYY-MM-DD/);
    });

    it("400 for partial date (missing day)", async () => {
        const res = await request(app).get("/api/calculate?birthday=2000-06");
        expect(res.status).toBe(400);
    });

    it("400 for February 30 (impossible calendar date)", async () => {
        const res = await request(app).get("/api/calculate?birthday=2000-02-30");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid calendar date/i);
    });

    it("400 for month 13 (impossible calendar date)", async () => {
        const res = await request(app).get("/api/calculate?birthday=2000-13-01");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid calendar date/i);
    });

    it("400 for April 31 (impossible calendar date)", async () => {
        const res = await request(app).get("/api/calculate?birthday=2024-04-31");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid calendar date/i);
    });

    it("400 when birthday is in the future", async () => {
        const future = new Date();
        future.setFullYear(future.getFullYear() + 1);
        const bd = fmtDate(future);
        const res = await request(app).get(`/api/calculate?birthday=${bd}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/future/i);
    });
});

// ===========================================================================
// GET /api/calculate – successful responses
// ===========================================================================

describe("GET /api/calculate – success", () => {
    it("returns 200 with full result structure for a valid birthday", async () => {
        const res = await request(app).get("/api/calculate?birthday=1990-06-15");
        expect(res.status).toBe(200);

        // Top-level fields
        expect(res.body.birthday).toBe("1990-06-15");
        expect(res.body.calculatedAt).toBeDefined();
        expect(new Date(res.body.calculatedAt).toString()).not.toBe("Invalid Date");

        // sinceBirth structure
        const sb = res.body.sinceBirth;
        expect(sb).toBeDefined();
        expect(sb.components).toBeDefined();
        expect(sb.totals).toBeDefined();

        // Component fields exist
        ["years", "months", "days", "hours", "minutes", "seconds"].forEach((f) => {
            expect(sb.components).toHaveProperty(f);
        });

        // Total fields exist
        ["years", "months", "days", "hours", "minutes", "seconds"].forEach((f) => {
            expect(sb.totals).toHaveProperty(f);
        });

        // totals.seconds > totals.minutes > totals.hours (for a 30+ year old)
        expect(sb.totals.seconds).toBeGreaterThan(sb.totals.minutes);
        expect(sb.totals.minutes).toBeGreaterThan(sb.totals.hours);
        expect(sb.totals.hours).toBeGreaterThan(sb.totals.days);
    });

    it("all sinceBirth components are non-negative and within their natural ranges", async () => {
        const res = await request(app).get("/api/calculate?birthday=2000-03-20");
        expect(res.status).toBe(200);
        const c = res.body.sinceBirth.components;

        expect(c.years).toBeGreaterThanOrEqual(0);
        expect(c.months).toBeGreaterThanOrEqual(0);
        expect(c.months).toBeLessThan(12);
        expect(c.days).toBeGreaterThanOrEqual(0);
        expect(c.hours).toBeGreaterThanOrEqual(0);
        expect(c.hours).toBeLessThan(24);
        expect(c.minutes).toBeGreaterThanOrEqual(0);
        expect(c.minutes).toBeLessThan(60);
        expect(c.seconds).toBeGreaterThanOrEqual(0);
        expect(c.seconds).toBeLessThan(60);
    });

    it("totals.years equals components.years", async () => {
        const res = await request(app).get("/api/calculate?birthday=1990-01-01");
        expect(res.status).toBe(200);
        const { components, totals } = res.body.sinceBirth;
        expect(totals.years).toBe(components.years);
    });

    it("returns isBirthday=true and turningAge when today is the birthday", async () => {
        const today = new Date();
        const birthdayYear = today.getFullYear() - 30;
        const bd = `${birthdayYear}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

        const res = await request(app).get(`/api/calculate?birthday=${bd}`);
        expect(res.status).toBe(200);
        expect(res.body.isBirthday).toBe(true);
        expect(res.body.turningAge).toBe(30);
        expect(res.body.untilNextBirthday).toBeNull();
        expect(res.body.nextBirthdayDate).toBeNull();
    });

    it("untilNextBirthday is populated with correct shape on a non-birthday", async () => {
        const res = await request(app).get("/api/calculate?birthday=1985-07-04");
        expect(res.status).toBe(200);

        // This test is only valid for non-birthday runs (extremely unlikely to run on July 4)
        if (!res.body.isBirthday) {
            const unb = res.body.untilNextBirthday;
            expect(unb).not.toBeNull();
            expect(unb.components).toBeDefined();
            expect(unb.totals).toBeDefined();

            ["months", "days", "hours", "minutes", "seconds"].forEach((f) => {
                expect(unb.components).toHaveProperty(f);
                expect(unb.totals).toHaveProperty(f);
            });

            expect(res.body.nextBirthdayDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it("nextBirthdayDate is in the future (or today on birthday)", async () => {
        const res = await request(app).get("/api/calculate?birthday=1990-01-01");
        expect(res.status).toBe(200);
        if (!res.body.isBirthday) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const nextBd = new Date(res.body.nextBirthdayDate);
            expect(nextBd.getTime()).toBeGreaterThan(today.getTime() - 1);
        }
    });
});

// ===========================================================================
// calculateAll() – unit tests (pure logic, no HTTP, fixed timestamps)
// ===========================================================================

describe("calculateAll() – component arithmetic", () => {
    it("simple case: no borrowing needed", () => {
        const birthDate = new Date(2000, 0, 1, 0, 0, 0); // Jan 1, 2000 00:00:00
        const now = new Date(2026, 5, 15, 10, 30, 45);   // June 15, 2026 10:30:45

        const r = calculateAll(birthDate, now);

        expect(r.sinceBirth.components.years).toBe(26);
        expect(r.sinceBirth.components.months).toBe(5);
        expect(r.sinceBirth.components.days).toBe(14);
        expect(r.sinceBirth.components.hours).toBe(10);
        expect(r.sinceBirth.components.minutes).toBe(30);
        expect(r.sinceBirth.components.seconds).toBe(45);
    });

    it("borrows days from previous month when days go negative", () => {
        // May 20 → June 10: days = 10 - 20 = -10 → borrow May (31 days) → 21, months = 0
        const birthDate = new Date(2000, 4, 20); // May 20, 2000
        const now = new Date(2026, 5, 10);       // June 10, 2026

        const r = calculateAll(birthDate, now);

        expect(r.sinceBirth.components.months).toBe(0);
        expect(r.sinceBirth.components.days).toBe(21);
    });

    it("borrows months from years when months go negative", () => {
        // Sep 15 → Feb 24: months = 1 - 8 = -7 → months = 5, years--
        const birthDate = new Date(2000, 8, 15); // Sep 15, 2000
        const now = new Date(2026, 1, 24);       // Feb 24, 2026

        const r = calculateAll(birthDate, now);

        expect(r.sinceBirth.components.years).toBe(25);
        expect(r.sinceBirth.components.months).toBe(5);
        expect(r.sinceBirth.components.days).toBe(9);
    });

    it("borrows seconds from minutes when seconds go negative", () => {
        // 10:30:45 → 10:31:30: seconds = -15 → 45, minutes--  → 0
        const birthDate = new Date(2000, 0, 1, 10, 30, 45);
        const now = new Date(2026, 0, 1, 10, 31, 30);

        const r = calculateAll(birthDate, now);

        expect(r.sinceBirth.components.minutes).toBe(0);
        expect(r.sinceBirth.components.seconds).toBe(45);
    });

    it("borrows minutes from hours when minutes go negative", () => {
        // 10:05:00 → 11:03:00: minutes = 3 - 5 = -2 → 58, hours = 0
        const birthDate = new Date(2000, 0, 1, 10, 5, 0);
        const now = new Date(2026, 0, 1, 11, 3, 0);

        const r = calculateAll(birthDate, now);

        expect(r.sinceBirth.components.hours).toBe(0);
        expect(r.sinceBirth.components.minutes).toBe(58);
    });

    it("borrows hours from days when hours go negative", () => {
        // Day 10, 8:00 → Day 11, 6:00: hours = 6 - 8 = -2 → 22, days = 0
        const birthDate = new Date(2000, 0, 10, 8, 0, 0);
        const now = new Date(2026, 0, 11, 6, 0, 0);

        const r = calculateAll(birthDate, now);

        expect(r.sinceBirth.components.days).toBe(0);
        expect(r.sinceBirth.components.hours).toBe(22);
    });
});

describe("calculateAll() – totals", () => {
    it("exactly one day difference gives correct totals", () => {
        const birthDate = new Date(2025, 0, 1); // Jan 1, 2025 00:00:00
        const now = new Date(2025, 0, 2);       // Jan 2, 2025 00:00:00

        const r = calculateAll(birthDate, now);

        expect(r.sinceBirth.totals.days).toBe(1);
        expect(r.sinceBirth.totals.hours).toBe(24);
        expect(r.sinceBirth.totals.minutes).toBe(1440);
        expect(r.sinceBirth.totals.seconds).toBe(86400);
    });

    it("exactly one hour gives correct totals", () => {
        const birthDate = new Date(2025, 0, 1, 10, 0, 0);
        const now = new Date(2025, 0, 1, 11, 0, 0);

        const r = calculateAll(birthDate, now);

        expect(r.sinceBirth.totals.hours).toBe(1);
        expect(r.sinceBirth.totals.minutes).toBe(60);
        expect(r.sinceBirth.totals.seconds).toBe(3600);
    });

    it("totalMonths accounts for partial month (day not yet reached)", () => {
        // Feb 28, 2000 → Feb 27, 2026: birthday not yet reached this month
        const birthDate = new Date(2000, 1, 28); // Feb 28, 2000
        const now = new Date(2026, 1, 27);       // Feb 27, 2026

        const r = calculateAll(birthDate, now);

        // 25 full years × 12 = 300, plus 11 full months = 311
        expect(r.sinceBirth.totals.months).toBe(311);
    });

    it("totalMonths includes the current month when day is reached", () => {
        // Feb 28, 2000 → Feb 28, 2026: birthday exactly reached today
        const birthDate = new Date(2000, 1, 28); // Feb 28, 2000
        const now = new Date(2026, 1, 28);       // Feb 28, 2026

        const r = calculateAll(birthDate, now);

        // Exactly 26 years = 312 months
        expect(r.sinceBirth.totals.months).toBe(312);
    });

    it("totals are in correct ascending order (seconds > minutes > hours > days)", () => {
        const birthDate = new Date(1990, 0, 1);
        const now = new Date(2026, 1, 24, 12, 0, 0);

        const r = calculateAll(birthDate, now);
        const t = r.sinceBirth.totals;

        expect(t.seconds).toBeGreaterThan(t.minutes);
        expect(t.minutes).toBeGreaterThan(t.hours);
        expect(t.hours).toBeGreaterThan(t.days);
        expect(t.days).toBeGreaterThan(t.months);
        expect(t.months).toBeGreaterThan(t.years);
    });
});

describe("calculateAll() – isBirthday and turningAge", () => {
    it("isBirthday=true when month and day match", () => {
        const birthDate = new Date(1990, 1, 24); // Feb 24, 1990
        const now = new Date(2026, 1, 24);       // Feb 24, 2026

        const r = calculateAll(birthDate, now);

        expect(r.isBirthday).toBe(true);
        expect(r.turningAge).toBe(36);
        expect(r.untilNextBirthday).toBeNull();
    });

    it("isBirthday=false and turningAge=null on a non-birthday", () => {
        const birthDate = new Date(1990, 2, 15); // Mar 15, 1990
        const now = new Date(2026, 1, 24);       // Feb 24, 2026

        const r = calculateAll(birthDate, now);

        expect(r.isBirthday).toBe(false);
        expect(r.turningAge).toBeNull();
        expect(r.untilNextBirthday).not.toBeNull();
    });

    it("turningAge is correct at age 1 (exact)", () => {
        const birthDate = new Date(2025, 1, 24); // Feb 24, 2025
        const now = new Date(2026, 1, 24);       // Feb 24, 2026

        const r = calculateAll(birthDate, now);

        expect(r.isBirthday).toBe(true);
        expect(r.turningAge).toBe(1);
    });
});

describe("calculateAll() – untilNextBirthday", () => {
    it("nextBirthdayDate stays this year when birthday hasn't passed yet", () => {
        const birthDate = new Date(1990, 2, 15); // Mar 15, 1990
        const now = new Date(2026, 1, 24);       // Feb 24, 2026 – before Mar 15

        const r = calculateAll(birthDate, now);

        expect(r.nextBirthdayDate).toBe("2026-03-15");
    });

    it("nextBirthdayDate rolls to next year when birthday already passed this year", () => {
        const birthDate = new Date(1990, 0, 10); // Jan 10, 1990
        const now = new Date(2026, 1, 24);       // Feb 24, 2026 – Jan 10 already passed

        const r = calculateAll(birthDate, now);

        expect(r.nextBirthdayDate).toBe("2027-01-10");
    });

    it("untilNextBirthday components are all non-negative", () => {
        const birthDate = new Date(1990, 5, 20); // June 20, 1990
        const now = new Date(2026, 1, 24);       // Feb 24, 2026

        const r = calculateAll(birthDate, now);

        const c = r.untilNextBirthday.components;
        expect(c.months).toBeGreaterThanOrEqual(0);
        expect(c.days).toBeGreaterThanOrEqual(0);
        expect(c.hours).toBeGreaterThanOrEqual(0);
        expect(c.minutes).toBeGreaterThanOrEqual(0);
        expect(c.seconds).toBeGreaterThanOrEqual(0);
    });

    it("untilNextBirthday totals are in correct ascending order", () => {
        const birthDate = new Date(1990, 5, 20);        // June 20
        const now = new Date(2026, 1, 24, 10, 30, 0);  // Feb 24, 2026 10:30

        const r = calculateAll(birthDate, now);
        const t = r.untilNextBirthday.totals;

        expect(t.days).toBeGreaterThan(0);
        expect(t.hours).toBeGreaterThan(t.days);
        expect(t.minutes).toBeGreaterThan(t.hours);
        expect(t.seconds).toBeGreaterThan(t.minutes);
    });

    it("untilNextBirthday.totals.days matches Math.floor(diffMs/86400000)", () => {
        const birthDate = new Date(1990, 5, 20);       // June 20
        const now = new Date(2026, 1, 24, 0, 0, 0);   // Feb 24, 2026 midnight

        const r = calculateAll(birthDate, now);

        // nextBd = June 20, 2026
        const nextBd = new Date(2026, 5, 20);
        const expectedDays = Math.floor((nextBd - now) / 86_400_000);
        expect(r.untilNextBirthday.totals.days).toBe(expectedDays);
    });
});

describe("calculateAll() – output formatting", () => {
    it("birthday field is formatted as YYYY-MM-DD", () => {
        const birthDate = new Date(1985, 11, 25); // Dec 25, 1985
        const now = new Date(2026, 1, 24);

        const r = calculateAll(birthDate, now);

        expect(r.birthday).toBe("1985-12-25");
    });

    it("calculatedAt is the ISO string of the 'now' parameter", () => {
        const birthDate = new Date(2000, 0, 1);
        const now = new Date(2026, 1, 24, 12, 0, 0);

        const r = calculateAll(birthDate, now);

        expect(r.calculatedAt).toBe(now.toISOString());
    });
});

// ===========================================================================
// fmtDate() – formatting helper
// ===========================================================================

describe("fmtDate()", () => {
    it("formats a standard date correctly", () => {
        expect(fmtDate(new Date(1985, 6, 4))).toBe("1985-07-04"); // July 4
    });

    it("pads single-digit month and day with leading zero", () => {
        expect(fmtDate(new Date(1990, 0, 5))).toBe("1990-01-05"); // Jan 5
    });

    it("handles December (month 11 → 12)", () => {
        expect(fmtDate(new Date(2000, 11, 25))).toBe("2000-12-25"); // Dec 25
    });

    it("returns a string matching YYYY-MM-DD format", () => {
        expect(fmtDate(new Date(2026, 1, 24))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

// ===========================================================================
// writeSummaryFile() – tested indirectly via the API
// ===========================================================================

describe("writeSummaryFile() – file output (via /api/calculate)", () => {
    const filePath = path.join(OUTPUT_DIR, "age_summary.txt");

    it("creates age_summary.txt after a valid calculation", async () => {
        try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }

        await request(app).get("/api/calculate?birthday=1990-01-15");
        // Give the async write a moment to complete
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(fs.existsSync(filePath)).toBe(true);
    });

    it("summary file contains the birthday that was requested", async () => {
        await request(app).get("/api/calculate?birthday=1985-07-04");
        await new Promise((resolve) => setTimeout(resolve, 300));

        const content = fs.readFileSync(filePath, "utf8");
        expect(content).toContain("1985-07-04");
    });

    it("summary file contains 'Time Since Birth' section header", async () => {
        // Pick a date that is definitely not today
        const today = new Date();
        const safeMonth = today.getMonth() === 5 ? 8 : 6; // avoid June, use July or Sep
        const safeDay = today.getDate() === 15 ? 16 : 15;
        const bd = `1988-${String(safeMonth + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;

        await request(app).get(`/api/calculate?birthday=${bd}`);
        await new Promise((resolve) => setTimeout(resolve, 300));

        const content = fs.readFileSync(filePath, "utf8");
        expect(content).toContain("Time Since Birth");
    });

    it("summary file contains 'Time Until Next Birthday' section on non-birthday", async () => {
        const today = new Date();
        const safeMonth = today.getMonth() === 5 ? 8 : 6;
        const safeDay = today.getDate() === 15 ? 16 : 15;
        const bd = `1988-${String(safeMonth + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;

        await request(app).get(`/api/calculate?birthday=${bd}`);
        await new Promise((resolve) => setTimeout(resolve, 300));

        const content = fs.readFileSync(filePath, "utf8");
        expect(content).toContain("Time Until Next Birthday");
    });

    it("summary file says HAPPY BIRTHDAY on birthday", async () => {
        const today = new Date();
        const birthdayYear = today.getFullYear() - 25;
        const bd = `${birthdayYear}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

        await request(app).get(`/api/calculate?birthday=${bd}`);
        await new Promise((resolve) => setTimeout(resolve, 300));

        const content = fs.readFileSync(filePath, "utf8");
        expect(content).toContain("HAPPY BIRTHDAY");
    });
});

// ===========================================================================
// Unknown routes
// ===========================================================================

describe("Unknown routes", () => {
    it("returns 404 for an unknown API route", async () => {
        const res = await request(app).get("/api/unknown");
        expect(res.status).toBe(404);
    });

    it("returns 404 for a totally unknown path", async () => {
        const res = await request(app).get("/nonexistent");
        expect(res.status).toBe(404);
    });
});
