/* Web worker: hosts the "Better AI" engine (WebLLM, Apache-2.0) so generation never blocks the page.
   The model (Qwen2.5-1.5B-Instruct, Apache-2.0) runs on the visitor's GPU through WebGPU. */
import { WebWorkerMLCEngineHandler } from "../../../vendor/web-llm/web-llm.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
