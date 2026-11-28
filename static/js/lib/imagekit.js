/* Image helpers for the image tools: decode any browser-readable image (plus iPhone HEIC via heic-to,
   LGPL, loaded only when needed), draw to a canvas, encode, and download one file or a ZIP. */
(function (global) {
  "use strict";
  var F = global.FileKit;
  var TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
  // File-picker filter: "image/*" alone greys out HEIC/AVIF/JFIF on some systems (e.g. Chrome on Windows).
  var ACCEPT = "image/*,.jpg,.jpeg,.jfif,.png,.webp,.gif,.bmp,.avif,.heic,.heif";

  function isHeic(file) { return /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type); }

  /* -> Promise<ImageBitmap> (EXIF orientation applied by the browser). */
  function decode(file) {
    return createImageBitmap(file).catch(function () {
      if (!isHeic(file)) throw new Error(file.name + ": this browser can't read this image.");
      return F.loadScript("vendor/heic-to/heic-to.js").then(function () {
        var heicTo = global.HeicTo.heicTo || global.HeicTo; // the IIFE build exports the function itself
        return heicTo({ blob: file, type: "image/png" });
      }).then(function (png) { return createImageBitmap(png); }).catch(function (e) {
        throw new Error(file.name + ": couldn't read this HEIC photo (" + (e && e.message || e) + ").");
      });
    });
  }

  /* Draw a bitmap at w x h. `background` fills transparency (needed for JPG). */
  function toCanvas(bmp, w, h, background) {
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w || bmp.width)); cv.height = Math.max(1, Math.round(h || bmp.height));
    var ctx = cv.getContext("2d");
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    return cv;
  }

  function encode(canvas, fmt, quality) {
    var type = TYPES[fmt] || fmt;
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (!b) return reject(new Error("This browser can't save images as " + fmt.toUpperCase() + "."));
        if (type === "image/webp" && b.type !== "image/webp") return reject(new Error("This browser can't save WebP; choose JPG or PNG."));
        resolve(b);
      }, type, quality);
    });
  }

  function ext(fmt) { return fmt === "jpg" ? ".jpg" : "." + fmt; }

  /* items: [{name, blob}] -> one file, or a ZIP when there are several. */
  function deliver(items, zipName) {
    if (items.length === 1) { F.download(items[0].blob, items[0].name); return Promise.resolve(); }
    return F.loadScript("vendor/jszip/jszip.min.js").then(function () {
      var zip = new global.JSZip(), used = {};
      items.forEach(function (it) {
        var n = it.name, i = 1;
        while (used[n]) n = it.name.replace(/(\.[^.]+)$/, "-" + (++i) + "$1");
        used[n] = true; zip.file(n, it.blob);
      });
      return zip.generateAsync({ type: "blob" });
    }).then(function (blob) { F.download(blob, zipName || "images.zip"); });
  }

  /* Shared UI for batch image tools.
     opts: {title, hint, accept, controls: Node[], button, zipName,
            process(file) -> Promise<{name, blob, info}>} */
  function batchTool(opts) {
    var el = global.Calc.el, files = [], results = [];
    var list = el("ul", { class: "batch-list" });
    var prog = F.progress();
    var go = F.button(opts.button || "Convert", run);
    var dlAll = F.button("Download all", function () { deliver(results, opts.zipName); });
    var clear = F.button("Clear", function () { files = []; results = []; render(); }, "btn ghost");
    function render() {
      list.textContent = "";
      files.forEach(function (f) {
        var r = results.filter(function (x) { return x.src === f; })[0];
        list.appendChild(el("li", {}, [
          el("span", { class: "fname", text: f.name }),
          el("span", { class: "muted small", text: F.fmtBytes(f.size) + (r ? " → " + F.fmtBytes(r.blob.size) + (r.info ? " · " + r.info : "") : "") }),
          r ? el("button", { type: "button", class: "btn small-btn", text: "Download", onclick: function () { F.download(r.blob, r.name); } })
            : (f.error ? el("span", { class: "warn small", text: f.error }) : null),
          opts.rowExtra ? opts.rowExtra(f) : null
        ]));
      });
      go.disabled = !files.length; clear.hidden = !files.length;
      dlAll.hidden = results.length < 2;
    }
    function run() {
      results = []; files.forEach(function (f) { f.error = null; });
      go.disabled = true;
      var chain = Promise.resolve();
      files.forEach(function (f, i) {
        chain = chain.then(function () {
          prog.set(i / files.length, "Processing " + (i + 1) + " of " + files.length + ": " + f.name);
          return opts.process(f).then(function (r) { r.src = f; results.push(r); }, function (e) { f.error = e.message || String(e); });
        }).then(render);
      });
      chain.then(function () {
        var failed = files.filter(function (f) { return f.error; }).length;
        prog.done(results.length ? "Done: " + results.length + " file" + (results.length > 1 ? "s" : "") + " ready" + (failed ? ", " + failed + " failed" : "") + "." : "Nothing could be converted.");
        if (results.length === 1) F.download(results[0].blob, results[0].name);
        go.disabled = !files.length; render();
      });
    }
    var root = F.root;
    root.textContent = "";
    root.appendChild(F.dropzone({ accept: opts.accept || ACCEPT, multiple: true, title: opts.title || "Choose images",
      hint: opts.hint || "or drag and drop them here", onFiles: function (fs) { files = files.concat(fs); results = []; render(); } }));
    root.appendChild(list);
    if (opts.controls && opts.controls.length) root.appendChild(el("div", { class: "fields" }, opts.controls));
    root.appendChild(el("div", { class: "actions" }, [go, dlAll, clear]));
    root.appendChild(prog.node);
    document.addEventListener("paste", function (e) {
      var fs = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
      if (fs.length) { files = files.concat(fs); results = []; render(); }
    });
    render();
    return { rerender: render, files: function () { return files; }, after: function (node) { list.after(node); } };
  }

  function select(name, options, value) {
    var el = global.Calc.el;
    return el("select", { name: name }, options.map(function (o) {
      var opt = el("option", { value: o[0], text: o[1] }); if (String(o[0]) === String(value)) opt.selected = true; return opt;
    }));
  }

  global.ImageKit = { isHeic: isHeic, decode: decode, toCanvas: toCanvas, encode: encode, ext: ext, deliver: deliver, TYPES: TYPES,
    batchTool: batchTool, select: select, ACCEPT: ACCEPT };
})(window);
