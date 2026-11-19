/* Text to speech with the voices built into the device (Web Speech API). Reads aloud with the
   current sentence highlighted; speed, pitch and voice selectable. No server involved. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, TK = window.TextKit, el = C.el;
  var synth = window.speechSynthesis;
  var text = el("textarea", { class: "bigtext", rows: "10", placeholder: "Type or paste text to read aloud", "aria-label": "Text to read aloud" });
  var voiceSel = el("select", { name: "voice", "aria-label": "Voice" });
  var rate = el("input", { type: "range", min: "0.5", max: "2", step: "0.1", value: "1", "aria-label": "Speed" });
  var pitch = el("input", { type: "range", min: "0.5", max: "2", step: "0.1", value: "1", "aria-label": "Pitch" });
  var rateLbl = el("b", { text: "1.0×" }), pitchLbl = el("b", { text: "1.0" });
  var reading = el("div", { class: "reading", hidden: "hidden" });
  var playBtn = F.button("▶ Read aloud", play), pauseBtn = F.button("❚❚ Pause", pause, "btn ghost"), stopBtn = F.button("■ Stop", stop, "btn ghost");
  var msg = el("p", { class: "muted small" });
  var voices = [], queue = [], idx = 0, spans = [];
  rate.addEventListener("input", function () { rateLbl.textContent = Number(rate.value).toFixed(1) + "×"; });
  pitch.addEventListener("input", function () { pitchLbl.textContent = Number(pitch.value).toFixed(1); });

  function loadVoices() {
    voices = synth.getVoices().slice().sort(function (a, b) { return a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name); });
    voiceSel.textContent = "";
    var pref = (navigator.language || "en").slice(0, 2), chosen = -1;
    voices.forEach(function (v, i) {
      voiceSel.appendChild(el("option", { value: i, text: v.name + " (" + v.lang + ")" + (v.localService ? "" : " · online") }));
      if (chosen < 0 && v.lang.slice(0, 2) === pref) chosen = i;
    });
    if (chosen >= 0) voiceSel.value = chosen;
    msg.textContent = voices.length ? voices.length + " voices available on this device. Voices marked “online” are provided by your browser's maker over the internet."
      : "No voices found yet. On some phones voices appear after a moment; you can also install voices in your system's speech settings.";
  }

  function play() {
    if (!synth) { msg.textContent = "This browser doesn't support speech synthesis."; return; }
    if (synth.paused) { synth.resume(); return; }
    stop();
    var paras = TK.paragraphs(text.value);
    queue = []; reading.textContent = ""; spans = [];
    paras.forEach(function (p) {
      var pe = el("p");
      p.sentences.forEach(function (s) { var sp = el("span", { text: s }); spans.push(sp); queue.push(s); pe.appendChild(sp); });
      if (p.sentences.length) reading.appendChild(pe);
    });
    if (!queue.length) return;
    reading.hidden = false; idx = 0; speakNext();
  }
  function speakNext() {
    spans.forEach(function (s) { s.classList.remove("now"); });
    if (idx >= queue.length) return;
    var u = new SpeechSynthesisUtterance(queue[idx]);
    var v = voices[Number(voiceSel.value)];
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Number(rate.value); u.pitch = Number(pitch.value);
    spans[idx].classList.add("now");
    u.onend = function () { idx++; speakNext(); };
    synth.speak(u);
  }
  function pause() { if (synth && synth.speaking) synth.pause(); }
  function stop() { if (synth) synth.cancel(); idx = queue.length; spans.forEach(function (s) { s.classList.remove("now"); }); }

  var root = F.root;
  root.textContent = "";
  root.append(text, el("div", { class: "fields" }, [el("label", { class: "wide" }, ["Voice", voiceSel]),
    el("label", {}, [el("span", {}, ["Speed ", rateLbl]), rate]), el("label", {}, [el("span", {}, ["Pitch ", pitchLbl]), pitch])]),
    el("div", { class: "actions" }, [playBtn, pauseBtn, stopBtn]), msg, reading);
  if (synth) { loadVoices(); synth.addEventListener("voiceschanged", loadVoices); }
  else msg.textContent = "This browser doesn't support speech synthesis. Try Chrome, Edge or Safari.";
})();
