/* Background remover: cuts out the main subject of one or many photos in the browser (ISNet via
   transformers.js). Photos are processed one after another; each result can be previewed, compared with
   the original and downloaded, or all downloaded together as a ZIP. Output: transparent PNG, or a new
   background (white, colour, blurred original). Nothing is uploaded. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, I = window.ImageKit, el = C.el;
  var MAX_SIDE = 4096;
  var SELF = document.currentScript.src; // captured now: currentScript is null later
  var worker = null, seq = 0, waiting = {};
  // items: {file, name, status: queued|working|done|error, error, cut (PNG blob of the cut-out), w, h, li}
  var items = [], current = null, busy = false;
  var view = { item: null, original: null, cutout: null }; // decoded canvases of the selected photo only (saves memory)

  var prog = F.progress();
  var grid = el("ul", { class: "thumbs-grid bg-grid" });
  var stage = el("div", { class: "bg-stage", hidden: "hidden" });
  var after = el("canvas", { class: "bg-after", "aria-label": "Result" });
  var before = el("canvas", { class: "bg-before", "aria-label": "Original" });
  var slider = el("input", { type: "range", min: "0", max: "100", value: "100", class: "compare", "aria-label": "Compare with the original" });
  var caption = el("p", { class: "muted small" });
  stage.append(caption, el("div", { class: "bg-view checker" }, [after, before]), el("label", { class: "inline small" }, ["Compare with original ", slider]));
  slider.addEventListener("input", function () { before.style.clipPath = "inset(0 " + slider.value + "% 0 0)"; });

  var bgMode = I.select("bg", [["transparent", "Transparent"], ["white", "White"], ["color", "Colour…"], ["blur", "Blurred original"]], "transparent");
  var color = el("input", { type: "color", value: "#2f6f5e", hidden: "hidden", "aria-label": "Background colour" });
  var fmt = I.select("fmt", [["png", "PNG"], ["jpg", "JPG"]], "png");
  var dl = F.button("Download this photo", download);
  var dlAll = F.button("Download all (ZIP)", downloadAll);
  var clear = F.button("Clear all", function () { items = []; current = null; showItem(null); renderGrid(); }, "btn ghost");
  var controls = el("div", { class: "fields", hidden: "hidden" }, [el("label", {}, ["Background (all photos)", bgMode]), el("label", {}, ["Colour", color]), el("label", {}, ["Format", fmt])]);
  var actions = el("div", { class: "actions", hidden: "hidden" }, [dl, dlAll, clear, el("span", { class: "muted small", text: "Transparent backgrounds need PNG." })]);
  bgMode.addEventListener("change", function () { color.hidden = bgMode.value !== "color"; if (bgMode.value === "transparent") fmt.value = "png"; compose(); });
  fmt.addEventListener("change", function () { if (fmt.value === "jpg" && bgMode.value === "transparent") { bgMode.value = "white"; compose(); } });
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
    worker.onerror = function (e) {
      Object.keys(waiting).forEach(function (k) { waiting[k].reject(new Error(e.message || "The AI model failed to load.")); });
      waiting = {}; worker = null;
    };
  }

  function blobOf(cv, type, q) { return new Promise(function (res) { cv.toBlob(res, type || "image/png", q); }); }

  /* Decode a photo at most MAX_SIDE px (HEIC supported via ImageKit). */
  function readOriginal(file) {
    return I.decode(file).then(function (bmp) {
      var s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      var cv = I.toCanvas(bmp, bmp.width * s, bmp.height * s);
      if (bmp.close) bmp.close();
      return cv;
    });
  }

  function cutOne(item) {
    var original;
    return readOriginal(item.file).then(function (cv) {
      original = cv; item.w = cv.width; item.h = cv.height;
      return blobOf(cv);
    }).then(function (blob) {
      ensureWorker();
      return new Promise(function (resolve, reject) { var id = ++seq; waiting[id] = { resolve: resolve, reject: reject }; worker.postMessage({ id: id, blob: blob }); });
    }).then(function (r) {
      var cut = document.createElement("canvas");
      cut.width = r.width; cut.height = r.height;
      cut.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      if (cut.width !== original.width || cut.height !== original.height) cut = I.toCanvas(cut, original.width, original.height); // keep the original resolution
      return blobOf(cut).then(function (b) { item.cut = b; return { original: original, cutout: cut }; });
    });
  }

  function add(files) {
    var fresh = files.filter(function (f) { return /^image\//.test(f.type) || /\.(heic|heif|avif|jfif|jpe?g|png|webp|gif|bmp)$/i.test(f.name); });
    var skipped = files.length - fresh.length;
    fresh.forEach(function (f) { items.push({ file: f, name: F.baseName(f.name), status: "queued" }); });
    if (skipped) prog.error(skipped + " file" + (skipped > 1 ? "s aren't images" : " isn't an image") + " and " + (skipped > 1 ? "were" : "was") + " skipped.");
    renderGrid(); run();
  }

  function run() {
    if (busy) return;
    var next = items.filter(function (it) { return it.status === "queued"; })[0];
    if (!next) { finish(); return; }
    busy = true; next.status = "working"; renderGrid();
    var n = items.indexOf(next) + 1;
    if (!worker || !Object.keys(waiting).length) prog.set(null, "Removing background " + n + " of " + items.length + ": " + next.file.name + "…");
    cutOne(next).then(function (canvases) {
      next.status = "done";
      if (!view.item || view.item.status !== "done") showItem(next, canvases); // show the first finished photo straight away
    }, function (e) {
      next.status = "error";
      next.error = /decode|source image|bitmap|can't read/i.test(e.message || "") ? "This browser can't read this image." : (e.message || String(e));
    }).then(function () { busy = false; renderGrid(); run(); });
  }

  function finish() {
    var done = items.filter(function (it) { return it.status === "done"; }).length;
    var failed = items.filter(function (it) { return it.status === "error"; }).length;
    if (!items.length) { prog.done(); return; }
    prog.done(done ? "Done: " + done + " photo" + (done > 1 ? "s" : "") + " ready" + (failed ? ", " + failed + " couldn't be processed" : "") + ". Click a photo to preview it." : "No photo could be processed.");
    dlAll.hidden = done < 2;
  }

  function renderGrid() {
    grid.textContent = "";
    items.forEach(function (it) {
      var thumb = el("div", { class: "thumb checker" });
      if (it.cut) { var img = el("img", { alt: it.name }); img.src = URL.createObjectURL(it.cut); img.onload = function () { URL.revokeObjectURL(img.src); }; thumb.append(img); }
      else thumb.append(el("span", { class: "muted small", text: it.status === "working" ? "Working…" : it.status === "error" ? "Failed" : "Waiting" }));
      var li = el("li", { class: (view.item === it ? "selected " : "") + it.status }, [
        el("button", { type: "button", class: "thumb-btn", "aria-label": "Preview " + it.file.name, disabled: it.status !== "done" ? "disabled" : null,
          onclick: function () { showItem(it); } }, [thumb]),
        el("p", { class: "fname", text: it.file.name, title: it.file.name }),
        it.status === "error" ? el("p", { class: "warn small", text: it.error }) : null,
        el("button", { type: "button", class: "link-btn small", text: "Remove", onclick: function () {
          items.splice(items.indexOf(it), 1); if (view.item === it) showItem(items.filter(function (x) { return x.status === "done"; })[0] || null); renderGrid();
        } })
      ]);
      grid.append(li);
    });
    var done = items.some(function (it) { return it.status === "done"; });
    controls.hidden = actions.hidden = !done;
    dlAll.hidden = items.filter(function (it) { return it.status === "done"; }).length < 2;
    clear.hidden = !items.length;
  }

  /* Show one finished photo in the big preview (decoding it again if needed). */
  function showItem(it, canvases) {
    view.item = it; view.original = view.cutout = null;
    if (!it) { stage.hidden = true; return; }
    var p = canvases ? Promise.resolve(canvases) : Promise.all([readOriginal(it.file), I.decode(it.cut)]).then(function (r) {
      return { original: r[0], cutout: I.toCanvas(r[1], r[0].width, r[0].height) };
    });
    p.then(function (c) {
      if (view.item !== it) return;
      view.original = c.original; view.cutout = c.cutout;
      caption.textContent = it.file.name + " · " + c.original.width + "×" + c.original.height + " px";
      stage.hidden = false; compose(); renderGrid();
    });
  }

  function paint(target, original, cutout, transparentOk) {
    var o = original, cv = target;
    cv.width = o.width; cv.height = o.height;
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    var mode = bgMode.value;
    if (mode === "transparent" && !transparentOk) mode = "white";
    if (mode === "white" || mode === "color") { ctx.fillStyle = mode === "white" ? "#ffffff" : color.value; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (mode === "blur") { ctx.filter = "blur(" + Math.max(6, Math.round(Math.max(o.width, o.height) / 80)) + "px)"; ctx.drawImage(o, 0, 0); ctx.filter = "none"; }
    ctx.drawImage(cutout, 0, 0);
    return cv;
  }

  function compose() {
    if (!view.cutout) return;
    paint(after, view.original, view.cutout, true);
    before.width = view.original.width; before.height = view.original.height;
    before.getContext("2d").drawImage(view.original, 0, 0);
    before.style.clipPath = "inset(0 " + slider.value + "% 0 0)";
  }

  function outName(it) { return it.name + (fmt.value === "jpg" ? "-edited.jpg" : "-no-bg.png"); }

  function render(it, original, cutout) {
    var jpg = fmt.value === "jpg";
    return blobOf(paint(document.createElement("canvas"), original, cutout, !jpg), jpg ? "image/jpeg" : "image/png", 0.92)
      .then(function (b) { return { name: outName(it), blob: b }; });
  }

  function download() {
    if (!view.cutout) return;
    render(view.item, view.original, view.cutout).then(function (r) { F.download(r.blob, r.name); });
  }

  function downloadAll() {
    var done = items.filter(function (it) { return it.status === "done"; });
    var out = [], chain = Promise.resolve();
    dlAll.disabled = true;
    done.forEach(function (it, i) {
      chain = chain.then(function () {
        prog.set(i / done.length, "Preparing " + (i + 1) + " of " + done.length + "…");
        if (bgMode.value === "transparent" && fmt.value === "png") { out.push({ name: outName(it), blob: it.cut }); return; } // already final
        return Promise.all([readOriginal(it.file), I.decode(it.cut)]).then(function (r) {
          return render(it, r[0], I.toCanvas(r[1], r[0].width, r[0].height));
        }).then(function (res) { out.push(res); });
      });
    });
    chain.then(function () { return I.deliver(out, "photos-no-background.zip"); })
      .then(function () { prog.done("Downloaded " + out.length + " photos as a ZIP."); }, function (e) { prog.error(e.message || String(e)); })
      .then(function () { dlAll.disabled = false; });
  }

  var rootEl = F.root;
  rootEl.textContent = "";
  rootEl.append(F.dropzone({ accept: I.ACCEPT, multiple: true, title: "Choose photos",
    hint: "One or many · JPG, PNG, WebP, HEIC (iPhone), AVIF · or drag and drop · or paste with Ctrl+V", onFiles: add }),
    prog.node, grid, stage, controls, actions);
  document.addEventListener("paste", function (e) {
    var files = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) add(files);
  });
})();
