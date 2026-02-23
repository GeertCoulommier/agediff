"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let birthday = null;   // stored as "YYYY-MM-DD"
let updateInterval = null;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const birthdayForm = document.getElementById("birthdayForm");
const birthdayInput = document.getElementById("birthdayInput");
const inputSection = document.getElementById("inputSection");
const resultsSection = document.getElementById("resultsSection");
const congratsSection = document.getElementById("congratsSection");
const congratsMessage = document.getElementById("congratsMessage");
const nextBirthdayCard = document.getElementById("nextBirthdayCard");
const errorToast = document.getElementById("errorToast");
const resetBtn = document.getElementById("resetBtn");

const sinceComponents = document.getElementById("sinceComponents");
const sinceTotals = document.getElementById("sinceTotals");
const nextComponents = document.getElementById("nextComponents");
const nextTotals = document.getElementById("nextTotals");

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
(() => {
    // Set max date on input to today
    const today = new Date();
    birthdayInput.max = fmtDate(today);
})();

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

birthdayForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = birthdayInput.value;
    if (!value) return;

    try {
        // Call the backend to generate the summary file
        const resp = await fetch(`/api/calculate?birthday=${encodeURIComponent(value)}`);
        const data = await resp.json();

        if (!resp.ok) {
            showError(data.error || "Something went wrong.");
            return;
        }

        // Store birthday and start live display
        birthday = value;
        startLiveUpdate();

        // Collapse input, show results
        inputSection.classList.add("collapsed");
        resultsSection.hidden = false;
        resetBtn.hidden = false;

        // Birthday handling
        if (data.isBirthday) {
            congratsSection.hidden = false;
            congratsMessage.textContent = `Congratulations! You are turning ${data.turningAge} today!`;
            nextBirthdayCard.hidden = true;
            launchConfetti();
        } else {
            congratsSection.hidden = true;
            nextBirthdayCard.hidden = false;
        }
    } catch {
        showError("Could not reach the server. Is the backend running?");
    }
});

resetBtn.addEventListener("click", () => {
    birthday = null;
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = null;

    inputSection.classList.remove("collapsed");
    resultsSection.hidden = true;
    congratsSection.hidden = true;
    resetBtn.hidden = true;
    birthdayInput.value = "";
});

// Tab switching (delegated)
document.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;

    const tabGroup = tab.closest(".result-card__tabs");
    const card = tab.closest(".result-card");

    tabGroup.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    const targetId = tab.dataset.target;
    card.querySelectorAll(".result-card__content").forEach((c) => {
        c.classList.toggle("active", c.id === targetId);
    });
});

// ---------------------------------------------------------------------------
// Live-updating display (recalculates client-side every second)
// ---------------------------------------------------------------------------

function startLiveUpdate() {
    if (updateInterval) clearInterval(updateInterval);
    updateDisplay();
    updateInterval = setInterval(updateDisplay, 1000);
}

function updateDisplay() {
    if (!birthday) return;

    const [year, month, day] = birthday.split("-").map(Number);
    const birthDate = new Date(year, month - 1, day);
    const now = new Date();

    // ── Since birth – components ──
    const since = calcSinceBirth(birthDate, now);

    sinceComponents.innerHTML = buildComponentGrid([
        { value: since.years, label: "Years" },
        { value: since.months, label: "Months" },
        { value: since.days, label: "Days" },
        { value: since.hours, label: "Hours" },
        { value: since.minutes, label: "Minutes" },
        { value: since.seconds, label: "Seconds" },
    ]);

    // ── Since birth – totals ──
    const diffMs = now.getTime() - birthDate.getTime();

    sinceTotals.innerHTML = buildTotalsList([
        { label: "Years", value: since.years },
        {
            label: "Months",
            value:
                (now.getFullYear() - birthDate.getFullYear()) * 12 +
                (now.getMonth() - birthDate.getMonth()) +
                (now.getDate() < birthDate.getDate() ? -1 : 0),
        },
        { label: "Days", value: Math.floor(diffMs / 86_400_000) },
        { label: "Hours", value: Math.floor(diffMs / 3_600_000) },
        { label: "Minutes", value: Math.floor(diffMs / 60_000) },
        { label: "Seconds", value: Math.floor(diffMs / 1000) },
    ]);

    // ── Until next birthday ──
    const isBirthday =
        now.getMonth() === birthDate.getMonth() &&
        now.getDate() === birthDate.getDate();

    if (!isBirthday) {
        let nextBd = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate());
        if (nextBd.getTime() <= now.getTime()) {
            nextBd.setFullYear(nextBd.getFullYear() + 1);
        }
        const diffToNext = nextBd.getTime() - now.getTime();

        // Components
        let nMonths = nextBd.getMonth() - now.getMonth();
        let nDays = nextBd.getDate() - now.getDate();
        let nHours = -now.getHours();
        let nMinutes = -now.getMinutes();
        let nSeconds = -now.getSeconds();

        if (nSeconds < 0) { nSeconds += 60; nMinutes--; }
        if (nMinutes < 0) { nMinutes += 60; nHours--; }
        if (nHours < 0) { nHours += 24; nDays--; }
        if (nDays < 0) {
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            nDays += daysInMonth;
            nMonths--;
        }
        if (nMonths < 0) { nMonths += 12; }

        nextComponents.innerHTML = buildComponentGrid([
            { value: nMonths, label: "Months" },
            { value: nDays, label: "Days" },
            { value: nHours, label: "Hours" },
            { value: nMinutes, label: "Minutes" },
            { value: nSeconds, label: "Seconds" },
        ]);

        nextTotals.innerHTML = buildTotalsList([
            { label: "Months", value: nMonths },
            { label: "Days", value: Math.floor(diffToNext / 86_400_000) },
            { label: "Hours", value: Math.floor(diffToNext / 3_600_000) },
            { label: "Minutes", value: Math.floor(diffToNext / 60_000) },
            { label: "Seconds", value: Math.floor(diffToNext / 1000) },
        ]);
    }
}

// ---------------------------------------------------------------------------
// Age calculation helpers
// ---------------------------------------------------------------------------

function calcSinceBirth(birthDate, now) {
    let years = now.getFullYear() - birthDate.getFullYear();
    let months = now.getMonth() - birthDate.getMonth();
    let days = now.getDate() - birthDate.getDate();
    let hours = now.getHours() - birthDate.getHours();
    let minutes = now.getMinutes() - birthDate.getMinutes();
    let seconds = now.getSeconds() - birthDate.getSeconds();

    if (seconds < 0) { seconds += 60; minutes--; }
    if (minutes < 0) { minutes += 60; hours--; }
    if (hours < 0) { hours += 24; days--; }
    if (days < 0) {
        const daysInPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        days += daysInPrevMonth;
        months--;
    }
    if (months < 0) { months += 12; years--; }

    return { years, months, days, hours, minutes, seconds };
}

// ---------------------------------------------------------------------------
// DOM builders
// ---------------------------------------------------------------------------

function buildComponentGrid(items) {
    return `<div class="unit-grid">${items
        .map(
            (i) => `
        <div class="unit-box">
            <span class="unit-box__value">${i.value.toLocaleString()}</span>
            <span class="unit-box__label">${i.label}</span>
        </div>`
        )
        .join("")}</div>`;
}

function buildTotalsList(items) {
    return `<div class="totals-list">${items
        .map(
            (i) => `
        <div class="totals-row">
            <span class="totals-row__label">${i.label}</span>
            <span class="totals-row__value">${i.value.toLocaleString()}</span>
        </div>`
        )
        .join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function showError(msg) {
    errorToast.textContent = msg;
    errorToast.hidden = false;
    setTimeout(() => { errorToast.hidden = true; }, 5000);
}

// ---------------------------------------------------------------------------
// Confetti effect (birthday only)
// ---------------------------------------------------------------------------

function launchConfetti() {
    const container = document.createElement("div");
    container.className = "confetti-container";
    document.body.appendChild(container);

    const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff6eb4", "#a66cff"];

    for (let i = 0; i < 150; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti-piece";
        piece.style.left = Math.random() * 100 + "%";
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 3 + "s";
        piece.style.animationDuration = (Math.random() * 2 + 3) + "s";
        piece.style.width = (Math.random() * 8 + 6) + "px";
        piece.style.height = (Math.random() * 8 + 6) + "px";
        container.appendChild(piece);
    }

    setTimeout(() => container.remove(), 8000);
}
