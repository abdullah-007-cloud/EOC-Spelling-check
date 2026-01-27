const inputEl = document.getElementById("input");
const outputEl = document.getElementById("output");
const checkBtn = document.getElementById("checkBtn");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const langEl = document.getElementById("lang");

const changesEl = document.getElementById("changes");
const changesCountEl = document.getElementById("changesCount");

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

// ---------- Protected Terms ----------
function parseProtectedTerms() {
  const raw = (protectedEl.value || "");
  const lines = raw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  return Array.from(new Set(lines));
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
  const defaults = ["ICAD", "TBCV", "AMAALA", "RSSSC"];
  setProtectedTerms(defaults);
}

protectedEl.addEventListener("input", () => {
  const terms = parseProtectedTerms();
  renderChips(protectedChipsEl, terms);
  localStorage.setItem("amaalaProtectedTerms", JSON.stringify(terms));
});

function renderChips(container, items) {
  container.innerHTML = "";
  items.forEach(t => {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = t;
    container.appendChild(span);
  });
}

loadProtectedTerms();

// ---------- Detect Companies: WORD before "CO.,"
// Example: "RSS CO.," => detect "RSS"
function detectCompanies(text) {
  const companies = new Set();

  // capture the word right before "CO.,"
  // supports: RSS CO.,  MASAH CO.,  ABC123 CO.,
  const regex = /\b([A-Za-z0-9&.-]+)\s+CO\.,/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    companies.add(match[1]);
  }

  return Array.from(companies);
}

function updateDetectedCompaniesUI() {
  const text = inputEl.value || "";
  const detected = detectCompanies(text);

  renderChips(detectedCompaniesChipsEl, detected);

  // Auto-add detected companies to Protected Terms (so they never get changed)
  const currentProtected = parseProtectedTerms();
  const merged = Array.from(new Set([...currentProtected, ...detected]));
  setProtectedTerms(merged);
}

// detect as user types
inputEl.addEventListener("input", updateDetectedCompaniesUI);
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

  const protectedSet = new Set(protectedTerms);

  for (const m of sorted) {
    if (!m.replacements || m.replacements.length === 0) continue;

    const before = originalText.slice(m.offset, m.offset + m.length);
    const after = m.replacements[0].value;

    // Don't change protected terms (exact match)
    if (protectedSet.has(before)) continue;

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

function setBusy(b) {
  checkBtn.disabled = b;
  copyBtn.disabled = b;
}

// ---------- MAIN ----------
checkBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  statusEl.textContent = "";
  outputEl.textContent = "(Result will appear here)";
  changesEl.textContent = "(Changes will appear here)";
  changesCountEl.textContent = "";

  const text = (inputEl.value || "").trim();
  if (!text) {
    errorEl.textContent = "Paste a report first.";
    return;
  }

  try {
    setBusy(true);
    statusEl.textContent = "Checking…";

    // make sure companies are detected before checking
    updateDetectedCompaniesUI();

    const data = await checkSpelling(text, langEl.value);
    const matches = data.matches || [];
    const protectedTerms = parseProtectedTerms();

    const { updated, changes } = applyCorrectionsAndTrack(text, matches, protectedTerms);

    outputEl.textContent = updated;
    changesEl.textContent = formatChanges(changes, matches.length);
    changesCountEl.textContent = changes.length ? `(${changes.length})` : "";

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
