// ===== Elements =====
const inputEl = document.getElementById("input");
const outputEl = document.getElementById("output");
const runBtn = document.getElementById("runBtn");      // button in HTML
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

// ===== Themes =====
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

// ===== Chips + Protected Terms =====
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

// ===== Smarter Company Detection =====
// Goal: detect "Al Harbi Co.,", "Red Sea Co.", etc — NOT "call from Al Harbi Co."
// Strategy:
// 1) Grab up to 6 words before Co/CO.
// 2) Clean it:
//    - if phrase contains " from ", keep only what comes AFTER the last "from"
//    - remove leading junk words like "call", "received", "phone", "reporting", etc.
//    - keep final cleaned name if it looks like a name (>=2 chars, has letters)
function cleanCompanyName(raw) {
  let s = (raw || "").trim();

  // normalize whitespace
  s = s.replace(/\s+/g, " ");

  // if it contains " from ", keep only after the last "from"
  const lower = s.toLowerCase();
  const idx = lower.lastIndexOf(" from ");
  if (idx !== -1) {
    s = s.slice(idx + " from ".length).trim();
  }

  // remove common leading junk words
  // (we only strip from the start)
  const junkStarts = [
    "a", "an", "the",
    "call", "phone", "telephone", "radio",
    "received", "receive", "receiving",
    "report", "reported", "reporting",
    "message", "sms",
    "from" // just in case
  ];

  // strip multiple leading words if they match junk list
  let parts = s.split(" ");
  while (parts.length && junkStarts.includes(parts[0].toLowerCase())) {
    parts.shift();
  }
  s = parts.join(" ").trim();

  // remove trailing punctuation/dashes
  s = s.replace(/[-–—,:;.\s]+$/g, "").trim();

  // sanity checks: must contain a letter
  if (!/[A-Za-z]/.test(s)) return null;

  // avoid obviously wrong long phrases
  if (s.toLowerCase().includes("call")) return null;

  // Keep it
  return s.length >= 2 ? s : null;
}

function detectCompanies(text) {
  const companies = new Set();

  // Grab up to 6 tokens before CO/Co (this catches "Al Harbi", "Red Sea", "Four Seasons", etc.)
  // Tokens allow letters/numbers and & . - /
  const regex =
    /\b((?:[A-Za-z0-9&.\-\/]+\s+){0,5}[A-Za-z0-9&.\-\/]+)\s+(?:CO|Co)\b\s*[.,;:]?,?/g;

  let m;
  while ((m = regex.exec(text)) !== null) {
    const cleaned = cleanCompanyName(m[1]);
    if (cleaned) companies.add(cleaned);
  }

  return Array.from(companies);
}

function updateDetectedCompanies(text) {
  const detected = detectCompanies(text);
  renderChips(detectedCompaniesChipsEl, detected);

  // Auto add to Protected Terms so spell-check won't ruin them
  const merged = Array.from(new Set([...parseProtectedTerms(), ...detected]));
  setProtectedTerms(merged);

  return detected;
}

// ===== LanguageTool Spell Check =====
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
      ? "(Suggestions found, but replacements were blocked (Protected Terms) or not applied.)"
      : "(No adjusted words found)";
  }
  return changes.map(c => `${c.before} → ${c.after}`).join("\n");
}

// ===== Timeline Parsing + Validation =====
function parseTimeToken(tokenDigits) {
  // tokenDigits is 3 or 4 digits string
  let hh, mm;
  if (tokenDigits.length === 3) {
    hh = parseInt(tokenDigits.slice(0, 1), 10);
    mm = parseInt(tokenDigits.slice(1), 10);
  } else {
    hh = parseInt(tokenDigits.slice(0, 2), 10);
    mm = parseInt(tokenDigits.slice(2), 10);
  }
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm, minutes: hh * 60 + mm };
}

function findInvalidTimestamps(text) {
  // Find ANY "<digits>hrs" and validate:
  // valid must be 3 or 4 digits AND HH/MM range ok.
  const invalids = [];
  const re = /\b(\d{1,6})\s*hrs\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const digits = m[1];
    const full = m[0];

    if (!(digits.length === 3 || digits.length === 4)) {
      invalids.push(`Invalid timestamp format: "${full}" (must be 3–4 digits like 925hrs or 1322hrs)`);
      continue;
    }
    const parsed = parseTimeToken(digits);
    if (!parsed) {
      invalids.push(`Invalid timestamp value: "${full}" (HH must be 00–23 and MM 00–59)`);
    }
  }
  return invalids;
}

function parseTimeFromLine(line) {
  // Extract only valid 3–4 digit time tokens from the line.
  const m = line.match(/\b(\d{3,4})\s*hrs\b/i);
  if (!m) return null;

  const parsed = parseTimeToken(m[1]);
  if (!parsed) return null;

  return { ...parsed, token: m[0] };
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

// Smart rollover rule: only when last >= 20:00 and current <= 06:00
function analyzeTimeline(text) {
  const issues = [];

  // 1) Invalid timestamps anywhere
  const invalids = findInvalidTimestamps(text);
  issues.push(...invalids);

  // 2) Out-of-order detection on valid timestamp lines
  const blocks = splitIntoTimestampBlocks(text);
  const timed = blocks.filter(b => b.time);

  if (timed.length < 2) {
    if (issues.length === 0) issues.push("No or not enough valid timestamps to analyze.");
    return issues;
  }

  let dayOffset = 0;
  let lastAdj = null;
  let lastBase = null;

  for (const b of timed) {
    const base = b.time.minutes;
    let adj = base + dayOffset;

    if (lastAdj !== null && adj < lastAdj) {
      const lastLate = lastBase >= (20 * 60);
      const curEarly = base <= (6 * 60);

      if (lastLate && curEarly) {
        dayOffset += 1440;
        adj = base + dayOffset;
        issues.push(`Midnight rollover detected near: "${b.lines[0].trim()}"`);
      } else {
        issues.push(`Out-of-order timestamp detected: "${b.lines[0].trim()}"`);
      }
    }

    lastAdj = adj;
    lastBase = base;
  }

  if (issues.length === 0) issues.push("No chronology issues detected ✅");
  return issues;
}

function fixChronology(text) {
  const blocks = splitIntoTimestampBlocks(text);

  // Assign sort keys for timed blocks with smart rollover
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
      // else: true out-of-order; sorting will fix it
    }

    b._sortKey = adj;
    lastAdj = adj;
    lastBase = base;
  }

  // Untimed blocks (rare) stay on top in original order
  let stable = 0;
  for (const b of blocks) {
    if (b.time) continue;
    b._sortKey = Number.NEGATIVE_INFINITY + stable++;
  }

  const sorted = [...blocks].sort((a, b) => (a._sortKey ?? 0) - (b._sortKey ?? 0));
  return sorted.map(b => b.lines.join("\n")).join("\n");
}

// ===== One button: Check Report =====
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
    statusEl.textContent = "Checking report…";

    // 1) detect companies + protect
    updateDetectedCompanies(raw);

    // 2) fix chronology first
    const chronoFixed = fixChronology(raw);

    // 3) timeline analysis (shows invalid timestamps + order issues)
    timelineEl.textContent = analyzeTimeline(chronoFixed).join("\n");

    // 4) spell check on chrono-fixed
    const data = await checkSpelling(chronoFixed, langEl.value);
    const matches = data.matches || [];
    const protectedTerms = parseProtectedTerms();

    const { updated, changes } = applyCorrectionsAndTrack(chronoFixed, matches, protectedTerms);

    outputEl.textContent = updated;
    changesEl.textContent = formatChanges(changes, matches.length);
    changesCountEl.textContent = changes.length ? `(${changes.length})` : "";

    // 5) re-analyze after spelling
    timelineEl.textContent = analyzeTimeline(updated).join("\n");

    statusEl.textContent = "Done ✅";
  } catch (e) {
    console.error(e);
    errorEl.textContent = "API blocked or rate-limited.";
    statusEl.textContent = "";
  } finally {
    setBusy(false);
  }
});

// Copy
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

// Live feedback while typing
inputEl.addEventListener("input", () => {
  updateDetectedCompanies(inputEl.value || "");
  timelineEl.textContent = analyzeTimeline(inputEl.value || "").join("\n");
});
updateDetectedCompanies(inputEl.value || "");
timelineEl.textContent = analyzeTimeline(inputEl.value || "").join("\n");
