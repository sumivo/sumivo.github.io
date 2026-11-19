/* Web worker: speech recognition with Whisper base (OpenAI, Apache-2.0; ONNX by onnx-community)
   through transformers.js. About 80 MB, downloaded once and cached. */
import { pipeline, env } from "../../../vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
const ORT = new URL("../../../vendor/ort/", import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = { mjs: ORT + "ort-wasm-simd-threaded.asyncify.js", wasm: ORT + "ort-wasm-simd-threaded.asyncify.wasm" };

let asr = null;
async function load() {
  if (asr) return asr;
  const files = {};
  asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
    dtype: "q8", device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = [p.loaded, p.total];
        let l = 0, t = 0;
        for (const [a, b] of Object.values(files)) { l += a; t += b; }
        postMessage({ type: "progress", loaded: l, total: t });
      }
    },
  });
  return asr;
}

self.onmessage = async (e) => {
  const { id, audio, language, task } = e.data;
  try {
    const run = await load();
    postMessage({ type: "status", text: "Transcribing… (about as long as the recording, or faster)" });
    const out = await run(audio, {
      language: language || null, task: task || "transcribe",
      chunk_length_s: 30, stride_length_s: 5, return_timestamps: true,
    });
    postMessage({ id, type: "ok", text: out.text, chunks: out.chunks || [] });
  } catch (err) {
    postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
