// --- 1. FFCS SLOTS MATRIX & PERIOD MAPPING ---
// 5 Days (0=Mon to 4=Fri) x 12 hours (0=8am ... 11=7pm) = 60 periods
const TIME_LABELS = [
  "08:00 - 08:50", "09:00 - 09:50", "10:00 - 10:50", "11:00 - 11:50",
  "12:00 - 12:50", "13:00 - 13:50 (Lunch)", "14:00 - 14:50", "15:00 - 15:50",
  "16:00 - 16:50", "17:00 - 17:50", "18:00 - 18:50", "19:00 - 19:50"
];

// ISO Days mapping for iCalendar RFC 5545 export
const DAY_CODES = ["MO", "TU", "WE", "TH", "FR"];
const DAY_START_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

const SLOT_MAP = {
  // Morning Theory
  A1: [0 * 12 + 0, 2 * 12 + 1],
  B1: [1 * 12 + 0, 3 * 12 + 1],
  C1: [2 * 12 + 0, 4 * 12 + 1],
  D1: [0 * 12 + 2, 2 * 12 + 3],
  E1: [1 * 12 + 2, 3 * 12 + 3],
  F1: [0 * 12 + 1, 2 * 12 + 2],
  G1: [1 * 12 + 1, 3 * 12 + 2],
  TA1: [4 * 12 + 0],
  TB1: [4 * 12 + 2],
  TC1: [4 * 12 + 3],

  // Evening Theory
  A2: [0 * 12 + 6, 2 * 12 + 7],
  B2: [1 * 12 + 6, 3 * 12 + 7],
  C2: [2 * 12 + 6, 4 * 12 + 7],
  D2: [0 * 12 + 8, 2 * 12 + 9],
  E2: [1 * 12 + 8, 3 * 12 + 9],
  F2: [0 * 12 + 7, 2 * 12 + 8],
  G2: [1 * 12 + 7, 3 * 12 + 8],
  TA2: [4 * 12 + 6],

  // Lab Slots (2-hour blocks)
  "L1+L2": [0 * 12 + 0, 0 * 12 + 1],
  "L3+L4": [0 * 12 + 2, 0 * 12 + 3],
  "L7+L8": [1 * 12 + 0, 1 * 12 + 1],
  "L9+L10": [1 * 12 + 2, 1 * 12 + 3],
  "L13+L14": [2 * 12 + 0, 2 * 12 + 1],
  "L15+L16": [2 * 12 + 2, 2 * 12 + 3],
  "L31+L32": [0 * 12 + 6, 0 * 12 + 7],
  "L33+L34": [0 * 12 + 8, 0 * 12 + 9],
  "L37+L38": [1 * 12 + 6, 1 * 12 + 7],
  "L43+L44": [2 * 12 + 6, 2 * 12 + 7]
};

const COURSE_COLORS = [
  { bg: "#dbeafe", border: "#2563eb", text: "#1e40af" },
  { bg: "#dcfce7", border: "#16a34a", text: "#166534" },
  { bg: "#fef3c7", border: "#d97706", text: "#92400e" },
  { bg: "#f3e8ff", border: "#9333ea", text: "#6b21a8" },
  { bg: "#ffe4e6", border: "#e11d48", text: "#9f1239" },
  { bg: "#e0f2fe", border: "#0284c7", text: "#075985" },
  { bg: "#ffedd5", border: "#ea580c", text: "#9a3412" }
];

function parseSlotString(str) {
  let mask = 0n;
  if (!str) return mask;
  const tokens = str.replace(/\s+/g, "").split("+");

  if (SLOT_MAP[str]) {
    for (const idx of SLOT_MAP[str]) mask |= 1n << BigInt(idx);
    return mask;
  }

  for (const token of tokens) {
    if (SLOT_MAP[token]) {
      for (const idx of SLOT_MAP[token]) mask |= 1n << BigInt(idx);
    }
  }
  return mask;
}

// Atomic theory + lab slot bitmask
function getAtomicBitmask(theorySlot, labSlot) {
  const m1 = parseSlotString(theorySlot);
  const m2 = parseSlotString(labSlot);
  // Internal clash: if theory & lab for the SAME option overlap, mark invalid
  if ((m1 & m2) !== 0n) return -1n;
  return m1 | m2;
}

// --- 2. CSP SOLVER WITH CREDIT & UTILITY EVALUATION ---
function evaluateScheduleMetrics(schedule) {
  let fullMask = 0n;
  let totalRating = 0;
  let totalCredits = 0;

  for (const item of schedule) {
    fullMask |= item.mask;
    totalRating += item.rating;
    totalCredits += item.credits;
  }

  let idleGaps = 0;
  let morningSlots = 0;
  let eveningSlots = 0;
  let fridayAfternoonSlots = 0;

  for (let day = 0; day < 5; day++) {
    const daySlots = [];
    for (let hour = 0; hour < 12; hour++) {
      if (hour === 5) continue; // Lunch
      const idx = day * 12 + hour;
      if ((fullMask & (1n << BigInt(idx))) !== 0n) {
        daySlots.push(hour);
        if (hour < 5) morningSlots++;
        if (hour > 5) eveningSlots++;
        if (day === 4 && hour > 5) fridayAfternoonSlots++;
      }
    }

    if (daySlots.length > 1) {
      for (let i = 0; i < daySlots.length - 1; i++) {
        const gap = daySlots[i + 1] - daySlots[i] - 1;
        const spansLunch = daySlots[i] < 5 && daySlots[i + 1] > 5;
        const netGap = spansLunch ? Math.max(0, gap - 1) : gap;
        idleGaps += netGap;
      }
    }
  }

  const avgRating = Number((totalRating / schedule.length).toFixed(2));
  // Multi-objective composite score:
  // Rewards faculty rating and clusters, penalizes gaps
  const compositeScore = Math.max(
    0,
    Math.round(avgRating * 20 - idleGaps * 5 + (morningSlots > eveningSlots ? 5 : 0))
  );

  return {
    totalCredits,
    avgRating,
    idleGaps,
    morningSlots,
    eveningSlots,
    fridayAfternoonSlots,
    compositeScore
  };
}

function solveAllTimetables(courses, minCredits, maxCredits, maxLimit = 300) {
  const results = [];
  const sorted = [...courses].sort((a, b) => a.options.length - b.options.length);

  function backtrack(idx, currentMask, currentSelection, accumulatedCredits) {
    if (idx === sorted.length) {
      if (accumulatedCredits >= minCredits && accumulatedCredits <= maxCredits) {
        const metrics = evaluateScheduleMetrics(currentSelection);
        results.push({ schedule: [...currentSelection], metrics });
      }
      return;
    }
    if (results.length >= maxLimit) return;

    const course = sorted[idx];
    for (const opt of course.options) {
      const optMask = getAtomicBitmask(opt.theorySlot, opt.labSlot);
      if (optMask === -1n) continue; // Internal clash between theory & lab

      if ((currentMask & optMask) === 0n) {
        currentSelection.push({
          code: course.code,
          credits: course.credits,
          faculty: opt.faculty,
          theorySlot: opt.theorySlot,
          labSlot: opt.labSlot,
          rating: opt.rating,
          mask: optMask
        });

        backtrack(
          idx + 1,
          currentMask | optMask,
          currentSelection,
          accumulatedCredits + course.credits
        );

        currentSelection.pop();
      }
    }
  }

  backtrack(0, 0n, [], 0);
  return results;
}

// --- 3. DIAGNOSTICS & DEADLOCK DETECTION ---
function diagnoseClashes(courses) {
  const deadlocks = [];

  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const c1 = courses[i];
      const c2 = courses[j];

      let allPairClash = true;
      for (const opt1 of c1.options) {
        const m1 = getAtomicBitmask(opt1.theorySlot, opt1.labSlot);
        for (const opt2 of c2.options) {
          const m2 = getAtomicBitmask(opt2.theorySlot, opt2.labSlot);
          if (m1 !== -1n && m2 !== -1n && (m1 & m2) === 0n) {
            allPairClash = false;
            break;
          }
        }
        if (!allPairClash) break;
      }

      if (allPairClash) {
        deadlocks.push(
          `<strong>Deadlock between ${c1.code} and ${c2.code}:</strong> All section options conflict between these two subjects.`
        );
      }
    }
  }
  return deadlocks;
}

// --- 4. EXPORT TO .ICS (RFC 5545 CALENDAR) ---
function exportToICS(solutionObj) {
  let icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI FFCS Timetable Optimizer//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];

  // Arbitrary baseline Monday (Semester Start Date): 2026-10-19
  const baseYear = 2026;
  const baseMonth = 10;
  const baseStartDay = 19; // Monday

  solutionObj.schedule.forEach((item) => {
    for (let day = 0; day < 5; day++) {
      for (let hour = 0; hour < 12; hour++) {
        if (hour === 5) continue;
        const periodIdx = day * 12 + hour;
        if ((item.mask & (1n << BigInt(periodIdx))) !== 0n) {
          const eventDay = baseStartDay + day;
          const startHourStr = String(DAY_START_HOURS[hour]).padStart(2, "0");
          const endHourStr = String(DAY_START_HOURS[hour] + 1).padStart(2, "0");
          const dtStart = `${baseYear}${baseMonth}${eventDay}T${startHourStr}0000`;
          const dtEnd = `${baseYear}${baseMonth}${eventDay}T${endHourStr}0000`;

          icsLines.push(
            "BEGIN:VEVENT",
            `SUMMARY:${item.code} (${item.faculty || "Class"})`,
            `DESCRIPTION:Slot: ${item.theorySlot} ${item.labSlot ? "/ " + item.labSlot : ""} | Credits: ${item.credits}`,
            `DTSTART:${dtStart}`,
            `DTEND:${dtEnd}`,
            `RRULE:FREQ=WEEKLY;UNTIL=${baseYear}1231T235959Z`,
            "END:VEVENT"
          );
        }
      }
    }
  });

  icsLines.push("END:VCALENDAR");

  const blob = new Blob([icsLines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `FFCS_Timetable_${solutionObj.metrics.compositeScore}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// --- 5. UI CONTROLLER & EVENT LISTENERS ---
let generatedSolutions = [];
let currentSortedList = [];
let currentIndex = 0;

const courseListEl = document.getElementById("course-list");
const statusEl = document.getElementById("status-message");
const resultsCountEl = document.getElementById("results-count");
const pageIndicatorEl = document.getElementById("page-indicator");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const sortSelect = document.getElementById("sort-select");
const metricsBar = document.getElementById("metrics-bar");
const creditCounterEl = document.getElementById("credit-counter");

function updateTotalCreditCounter() {
  let sum = 0;
  document.querySelectorAll(".course-card").forEach((card) => {
    const cr = parseInt(card.querySelector(".course-credits").value) || 0;
    sum += cr;
  });
  creditCounterEl.textContent = `${sum} Credits Selected`;
}

function createCourseCard(code = "", credits = 4, options = []) {
  const card = document.createElement("div");
  card.className = "course-card";

  card.innerHTML = `
    <div class="course-header">
      <input type="text" class="course-code" placeholder="Course (e.g. CSE2001)" value="${code}" />
      <input type="number" class="course-credits" placeholder="Credits" value="${credits}" min="1" max="6" />
      <button class="btn danger remove-course">&times;</button>
    </div>
    <div class="options-container"></div>
    <button class="btn outline add-option" style="margin-top:0.4rem; font-size:0.75rem;">+ Add Section / Faculty</button>
  `;

  const optionsContainer = card.querySelector(".options-container");

  function addOptionRow(faculty = "", theorySlot = "", labSlot = "", rating = 4) {
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `
      <input type="text" class="faculty-name" placeholder="Faculty" value="${faculty}" />
      <input type="text" class="theory-slot" placeholder="Theory (A1+TA1)" value="${theorySlot}" />
      <input type="text" class="lab-slot" placeholder="Lab (L31+L32)" value="${labSlot}" />
      <select class="faculty-rating">
        <option value="5" ${rating == 5 ? "selected" : ""}>5★</option>
        <option value="4" ${rating == 4 ? "selected" : ""}>4★</option>
        <option value="3" ${rating == 3 ? "selected" : ""}>3★</option>
        <option value="2" ${rating == 2 ? "selected" : ""}>2★</option>
        <option value="1" ${rating == 1 ? "selected" : ""}>1★</option>
      </select>
      <button class="btn danger remove-option">&times;</button>
    `;
    row.querySelector(".remove-option").addEventListener("click", () => row.remove());
    optionsContainer.appendChild(row);
  }

  if (options.length === 0) {
    addOptionRow();
  } else {
    options.forEach((opt) => addOptionRow(opt.faculty, opt.theorySlot, opt.labSlot, opt.rating));
  }

  card.querySelector(".add-option").addEventListener("click", () => addOptionRow());
  card.querySelector(".remove-course").addEventListener("click", () => {
    card.remove();
    updateTotalCreditCounter();
  });
  card.querySelector(".course-credits").addEventListener("input", updateTotalCreditCounter);

  courseListEl.appendChild(card);
  updateTotalCreditCounter();
}

// Demo Data Preset with Bundled Theory + Lab and Faculty Ratings
document.getElementById("load-demo-btn").addEventListener("click", () => {
  courseListEl.innerHTML = "";
  createCourseCard("CSE2001", 4, [
    { faculty: "Dr. Sharma", theorySlot: "A1+TA1", labSlot: "L31+L32", rating: 5 },
    { faculty: "Prof. Verma", theorySlot: "B1", labSlot: "L1+L2", rating: 4 }
  ]);
  createCourseCard("MAT2001", 4, [
    { faculty: "Dr. Grace", theorySlot: "C1", labSlot: "", rating: 5 },
    { faculty: "Dr. Alan", theorySlot: "D1", labSlot: "", rating: 3 }
  ]);
  createCourseCard("CSE2002", 4, [
    { faculty: "Prof. Joy", theorySlot: "E1", labSlot: "L37+L38", rating: 5 },
    { faculty: "Prof. Linus", theorySlot: "F1", labSlot: "L7+L8", rating: 4 }
  ]);
  createCourseCard("PHY1701", 3, [
    { faculty: "Dr. Neil", theorySlot: "B2", labSlot: "", rating: 4 },
    { faculty: "Dr. Sagan", theorySlot: "A2", labSlot: "", rating: 5 }
  ]);
  createCourseCard("ENG1001", 2, [
    { faculty: "Prof. Maya", theorySlot: "TA2", labSlot: "", rating: 4 },
    { faculty: "Prof. Blake", theorySlot: "TB1", labSlot: "", rating: 3 }
  ]);
  updateTotalCreditCounter();
});

document.getElementById("add-course-btn").addEventListener("click", () => createCourseCard());

// Sorting Function
function applySort() {
  const criteria = sortSelect.value;
  currentSortedList = [...generatedSolutions];

  if (criteria === "composite") {
    currentSortedList.sort((a, b) => b.metrics.compositeScore - a.metrics.compositeScore);
  } else if (criteria === "rating") {
    currentSortedList.sort((a, b) => b.metrics.avgRating - a.metrics.avgRating);
  } else if (criteria === "least-gaps") {
    currentSortedList.sort((a, b) => a.metrics.idleGaps - b.metrics.idleGaps);
  } else if (criteria === "morning") {
    currentSortedList.sort((a, b) => b.metrics.morningSlots - a.metrics.morningSlots);
  } else if (criteria === "evening") {
    currentSortedList.sort((a, b) => b.metrics.eveningSlots - a.metrics.eveningSlots);
  } else if (criteria === "free-friday") {
    currentSortedList.sort((a, b) => a.metrics.fridayAfternoonSlots - b.metrics.fridayAfternoonSlots);
  }

  currentIndex = 0;
  renderCurrentSolution();
}

sortSelect.addEventListener("change", applySort);

// Main Optimization Trigger
document.getElementById("generate-btn").addEventListener("click", () => {
  statusEl.classList.add("hidden");
  statusEl.innerHTML = "";

  const minCredits = parseInt(document.getElementById("min-credits").value) || 0;
  const maxCredits = parseInt(document.getElementById("max-credits").value) || 35;

  const courses = [];
  document.querySelectorAll(".course-card").forEach((card) => {
    const code = card.querySelector(".course-code").value.trim();
    const credits = parseInt(card.querySelector(".course-credits").value) || 0;
    const options = [];

    card.querySelectorAll(".option-row").forEach((row) => {
      const faculty = row.querySelector(".faculty-name").value.trim();
      const theorySlot = row.querySelector(".theory-slot").value.trim().toUpperCase();
      const labSlot = row.querySelector(".lab-slot").value.trim().toUpperCase();
      const rating = parseInt(row.querySelector(".faculty-rating").value) || 4;

      if (theorySlot || labSlot) {
        options.push({ faculty, theorySlot, labSlot, rating });
      }
    });

    if (code && options.length > 0) {
      courses.push({ code, credits, options });
    }
  });

  if (courses.length === 0) {
    statusEl.textContent = "Please add at least one course with valid slot options.";
    statusEl.className = "status-box error";
    statusEl.classList.remove("hidden");
    return;
  }

  generatedSolutions = solveAllTimetables(courses, minCredits, maxCredits);
  resultsCountEl.textContent = `${generatedSolutions.length} combinations found`;

  if (generatedSolutions.length === 0) {
    const diagnostics = diagnoseClashes(courses);
    let errorHTML = "<strong>No clash-free schedules found!</strong>";
    if (diagnostics.length > 0) {
      errorHTML += "<ul>" + diagnostics.map((d) => `<li>${d}</li>`).join("") + "</ul>";
    } else {
      errorHTML += "<p>Check if your selected courses violate the Credit Range limits or have overlapping slots.</p>";
    }
    statusEl.innerHTML = errorHTML;
    statusEl.className = "status-box error";
    statusEl.classList.remove("hidden");
    metricsBar.classList.add("hidden");
    renderGrid(null);
  } else {
    applySort();
  }
});

// Grid Renderer
function renderGrid(solutionObj) {
  const tbody = document.getElementById("timetable-body");
  tbody.innerHTML = "";

  const courseColorMap = {};
  let colorIdx = 0;

  for (let hour = 0; hour < 12; hour++) {
    const tr = document.createElement("tr");

    const timeTd = document.createElement("td");
    timeTd.style.fontWeight = "600";
    timeTd.style.background = "#f8fafc";
    timeTd.textContent = TIME_LABELS[hour];
    tr.appendChild(timeTd);

    if (hour === 5) {
      const lunchTd = document.createElement("td");
      lunchTd.colSpan = 5;
      lunchTd.className = "lunch-period";
      lunchTd.textContent = "LUNCH BREAK (13:00 - 14:00)";
      tr.appendChild(lunchTd);
    } else {
      for (let day = 0; day < 5; day++) {
        const td = document.createElement("td");
        const periodIdx = day * 12 + hour;

        if (solutionObj) {
          for (const item of solutionObj.schedule) {
            if ((item.mask & (1n << BigInt(periodIdx))) !== 0n) {
              if (!courseColorMap[item.code]) {
                courseColorMap[item.code] = COURSE_COLORS[colorIdx % COURSE_COLORS.length];
                colorIdx++;
              }
              const color = courseColorMap[item.code];
              td.innerHTML = `
                <div class="cell-slot" style="background:${color.bg}; border-left:3px solid ${color.border};">
                  <strong style="color:${color.text}">${item.code} (${item.credits}cr)</strong>
                  <span>${item.faculty || "Faculty"} • ${item.rating}★</span>
                </div>
              `;
              break;
            }
          }
        }
        tr.appendChild(td);
      }
    }
    tbody.appendChild(tr);
  }
}

function renderCurrentSolution() {
  if (currentSortedList.length === 0) {
    metricsBar.classList.add("hidden");
    return;
  }

  const current = currentSortedList[currentIndex];
  pageIndicatorEl.textContent = `${currentIndex + 1} / ${currentSortedList.length}`;
  prevBtn.disabled = currentIndex === 0;
  nextBtn.disabled = currentIndex === currentSortedList.length - 1;

  metricsBar.classList.remove("hidden");
  document.getElementById("metric-credits").textContent = current.metrics.totalCredits;
  document.getElementById("metric-rating").textContent = current.metrics.avgRating;
  document.getElementById("metric-gaps").textContent = current.metrics.idleGaps;
  document.getElementById("metric-shift").textContent = `${current.metrics.morningSlots} / ${current.metrics.eveningSlots}`;
  document.getElementById("metric-score").textContent = current.metrics.compositeScore;

  renderGrid(current);
}

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) {
    currentIndex--;
    renderCurrentSolution();
  }
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < currentSortedList.length - 1) {
    currentIndex++;
    renderCurrentSolution();
  }
});

// CSV/JSON File Import
document.getElementById("csv-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const content = event.target.result;
      if (file.name.endsWith(".json")) {
        const data = JSON.parse(content);
        courseListEl.innerHTML = "";
        data.forEach((c) => createCourseCard(c.code, c.credits, c.options));
      } else {
        // Simple CSV parser: Code, Credits, Faculty, TheorySlot, LabSlot, Rating
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        const map = {};
        for (let i = 1; i < lines.length; i++) {
          const [code, cr, faculty, tSlot, lSlot, rating] = lines[i].split(",").map((s) => s.trim());
          if (!map[code]) map[code] = { credits: parseInt(cr) || 4, options: [] };
          map[code].options.push({
            faculty,
            theorySlot: tSlot,
            labSlot: lSlot || "",
            rating: parseInt(rating) || 4
          });
        }
        courseListEl.innerHTML = "";
        Object.keys(map).forEach((k) => createCourseCard(k, map[k].credits, map[k].options));
      }
      updateTotalCreditCounter();
      alert("Course catalog imported successfully!");
    } catch (err) {
      alert("Failed to parse file. Make sure it matches the expected JSON/CSV format.");
    }
  };
  reader.readAsText(file);
});

// .ICS Calendar Export Trigger
document.getElementById("export-ics-btn").addEventListener("click", () => {
  if (currentSortedList.length === 0) {
    alert("Please generate and select a timetable first.");
    return;
  }
  exportToICS(currentSortedList[currentIndex]);
});

// Print / PDF Trigger
document.getElementById("export-btn").addEventListener("click", () => {
  if (currentSortedList.length === 0) {
    alert("Please generate and select a timetable first.");
    return;
  }
  window.print();
});

// Initial Blank Render
renderGrid(null);