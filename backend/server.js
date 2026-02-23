"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 4000;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "/app/output";

// Ensure the output directory exists at startup
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Initialise Express & middleware
// ---------------------------------------------------------------------------
const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json());

// Trust the Nginx reverse proxy so rate limiting uses the real client IP
app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const rateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many requests – please wait a moment and try again.",
    },
});

app.use("/api/", rateLimiter);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Main calculation endpoint
app.get("/api/calculate", (req, res) => {
    try {
        const { birthday } = req.query;

        if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
            return res.status(400).json({
                error: "birthday parameter is required in YYYY-MM-DD format.",
            });
        }

        const [year, month, day] = birthday.split("-").map(Number);
        const birthDate = new Date(year, month - 1, day);

        // Ensure the parsed date matches the input (catches invalid dates like Feb 30)
        if (
            birthDate.getFullYear() !== year ||
            birthDate.getMonth() !== month - 1 ||
            birthDate.getDate() !== day
        ) {
            return res.status(400).json({ error: "Invalid calendar date." });
        }

        const now = new Date();
        if (birthDate > now) {
            return res.status(400).json({
                error: "Birthday cannot be in the future.",
            });
        }

        const result = calculateAll(birthDate, now);

        // Write summary file (async – don't block response)
        writeSummaryFile(result).catch((err) => {
            console.error("Failed to write summary file:", err.message);
        });

        res.json(result);
    } catch (err) {
        console.error("Calculation error:", err.message);
        res.status(500).json({ error: "Failed to calculate age difference." });
    }
});

// ---------------------------------------------------------------------------
// Age-difference calculation logic
// ---------------------------------------------------------------------------

/**
 * Calculate the full age breakdown and time-to-next-birthday.
 * @param {Date} birthDate
 * @param {Date} now
 * @returns {object}
 */
function calculateAll(birthDate, now) {
    // ── Time since birth: component breakdown ──────────────────────────
    let years = now.getFullYear() - birthDate.getFullYear();
    let months = now.getMonth() - birthDate.getMonth();
    let days = now.getDate() - birthDate.getDate();
    let hours = now.getHours() - birthDate.getHours();
    let minutes = now.getMinutes() - birthDate.getMinutes();
    let seconds = now.getSeconds() - birthDate.getSeconds();

    // Borrow as needed so every component is non-negative
    if (seconds < 0) { seconds += 60; minutes--; }
    if (minutes < 0) { minutes += 60; hours--; }
    if (hours < 0) { hours += 24; days--; }
    if (days < 0) {
        const daysInPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        days += daysInPrevMonth;
        months--;
    }
    if (months < 0) { months += 12; years--; }

    // ── Time since birth: totals (each unit independently) ─────────────
    const diffMs = now.getTime() - birthDate.getTime();
    const totalSeconds = Math.floor(diffMs / 1000);
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const totalMonths =
        (now.getFullYear() - birthDate.getFullYear()) * 12 +
        (now.getMonth() - birthDate.getMonth()) +
        (now.getDate() < birthDate.getDate() ? -1 : 0);
    const totalYears = years;

    // ── Is today the birthday? ─────────────────────────────────────────
    const isBirthday =
        now.getMonth() === birthDate.getMonth() &&
        now.getDate() === birthDate.getDate();

    // ── Time until next birthday ───────────────────────────────────────
    let untilNextBirthday = null;
    let nextBirthdayDate = null;

    if (!isBirthday) {
        let nextBd = new Date(
            now.getFullYear(), birthDate.getMonth(), birthDate.getDate()
        );
        if (nextBd.getTime() <= now.getTime()) {
            nextBd.setFullYear(nextBd.getFullYear() + 1);
        }
        nextBirthdayDate = fmtDate(nextBd);

        const diffToNext = nextBd.getTime() - now.getTime();

        // Component breakdown: from now → midnight of next birthday
        let nMonths = nextBd.getMonth() - now.getMonth();
        let nDays = nextBd.getDate() - now.getDate();
        let nHours = -now.getHours();
        let nMinutes = -now.getMinutes();
        let nSeconds = -now.getSeconds();

        if (nSeconds < 0) { nSeconds += 60; nMinutes--; }
        if (nMinutes < 0) { nMinutes += 60; nHours--; }
        if (nHours < 0) { nHours += 24; nDays--; }
        if (nDays < 0) {
            const daysInMonth = new Date(
                now.getFullYear(), now.getMonth() + 1, 0
            ).getDate();
            nDays += daysInMonth;
            nMonths--;
        }
        if (nMonths < 0) { nMonths += 12; }

        // Totals
        const totalSecsNext = Math.floor(diffToNext / 1000);
        const totalMinsNext = Math.floor(diffToNext / (1000 * 60));
        const totalHrsNext = Math.floor(diffToNext / (1000 * 60 * 60));
        const totalDaysNext = Math.floor(diffToNext / (1000 * 60 * 60 * 24));

        untilNextBirthday = {
            components: {
                months: nMonths, days: nDays, hours: nHours,
                minutes: nMinutes, seconds: nSeconds,
            },
            totals: {
                months: nMonths, days: totalDaysNext, hours: totalHrsNext,
                minutes: totalMinsNext, seconds: totalSecsNext,
            },
        };
    }

    return {
        birthday: fmtDate(birthDate),
        calculatedAt: now.toISOString(),
        sinceBirth: {
            components: { years, months, days, hours, minutes, seconds },
            totals: {
                years: totalYears, months: totalMonths, days: totalDays,
                hours: totalHours, minutes: totalMinutes, seconds: totalSeconds,
            },
        },
        untilNextBirthday,
        nextBirthdayDate,
        isBirthday,
        turningAge: isBirthday ? years : null,
    };
}

/** Format a Date as YYYY-MM-DD. */
function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Summary text-file generation (written to the bound volume)
// ---------------------------------------------------------------------------

async function writeSummaryFile(data) {
    await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

    const lines = [];
    const W = 58;
    const bar = "=".repeat(W);
    const thin = "-".repeat(W);

    // ── Header ──
    if (data.isBirthday) {
        lines.push(`+${bar}+`);
        lines.push(`|${center("HAPPY BIRTHDAY!", W)}|`);
        lines.push(`|${center(`You are turning ${data.turningAge} today!`, W)}|`);
        lines.push(`+${bar}+`);
        lines.push("");
        lines.push(getBirthdayAsciiArt());
        lines.push("");
    } else {
        lines.push(`+${bar}+`);
        lines.push(`|${center("AGE DIFFERENCE - Summary Report", W)}|`);
        lines.push(`+${bar}+`);
    }

    lines.push("");
    lines.push(`  Birthday:    ${data.birthday}`);
    lines.push(`  Calculated:  ${data.calculatedAt}`);
    lines.push("");

    // ── Since birth ──
    lines.push(`-- Time Since Birth ${thin.slice(20)}`);
    lines.push("");

    const sc = data.sinceBirth.components;
    lines.push("  Component Breakdown:");
    lines.push(`    ${sc.years} years, ${sc.months} months, ${sc.days} days,`);
    lines.push(`    ${sc.hours} hours, ${sc.minutes} minutes, ${sc.seconds} seconds`);
    lines.push("");

    const st = data.sinceBirth.totals;
    lines.push("  Total in Each Unit:");
    lines.push(`    Years:   ${fmt(st.years)}`);
    lines.push(`    Months:  ${fmt(st.months)}`);
    lines.push(`    Days:    ${fmt(st.days)}`);
    lines.push(`    Hours:   ${fmt(st.hours)}`);
    lines.push(`    Minutes: ${fmt(st.minutes)}`);
    lines.push(`    Seconds: ${fmt(st.seconds)}`);
    lines.push("");

    // ASCII bar chart
    lines.push("  Visual Breakdown:");
    asciiBar(lines, [
        { label: "Years  ", value: sc.years },
        { label: "Months ", value: sc.months },
        { label: "Days   ", value: sc.days },
        { label: "Hours  ", value: sc.hours },
        { label: "Minutes", value: sc.minutes },
        { label: "Seconds", value: sc.seconds },
    ]);
    lines.push("");

    // ── Until next birthday ──
    if (data.untilNextBirthday) {
        lines.push(`-- Time Until Next Birthday ${thin.slice(28)}`);
        lines.push("");

        const nc = data.untilNextBirthday.components;
        lines.push("  Component Breakdown:");
        lines.push(`    ${nc.months} months, ${nc.days} days,`);
        lines.push(`    ${nc.hours} hours, ${nc.minutes} minutes, ${nc.seconds} seconds`);
        lines.push("");

        const nt = data.untilNextBirthday.totals;
        lines.push("  Total in Each Unit:");
        lines.push(`    Months:  ${fmt(nt.months)}`);
        lines.push(`    Days:    ${fmt(nt.days)}`);
        lines.push(`    Hours:   ${fmt(nt.hours)}`);
        lines.push(`    Minutes: ${fmt(nt.minutes)}`);
        lines.push(`    Seconds: ${fmt(nt.seconds)}`);
        lines.push("");

        lines.push("  Visual Countdown:");
        asciiBar(lines, [
            { label: "Months ", value: nc.months },
            { label: "Days   ", value: nc.days },
            { label: "Hours  ", value: nc.hours },
            { label: "Minutes", value: nc.minutes },
            { label: "Seconds", value: nc.seconds },
        ]);
        lines.push("");
        lines.push(`  Next birthday: ${data.nextBirthdayDate}`);
    } else {
        lines.push(`-- It's your birthday today! ${thin.slice(29)}`);
    }

    lines.push("");
    lines.push(bar);
    lines.push("");

    const filePath = path.join(OUTPUT_DIR, "age_summary.txt");
    await fs.promises.writeFile(filePath, lines.join("\n"), "utf8");
    console.log(`Summary written to ${filePath}`);
}

/** Centre text within a given width. */
function center(text, width) {
    const pad = Math.max(0, width - text.length);
    const left = Math.floor(pad / 2);
    const right = pad - left;
    return " ".repeat(left) + text + " ".repeat(right);
}

/** Format a number with locale separators. */
function fmt(n) {
    return n.toLocaleString("en-US");
}

/** Append horizontal ASCII bar-chart lines. */
function asciiBar(lines, items) {
    const maxBar = 36;
    const maxVal = Math.max(...items.map((i) => i.value), 1);
    for (const item of items) {
        const barLen = Math.max(1, Math.round((item.value / maxVal) * maxBar));
        lines.push(`    ${item.label} ${"#".repeat(barLen)} ${item.value}`);
    }
}

/** ASCII-art birthday cake (pure ASCII, no emoji). */
function getBirthdayAsciiArt() {
    return [
        "            *    *    *    *    *",
        "            |    |    |    |    |",
        "           .|.  .|.  .|.  .|.  .|.",
        "       ____|_|__|_|__|_|__|_|__|_|____",
        "      |                              |",
        "      | ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~  |",
        "      |   H A P P Y                  |",
        "      |       B I R T H D A Y !      |",
        "      | ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~  |",
        "      |______________________________|",
        "      |                              |",
        "      |   * * * * * * * * * * * * *  |",
        "      |______________________________|",
        "       \\____________________________/",
    ].join("\n");
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
    console.log(`AgeDiff backend listening on http://0.0.0.0:${PORT}`);
});
