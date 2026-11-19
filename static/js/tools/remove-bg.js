/* Background remover: cuts out the main subject of a photo in the browser (ISNet via transformers.js).
   Output: transparent PNG, or a new background colour / blurred original. Nothing is uploaded. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, el = C.el;
  var MAX_SIDE = 4096;
  var SELF = document.currentScript.src; // captured now: currentScript is null later
  var worker = null, seq = 0, waiting = {};
  var state = { name: "image", original: null, cutout: null }; // canvases

  var prog = F.progress();
  var stage = el("div", { class: "bg-stage", hidden: "hidden" });
  var after = el("canvas", { class: "bg-after", "aria-label": "Result" });
  var before = el("canvas", { class: "bg-before", "aria-label": "Original" });
  var slider = el("input", { type: "range", min: "0", max: "100", value: "100", class: "compare", "aria-label": "Compare with the original" });
  stage.append(el("div", { class: "bg-view checker" }, [after, before]), el("label", { class: "inline small" }, ["Compare with original ", slider]));
  slider.addEventListener("input", function () { before.style.clipPath = "inset(0 " + slider.value + "% 0 0)"; });

  var bgMode = el("select", { name: "bg" }, [["transparent", "Transparent"], ["white", "White"], ["color", "Colour…"], ["blur", "Blurred original"]]
    .map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
  var color = el("input", { type: "color", value: "#2f6f5e", hidden: "hidden", "aria-label": "Background colour" });
  var fmt = el("select", { name: "fmt" }, [["png", "PNG"], ["jpg", "JPG"]].map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
  var dl = F.button("Download", download);
  var controls = el("div", { class: "fields", hidden: "hidden" }, [el("label", {}, ["Background", bgMode]), el("label", {}, ["Colour", color]), el("label", {}, ["Format", fmt])]);
  var actions = el("div", { class: "actions", hidden: "hidden" }, [dl, el("span", { class: "muted small", text: "Transparent backgrounds need PNG." })]);
  bgMode.addEventListener("change", function () { color.hidden = bgMode.value !== "color"; if (bgMode.value === "transparent") fmt.value = "png"; compose(); });
  color.addEventListener("input", compose);

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(new URL("workers/bg-worker.js", SELF), { type: "module" });
    worker.onmessage = function (e) {
      var d = e.data;
      if (d.type === "progress") { prog.set(d.loaded / d.total, "Downloading the AI model (first time only): " + F.fmtBytes(d.loaded) + " of " + F.fmtBytes(d.total)); return; }
      var w = waiting[d.id]; if (!w) return;
      delete waiting[d.id];
      if (d.type === "error") w.reject(new Error(d.message)); else w.resolve(d);
    };
    worker.onerror = function (e) { Object.keys(waiting).forEach(function (k) { waiting[k].reject(new Error(e.message || "The AI model failed to load.")); }); waiting = {}; };
  }

  function open(files) {
    var f = files[0];
    if (!f) return;
    state.name = F.baseName(f.name);
    stage.hidden = true; controls.hidden = true; actions.hidden = true;
    prog.set(null, "Reading the image…");
    createImageBitmap(f).then(function (bmp) {
      var s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      var cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      state.original = cv;
      return new Promise(function (res) { cv.toBlob(res, "image/png"); });
    }).then(function (blob) {
      ensureWorker();
      prog.set(null, "Finding the subject… (this can take a few seconds)");
      return new Promise(function (resolve, reject) { var id = ++seq; waiting[id] = { resolve: resolve, reject: reject }; worker.postMessage({ id: id, blob: blob }); });
    }).then(function (r) {
      var cut = document.createElement("canvas");
      cut.width = r.width; cut.height = r.height;
      cut.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      if (cut.width !== state.original.width) { // keep the original resolution
        var scaled = document.createElement("canvas");
        scaled.width = state.original.width; scaled.height = state.original.height;
        scaled.getContext("2d").drawImage(cut, 0, 0, scaled.width, scaled.height);
        cut = scaled;
      }
      state.cutout = cut;
      prog.done();
      stage.hidden = false; controls.hidden = false; actions.hidden = false;
      compose();
      stage.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (e) {
      prog.error(/decode|source image|bitmap/i.test(e.message || "") ? "This browser can't read that image. Try a JPG, PNG or WebP." : (e.message || String(e)));
    });
  }

  function paint(target, transparentOk) {
    var o = state.original, cv = target;
    cv.width = o.width; cv.height = o.height;
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    var mode = bgMode.value;
    if (mode === "transparent" && !transparentOk) mode = "white";
    if (mode === "white" || mode === "color") { ctx.fillStyle = mode === "white" ? "#ffffff" : color.value; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (mode === "blur") { ctx.filter = "blur(" + Math.max(6, Math.round(Math.max(o.width, o.height) / 80)) + "px)"; ctx.drawImage(o, 0, 0); ctx.filter = "none"; }
    ctx.drawImage(state.cutout, 0, 0);
    return cv;
  }

  function compose() {
    if (!state.cutout) return;
    paint(after, true);
    before.width = state.original.width; before.height = state.original.height;
    before.getContext("2d").drawImage(state.original, 0, 0);
    before.style.clipPath = "inset(0 " + slider.value + "% 0 0)";
  }

  function download() {
    var jpg = fmt.value === "jpg";
    var cv = paint(document.createElement("canvas"), !jpg);
    cv.toBlob(function (b) { F.download(b, state.name + (jpg ? "-edited.jpg" : "-no-bg.png")); }, jpg ? "image/jpeg" : "image/png", 0.92);
  }

  var rootEl = F.root;
  rootEl.textContent = "";
  rootEl.append(F.dropzone({ accept: "image/*", title: "Choose a photo", hint: "JPG, PNG or WebP · people, products, pets, objects · or drag and drop", onFiles: open }),
    prog.node, stage, controls, actions);
  document.addEventListener("paste", function (e) {
    var files = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) open(files);
  });
})();
