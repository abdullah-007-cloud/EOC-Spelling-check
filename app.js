document.addEventListener("DOMContentLoaded", () => {
  // ===== Elements =====
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
  const timelineCard = document.getElementById("timelineCard");

  const themeSelect = document.getElementById("themeSelect");

  const protectedEl = document.getElementById("protectedTerms");
  const protectedChipsEl = document.getElementById("protectedChips");
  const detectedCompaniesChipsEl = document.getElementById("detectedCompaniesChips");

  // Chat
  const chatLog = document.getElementById("chatLog");
  const chatInput = document.getElementById("chatInput");
  const chatSend = document.getElementById("chatSend");
  const chatClear = document.getElementById("chatClear");

  // ===== Theme =====
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("amaalaTheme", theme);
  }
  function loadTheme() {
    const saved = localStorage.getItem("amaalaTheme") || "dark";
    setTheme(saved);
    themeSelect.value = saved;
  }
  themeSelect.addEventListener("change", () => setTheme(themeSelect.value));
  loadTheme();

  // ===== Chips =====
  function renderChips(container, items) {
    container.innerHTML = "";
    items.forEach(t => {
      const span = document.createElement("span");
      span.className = "chip";
      span.textContent = t;
      container.appendChild(span);
    });
  }

  // ===== Protected Terms =====
  function parseProtectedTerms() {
    const raw = (protectedEl.value || "");
    return Array.from(new Set(raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)));
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

  // ===== Company Detection (smart) =====
  function cleanCompanyName(raw) {
    let s = (raw || "").trim().replace(/\s+/g, " ");
    const lower = s.toLowerCase();
    const idx = lower.lastIndexOf(" from ");
    if (idx !== -1) s = s.slice(idx + " from ".length).trim();

    const junkStarts = [
      "a","an","the",
      "call","phone","telephone","radio",
      "received","receive","receiving",
      "report","reported","reporting",
      "message","sms",
      "from"
    ];
    let parts = s.split(" ");
    while (parts.length && junkStarts.includes(parts[0].toLowerCase())) parts.shift();
    s = parts.join(" ").trim();

    s = s.replace(/[-–—,:;.\s]+$/g, "").trim();
    if (!/[A-Za-z]/.test(s)) return null;
    if (s.length < 2) return null;
    return s;
  }

  function detectCompanies(text) {
    const companies = new Set();
    const regex = /\b((?:[A-Za-z0-9&.\-\/]+\s+){0,5}[A-Za-z0-9&.\-\/]+)\s+(?:CO|Co)\b\s*[.,;:]?,?/g;
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

      updated = updated.slice(0, m.offset) + after + updated.slice(m.offset + m.length);
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

  // ===== Timeline =====
  function parseTimeToken(tokenDigits) {
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
    return { minutes: hh * 60 + mm };
  }

  function findInvalidTimestamps(text) {
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
      if (!parsed) invalids.push(`Invalid timestamp value: "${full}" (HH 00–23 and MM 00–59)`);
    }
    return invalids;
  }

  function parseTimeFromLine(line) {
    const m = line.match(/\b(\d{3,4})\s*hrs\b/i);
    if (!m) return null;
    const parsed = parseTimeToken(m[1]);
    if (!parsed) return null;
    return { minutes: parsed.minutes, token: m[0] };
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

  function analyzeTimeline(text) {
    const issues = [];
    let hasCriticalError = false;

    const invalids = findInvalidTimestamps(text);
    if (invalids.length) {
      hasCriticalError = true;
      issues.push(...invalids);
    }

    const blocks = splitIntoTimestampBlocks(text);
    const timed = blocks.filter(b => b.time);

    if (timed.length >= 2) {
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
            hasCriticalError = true;
            issues.push(`Out-of-order timestamp detected: "${b.lines[0].trim()}"`);
          }
        }

        lastAdj = adj;
        lastBase = base;
      }
    }

    if (!issues.length) issues.push("No chronology issues detected ✅");
    return { issues, hasCriticalError };
  }

  function setTimelineAlert(isAlert) {
    if (isAlert) timelineCard.classList.add("alert");
    else timelineCard.classList.remove("alert");
  }

  function fixChronology(text) {
    const blocks = splitIntoTimestampBlocks(text);

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
      }

      b._sortKey = adj;
      lastAdj = adj;
      lastBase = base;
    }

    let stable = 0;
    for (const b of blocks) {
      if (b.time) continue;
      b._sortKey = Number.NEGATIVE_INFINITY + stable++;
    }

    const sorted = [...blocks].sort((a, b) => (a._sortKey ?? 0) - (b._sortKey ?? 0));
    return sorted.map(b => b.lines.join("\n")).join("\n");
  }

  // ===== Core Actions =====
  function setBusy(b) {
    runBtn.disabled = b;
    copyBtn.disabled = b;
  }

  async function runCheck() {
    errorEl.textContent = "";
    statusEl.textContent = "";
    outputEl.textContent = "(Result will appear here)";
    changesEl.textContent = "(Changes will appear here)";
    changesCountEl.textContent = "";
    timelineEl.textContent = "(Timeline analysis will appear here)";
    setTimelineAlert(false);

    const raw = (inputEl.value || "").trim();
    if (!raw) {
      errorEl.textContent = "Paste a report first.";
      return;
    }

    try {
      setBusy(true);
      statusEl.textContent = "Checking report…";

      updateDetectedCompanies(raw);

      const chronoFixed = fixChronology(raw);

      const t1 = analyzeTimeline(chronoFixed);
      timelineEl.textContent = t1.issues.join("\n");
      setTimelineAlert(t1.hasCriticalError);

      const data = await checkSpelling(chronoFixed, langEl.value);
      const matches = data.matches || [];
      const protectedTerms = parseProtectedTerms();

      const { updated, changes } = applyCorrectionsAndTrack(chronoFixed, matches, protectedTerms);

      outputEl.textContent = updated;
      changesEl.textContent = formatChanges(changes, matches.length);
      changesCountEl.textContent = changes.length ? `(${changes.length})` : "";

      const t2 = analyzeTimeline(updated);
      timelineEl.textContent = t2.issues.join("\n");
      setTimelineAlert(t2.hasCriticalError);

      statusEl.textContent = "Done ✅";
    } catch (e) {
      console.error(e);
      errorEl.textContent = "API blocked or rate-limited.";
      statusEl.textContent = "";
    } finally {
      setBusy(false);
    }
  }

  async function copyResult() {
    const text = outputEl.textContent || "";
    if (!text || text.startsWith("(")) return;
    try {
      await navigator.clipboard.writeText(text);
      statusEl.textContent = "Copied ✅";
      setTimeout(() => (statusEl.textContent = ""), 1200);
    } catch {
      errorEl.textContent = "Copy blocked by browser.";
    }
  }

  // ===== CHAT =====
  function addMsg(role, text) {
    const row = document.createElement("div");
    row.className = `msg ${role}`;

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = role === "me" ? "You" : "AI";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;

    row.appendChild(av);
    row.appendChild(bubble);
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function botReply(userText) {
    const t = (userText || "").trim().toLowerCase();

    if (t === "check" || t.includes("check report") || t.includes("run")) {
      addMsg("bot", "Got you. Running Check Report الآن… ✅");
      runCheck();
      return;
    }

    if (t.includes("copy")) {
      addMsg("bot", "Copy Result button موجود فوق 👆 اضغطه وراح ينسخ الناتج.");
      return;
    }

    if (t.includes("company")) {
      addMsg("bot", "الشركات تُكتشف تلقائيًا من أي كلمة قبل “Co/CO”. وتندمج تلقائيًا في Protected Terms عشان ما تتخرب.");
      return;
    }

    addMsg("bot", "اكتب “check” عشان أشغّل الفحص بالكامل، أو قلّي تبغى الجملة بصياغة أكثر رسمية/أقصر/أوضح.");
  }

  function sendChat() {
    const text = (chatInput.value || "").trim();
    if (!text) return;
    addMsg("me", text);
    chatInput.value = "";
    botReply(text);
  }

  // ===== Bind Buttons =====
  runBtn.addEventListener("click", runCheck);
  copyBtn.addEventListener("click", copyResult);

  chatSend.addEventListener("click", sendChat);
  chatClear.addEventListener("click", () => {
    chatLog.innerHTML = "";
    addMsg("bot", "Chat cleared. Type “check” whenever you want. 💬");
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // ===== Live Preview =====
  inputEl.addEventListener("input", () => {
    updateDetectedCompanies(inputEl.value || "");
    const t = analyzeTimeline(inputEl.value || "");
    timelineEl.textContent = t.issues.join("\n");
    setTimelineAlert(t.hasCriticalError);
  });

  // ===== Initial =====
  addMsg("bot", "Hey 👋 Paste the report on the left, then click “Check Report” or type “check” here.");
  updateDetectedCompanies(inputEl.value || "");
  const t0 = analyzeTimeline(inputEl.value || "");
  timelineEl.textContent = t0.issues.join("\n");
  setTimelineAlert(t0.hasCriticalError);
});
