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

// ================== UI TRANSLATIONS ==================
const UI_TEXT = {
  "en": {
    pastePlaceholder: "Paste EOC report here...",
    checkBtn: "✅ Check Spelling",
    copyBtn: "📋 Copy Result",
    checking: "Checking…",
    done: "Done ✅",
    pasteFirst: "Paste a report first.",
    apiError: "API blocked or rate-limited.",
    resultPlaceholder: "(Result will appear here)",
    changesPlaceholder: "(Changes will appear here)",
    noChanges: "(No adjusted words found)",
    someSuggestions: "(Suggestions were found, but no direct replacements were applied.)"
  },
  "ar": {
    pastePlaceholder: "الصق تقرير مركز العمليات هنا...",
    checkBtn: "✅ تدقيق إملائي",
    copyBtn: "📋 نسخ التقرير",
    checking: "جاري التدقيق…",
    done: "تم ✅",
    pasteFirst: "يرجى لصق التقرير أولاً.",
    apiError: "الخدمة محجوبة أو تجاوزت الحد.",
    resultPlaceholder: "(سيظهر التقرير المعدل هنا)",
    changesPlaceholder: "(ستظهر الكلمات المعدلة هنا)",
    noChanges: "(لا توجد كلمات معدلة)",
    someSuggestions: "(تم العثور على ملاحظات، ولكن لم يتم تطبيق استبدال مباشر)"
  }
};

// ================== THEME ==================
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

// ================== LANGUAGE UI SWITCH ==================
function getUILang() {
  return langEl.value.startsWith("ar") ? "ar" : "en";
}

function applyUILanguage() {
  const L = UI_TEXT[getUILang()];

  inputEl.placeholder = L.pastePlaceholder;
  checkBtn.textContent = L.checkBtn;
  copyBtn.textContent = L.copyBtn;

  if (outputEl.textContent.startsWith("(")) {
    outputEl.textContent = L.resultPlaceholder;
  }
  if (changesEl.textContent.startsWith("(")) {
    changesEl.textContent = L.changesPlaceholder;
  }
}

// change UI instantly when language changes
langEl.addEventListener("change", applyUILanguage);
applyUILanguage();

// ================== API ==================
async function checkSpelling(text, language) {
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("language", language);

  const res = await fetch("https://api.languagetool.org/v2/check", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error("API error");
  return res.json();
}

function applyCorrectionsAndTrack(originalText, matches) {
  const sorted = [...matches].sort((a, b) => b.offset - a.offset);

  let updated = originalText;
  const changes = [];

  for (const m of sorted) {
    if (!m.replacements || m.replacements.length === 0) continue;

    const before = originalText.slice(m.offset, m.offset + m.length);
    const after = m.replacements[0].value;

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
  const L = UI_TEXT[getUILang()];
  if (!changes.length) {
    return suggestionsFound ? L.someSuggestions : L.noChanges;
  }
  return changes.map(c => `${c.before} → ${c.after}`).join("\n");
}

function setBusy(b) {
  checkBtn.disabled = b;
  copyBtn.disabled = b;
}

// ================== MAIN ==================
checkBtn.addEventListener("click", async () => {
  const L = UI_TEXT[getUILang()];
  errorEl.textContent = "";
  statusEl.textContent = "";

  outputEl.textContent = L.resultPlaceholder;
  changesEl.textContent = L.changesPlaceholder;
  changesCountEl.textContent = "";

  const text = (inputEl.value || "").trim();
  if (!text) {
    errorEl.textContent = L.pasteFirst;
    return;
  }

  try {
    setBusy(true);
    statusEl.textContent = L.checking;

    const data = await checkSpelling(text, langEl.value);
    const matches = data.matches || [];

    const { updated, changes } = applyCorrectionsAndTrack(text, matches);

    outputEl.textContent = updated;
    changesEl.textContent = formatChanges(changes, matches.length);
    changesCountEl.textContent = changes.length ? `(${changes.length})` : "";

    statusEl.textContent = L.done;
  } catch (e) {
    console.error(e);
    errorEl.textContent = L.apiError;
  } finally {
    setBusy(false);
  }
});

// ================== COPY ==================
copyBtn.addEventListener("click", async () => {
  const text = outputEl.textContent || "";
  if (!text || text.startsWith("(")) return;

  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = UI_TEXT[getUILang()].done;
    setTimeout(() => (statusEl.textContent = ""), 1200);
  } catch {
    errorEl.textContent = UI_TEXT[getUILang()].apiError;
  }
});
