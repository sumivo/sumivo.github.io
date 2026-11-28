/* Speech to text: transcribe audio or video files, or a microphone recording, with Whisper running
   in the browser. Export as text or SRT subtitles; optionally translate the speech into English. */
const { Calc: C, FileKit: F, ImageKit: I } = window;
const el = C.el;
const LANGS = [["", "Detect automatically"], ["english", "English"], ["hindi", "Hindi"], ["bengali", "Bengali"], ["marathi", "Marathi"],
  ["tamil", "Tamil"], ["telugu", "Telugu"], ["gujarati", "Gujarati"], ["kannada", "Kannada"], ["malayalam", "Malayalam"], ["punjabi", "Punjabi"],
  ["urdu", "Urdu"], ["spanish", "Spanish"], ["french", "French"], ["german", "German"], ["portuguese", "Portuguese"], ["italian", "Italian"],
  ["russian", "Russian"], ["arabic", "Arabic"], ["chinese", "Chinese"], ["japanese", "Japanese"], ["korean", "Korean"], ["indonesian", "Indonesian"]];
const lang = I.select("lang", LANGS, "");
const task = I.select("task", [["transcribe", "Write down what is said"], ["translate", "Translate the speech into English"]], "transcribe");
const prog = F.progress();
const out = el("textarea", { class: "bigtext", rows: "12", placeholder: "The transcript will appear here.", "aria-label": "Transcript" });
let chunks = [], name = "transcript";
const recBtn = F.button("● Record from microphone", toggleRec, "btn ghost");
const actions = el("div", { class: "actions", hidden: "hidden" }, [
  F.button("Copy", () => navigator.clipboard.writeText(out.value), "btn ghost"),
  F.button("Download .txt", () => F.download(new Blob([out.value], { type: "text/plain;charset=utf-8" }), name + ".txt"), "btn ghost"),
  F.button("Download subtitles (.srt)", () => F.download(new Blob([srt()], { type: "text/plain;charset=utf-8" }), name + ".srt"), "btn ghost")]);

let worker = null;
function transcribe(audio) {
  if (!worker) worker = new Worker(new URL("./workers/whisper-worker.js", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === "progress") prog.set(d.loaded / d.total, "Downloading the speech model (first time only): " + F.fmtBytes(d.loaded) + " of " + F.fmtBytes(d.total));
      else if (d.type === "status") prog.set(null, d.text);
      else if (d.type === "error") reject(new Error(d.message));
      else if (d.type === "ok") resolve(d);
    };
    worker.postMessage({ id: 1, audio, language: lang.value, task: task.value }, [audio.buffer]);
  });
}

/* Any audio/video the browser can decode -> 16 kHz mono Float32Array (what Whisper expects). */
async function toPcm(blob) {
  const ctx = new AudioContext();
  let decoded;
  try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error("This browser can't read that file's audio. Try MP3, WAV, M4A, OGG, WebM or MP4."); }
  finally { ctx.close(); }
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const srcNode = off.createBufferSource();
  srcNode.buffer = decoded; srcNode.connect(off.destination); srcNode.start();
  const rendered = await off.startRendering();
  return { pcm: rendered.getChannelData(0), seconds: decoded.duration };
}

async function handle(blob, label) {
  name = F.baseName(label || "recording");
  actions.hidden = true; out.value = "";
  try {
    prog.set(null, "Reading the audio…");
    const { pcm, seconds } = await toPcm(blob);
    if (seconds > 60 * 60) throw new Error("Please use recordings up to 60 minutes long.");
    prog.set(null, "Loading the speech model…");
    const r = await transcribe(new Float32Array(pcm));
    chunks = r.chunks; out.value = r.text.trim();
    actions.hidden = false;
    prog.done("Done: " + Math.round(seconds / 60 * 10) / 10 + " minutes transcribed. Check names and numbers.");
  } catch (e) { prog.error(e.message || String(e)); }
}

function ts(s) {
  const ms = Math.round((s || 0) * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":") + "," + String(ms % 1000).padStart(3, "0");
}
function srt() {
  return chunks.map((c, i) => (i + 1) + "\n" + ts(c.timestamp[0]) + " --> " + ts(c.timestamp[1] ?? c.timestamp[0] + 3) + "\n" + c.text.trim() + "\n").join("\n");
}

let rec = null, parts = [];
async function toggleRec() {
  if (rec) { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    parts = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      rec = null; recBtn.textContent = "● Record from microphone";
      handle(new Blob(parts, { type: parts[0] && parts[0].type }), "recording");
    };
    rec.start();
    recBtn.textContent = "■ Stop recording";
    prog.set(null, "Recording… press Stop when you're done.");
  } catch { prog.error("Microphone access was blocked. Allow it in the address bar, or choose a file instead."); }
}

F.root.textContent = "";
F.root.append(
  F.dropzone({ accept: "audio/*,video/*,.mp3,.wav,.m4a,.ogg,.webm,.mp4,.mov", title: "Choose an audio or video file",
    hint: "Voice notes, interviews, lectures, meetings · MP3, WAV, M4A, OGG, WebM, MP4", onFiles: (fs) => handle(fs[0], fs[0].name) }),
  el("div", { class: "fields" }, [el("label", {}, ["Spoken language", lang]), el("label", {}, ["Output", task])]),
  el("div", { class: "actions" }, [recBtn]), prog.node, out, actions);
