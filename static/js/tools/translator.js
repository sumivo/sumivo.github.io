/* Translator that runs on the device. Engine order:
   1. The browser's built-in on-device Translator API (recent Chrome on computers), if it supports the pair.
   2. Opus-MT models for pairs with English (about 115 MB per language pair, downloaded once),
      chaining through English for other pairs (e.g. Hindi -> English -> French).
   3. M2M100 (about 650 MB once) for everything else, including Bengali, Tamil, Telugu and more. */
const { Calc: C, FileKit: F, TextKit: TK } = window;
const el = C.el;

const LANGS = [["en", "English"], ["hi", "Hindi"], ["bn", "Bengali"], ["mr", "Marathi"], ["ta", "Tamil"], ["te", "Telugu"],
  ["gu", "Gujarati"], ["kn", "Kannada"], ["ml", "Malayalam"], ["pa", "Punjabi"], ["ur", "Urdu"], ["ne", "Nepali"],
  ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"], ["nl", "Dutch"],
  ["ru", "Russian"], ["uk", "Ukrainian"], ["pl", "Polish"], ["tr", "Turkish"], ["ar", "Arabic"], ["fa", "Persian"],
  ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"], ["id", "Indonesian"], ["vi", "Vietnamese"], ["th", "Thai"],
  ["sv", "Swedish"], ["da", "Danish"], ["fi", "Finnish"], ["cs", "Czech"], ["hu", "Hungarian"], ["ro", "Romanian"], ["el", "Greek"], ["he", "Hebrew"], ["ms", "Malay"], ["sw", "Swahili"]];
const NAME = Object.fromEntries(LANGS);
// Opus-MT pairs available as browser models (Xenova/opus-mt-*).
const FROM_EN = new Set("af ar cs da de es fi fr hi hu id it nl ro ru sv uk vi zh".split(" "));
const TO_EN = new Set("af ar cs da de es et fi fr hi hu id it ja ko nl pl ru sv th uk vi zh".split(" "));
const M2M = new Set("en hi bn mr ta gu kn ml pa ur ne es fr de it pt nl ru uk pl tr ar fa zh ja ko id vi th sv da fi cs hu ro el he ms sw".split(" "));

function plan(src, tgt) {
  const opus = (a, b) => ({ model: "Xenova/opus-mt-" + a + "-" + b, src: a, tgt: b, size: 115 });
  if (src === "en" && FROM_EN.has(tgt)) return [opus("en", tgt)];
  if (tgt === "en" && TO_EN.has(src)) return [opus(src, "en")];
  if (TO_EN.has(src) && FROM_EN.has(tgt)) return [opus(src, "en"), opus("en", tgt)];
  if (M2M.has(src) && M2M.has(tgt)) return [{ model: "Xenova/m2m100_418M", src, tgt, size: 650 }];
  return null;
}

// ---- engines
async function builtIn(src, tgt) {
  if (!("Translator" in self)) return null;
  try {
    const a = await self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
    return a === "unavailable" ? null : a;
  } catch { return null; }
}

let worker = null, seq = 0;
const waiting = new Map();
function callWorker(msg, onProgress) {
  if (!worker) {
    worker = new Worker(new URL("./workers/translate-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const d = e.data, w = waiting.get(d.id);
      if (!w) return;
      if (d.type === "progress") return w.onProgress(d.loaded / d.total, "Downloading the translation model (first time only): " + F.fmtBytes(d.loaded) + " of " + F.fmtBytes(d.total));
      if (d.type === "step") return w.onProgress(d.done / d.total, "Translating… " + Math.round(100 * d.done / d.total) + "%");
      waiting.delete(d.id);
      d.type === "error" ? w.reject(new Error(d.message)) : w.resolve(d.result);
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject, onProgress }); worker.postMessage({ ...msg, id }); });
}

/* Split text into single sentences (keeping the spacing between them). Small translation models
   sometimes drop a sentence when given several at once, so each sentence is translated on its own. */
function chunk(text) {
  const out = [];
  for (const p of TK.paragraphs(text)) {
    if (!p.sentences.length) { out.push({ text: "", sep: p.sep }); continue; }
    p.sentences.forEach((s, i) => out.push({ text: s.trim(), sep: i === p.sentences.length - 1 ? p.sep : " " }));
  }
  return out;
}

// ---- UI
const opt = (code, label) => el("option", { value: code, text: label });
const from = el("select", { "aria-label": "From language" }, LANGS.map(([c, n]) => opt(c, n)));
const to = el("select", { "aria-label": "To language" }, LANGS.map(([c, n]) => opt(c, n)));
from.value = "en"; to.value = "hi";
const swap = el("button", { type: "button", class: "icon", title: "Swap languages", "aria-label": "Swap languages", text: "⇄",
  onclick: () => { [from.value, to.value] = [to.value, from.value]; [input.value, output.value] = [output.value || input.value, ""]; note(); } });
const input = el("textarea", { class: "bigtext", rows: "10", placeholder: "Type or paste text to translate", "aria-label": "Text to translate" });
const output = el("textarea", { class: "bigtext", rows: "10", readonly: "readonly", placeholder: "Translation", "aria-label": "Translation" });
const prog = F.progress();
const engineNote = el("p", { class: "muted small" });
const go = F.button("Translate", run);
const copy = F.button("Copy", () => navigator.clipboard.writeText(output.value).then(() => { copy.textContent = "Copied ✓"; setTimeout(() => (copy.textContent = "Copy"), 1500); }), "btn ghost");

async function note() {
  const s = from.value, t = to.value;
  if (s === t) { engineNote.textContent = "Choose two different languages."; return; }
  const b = await builtIn(s, t);
  if (b) { engineNote.textContent = "Engine: your browser's built-in on-device translator" + (b === "available" ? "." : " (it downloads the language pack once)."); return; }
  const p = plan(s, t);
  engineNote.textContent = p ? "Engine: open-source " + (p[0].model.includes("m2m100") ? "M2M100" : "Opus-MT") + " model on your device" +
    (p.length > 1 ? ", via English" : "") + " (about " + p.reduce((n, x) => n + x.size, 0) + " MB to download once, then cached)."
    : "This language pair needs a browser with a built-in translator (recent Chrome on a computer).";
}
from.addEventListener("change", note); to.addEventListener("change", note);

async function run() {
  const text = input.value.trim(), s = from.value, t = to.value;
  if (!text || s === t) return;
  if (text.length > 5000) { prog.error("Please translate up to 5,000 characters at a time."); return; }
  go.disabled = true; output.value = "";
  try {
    if (await builtIn(s, t)) {
      prog.set(null, "Preparing your browser's translator…");
      const tr = await self.Translator.create({ sourceLanguage: s, targetLanguage: t,
        monitor(m) { m.addEventListener("downloadprogress", (e) => prog.set(e.loaded, "Downloading the language pack (first time only)…")); } });
      prog.set(null, "Translating…");
      const parts = chunk(text);
      let res = "";
      for (const c of parts) res += (c.text ? await tr.translate(c.text) : "") + c.sep;
      output.value = res.trim();
    } else {
      const steps = plan(s, t);
      if (!steps) throw new Error("This language pair isn't available offline yet. Try translating via English.");
      prog.set(null, "Loading the translation model…");
      const parts = chunk(text);
      const result = await callWorker({ steps, chunks: parts.map((c) => c.text) }, (f, msg) => prog.set(f, msg));
      output.value = result.map((r, i) => r + parts[i].sep).join("").trim();
    }
    prog.done("Done. Machine translation can miss nuance; check important text with a fluent speaker.");
  } catch (e) { prog.error(e.message || String(e)); }
  go.disabled = false;
}

F.root.textContent = "";
F.root.append(
  el("div", { class: "lang-row" }, [el("label", {}, ["From", from]), swap, el("label", {}, ["To", to])]),
  engineNote,
  el("div", { class: "para-grid" }, [input, output]),
  el("div", { class: "actions" }, [go, copy]), prog.node);
note();
