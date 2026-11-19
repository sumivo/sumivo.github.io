/* Web worker: background removal with transformers.js and ISNet (int8, MIT licence, ~44 MB,
   downloaded once from Hugging Face and cached). Uses WebGPU when available, otherwise WebAssembly. */
import { pipeline, env, RawImage } from "../../../vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
// Self-hosted ONNX runtime (exact files, so any web server works; .js avoids .mjs MIME issues).
const ORT = new URL("../../../vendor/ort/", import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = { mjs: ORT + "ort-wasm-simd-threaded.asyncify.js", wasm: ORT + "ort-wasm-simd-threaded.asyncify.wasm" };

const MODEL = "xrds/isnet-general-onnx-int8";
let seg = null;

async function hasWebGPU() {
  try { return !!(self.navigator.gpu && (await self.navigator.gpu.requestAdapter())); } catch { return false; }
}

async function load() {
  if (seg) return;
  const files = {};
  const progress_callback = (p) => {
    if (p.status === "progress" && p.total) {
      files[p.file] = [p.loaded, p.total];
      let loaded = 0, total = 0;
      for (const [l, t] of Object.values(files)) { loaded += l; total += t; }
      postMessage({ type: "progress", loaded, total });
    }
  };
  const device = (await hasWebGPU()) ? "webgpu" : "wasm";
  try {
    seg = await pipeline("background-removal", MODEL, { dtype: "q8", device, progress_callback });
  } catch (e) {
    if (device !== "webgpu") throw e;
    seg = await pipeline("background-removal", MODEL, { dtype: "q8", device: "wasm", progress_callback });
  }
}

self.onmessage = async (e) => {
  const { id, blob } = e.data;
  try {
    await load();
    const img = await RawImage.fromBlob(blob);
    let out = await seg(img);
    if (Array.isArray(out)) out = out[0]; // one image in: some versions return a list
    const rgba = out.rgba ? out.rgba() : out; // ensure 4 channels
    postMessage({ id, type: "ok", width: rgba.width, height: rgba.height, data: rgba.data }, [rgba.data.buffer]);
  } catch (err) {
    postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
