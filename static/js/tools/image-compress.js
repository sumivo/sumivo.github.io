/* Image compressor: by quality, or to a target size such as 20 KB / 50 KB / 100 KB (common for
   application forms), with optional maximum dimensions. Batch, in the browser. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, I = window.ImageKit, el = C.el;
  var mode = I.select("mode", [["quality", "By quality"], ["target", "To a target size"]], "quality");
  var quality = I.select("quality", [[0.85, "Light (85%)"], [0.75, "Recommended (75%)"], [0.6, "Strong (60%)"], [0.45, "Maximum (45%)"]], 0.75);
  var target = el("input", { type: "number", min: "5", step: "1", value: "100", inputmode: "numeric", "aria-label": "Target size in KB" });
  var maxSide = I.select("max", [[0, "Keep original size"], [3840, "Max 3840 px"], [2560, "Max 2560 px"], [1920, "Max 1920 px"], [1280, "Max 1280 px"], [800, "Max 800 px"]], 0);
  var fmt = I.select("fmt", [["auto", "Automatic"], ["jpg", "JPG"], ["webp", "WebP"], ["png", "PNG (lossless)"]], "auto");
  var qLabel = el("label", {}, ["Compression", quality]), tLabel = el("label", {}, ["Target size (KB)", target]);
  function sync() { qLabel.hidden = mode.value !== "quality"; tLabel.hidden = mode.value !== "target"; }
  mode.addEventListener("change", sync);

  function hasAlpha(cv) {
    var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    for (var i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) return true;
    return false;
  }

  function scaled(bmp, max) {
    var s = max && Math.max(bmp.width, bmp.height) > max ? max / Math.max(bmp.width, bmp.height) : 1;
    return [Math.round(bmp.width * s), Math.round(bmp.height * s)];
  }

  /* Smallest quality / size that fits under `bytes`: binary search on quality, then shrink. */
  function toTarget(bmp, type, bytes, w, h) {
    function attempt(w, h, tries) {
      var cv = I.toCanvas(bmp, w, h, type === "jpg" ? "#ffffff" : null);
      var lo = 0.05, hi = 0.95, best = null;
      var steps = 0;
      function step() {
        if (steps++ >= 7) return Promise.resolve(best);
        var q = (lo + hi) / 2;
        return I.encode(cv, type, q).then(function (b) {
          if (b.size <= bytes) { best = { blob: b, q: q, w: w, h: h }; lo = q; } else { hi = q; }
          return step();
        });
      }
      return step().then(function (r) {
        if (r) return r;
        if (tries > 12 || w < 64) return I.encode(cv, type, 0.05).then(function (b) { return { blob: b, q: 0.05, w: w, h: h, over: true }; });
        return attempt(Math.round(w * 0.85), Math.round(h * 0.85), tries + 1);
      });
    }
    return attempt(w, h, 0);
  }

  I.batchTool({
    title: "Choose images to compress", hint: "JPG, PNG, WebP, HEIC · or drag and drop · several at once is fine",
    controls: [el("label", {}, ["Mode", mode]), qLabel, tLabel, el("label", {}, ["Dimensions", maxSide]), el("label", {}, ["Output format", fmt])],
    button: "Compress", zipName: "compressed-images.zip",
    process: function (file) {
      return I.decode(file).then(function (bmp) {
        var wh = scaled(bmp, Number(maxSide.value));
        var type = fmt.value;
        if (type === "auto") type = hasAlpha(I.toCanvas(bmp, Math.min(bmp.width, 400), Math.min(bmp.height, 400))) ? "webp" : "jpg";
        var job;
        if (mode.value === "target") {
          if (type === "png") throw new Error("PNG is lossless and can't target a size; choose JPG, WebP or Automatic.");
          job = toTarget(bmp, type, Math.max(5, Number(target.value) || 100) * 1024, wh[0], wh[1]);
        } else {
          var cv = I.toCanvas(bmp, wh[0], wh[1], type === "jpg" ? "#ffffff" : null);
          job = I.encode(cv, type, Number(quality.value)).then(function (b) { return { blob: b, w: wh[0], h: wh[1] }; });
        }
        return job.then(function (r) {
          var sameType = (I.TYPES[type] === file.type);
          if (mode.value === "quality" && sameType && r.blob.size >= file.size && wh[0] === bmp.width) {
            return { name: file.name, blob: file, info: "already well compressed, kept as is" };
          }
          var saved = Math.round(100 * (1 - r.blob.size / file.size));
          var info = r.w + "×" + r.h + (saved > 0 ? " · " + saved + "% smaller" : "") + (r.over ? " · couldn't reach the target" : "");
          return { name: F.baseName(file.name) + I.ext(type), blob: r.blob, info: info };
        });
      });
    }
  });
  sync();
})();
