/* Web worker: offline translation with transformers.js.
   - Opus-MT (Helsinki-NLP, Apache-2.0; ONNX by Xenova): small, good models for pairs with English.
   - M2M100 418M (Meta, MIT): one model for 100 languages, used when no Opus-MT pair exists. */
import { pipeline, env } from "../../../vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
const ORT = new URL("../../../vendor/ort/", import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = { mjs: ORT + "ort-wasm-simd-threaded.asyncify.js", wasm: ORT + "ort-wasm-simd-threaded.asyncify.wasm" };

const cache = new Map();
async function model(id, report) {
  if (!cache.has(id)) {
    const files = {};
    cache.set(id, pipeline("translation", id, {
      dtype: "q8", device: "wasm",
      progress_callback: (p) => {
        if (p.status === "progress" && p.total) {
          files[p.file] = [p.loaded, p.total];
          let l = 0, t = 0;
          for (const [a, b] of Object.values(files)) { l += a; t += b; }
          report(l, t);
        }
      },
    }).catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}

self.onmessage = async (e) => {
  const { id, steps, chunks } = e.data; // steps: [{model, src, tgt}] applied in order
  const report = (loaded, total) => postMessage({ id, type: "progress", loaded, total });
  try {
    let texts = chunks;
    for (let s = 0; s < steps.length; s++) {
      const st = steps[s];
      const tr = await model(st.model, report);
      const out = [];
      for (let i = 0; i < texts.length; i++) {
        postMessage({ id, type: "step", done: s * texts.length + i, total: steps.length * texts.length });
        if (!texts[i].trim()) { out.push(texts[i]); continue; }
        const opts = st.model.includes("m2m100") ? { src_lang: st.src, tgt_lang: st.tgt, max_new_tokens: 400 } : { max_new_tokens: 400 };
        const r = await tr(texts[i], opts);
        out.push(r[0].translation_text);
      }
      texts = out;
    }
    postMessage({ id, type: "ok", result: texts });
  } catch (err) {
    postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
