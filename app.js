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

const toastEl = document.getElementById("toast");
const toastTextEl = document.getElementById("toastText");
const toastEmojiEl = document.getElementById("toastEmoji");

const dirHintEl = document.getElementById("dirHint");

// ---------- TOAST ----------
let toastTimer = null;
function showToast(message, type = "success") {
  if (!toastEl) return;

  toastEl.classList.remove("success", "error", "show");
  toastEl.classList.add(type);

  toastEmojiEl.textContent = type === "success" ? "✅" : "⚠️";
  toastTextEl.textContent = message;

  // show
  requestAnimationFrame(() => toastEl.classList.add("show"));

  // auto hide
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

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

// ---------- RTL/LTR switching ----------
function applyDirectionForLanguage(code) {
  const isArabic = code.startsWith("ar");
  const dir = isArabic ? "rtl" : "ltr";

  inputEl.setAttribute("dir", dir);
  outputEl.setAttribute("dir", dir);
  changesEl.setAttribute("dir", dir);

  inputEl.setAttribute("lang", isArabic ? "ar" : "en");
  outputEl.setAttribute("lang", isArabic ? "ar" : "en");

  if (dirHintEl) dirHintEl.textContent = `Direction: ${dir.toUpperCase()}`;

  // feel-good feedback
  showToast(isArabic ? "تم تفعيل وضع العربية (RTL)" : "English mode (LTR) enabled", "success");
}

langEl.addEventListener("change", () => {
  applyDirectionForLanguage(langEl.value);
});

// init direction on load
applyDirectionForLanguage(langEl.value);

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

// Apply from end -> start to keep offsets valid
function applyCorrectionsAndTrack(originalText, matches) {
  const sorted = [...matches].sort((a, b) => b.offset - a.offset);

  let updated = originalText;
  const changes = [];

  for (const m of sorted) {
    const before = originalText.slice(m.offset, m.offset + m.length);

    if (!m.replacements || m.replacements.length === 0) continue;

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
  if (!changes.length) {
    if (suggestionsFound > 0) {
      return "(وجدنا اقتراحات، لكن ما كان فيها استبدال مباشر للكلمات.)";
    }
    return "(لا توجد كلمات تم تعديلها)";
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
    errorEl.textContent = "الصق التقرير أولاً.";
    showToast("الصق التقرير أولاً", "error");
    return;
  }

  try {
    setBusy(true);
    statusEl.textContent = "Checking…";

    const data = await checkSpelling(text, langEl.value);
    const matches = data.matches || [];

    const { updated, changes } = applyCorrectionsAndTrack(text, matches);

    outputEl.textContent = updated;
    changesEl.textContent = formatChanges(changes, matches.length);
    changesCountEl.textContent = changes.length ? `(${changes.length})` : "";

    statusEl.textContent = "Done ✅";

    // Banner after finish
    const isArabic = langEl.value.startsWith("ar");
    showToast(isArabic ? "✅ تم الانتهاء من التدقيق الإملائي" : "✅ Spell check finished", "success");
  } catch (e) {
    console.error(e);
    errorEl.textContent = "API blocked or rate-limited.";
    statusEl.textContent = "";
    showToast("⚠️ تعذّر التدقيق (API محجوب أو تم تجاوز الحد)", "error");
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
    showToast("📋 تم النسخ", "success");
    setTimeout(() => (statusEl.textContent = ""), 1200);
  } catch {
    errorEl.textContent = "Copy blocked by browser.";
    showToast("⚠️ المتصفح منع النسخ", "error");
  }
});
