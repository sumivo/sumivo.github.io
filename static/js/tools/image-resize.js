/* Image resizer: by pixels, percentage or presets (passport photo, social media sizes, form photo
   and signature sizes). When cropping to an exact size, the crop is placed by "smart crop" (keeps
   the most detailed area) or a chosen position, and every image can be adjusted by dragging a crop
   box. Batch, in the browser. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, I = window.ImageKit, el = C.el;
  var PRESETS = [
    ["", "Custom size"],
    ["413x531", "Passport photo 35×45 mm (413×531 px at 300 dpi)"],
    ["600x600", "US passport / visa photo 2×2 in (600×600 px)"],
    ["200x230", "Exam form photo (200×230 px)"],
    ["140x60", "Signature for forms (140×60 px)"],
    ["1080x1080", "Instagram post, square (1080×1080)"],
    ["1080x1350", "Instagram post, portrait (1080×1350)"],
    ["1080x1920", "Instagram / WhatsApp story (1080×1920)"],
    ["1280x720", "YouTube thumbnail (1280×720)"],
    ["1200x630", "Facebook / LinkedIn share image (1200×630)"],
    ["820x312", "Facebook cover (820×312)"],
    ["1500x500", "X (Twitter) header (1500×500)"],
    ["400x400", "Profile picture (400×400)"],
    ["1920x1080", "Full HD wallpaper (1920×1080)"]
  ];
  var unit = I.select("unit", [["px", "Pixels"], ["pct", "Percentage"]], "px");
  var preset = I.select("preset", PRESETS, "");
  var w = el("input", { type: "number", min: "1", step: "1", value: "1280", inputmode: "numeric", "aria-label": "Width" });
  var h = el("input", { type: "number", min: "1", step: "1", value: "", placeholder: "auto", inputmode: "numeric", "aria-label": "Height" });
  var pct = el("input", { type: "number", min: "1", max: "1000", step: "1", value: "50", inputmode: "numeric", "aria-label": "Percentage" });
  var fit = I.select("fit", [["keep", "Keep proportions (fit inside)"], ["crop", "Crop to fill exactly"], ["stretch", "Stretch to exact size"]], "keep");
  var focus = I.select("focus", [["smart", "Smart: keep the most detailed area"], ["center", "Centre"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]], "smart");
  var fmt = I.select("fmt", [["same", "Same as original"], ["jpg", "JPG"], ["png", "PNG"], ["webp", "WebP"]], "same");
  var wl = el("label", {}, ["Width (px)", w]), hl = el("label", {}, ["Height (px)", h]), pl = el("label", {}, ["Percentage (%)", pct]),
    fl = el("label", {}, ["When both sides are set", fit]), ul = el("label", {}, ["Resize by", unit]), cl = el("label", {}, ["Crop position", focus]);
  var tool;
  function cropping() { return unit.value === "px" && fit.value === "crop" && Number(w.value) > 0 && Number(h.value) > 0; }
  function sync() {
    var p = unit.value === "pct";
    wl.hidden = hl.hidden = p; pl.hidden = !p; fl.hidden = p; cl.hidden = !cropping();
    if (tool) tool.rerender();
  }
  preset.addEventListener("change", function () {
    if (!preset.value) return;
    var d = preset.value.split("x"); unit.value = "px"; w.value = d[0]; h.value = d[1]; fit.value = "crop";
    tool.files().forEach(function (f) { f.crop = null; });
    sync();
  });
  [unit, fit, w, h].forEach(function (x) { x.addEventListener("change", sync); x.addEventListener("input", sync); });

  /* Crop window (in source pixels) for aspect ar = tw/th at zoom s (1 = largest possible), centred on (cx, cy) 0..1. */
  function windowFor(bmp, ar, cx, cy, s) {
    var cw = Math.min(bmp.width, bmp.height * ar) * s, ch = cw / ar;
    var x = Math.max(0, Math.min(bmp.width - cw, cx * bmp.width - cw / 2));
    var y = Math.max(0, Math.min(bmp.height - ch, cy * bmp.height - ch / 2));
    return { x: x, y: y, w: cw, h: ch };
  }

  /* Smart crop: detail energy (edges + colourfulness) on a small copy, summed with an integral image;
     choose the largest-window position with the most energy, gently preferring the centre. */
  function smartCentre(bmp, ar) {
    var S = 160, k = S / Math.max(bmp.width, bmp.height);
    var sw = Math.max(8, Math.round(bmp.width * k)), sh = Math.max(8, Math.round(bmp.height * k));
    var cv = I.toCanvas(bmp, sw, sh), d = cv.getContext("2d").getImageData(0, 0, sw, sh).data;
    var lum = new Float32Array(sw * sh), sat = new Float32Array(sw * sh);
    for (var i = 0; i < sw * sh; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
    }
    var integ = new Float64Array((sw + 1) * (sh + 1));
    for (var y = 0; y < sh; y++) {
      var row = 0;
      for (var x = 0; x < sw; x++) {
        var j = y * sw + x;
        var gx = x > 0 && x < sw - 1 ? lum[j + 1] - lum[j - 1] : 0, gy = y > 0 && y < sh - 1 ? lum[j + sw] - lum[j - sw] : 0;
        row += Math.sqrt(gx * gx + gy * gy) + sat[j] * 0.25;
        integ[(y + 1) * (sw + 1) + x + 1] = integ[y * (sw + 1) + x + 1] + row;
      }
    }
    function sum(x0, y0, x1, y1) { var W = sw + 1; return integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0]; }
    var win = windowFor({ width: sw, height: sh }, ar, 0.5, 0.5, 1), ww = Math.round(win.w), wh = Math.round(win.h);
    var best = -1, bx = 0, by = 0;
    for (var yy = 0; yy + wh <= sh; yy++) for (var xx = 0; xx + ww <= sw; xx++) {
      var cxn = (xx + ww / 2) / sw - 0.5, cyn = (yy + wh / 2) / sh - 0.5;
      var score = sum(xx, yy, xx + ww, yy + wh) * (1 - 0.35 * Math.sqrt(cxn * cxn + cyn * cyn));
      if (score > best) { best = score; bx = xx; by = yy; }
    }
    return { cx: (bx + ww / 2) / sw, cy: (by + wh / 2) / sh };
  }

  function autoCrop(bmp, ar) {
    var f = focus.value;
    if (f === "smart") return smartCentre(bmp, ar);
    return { cx: f === "left" ? 0 : f === "right" ? 1 : 0.5, cy: f === "top" ? 0 : f === "bottom" ? 1 : 0.5 };
  }

  function draw(bmp, tw, th, mode, type, crop) {
    var cv = document.createElement("canvas");
    cv.width = tw; cv.height = th;
    var ctx = cv.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (type === "jpg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, tw, th); }
    if (mode === "crop") {
      var win = windowFor(bmp, tw / th, crop.cx, crop.cy, crop.s || 1);
      ctx.drawImage(bmp, win.x, win.y, win.w, win.h, 0, 0, tw, th);
    } else {
      ctx.drawImage(bmp, 0, 0, tw, th);
    }
    return cv;
  }

  // ---- crop editor (drag the box, zoom with the slider)
  var editor = el("div", { class: "crop-editor", hidden: "hidden" });
  function openEditor(file) {
    I.decode(file).then(function (bmp) {
      var ar = Number(w.value) / Number(h.value);
      var crop = file.crop || Object.assign({ s: 1 }, autoCrop(bmp, ar));
      var maxW = Math.min(560, editor.parentNode.clientWidth - 30), k = Math.min(maxW / bmp.width, 420 / bmp.height);
      var cv = el("canvas", { class: "crop-canvas", width: String(Math.round(bmp.width * k)), height: String(Math.round(bmp.height * k)) });
      var zoom = el("input", { type: "range", min: "0.2", max: "1", step: "0.01", value: String(crop.s), "aria-label": "Crop size" });
      function paint() {
        var ctx = cv.getContext("2d"), win = windowFor(bmp, ar, crop.cx, crop.cy, crop.s);
        ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); ctx.rect(win.x * k, win.y * k, win.w * k, win.h * k); ctx.fill("evenodd");
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(win.x * k, win.y * k, win.w * k, win.h * k);
      }
      var drag = null;
      cv.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener("pointermove", function (e) {
        if (!drag) return;
        var scale = cv.width / cv.clientWidth;
        crop.cx = Math.max(0, Math.min(1, drag.cx + (e.clientX - drag.x) * scale / cv.width));
        crop.cy = Math.max(0, Math.min(1, drag.cy + (e.clientY - drag.y) * scale / cv.height));
        var win = windowFor(bmp, ar, crop.cx, crop.cy, crop.s); // clamp centre to the reachable range
        crop.cx = (win.x + win.w / 2) / bmp.width; crop.cy = (win.y + win.h / 2) / bmp.height;
        paint();
      });
      cv.addEventListener("pointerup", function () { drag = null; });
      zoom.addEventListener("input", function () { crop.s = Number(zoom.value); paint(); });
      editor.textContent = "";
      editor.append(el("h3", { text: "Adjust crop: " + file.name }), el("p", { class: "muted small", text: "Drag the bright box to choose what to keep; use the slider to crop tighter." }),
        cv, el("label", { class: "inline" }, ["Crop size ", zoom]),
        el("div", { class: "actions" }, [
          F.button("Use this crop", function () { file.crop = crop; editor.hidden = true; tool.rerender(); }),
          F.button("Reset to automatic", function () { file.crop = null; editor.hidden = true; tool.rerender(); }, "btn ghost"),
          F.button("Cancel", function () { editor.hidden = true; }, "btn ghost")]));
      editor.hidden = false; paint();
      editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (e) { alert(e.message); });
  }

  tool = I.batchTool({
    title: "Choose images to resize", hint: "JPG, PNG, WebP, HEIC · or drag and drop · several at once is fine",
    controls: [el("label", { class: "wide" }, ["Preset", preset]), ul, wl, hl, pl, fl, cl, el("label", {}, ["Format", fmt])],
    button: "Resize", zipName: "resized-images.zip",
    rowExtra: function (f) {
      if (!cropping()) return null;
      return el("button", { type: "button", class: "btn ghost small-btn", text: f.crop ? "Crop adjusted ✓" : "Adjust crop", onclick: function () { openEditor(f); } });
    },
    process: function (file) {
      return I.decode(file).then(function (bmp) {
        var tw, th, mode = fit.value;
        if (unit.value === "pct") {
          var p = Math.max(1, Number(pct.value) || 100) / 100;
          tw = Math.round(bmp.width * p); th = Math.round(bmp.height * p); mode = "stretch";
        } else {
          var W = Number(w.value) || 0, H = Number(h.value) || 0;
          if (!W && !H) throw new Error("Enter a width or a height.");
          if (!W || !H) { var s = W ? W / bmp.width : H / bmp.height; tw = Math.round(bmp.width * s); th = Math.round(bmp.height * s); mode = "stretch"; }
          else if (mode === "keep") { var k = Math.min(W / bmp.width, H / bmp.height); tw = Math.round(bmp.width * k); th = Math.round(bmp.height * k); }
          else { tw = W; th = H; }
        }
        if (tw > 16000 || th > 16000) throw new Error("That's larger than browsers can handle (max 16000 px).");
        var crop = mode === "crop" ? (file.crop || Object.assign({ s: 1 }, autoCrop(bmp, tw / th))) : null;
        var type = fmt.value === "same" ? (/png$/i.test(file.type) ? "png" : /webp$/i.test(file.type) ? "webp" : "jpg") : fmt.value;
        return I.encode(draw(bmp, tw, th, mode, type, crop), type, 0.92).then(function (blob) {
          return { name: F.baseName(file.name) + "-" + tw + "x" + th + I.ext(type), blob: blob,
            info: bmp.width + "×" + bmp.height + " → " + tw + "×" + th + (crop ? (file.crop ? " · your crop" : " · " + (focus.value === "smart" ? "smart crop" : focus.value)) : "") };
        });
      });
    }
  });
  tool.after(editor);
  sync();
})();
