const inputEl = document.getElementById("input");
const outputEl = document.getElementById("output");
const checkBtn = document.getElementById("checkBtn");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const langEl = document.getElementById("lang");
const changesEl = document.getElementById("changes");
const changesCountEl = document.getElementById("changesCount");

const kpiSuggestions = document.getElementById("kpiSuggestions");
const kpiApplied = document.getElementById("kpiApplied");
const kpiChars = document.getElementById("kpiChars");

const themeBtn = document.getElementById("themeBtn");

// ========= THEME =========
function getSavedTheme() {
  return localStorage.getItem("amaalaTheme") || "dark";
}
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("amaalaTheme", theme);
}
setTheme(getSavedTheme());

themeBtn?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(current === "dark" ? "light" : "dark");
});

// ========= LIVE CHAR COUNT =========
function updateCharCount() {
  kpiChars.textContent = String((inputEl.value || "").length);
}
inputEl.addEventListener("input", updateCharCount);
updateCharCount();

// ========= LanguageTool Public API =========
async function checkSpelling(text, language) {
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("language", language);

  const res = await fetch("https://api.languagetool.org/v2/check", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function applyCorrectionsAndTrack(originalText, matches) {
  // Apply from end -> start so offsets remain correct
  const sorted = [...matches].sort((a, b) => b.offset - a.offset);

  let updatedText = originalText;
  const changes = [];

  for (const m of sorted) {
    if (!m.replacements || m.replacements.length === 0) continue;

    const before = originalText.slice(m.offset, m.offset + m.length);
    const after = m.replacements[0].value;

    // Show only applied + actually changed
    if (!before || before === after) continue;

    updatedText =
      updatedText.slice(0, m.offset) +
      after +
      updatedText.slice(m.offset + m.length);

    changes.push({ offset: m.offset, before, after });
  }

  // Display in reading order
  changes.sort((a, b) => a.offset - b.offset);

  return { updatedText, changes };
}

function formatChanges(changes) {
  if (!changes.length) return "(No adjusted words found)";
  return changes.map(c => `${c.before} → ${c.after}`).join("\n");
}

function setKPIs({ suggestions, applied }) {
  kpiSuggestions.textContent = suggestions ?? "—";
  kpiApplied.textContent = applied ?? "—";
}

function setBusy(isBusy) {
  checkBtn.disabled = isBusy;
  copyBtn.disabled = isBusy;
}

// ========= MAIN ACTION =========
checkBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  statusEl.textContent = "";
  outputEl.textContent = "(Result will appear here)";
  changesEl.textContent = "(Changes will appear here)";
  changesCountEl.textContent = "";
  setKPIs({ suggestions: "—", applied: "—" });

  const text = (inputEl.value || "").trim();
  if (!text) {
    errorEl.textContent = "Paste a report first.";
    return;
  }

  try {
    setBusy(true);
    statusEl.textContent = "Checking…";

    const data = await checkSpelling(text, langEl.value);
    const matches = data.matches || [];

    const { updatedText, changes } = applyCorrectionsAndTrack(text, matches);

    outputEl.textContent = updatedText;
    changesEl.textContent = formatChanges(changes);
    changesCountEl.textContent = changes.length ? `(${changes.length})` : "";

    setKPIs({ suggestions: matches.length, applied: changes.length });
    statusEl.textContent = "Done ✅";
  } catch (err) {
    console.error(err);
    errorEl.textContent = "API blocked or rate-limited.";
    statusEl.textContent = "";
  } finally {
    setBusy(false);
  }
});

// ========= COPY =========
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
