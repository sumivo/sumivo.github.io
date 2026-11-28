/* Web worker: runs the "Fast" paraphrase model (T5, ONNX) with transformers.js, off the main thread.
   Model: humarin/chatgpt_paraphraser_on_T5_base (OpenRAIL licence), ONNX conversion by Felladrin,
   downloaded once from Hugging Face and cached by the browser. */
import { pipeline, env } from "../../../vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
// Self-hosted ONNX runtime (exact files, so any web server works; .js avoids .mjs MIME issues).
const ORT = new URL("../../../vendor/ort/", import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = { mjs: ORT + "ort-wasm-simd-threaded.asyncify.js", wasm: ORT + "ort-wasm-simd-threaded.asyncify.wasm" };

const MODEL = "Felladrin/onnx-chatgpt_paraphraser_on_T5_base";
let gen = null;

const SETTINGS = [
  { repetition_penalty: 1.3, no_repeat_ngram_size: 3 },                                       // faithful
  { do_sample: true, temperature: 0.7, top_p: 0.9, repetition_penalty: 1.3, no_repeat_ngram_size: 3 },  // balanced
  { do_sample: true, temperature: 1.0, top_p: 0.92, repetition_penalty: 1.3, no_repeat_ngram_size: 3 }, // creative
];

async function load() {
  if (gen) return;
  const files = {};
  gen = await pipeline("text2text-generation", MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = [p.loaded, p.total];
        let loaded = 0, total = 0;
        for (const [l, t] of Object.values(files)) { loaded += l; total += t; }
        postMessage({ type: "progress", loaded, total });
      }
    },
  });
}

async function paraphrase(text, level, n) {
  const words = text.split(/\s+/).length;
  const opts = { ...SETTINGS[Math.max(0, Math.min(2, level))], max_new_tokens: Math.min(256, Math.max(32, Math.round(words * 2.5))) };
  const out = [];
  for (let i = 0; i < (n || 1); i++) {
    const r = await gen("paraphrase: " + text, opts);
    out.push(r[0].generated_text.trim());
  }
  return out;
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === "load") { await load(); postMessage({ id, type: "ok" }); }
    else if (type === "run") { await load(); postMessage({ id, type: "ok", result: await paraphrase(e.data.text, e.data.level, e.data.n) }); }
  } catch (err) {
    postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
