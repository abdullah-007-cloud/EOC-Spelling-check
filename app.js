const inputEl = document.getElementById("input");
const outputEl = document.getElementById("output");
const checkBtn = document.getElementById("checkBtn");
const fixChronBtn = document.getElementById("fixChronBtn");
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

// ---------- Chips + Protected Terms ----------
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

// ---------- Detect Companies (1–3 words before CO/Co + punctuation) ----------
function detectCompanies(text) {
  const companies = new Set();
  const regex =
    /\b((?:[A-Za-z0-9&.\-\/]+\s+){0,2}[A-Za-z0-9&.\-\/]+)\s+(?:CO|Co)\b\s*[.,;:]?,?/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length < 2) continue;
    companies.add(name);
  }
  return Array.from(companies);
}

function updateDetectedCompaniesUI() {
  const text = inputEl.value || "";
  const detected = detectCompanies(text);
  renderChips(detectedCompaniesChipsEl, detected);

  // Auto-add detected companies to Protected Terms
  const merged = Array.from(new Set([...parseProtectedTerms(), ...detected]));
  setProtectedTerms(merged);
}

inputEl.addEventListener("input", () => {
  updateDetectedCompaniesUI();
  analyzeTimelineToUI(inputEl.value || "");
});
updateDetectedCompaniesUI();

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
      ? "(Suggestions were found, but no direct replacements were applied — or changes were blocked by Protected Terms.)"
      : "(No adjusted words found)";
  }
  return changes.map(c => `${c.before} → ${c.after}`).join("\n");
}

// ---------- TIMELINE PARSING + ANALYSIS ----------
function parseTimeFromLine(line) {
  // Supports: "1741hrs", "1741 hrs", "1741hrs.", "0125hrs."
  const m = line.match(/\b(\d{3,4})\s*hrs\b/i);
  if (!m) return null;

  const raw = m[1];
  // 3 digits => HMM, 4 digits => HHMM
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
      // start a new block
      if (current) blocks.push(current);
      current = { time: t, lines: [line] };
    } else {
      // attach to current block if exists, else standalone block without time
      if (current) current.lines.push(line);
      else blocks.push({ time: null, lines: [line] });
    }
  }
  if (current) blocks.push(current);

  return blocks;
}

function analyzeTimeline(blocks) {
  // Consider only timed blocks for chronology checks
  const timed = blocks
    .map((b, idx) => ({ ...b, idx }))
    .filter(b => b.time);

  if (timed.length < 2) {
    return { issues: ["No or not enough timestamps to analyze."], rolloverCount: 0 };
  }

  const issues = [];
  let rolloverCount = 0;

  let lastAdj = null;
  let dayOffset = 0;

  const seen = new Map(); // minutesAdj -> count

  for (let i = 0; i < timed.length; i++) {
    const cur = timed[i];
    const baseMin = cur.time.minutes;
    let adj = baseMin + dayOffset;

    if (lastAdj !== null && adj < lastAdj) {
      // assume midnight rollover
      dayOffset += 1440;
      adj = baseMin + dayOffset;
      rolloverCount++;
      issues.push(`Midnight rollover detected near: "${cur.lines[0].trim()}"`);
    }

    // out-of-order check (if still out after rollover logic)
    if (lastAdj !== null && adj < lastAdj) {
      issues.push(`Out-of-order timestamp near: "${cur.lines[0].trim()}"`);
    }

    // duplicate time check
    const key = adj;
    seen.set(key, (seen.get(key) || 0) + 1);

    cur._adjMinutes = adj;
    lastAdj = adj;
  }

  for (const [k, c] of seen.entries()) {
    if (c > 1) issues.push(`Duplicate timestamp detected (${c} times) at minute: ${k}`);
  }

  if (issues.length === 0) issues.push("No chronology issues detected ✅");

  return { issues, rolloverCount };
}

function analyzeTimelineToUI(text) {
  const blocks = splitIntoTimestampBlocks(text);
  const { issues } = analyzeTimeline(blocks);
  timelineEl.textContent = issues.join("\n");
}

analyzeTimelineToUI(inputEl.value || "");

// ---------- FIX CHRONOLOGY ----------
function fixChronology(text) {
  const blocks = splitIntoTimestampBlocks(text);

  // compute adjusted minutes with midnight rollover for sorting
  let dayOffset = 0;
  let lastAdj = null;

  for (const b of blocks) {
    if (!b.time) continue;

    let adj = b.time.minutes + dayOffset;

    if (lastAdj !== null && adj < lastAdj) {
      dayOffset += 1440;
      adj = b.time.minutes + dayOffset;
    }

    b._adjMinutes = adj;
    lastAdj = adj;
  }

  // Keep untimed blocks in-place unless they were attached to a timed block (already inside block)
  // Standalone untimed blocks (time=null) will remain at their relative position by giving them a stable key.
  let stableCounter = 0;
  for (const b of blocks) {
    if (b.time) continue;
    b._adjMinutes = Number.NEGATIVE_INFINITY + stableCounter; // keep order at top
    stableCounter++;
  }

  // Sort: untimed standalone first (in original order), then timed blocks by adjusted minutes
  const sorted = [...blocks].sort((a, b) => {
    const ax = a._adjMinutes ?? 0;
    const bx = b._adjMinutes ?? 0;
    return ax - bx;
  });

  return sorted.map(b => b.lines.join("\n")).join("\n");
}

// ---------- UI helpers ----------
function setBusy(b) {
  checkBtn.disabled = b;
  copyBtn.disabled = b;
  fixChronBtn.disabled = b;
}

// ---------- MAIN: SPELL CHECK ----------
checkBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  statusEl.textContent = "";
  outputEl.textContent = "(Result will appear here)";
  changesEl.textContent = "(Changes will appear here)";
  changesCountEl.textContent = "";
  timelineEl.textContent = "(Timeline analysis will appear here)";

  const text = (inputEl.value || "").trim();
  if (!text) {
    errorEl.textContent = "Paste a report first.";
    return;
  }

  try {
    setBusy(true);
    statusEl.textContent = "Checking…";

    updateDetectedCompaniesUI();
    analyzeTimelineToUI(text);

    const data = await checkSpelling(text, langEl.value);
    const matches = data.matches || [];
    const protectedTerms = parseProtectedTerms();

    const { updated, changes } = applyCorrectionsAndTrack(text, matches, protectedTerms);

    outputEl.textContent = updated;
    changesEl.textContent = formatChanges(changes, matches.length);
    changesCountEl.textContent = changes.length ? `(${changes.length})` : "";

    // Re-run timeline analysis on adjusted output too
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

// ---------- FIX CHRONOLOGY button ----------
fixChronBtn.addEventListener("click", () => {
  errorEl.textContent = "";
  statusEl.textContent = "";

  const text = (inputEl.value || "").trim();
  if (!text) {
    errorEl.textContent = "Paste a report first.";
    return;
  }

  // Fix based on the raw input (operator controlled)
  const fixed = fixChronology(text);

  // Put the fixed output into Adjusted Report (doesn't overwrite the input)
  outputEl.textContent = fixed;

  // Run timeline analysis on fixed
  analyzeTimelineToUI(fixed);

  statusEl.textContent = "Chronology fixed ✅";
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
