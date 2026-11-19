/* Paraphrasing tool with two in-browser engines:
   - Fast: a T5 paraphrase model via transformers.js (any modern browser, ~250 MB once).
   - Better AI: Qwen2.5-1.5B-Instruct via WebLLM on WebGPU (desktop Chrome/Edge, ~1 GB once), with modes.
   Text never leaves the device. */
// WebLLM (6.8 MB) is imported only when "Better AI" is used, keeping the page fast.

const { Calc: C, FileKit: F, TextKit: TK } = window;
const el = C.el;
const LIMIT = { fast: 600, ai: 1500 };
const MODES = [
  ["standard", "Standard", "Paraphrase it in natural, clear wording, changing the vocabulary and sentence structure moderately."],
  ["fluency", "Fluency", "Fix grammar, spelling and awkward phrasing so it reads smoothly. Change as little as needed."],
  ["formal", "Formal", "Rewrite it in a formal, professional tone suitable for business or academic writing."],
  ["simple", "Simple", "Rewrite it in plain, simple English that a 12-year-old understands. Prefer short sentences and common words."],
  ["creative", "Creative", "Rewrite it creatively, with fresh vocabulary and varied sentence structure, keeping the meaning."],
  ["shorten", "Shorten", "Rewrite it more concisely. Remove about a third of the words without losing any key information."],
  ["expand", "Expand", "Rewrite it in more detail and about a third longer, without adding new facts or claims."],
];
const LEVELS = ["Faithful", "Balanced", "Creative"];
const BROKEN_KEY = "sumivo-better-ai-unsupported";

// ------------------------------------------------------------------ engines
class FastEngine {
  constructor() { this.worker = null; this.seq = 0; this.waiting = new Map(); this.onProgress = null; }
  ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL("./workers/t5-worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === "progress") { if (this.onProgress) this.onProgress(d.loaded / d.total, "Downloading the Fast model (first time only): " + F.fmtBytes(d.loaded) + " of " + F.fmtBytes(d.total)); return; }
      const w = this.waiting.get(d.id); if (!w) return;
      this.waiting.delete(d.id);
      d.type === "error" ? w.reject(new Error(d.message)) : w.resolve(d.result);
    };
    this.worker.onerror = (e) => { for (const w of this.waiting.values()) w.reject(new Error(e.message || "The model failed to load.")); this.waiting.clear(); };
  }
  call(msg) { this.ensure(); const id = ++this.seq; return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.worker.postMessage({ ...msg, id }); }); }
  load(onProgress) { this.onProgress = onProgress; return this.call({ type: "load" }); }
  async rewriteSentence(s, opts) { return (await this.call({ type: "run", text: s, level: opts.level, n: 1 }))[0]; }
  alternatives(s) { return this.call({ type: "run", text: s, level: 2, n: 3 }); }
}

class AiEngine {
  constructor() { this.engine = null; this.model = null; }
  static async support() {
    if (!navigator.gpu) return { ok: false, why: "This browser doesn't support WebGPU. Use a recent Chrome or Edge on a computer." };
    try {
      const a = await navigator.gpu.requestAdapter();
      if (!a) return { ok: false, why: "No compatible graphics card found (WebGPU is unavailable)." };
      return { ok: true };
    } catch (e) { return { ok: false, why: "WebGPU is unavailable: " + e.message }; }
  }
  async load(onProgress) {
    if (this.engine) return;
    const sup = await AiEngine.support();
    if (!sup.ok) throw new Error(sup.why);
    // q4f32 rather than q4f16: the f16 build returns empty text on some integrated GPUs (seen on Intel Gen12).
    this.model = "Qwen2.5-1.5B-Instruct-q4f32_1-MLC";
    const { CreateWebWorkerMLCEngine } = await import("../../vendor/web-llm/web-llm.js");
    const worker = new Worker(new URL("./workers/llm-worker.js", import.meta.url), { type: "module" });
    const engine = await CreateWebWorkerMLCEngine(worker, this.model, {
      initProgressCallback: (r) => onProgress(r.progress, /fetch|download|loading model from cache/i.test(r.text) ? "Preparing the AI model (first time downloads about 1 GB): " + Math.round(r.progress * 100) + "%" : "Starting the AI model…"),
    });
    // Self-test: some integrated GPUs load the model but produce empty output. Detect it once,
    // remember it for this device, and let the page fall back to the Fast engine.
    onProgress(null, "Checking the AI model works on this device…");
    let reply = "";
    try {
      const probe = await withTimeout(engine.chat.completions.create({ messages: [{ role: "user", content: "Reply with the single word OK." }], temperature: 0, max_tokens: 8 }), 45000);
      reply = (probe.choices[0].message.content || "").trim();
    } catch { reply = ""; } // timeout (generation hung) or GPU error
    if (!/\bok\b/i.test(reply)) { // empty, hung or garbage output: this GPU can't run the model correctly
      try { worker.terminate(); } catch {}
      AiEngine.markBroken();
      const err = new Error("Better AI doesn't run correctly on this device's graphics chip, so the Fast engine was used instead.");
      err.fallback = true;
      throw err;
    }
    this.engine = engine;
    this.worker = worker;
  }
  static markBroken() { try { localStorage.setItem(BROKEN_KEY, new Date().toISOString()); } catch {} }
  static isBroken() { try { return !!localStorage.getItem(BROKEN_KEY); } catch { return false; } }
  static clearBroken() { try { localStorage.removeItem(BROKEN_KEY); } catch {} }
  async chat(system, user, temperature, maxTokens) {
    let r;
    try {
      // Generous limit (a healthy GPU writes several words a second); a hang means the GPU misbehaves.
      r = await withTimeout(this.engine.chat.completions.create({
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature, top_p: 0.95, max_tokens: maxTokens,
      }), 60000 + maxTokens * 400);
    } catch (e) {
      if (!e.timeout) throw e;
      try { this.worker.terminate(); } catch {}
      this.engine = null;
      AiEngine.markBroken();
      const err = new Error("Better AI stopped responding on this device's graphics chip, so the Fast engine was used instead.");
      err.fallback = true;
      throw err;
    }
    const text = clean(r.choices[0].message.content || "");
    if (!text) {
      AiEngine.markBroken();
      const err = new Error("Better AI returned no text on this device's graphics chip, so the Fast engine was used instead.");
      err.fallback = true;
      throw err;
    }
    return text;
  }
  rewriteParagraph(p, opts) {
    const mode = MODES.find((m) => m[0] === opts.mode) || MODES[0];
    let sys = "You are a rewriting engine. Rewrite the user's text as instructed. " + mode[2] +
      " Keep the meaning exactly. Never change, add or guess facts: keep every name, number, amount, date and day as written" +
      " (expand informal shorthand faithfully, for example tmrw = tomorrow, u = you). Keep the same language as the input. " +
      "Reply with only the rewritten text: no introduction, no quotes, no notes.";
    if (opts.freeze.length) sys += " Keep these words and phrases exactly as written: " + opts.freeze.join(", ") + ".";
    const words = TK.countWords(p);
    const factor = opts.mode === "expand" ? 3.2 : 2.4;
    return this.chat(sys, p, [0.2, 0.6, 0.9][opts.level], Math.min(1500, Math.round(words * factor) + 40));
  }
  async alternatives(s, opts) {
    const mode = MODES.find((m) => m[0] === opts.mode) || MODES[0];
    const txt = await this.chat("You rewrite sentences. " + mode[2] + " Give exactly three different rewrites of the user's sentence, one per line. No numbering, no quotes, nothing else.",
      s, 0.9, Math.round(TK.countWords(s) * 8) + 60);
    return txt.split(/\n+/).map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean).slice(0, 3);
  }
  stop() { if (this.engine) this.engine.interruptGenerate(); }
}

function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => { const e = new Error("timeout"); e.timeout = true; reject(e); }, ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

function clean(s) {
  return s.trim().replace(/^(?:sure[,!.]?\s*)?(?:here(?:'s| is)[^:\n]*:\s*)/i, "").replace(/^["“](.*)["”]$/s, "$1").trim();
}

// ------------------------------------------------------------------ UI
const engines = { fast: new FastEngine(), ai: new AiEngine() };
const state = { engine: "fast", mode: "standard", level: 0, busy: false, stop: false, out: [] };

const input = el("textarea", { class: "bigtext", rows: "14", placeholder: "Type or paste the text you want to rephrase…", "aria-label": "Text to paraphrase" });
const inCount = el("span", { class: "muted small" });
const output = el("div", { class: "para-out", "aria-live": "polite" }, [el("p", { class: "muted", text: "Your paraphrased text will appear here. Click any sentence for alternatives." })]);
const outCount = el("span", { class: "muted small" });
const prog = F.progress();
const go = F.button("Paraphrase", run);
const stopBtn = F.button("Stop", () => { state.stop = true; engines.ai.stop(); }, "btn ghost");
stopBtn.hidden = true;
const copyBtn = F.button("Copy", () => {
  navigator.clipboard.writeText(outputText()).then(() => { copyBtn.textContent = "Copied ✓"; setTimeout(() => (copyBtn.textContent = "Copy"), 1500); });
}, "btn ghost");
const showChanges = el("input", { type: "checkbox", checked: "checked", onchange: () => output.classList.toggle("plain", !showChanges.checked) });
const freeze = el("input", { type: "text", placeholder: "Words to keep unchanged, separated by commas" });
const level = el("input", { type: "range", min: "0", max: "2", step: "1", value: "0", "aria-label": "Creativity" });
const levelLabel = el("b", { text: LEVELS[0] });
level.addEventListener("input", () => { state.level = Number(level.value); levelLabel.textContent = LEVELS[state.level]; });

const engineTabs = el("div", { class: "seg", role: "tablist" });
const modeRow = el("div", { class: "seg modes" });
const aiNote = el("p", { class: "muted small" });
const aiOnly = el("div", { class: "ai-only" }, [el("div", { class: "row-label", text: "Mode" }), modeRow, el("label", { class: "block" }, ["Freeze words", freeze])]);

function tab(key, label, sub) {
  return el("button", { type: "button", role: "tab", "data-k": key, onclick: () => setEngine(key) }, [el("strong", { text: label }), el("small", { text: sub })]);
}
engineTabs.append(tab("fast", "Fast", "Works in any browser"), tab("ai", "Better AI", "Modes · needs a computer with WebGPU"));
MODES.forEach(([k, label]) => modeRow.append(el("button", { type: "button", "data-k": k, text: label, onclick: () => { state.mode = k; paintTabs(); } })));

function setEngine(k) { state.engine = k; paintTabs(); }
function paintTabs() {
  engineTabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b.dataset.k === state.engine));
  modeRow.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === state.mode));
  aiOnly.hidden = state.engine !== "ai";
  updateCount();
}
function updateCount() {
  const n = TK.countWords(input.value), lim = LIMIT[state.engine];
  inCount.textContent = n + " / " + lim + " words";
  inCount.classList.toggle("warn", n > lim);
}
input.addEventListener("input", updateCount);

function outputText() {
  return state.out.map((p) => p.sentences.map((s) => s.text).join(" ") + p.sep).join("").trim();
}

function renderOut() {
  output.textContent = "";
  state.out.forEach((p, pi) => {
    const para = el("p");
    p.sentences.forEach((s, si) => {
      const span = el("span", { class: "sent" + (s.pending ? " pending" : ""), tabindex: "0", role: "button", title: "Click for alternatives" });
      if (s.pending) span.textContent = s.text;
      else TK.wordDiff(s.base, s.text).forEach((t) => span.append(t.changed ? el("mark", { text: t.text }) : document.createTextNode(t.text)));
      span.addEventListener("click", () => openAlternatives(pi, si, span));
      span.addEventListener("keydown", (e) => { if (e.key === "Enter") openAlternatives(pi, si, span); });
      para.append(span, document.createTextNode(" "));
    });
    if (p.sentences.length) output.append(para);
  });
  const n = TK.countWords(outputText());
  outCount.textContent = n ? n + " words" : "";
}

let pop = null;
async function openAlternatives(pi, si, anchor) {
  if (state.busy) return;
  if (pop) pop.remove();
  const s = state.out[pi].sentences[si];
  pop = el("div", { class: "alts" }, [el("p", { class: "muted small", text: "Finding alternatives…" })]);
  anchor.after(pop);
  try {
    const eng = engines[state.engine];
    const alts = await eng.alternatives(s.source, { mode: state.mode, level: 2, freeze: [] });
    pop.textContent = "";
    const choices = [...new Set([...alts, s.source])].filter((a) => a && a !== s.text);
    choices.forEach((a) => pop.append(el("button", { type: "button", text: a === s.source ? "↺ Original: " + a : a, onclick: () => { s.text = a; pop.remove(); pop = null; renderOut(); } })));
    pop.append(el("button", { type: "button", class: "link", text: "Close", onclick: () => { pop.remove(); pop = null; } }));
  } catch (e) {
    pop.textContent = e.message;
    if (e.fallback) { disableAi("Better AI doesn't run correctly on this device's graphics chip."); setEngine("fast"); }
  }
}

async function run() {
  const text = input.value.trim();
  if (!text) return;
  if (TK.countWords(text) > LIMIT[state.engine]) { prog.error("Please paraphrase at most " + LIMIT[state.engine] + " words at a time with this engine."); return; }
  const eng = engines[state.engine];
  const opts = { mode: state.mode, level: state.level, freeze: freeze.value.split(",").map((s) => s.trim()).filter(Boolean) };
  state.busy = true; state.stop = false; go.disabled = true; stopBtn.hidden = false;
  try {
    prog.set(null, state.engine === "ai" ? "Starting the AI model…" : "Loading the Fast model…");
    await eng.load((f, t) => prog.set(f, t));
    const paras = TK.paragraphs(text);
    const total = paras.reduce((n, p) => n + (state.engine === "ai" ? (p.sentences.length ? 1 : 0) : p.sentences.length), 0);
    let done = 0;
    state.out = paras.map((p) => ({ sep: p.sep, sentences: p.sentences.map((s) => ({ source: s.trim(), base: s.trim(), text: s.trim(), pending: true })) }));
    renderOut();
    for (const p of state.out) {
      if (state.stop) break;
      if (!p.sentences.length) continue;
      if (state.engine === "ai") {
        prog.set(done / total, "Rewriting paragraph " + (done + 1) + " of " + total + "…");
        const original = p.sentences.map((s) => s.source).join(" ");
        const result = await eng.rewriteParagraph(TK.expandShorthand(original), opts);
        p.sentences = TK.splitSentences(result).map((s) => ({ source: s.trim(), base: original, text: s.trim() }));
        done++;
      } else {
        for (const s of p.sentences) {
          if (state.stop) break;
          prog.set(done / total, "Rewriting sentence " + (done + 1) + " of " + total + "…");
          if (TK.countWords(s.source) >= 4) s.text = await eng.rewriteSentence(s.source, opts);
          s.pending = false; done++;
          renderOut();
        }
      }
      renderOut();
    }
    state.out.forEach((p) => p.sentences.forEach((s) => (s.pending = false)));
    renderOut();
    const changed = Math.round(100 * TK.changedShare(text, outputText()));
    const added = TK.newFacts(TK.expandShorthand(text), outputText());
    prog.done(state.stop ? "Stopped." : "Done: about " + changed + "% of the words changed. Click a sentence for alternatives." +
      (added.length ? " Please check: " + added.join(", ") + " " + (added.length > 1 ? "aren't" : "isn't") + " in your original text." : ""));
  } catch (e) {
    if (e.fallback) {
      disableAi("Better AI doesn't run correctly on this device's graphics chip.");
      setEngine("fast");
      state.busy = false;
      prog.set(null, e.message);
      await run(); // finish the Fast run before this call's cleanup runs
      return;
    }
    prog.error(e.message || String(e));
  } finally {
    state.busy = false; go.disabled = false; stopBtn.hidden = true;
  }
}

const rootEl = F.root;
rootEl.textContent = "";
rootEl.append(
  engineTabs, aiNote,
  el("div", { class: "para-opts" }, [el("label", { class: "inline" }, ["Creativity ", level, " ", levelLabel]), aiOnly]),
  el("div", { class: "para-grid" }, [
    el("div", {}, [el("div", { class: "pane-head" }, [el("strong", { text: "Your text" }), inCount]), input]),
    el("div", {}, [el("div", { class: "pane-head" }, [el("strong", { text: "Paraphrased" }), outCount,
      el("label", { class: "inline small" }, [showChanges, " Show changes"])]), output]),
  ]),
  el("div", { class: "actions" }, [go, stopBtn, copyBtn]),
  prog.node,
);
paintTabs();
function disableAi(why, canRetry) {
  const b = engineTabs.querySelector('[data-k="ai"]');
  b.disabled = true; b.title = why;
  aiNote.textContent = "Better AI isn't available here: " + why + " The Fast engine works fine. ";
  if (canRetry !== false) aiNote.append(el("button", { type: "button", class: "link", text: "Try Better AI again", onclick: () => {
    AiEngine.clearBroken(); b.disabled = false; b.title = ""; aiNote.textContent = "";
  } }));
}
AiEngine.support().then((s) => {
  if (!s.ok) disableAi(s.why, false);
  else if (AiEngine.isBroken()) disableAi("it didn't run correctly on this device's graphics chip last time.");
});
