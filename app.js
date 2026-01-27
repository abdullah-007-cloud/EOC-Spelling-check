const inputEl = document.getElementById("input");
const outputEl = document.getElementById("output");
const runBtn = document.getElementById("runBtn");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const langEl = document.getElementById("lang");

const changesEl = document.getElementById("changes");
const changesCountEl = document.getElementById("changesCount");
const timelineEl = document.getElementById("timeline");

const themeSelect = document.getElementById("themeSelect");

const protectedEl = document.getElementById("protectedTerms");
const protectedChipsEl = document.getElementById("protectedChips");
const detectedCompaniesChipsEl = document.getElementById("detectedCompaniesChips");

// ---------- THEMES ----------
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("amaalaTheme", theme);
}
function loadTheme() {
  const saved = localStorage.getItem("amaalaTheme") || "dark";
  setTheme(saved);
  if (themeSelect) themeSelect.value = saved;
}
themeSelect?.addEventListener("change", () => setTheme(themeSelect.value));
loadTheme();

// ---------- CHIPS + PROTECTED ----------
function renderChips(container, items) {
  container.innerHTML = "";
  items.forEach(t => {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = t;
    container.appendChild(span);
  });
}

function parseProtectedTerms() {
  const raw = (protectedEl.value || "");
  return Array.from(new Set(
    raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  ));
}

function setProtectedTerms(terms) {
  const unique = Array.from(new Set(terms));
  protectedEl.value = unique.join("\n");
  renderChips(protectedChipsEl, unique);
  localStorage.setItem("amaalaProtectedTerms", JSON.stringify(unique));
}

function loadProtectedTerms() {
  try {
    const saved = JSON.parse(localStorage.getItem("amaalaProtectedTerms") || "null");
    if (Array.isArray(saved) && saved.length) {
      protectedEl.value = saved.join("\n");
      renderChips(protectedChipsEl, saved);
      return;
    }
  } catch {}
  setProtectedTerms(["ICAD", "TBCV", "AMAALA", "RSSSC"]);
}

protectedEl.addEventListener("input", () => {
  const terms = parseProtectedTerms();
  renderChips(protectedChipsEl, terms);
  localStorage.setItem("amaalaProtectedTerms", JSON.stringify(terms));
});

loadProtectedTerms();

// ---------- DETECT COMPANIES (keeps "Al Harbi") ----------
// Captures up to 4 words before Co/CO and preserves small prefixes like "Al"
function detectCompanies(text) {
  const companies = new Set();

  // Words may include letters/numbers and & . - /
  // Capture 1–4 words before "Co/CO"
  const regex =
    /\b((?:[A-Za-z0-9&.\-\/]+(?:\s+|-\s*)?){1,4})\s+(?:CO|Co)\b\s*[.,;:]?,?/g;

  let m;
  while ((m = regex.exec(text)) !== null) {
    let name = (m[1] || "").trim();

    // Clean trailing hyphens/spaces
    name = name.replace(/[-\s]+$/g, "").trim();

    // Optional: normalize multiple spaces
    name = name.replace(/\s+/g, " ");

    if (name.length >= 2) companies.add(name);
  }

  return Array.from(companies);
}

function updateDetectedCompanies(text) {
  const detected = detectCompanies(text);
  renderChips(detectedCompaniesChipsEl, detected);

  // Auto-add to Protected Terms (prevents wrong replacements)
  const merged = Array.from(new Set([...parseProtectedTerms(), ...detected]));
  setProtectedTerms(merged);

  return detected;
}

// ---------- LanguageTool API ----------
async function checkSpelling(text, language) {
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("language", language);

  const res = await fetch("https://api.languagetool.org/v2/check", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function applyCorrectionsAndTrack(originalText, matches, protectedTerms) {
  const sorted = [...matches].sort((a, b) => b.offset - a.offset);

  let updated = originalText;
  const changes = [];

  // Case-insensitive protection
  const protectedLower = new Set(protectedTerms.map(t => t.toLowerCase()));

  for (const m of sorted) {
    if (!m.replacements || m.replacements.length === 0) continue;

    const before = originalText.slice(m.offset, m.offset + m.length);
    const after = m.replacements[0].value;

    if (protectedLower.has(before.toLowerCase())) continue;
    if (!before || before === after) continue;

    updated =
      updated.slice(0, m.offset) +
      after +
      updated.slice(m.offset + m.length);

    changes.push({ offset: m.offset, before, after });
  }

  changes.sort((a, b) => a.offset - b.offset);
  return { updated, changes };
}

function formatChanges(changes, suggestionsFound) {
  if (!changes.length) {
    return suggestionsFound
      ? "(Suggestions found, but no direct replacements were applied — or changes were blocked by Protected Terms.)"
      : "(No adjusted words found)";
  }
  return changes.map(c => `${c.before} → ${c.after}`).join("\n");
}

// ---------- TIMELINE PARSE + SMART ROLLOVER ----------
function parseTimeFromLine(line) {
  // Supports: 1322hrs. / 1322 hrs / 0125hrs / 925hrs
  const m = line.match(/\b(\d{3,4})\s*hrs\b/i);
  if (!m) return null;

  const raw = m[1];
  let hh, mm;

  if (raw.length === 3) {
    hh = parseInt(raw.slice(0, 1), 10);
    mm = parseInt(raw.slice(1), 10);
  } else {
    hh = parseInt(raw.slice(0, 2), 10);
    mm = parseInt(raw.slice(2), 10);
  }

  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  return { hh, mm, minutes: hh * 60 + mm, token: m[0] };
}

function splitIntoTimestampBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const t = parseTimeFromLine(line);

    if (t) {
      if (current) blocks.push(current);
      current = { time: t, lines: [line] };
    } else {
      if (current) current.lines.push(line);
      else blocks.push({ time: null, lines: [line] });
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/**
 * Smart rollover:
 * Only treat as "midnight rollover" if last time is late (>= 20:00) and current is early (<= 06:00)
 * Otherwise it's a real out-of-order error (like your 1330 then 1323)
 */
function analyzeTimeline(blocks) {
  const timed = blocks.filter(b => b.time);
  if (timed.length < 2) return ["No or not enough timestamps to analyze."];

  const issues = [];
  let dayOffset = 0;
  let lastAdj = null;
  let lastBase = null;

  for (let i = 0; i < timed.length; i++) {
    const base = timed[i].time.minutes;
    let adj = base + dayOffset;

    if (lastAdj !== null && adj < lastAdj) {
      const lastLate = lastBase >= (20 * 60);   // >= 20:00
      const curEarly = base <= (6 * 60);        // <= 06:00

      if (lastLate && curEarly) {
        dayOffset += 1440;
        adj = base + dayOffset;
        issues.push(`Midnight rollover detected near: "${timed[i].lines[0].trim()}"`);
      } else {
        issues.push(`Out-of-order timestamp detected: "${timed[i].lines[0].trim()}" (appears after a later time)`);
      }
    }

    lastAdj = adj;
    lastBase = base;
    timed[i]._adj = adj;
  }

  if (issues.length === 0) issues.push("No chronology issues detected ✅");
  return issues;
}

function analyzeTimelineToUI(text) {
  const blocks = splitIntoTimestampBlocks(text);
  const issues = analyzeTimeline(blocks);
  timelineEl.textContent = issues.join("\n");
}

// ---------- FIX CHRONOLOGY (sort timed blocks; keep rollover rule) ----------
function fixChronology(text) {
  const blocks = splitIntoTimestampBlocks(text);

  // compute adjusted minutes with SMART rollover for sorting
  let dayOffset = 0;
  let lastAdj = null;
  let lastBase = null;

  for (const b of blocks) {
    if (!b.time) continue;

    const base = b.time.minutes;
    let adj = base + dayOffset;

    if (lastAdj !== null && adj < lastAdj) {
      const lastLate = lastBase >= (20 * 60);
      const curEarly = base <= (6 * 60);

      if (lastLate && curEarly) {
        dayOffset += 1440;
        adj = base + dayOffset;
      }
      // else: it's truly out-of-order, no dayOffset; we still sort by base within same day below
    }

    b._sortKey = adj;
    lastAdj = adj;
    lastBase = base;
  }

  // Keep untimed blocks in place at the top (rare)
  let stable = 0;
  for (const b of blocks) {
    if (b.time) continue;
    b._sortKey = Number.NEGATIVE_INFINITY + stable++;
  }

  // Sort by key
  const sorted = [...blocks].sort((a, b) => (a._sortKey ?? 0) - (b._sortKey ?? 0));
  return sorted.map(b => b.lines.join("\n")).join("\n");
}

// ---------- ONE BUTTON: RUN QA ----------
function setBusy(b) {
  runBtn.disabled = b;
  copyBtn.disabled = b;
}

runBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  statusEl.textContent = "";
  outputEl.textContent = "(Result will appear here)";
  changesEl.textContent = "(Changes will appear here)";
  changesCountEl.textContent = "";
  timelineEl.textContent = "(Timeline analysis will appear here)";

  const raw = (inputEl.value || "").trim();
  if (!raw) {
    errorEl.textContent = "Paste a report first.";
    return;
  }

  try {
    setBusy(true);
    statusEl.textContent = "Running QA…";

    // 1) Detect companies + protect them
    updateDetectedCompanies(raw);

    // 2) Fix chronology first (so output is in order)
    const chronoFixed = fixChronology(raw);

    // 3) Analyze chronology (after fix) and show
    analyzeTimelineToUI(chronoFixed);

    // 4) Spell check on chrono-fixed text
    const data = await checkSpelling(chronoFixed, langEl.value);
    const matches = data.matches || [];
    const protectedTerms = parseProtectedTerms();

    const { updated, changes } = applyCorrectionsAndTrack(chronoFixed, matches, protectedTerms);

    // 5) Output final + changes + timeline on final too
    outputEl.textContent = updated;
    changesEl.textContent = formatChanges(changes, matches.length);
    changesCountEl.textContent = changes.length ? `(${changes.length})` : "";
    analyzeTimelineToUI(updated);

    statusEl.textContent = "Done ✅";
  } catch (e) {
    console.error(e);
    errorEl.textContent = "API blocked or rate-limited.";
    statusEl.textContent = "";
  } finally {
    setBusy(false);
  }
});

// ---------- COPY ----------
copyBtn.addEventListener("click", async () => {
  const text = outputEl.textContent || "";
  if (!text || text.startsWith("(")) return;

  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = "Copied ✅";
    setTimeout(() => (statusEl.textContent = ""), 1200);
  } catch {
    errorEl.textContent = "Copy blocked by browser.";
  }
});

// Live: keep companies + timeline visible while typing
inputEl.addEventListener("input", () => {
  updateDetectedCompanies(inputEl.value || "");
  analyzeTimelineToUI(inputEl.value || "");
});
updateDetectedCompanies(inputEl.value || "");
analyzeTimelineToUI(inputEl.value || "");
