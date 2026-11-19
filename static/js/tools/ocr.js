/* Image to text (OCR) with tesseract.js (Apache-2.0). The engine is self-hosted; language data
   (a few MB per language) downloads once from jsDelivr. Images never leave the device. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, I = window.ImageKit, el = C.el;
  var LANGS = [["eng", "English"], ["hin", "Hindi"], ["ben", "Bengali"], ["mar", "Marathi"], ["tam", "Tamil"], ["tel", "Telugu"],
    ["guj", "Gujarati"], ["kan", "Kannada"], ["mal", "Malayalam"], ["pan", "Punjabi"], ["urd", "Urdu"], ["ori", "Odia"],
    ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["por", "Portuguese"], ["ita", "Italian"], ["nld", "Dutch"],
    ["rus", "Russian"], ["ukr", "Ukrainian"], ["pol", "Polish"], ["tur", "Turkish"], ["ara", "Arabic"], ["chi_sim", "Chinese (simplified)"],
    ["chi_tra", "Chinese (traditional)"], ["jpn", "Japanese"], ["kor", "Korean"], ["ind", "Indonesian"], ["vie", "Vietnamese"], ["tha", "Thai"]];
  var lang1 = I.select("lang1", LANGS, "eng");
  var lang2 = I.select("lang2", [["", "None"]].concat(LANGS), "");
  var prog = F.progress();
  var out = el("textarea", { class: "bigtext", rows: "12", placeholder: "The recognised text will appear here. You can edit it before copying.", "aria-label": "Recognised text" });
  var preview = el("div", { class: "ocr-preview" });
  var copyBtn = F.button("Copy text", function () { navigator.clipboard.writeText(out.value).then(function () { copyBtn.textContent = "Copied ✓"; setTimeout(function () { copyBtn.textContent = "Copy text"; }, 1500); }); }, "btn ghost");
  var saveBtn = F.button("Download .txt", function () { F.download(new Blob([out.value], { type: "text/plain;charset=utf-8" }), "text.txt"); }, "btn ghost");
  var worker = null, workerLangs = "";

  function getWorker(langs) {
    if (worker && workerLangs === langs) return Promise.resolve(worker);
    var old = worker; worker = null;
    return Promise.resolve(old && old.terminate()).then(function () { return F.loadScript("vendor/tesseract/tesseract.min.js"); }).then(function () {
      var base = new URL(F.asset("vendor/tesseract/"), location.href).href;
      return window.Tesseract.createWorker(langs.split("+"), 1, {
        workerPath: base + "worker.min.js", corePath: base, workerBlobURL: false,
        logger: function (m) {
          if (m.status === "recognizing text") prog.set(m.progress, "Reading the text… " + Math.round(m.progress * 100) + "%");
          else if (/loading|initializ/i.test(m.status)) prog.set(m.progress || null, (/language/i.test(m.status) ? "Downloading language data (first time only)…" : "Starting the OCR engine…"));
        }
      });
    }).then(function (w) { worker = w; workerLangs = langs; return w; });
  }

  function run(files) {
    var langs = lang1.value + (lang2.value && lang2.value !== lang1.value ? "+" + lang2.value : "");
    var texts = [];
    prog.set(null, "Starting the OCR engine…");
    preview.textContent = "";
    var chain = getWorker(langs);
    files.forEach(function (f, i) {
      chain = chain.then(function () { return I.decode(f); }).then(function (bmp) {
        var cv = I.toCanvas(bmp, bmp.width, bmp.height, "#ffffff");
        preview.appendChild(el("img", { src: cv.toDataURL("image/jpeg", 0.6), alt: "Page " + (i + 1) }));
        return worker.recognize(cv);
      }).then(function (r) {
        texts.push((files.length > 1 ? "--- " + f.name + " ---\n" : "") + r.data.text.trim());
        out.value = texts.join("\n\n");
      });
    });
    chain.then(function () {
      var words = (out.value.match(/\S+/g) || []).length;
      prog.done(words ? "Done: " + words + " words found. Check names and numbers before using the text." : "No text found. Try a sharper photo, or choose the document's language.");
    }).catch(function (e) { prog.error(e.message || String(e)); });
  }

  var root = F.root;
  root.textContent = "";
  root.appendChild(F.dropzone({ accept: "image/*,.heic,.heif", multiple: true, title: "Choose an image with text",
    hint: "Photo, scan or screenshot (JPG, PNG, WebP, HEIC) · or drag and drop · or paste (Ctrl+V)", onFiles: run }));
  root.appendChild(el("div", { class: "fields" }, [el("label", {}, ["Language", lang1]), el("label", {}, ["Second language (optional)", lang2])]));
  root.appendChild(prog.node);
  root.appendChild(el("div", { class: "ocr-grid" }, [preview, el("div", {}, [out, el("div", { class: "actions" }, [copyBtn, saveBtn])])]));
  document.addEventListener("paste", function (e) {
    var fs = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (fs.length) run(fs);
  });
})();
