const inputEl = document.getElementById("input");
const outputEl = document.getElementById("output");
const checkBtn = document.getElementById("checkBtn");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const langEl = document.getElementById("lang");

// Uses LanguageTool public API endpoint.
// Docs: https://languagetool.org/http-api/  (see citations in chat response)
async function checkSpelling(text, language) {
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("language", language);

  const res = await fetch("https://api.languagetool.org/v2/check", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

function applyCorrections(originalText, matches) {
  // Apply from end to start so offsets don't shift.
  const sorted = [...matches].sort((a, b) => (b.offset - a.offset));
  let updated = originalText;

  for (const m of sorted) {
    if (!m.replacements || m.replacements.length === 0) continue;

    // pick the top suggestion
    const suggestion = m.replacements[0].value;
    updated =
      updated.slice(0, m.offset) +
      suggestion +
      updated.slice(m.offset + m.length);
  }
  return updated;
}

checkBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  statusEl.textContent = "";

  const text = inputEl.value || "";
  const language = langEl.value;

  if (!text.trim()) {
    errorEl.textContent = "  Paste a report first.";
    return;
  }

  try {
    statusEl.textContent = "Checking...";
    checkBtn.disabled = true;

    const data = await checkSpelling(text, language);
    const fixed = applyCorrections(text, data.matches || []);
    outputEl.textContent = fixed;

    const count = (data.matches || []).length;
    statusEl.textContent = `Done. Suggestions found: ${count}`;
  } catch (e) {
    console.error(e);
    errorEl.textContent = "  Something went wrong (API blocked or rate-limited).";
    statusEl.textContent = "";
  } finally {
    checkBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  const text = outputEl.textContent || "";
  if (!text || text.startsWith("(Result")) return;

  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = "Copied ✅";
    setTimeout(() => (statusEl.textContent = ""), 1200);
  } catch {
    errorEl.textContent = "  Could not copy (browser blocked).";
  }
});
