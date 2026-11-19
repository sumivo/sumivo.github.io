/* Passport photo maker.
   1. Background removal with ISNet (same in-browser model as the background remover).
   2. Face landmarks with MediaPipe Face Landmarker (Apache-2.0): chin, eyes, nose; blendshapes for
      eyes-closed / smile / open-mouth checks. The crown is the top of the cut-out above the face.
   3. Auto-straighten (level eyes), scale so crown-to-chin matches the chosen document's head size,
      centre the face; the user can still drag, zoom and nudge.
   4. Export a single photo (optionally under a KB limit) or a print sheet with cut lines.
   Everything happens on the device. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, I = window.ImageKit, el = C.el;
  var SELF = document.currentScript.src;
  var VENDOR = new URL("../../vendor/", SELF).href;
  var DPI = 300, MM = DPI / 25.4;
  // [id, label, width mm, height mm, crown-to-chin share of photo height, crown margin share]
  var SPECS = [
    ["in-passport", "India passport (35×45 mm)", 35, 45, 0.72, 0.08],
    ["in-visa", "India visa / OCI (2×2 in, 51×51 mm)", 50.8, 50.8, 0.6, 0.1],
    ["in-pan", "India PAN card (25×35 mm)", 25, 35, 0.68, 0.09],
    ["us", "US passport & visa (2×2 in)", 50.8, 50.8, 0.6, 0.1],
    ["uk", "UK passport (35×45 mm)", 35, 45, 0.72, 0.08],
    ["schengen", "Schengen visa / EU (35×45 mm)", 35, 45, 0.75, 0.07],
    ["ca", "Canada passport (50×70 mm)", 50, 70, 0.5, 0.12],
    ["au", "Australia passport (35×45 mm)", 35, 45, 0.75, 0.07],
    ["cn", "China visa (33×48 mm)", 33, 48, 0.68, 0.08],
    ["custom", "Custom size", 35, 45, 0.72, 0.08]
  ];
  var spec = I.select("spec", SPECS.map(function (s) { return [s[0], s[1]]; }), "in-passport");
  var cw = el("input", { type: "number", min: "10", max: "100", step: "0.5", value: "35", "aria-label": "Width in mm" });
  var ch = el("input", { type: "number", min: "10", max: "100", step: "0.5", value: "45", "aria-label": "Height in mm" });
  var customBox = el("div", { class: "fields", hidden: "hidden" }, [el("label", {}, ["Width (mm)", cw]), el("label", {}, ["Height (mm)", ch])]);
  var bgSel = I.select("bg", [["#ffffff", "White"], ["#f4f4f2", "Off-white"], ["#e7e7e7", "Light grey"], ["#dbe8f6", "Light blue"], ["original", "Keep original background"]], "#ffffff");
  var zoom = el("input", { type: "range", min: "0.5", max: "2", step: "0.005", value: "1", "aria-label": "Zoom" });
  var bright = el("input", { type: "range", min: "-40", max: "40", step: "1", value: "0", "aria-label": "Brightness" });
  var rotate = el("input", { type: "range", min: "-15", max: "15", step: "0.5", value: "0", "aria-label": "Rotation in degrees" });
  var guides = el("input", { type: "checkbox", checked: "checked" });
  var maxKb = el("input", { type: "number", min: "0", step: "1", value: "", placeholder: "no limit", inputmode: "numeric", "aria-label": "Maximum file size in KB" });
  var sheet = I.select("sheet", [["4x6", "4×6 in photo paper (102×152 mm)"], ["a4", "A4 sheet"], ["5x7", "5×7 in photo paper"]], "4x6");
  var prog = F.progress();
  var view = el("canvas", { class: "pp-canvas", "aria-label": "Passport photo preview. Drag to move, use the sliders to zoom and rotate." });
  var info = el("p", { class: "muted small" });
  var checks = el("ul", { class: "pp-checks" });
  var editor = el("div", { class: "pp-editor", hidden: "hidden" });
  // Geometry in source-image pixels: pivot (face centre), angle (radians), scale and the output position
  // (x, y) of the pivot, in output pixels.
  var state = { cut: null, orig: null, scale: 1, base: 1, angle: 0, pivot: { x: 0, y: 0 }, x: 0, y: 0, face: null };
  var worker = null, seq = 0, waiting = {}, landmarker = null;

  function cur() {
    var s = SPECS.filter(function (x) { return x[0] === spec.value; })[0];
    if (s[0] === "custom") return { w: Number(cw.value) || 35, h: Number(ch.value) || 45, head: s[4], top: s[5], label: "Custom" };
    return { w: s[2], h: s[3], head: s[4], top: s[5], label: s[1] };
  }
  function px() { var s = cur(); return [Math.round(s.w * MM), Math.round(s.h * MM)]; }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(new URL("workers/bg-worker.js", SELF), { type: "module" });
    worker.onmessage = function (e) {
      var d = e.data;
      if (d.type === "progress") { prog.set(d.loaded / d.total, "Downloading the AI model (first time only): " + F.fmtBytes(d.loaded) + " of " + F.fmtBytes(d.total)); return; }
      var w = waiting[d.id]; if (!w) return; delete waiting[d.id];
      d.type === "error" ? w.reject(new Error(d.message)) : w.resolve(d);
    };
  }

  function faceModel() {
    if (!landmarker) {
      landmarker = import(VENDOR + "mediapipe/vision_bundle.js").then(function (mp) {
        return mp.FilesetResolver.forVisionTasks(VENDOR + "mediapipe/wasm").then(function (files) {
          return mp.FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: VENDOR + "mediapipe/face_landmarker.task", delegate: "CPU" },
            runningMode: "IMAGE", numFaces: 3, outputFaceBlendshapes: true
          });
        });
      }).catch(function (e) { landmarker = null; throw e; });
    }
    return landmarker;
  }

  function open(files) {
    var f = files[0]; if (!f) return;
    editor.hidden = true;
    prog.set(null, "Reading the photo…");
    I.decode(f).then(function (bmp) {
      var s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      state.orig = I.toCanvas(bmp, bmp.width * s, bmp.height * s);
      prog.set(null, "Finding your face…");
      return faceModel().then(function (fl) { return fl.detect(state.orig); }).catch(function () { return null; });
    }).then(function (res) {
      state.face = analyse(res);
      return I.encode(state.orig, "png");
    }).then(function (blob) {
      ensureWorker();
      prog.set(null, "Removing the background… (a few seconds)");
      return new Promise(function (resolve, reject) { var id = ++seq; waiting[id] = { resolve: resolve, reject: reject }; worker.postMessage({ id: id, blob: blob }); });
    }).then(function (r) {
      var cut = document.createElement("canvas");
      cut.width = r.width; cut.height = r.height;
      cut.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      if (cut.width !== state.orig.width) cut = I.toCanvas(cut, state.orig.width, state.orig.height);
      state.cut = cut;
      if (state.face) state.face.crown = crownFromMask(cut, state.face);
      else {
        var sil = silhouette(cut);
        if (!sil) throw new Error("Couldn't find a person in this photo. Use a photo of your face and shoulders, facing the camera.");
        state.sil = sil;
      }
      autoFit();
      editor.hidden = false; prog.done();
      editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (e) { prog.error(e.message || String(e)); });
  }

  /* Landmarks -> face geometry and quality checks (in source pixels). */
  function analyse(res) {
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) return null;
    var W = state.orig.width, H = state.orig.height;
    // Use the biggest face.
    var best = 0, bestArea = -1;
    res.faceLandmarks.forEach(function (lm, i) {
      var xs = lm.map(function (p) { return p.x; }), ys = lm.map(function (p) { return p.y; });
      var a = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * (Math.max.apply(null, ys) - Math.min.apply(null, ys));
      if (a > bestArea) { bestArea = a; best = i; }
    });
    var lm = res.faceLandmarks[best];
    function P(i) { return { x: lm[i].x * W, y: lm[i].y * H }; }
    var eyeR = lm.length > 473 ? P(468) : P(33), eyeL = lm.length > 473 ? P(473) : P(263);
    var chin = P(152), brow = P(10), nose = P(1);
    var mid = { x: (eyeR.x + eyeL.x) / 2, y: (eyeR.y + eyeL.y) / 2 };
    var eyeDist = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y);
    var tilt = Math.atan2(eyeL.y - eyeR.y, eyeL.x - eyeR.x);
    var shapes = {};
    if (res.faceBlendshapes && res.faceBlendshapes[best]) res.faceBlendshapes[best].categories.forEach(function (c) { shapes[c.categoryName] = c.score; });
    var faceW = Math.max.apply(null, lm.map(function (p) { return p.x; })) * W - Math.min.apply(null, lm.map(function (p) { return p.x; })) * W;
    return { chin: chin, brow: brow, mid: mid, nose: nose, eyeDist: eyeDist, tilt: tilt, faces: res.faceLandmarks.length, shapes: shapes, faceW: faceW,
      yaw: (nose.x - mid.x) / eyeDist, chinToEyes: chin.y - mid.y };
  }

  /* Crown = highest solid pixel of the cut-out within the face's column, above the forehead. */
  function crownFromMask(cut, f) {
    var w = cut.width, d = cut.getContext("2d").getImageData(0, 0, w, cut.height).data;
    var x0 = Math.max(0, Math.round(f.mid.x - f.faceW * 0.3)), x1 = Math.min(w - 1, Math.round(f.mid.x + f.faceW * 0.3));
    for (var y = 0; y < f.brow.y; y++) {
      var n = 0;
      for (var x = x0; x <= x1; x++) if (d[(y * w + x) * 4 + 3] > 128) n++;
      if (n > (x1 - x0) * 0.08) return { x: f.mid.x, y: y };
    }
    // No hair found above the forehead (e.g. bald or cut-out failed): crown is about 0.3 face-heights above the brow landmark.
    return { x: f.mid.x, y: f.brow.y - (f.chin.y - f.brow.y) * 0.3 };
  }

  /* Fallback when no face is detected: estimate from the cut-out silhouette. */
  function silhouette(cut) {
    var w = cut.width, h = cut.height, d = cut.getContext("2d").getImageData(0, 0, w, h).data, top = -1, widths = [], headW = 0, cx = w / 2;
    for (var y = 0; y < h; y++) {
      var l = -1, r = -1;
      for (var x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 128) { if (l < 0) l = x; r = x; }
      var width = l < 0 ? 0 : r - l + 1;
      if (top < 0 && width > w * 0.03) top = y;
      if (top < 0) continue;
      if (widths.length > 10) {
        var s = widths.slice().sort(function (a, b) { return a - b; }), med = s[Math.floor(s.length * 0.6)];
        if (width > med * 1.45 && y - top > med * 0.8) break;
      }
      widths.push(width);
      if (width > headW) { headW = width; cx = (l + r) / 2; }
    }
    if (top < 0) return null;
    return { crown: { x: cx, y: top }, chin: { x: cx, y: top + Math.min(headW * 1.38, (h - top) * 0.95) } };
  }

  function rot(p) { // rotate a source point around the pivot by state.angle
    var c = Math.cos(state.angle), s = Math.sin(state.angle), dx = p.x - state.pivot.x, dy = p.y - state.pivot.y;
    return { x: state.pivot.x + dx * c - dy * s, y: state.pivot.y + dx * s + dy * c };
  }
  function toOut(p) { var r = rot(p); return { x: state.x + (r.x - state.pivot.x) * state.scale, y: state.y + (r.y - state.pivot.y) * state.scale }; }

  function autoFit() {
    var s = cur(), P = px(), f = state.face, crown, chin;
    if (f) {
      state.pivot = { x: f.mid.x, y: f.mid.y };
      state.angle = Math.abs(f.tilt) < 15 * Math.PI / 180 ? -f.tilt : 0;
      crown = rot(f.crown); chin = rot(f.chin);
    } else {
      state.pivot = { x: state.sil.crown.x, y: (state.sil.crown.y + state.sil.chin.y) / 2 };
      state.angle = 0; crown = state.sil.crown; chin = state.sil.chin;
    }
    state.scale = state.base = (s.head * P[1]) / (chin.y - crown.y);
    // Put the crown at the top margin and the face centre (eye midpoint) on the vertical centre line.
    state.x = P[0] / 2 - (rot(f ? f.mid : state.pivot).x - state.pivot.x) * state.scale;
    state.y = s.top * P[1] - (crown.y - state.pivot.y) * state.scale;
    zoom.value = 1; rotate.value = (state.angle * 180 / Math.PI).toFixed(1);
    draw(); report();
  }

  function render(cv, w, h) {
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d"), P = px(), k = w / P[0];
    var useOrig = bgSel.value === "original";
    ctx.fillStyle = useOrig ? "#ffffff" : bgSel.value; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.filter = Number(bright.value) ? "brightness(" + (100 + Number(bright.value)) + "%)" : "none";
    ctx.imageSmoothingQuality = "high";
    ctx.translate(state.x * k, state.y * k);
    ctx.rotate(state.angle);
    var img = useOrig ? state.orig : state.cut;
    ctx.drawImage(img, -state.pivot.x * state.scale * k, -state.pivot.y * state.scale * k, img.width * state.scale * k, img.height * state.scale * k);
    ctx.restore();
    return cv;
  }

  function draw() {
    if (!state.cut) return;
    var P = px(), dispH = 420, dispW = Math.round(dispH * P[0] / P[1]);
    render(view, dispW, dispH);
    var s = cur(), ctx = view.getContext("2d");
    if (guides.checked) {
      ctx.save();
      ctx.strokeStyle = "rgba(47,111,94,.9)"; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
      var top = s.top * dispH, headH = s.head * dispH, cx = dispW / 2;
      ctx.beginPath(); ctx.ellipse(cx, top + headH / 2, headH * 0.37, headH / 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(dispW, top); ctx.moveTo(0, top + headH); ctx.lineTo(dispW, top + headH);
      ctx.moveTo(cx, 0); ctx.lineTo(cx, dispH); ctx.stroke();
      ctx.restore();
    }
    info.textContent = s.label + ": " + P[0] + "×" + P[1] + " px at 300 dpi. Dashed lines: top of head, chin and centre.";
  }

  function report() {
    var f = state.face, items = [];
    function add(ok, text) { items.push(el("li", { class: ok ? "ok" : "warn-item", text: (ok ? "✓ " : "⚠ ") + text })); }
    if (!f) add(false, "No face was detected, so the position is estimated from your outline. Check it against the dashed lines.");
    else {
      add(f.faces === 1, f.faces === 1 ? "One face found and positioned automatically." : f.faces + " faces found: the biggest is used. Passport photos must show only you.");
      var deg = Math.abs(f.tilt * 180 / Math.PI);
      add(deg < 15, deg < 0.5 ? "Head is level." : deg < 15 ? "Head tilt of " + deg.toFixed(1) + "° was straightened." : "Head is tilted " + deg.toFixed(0) + "°: retake the photo with your head straight.");
      add(Math.abs(f.yaw) < 0.12, Math.abs(f.yaw) < 0.12 ? "Facing the camera." : "Face is turned to one side: look straight at the camera.");
      var blink = Math.max(f.shapes.eyeBlinkLeft || 0, f.shapes.eyeBlinkRight || 0);
      add(blink < 0.5, blink < 0.5 ? "Eyes open." : "Eyes look closed or half closed.");
      var smile = Math.max(f.shapes.mouthSmileLeft || 0, f.shapes.mouthSmileRight || 0), jaw = f.shapes.jawOpen || 0;
      add(smile < 0.45 && jaw < 0.25, smile < 0.45 && jaw < 0.25 ? "Neutral expression, mouth closed." : "Most passports need a neutral expression with the mouth closed.");
      var faceH = f.chin.y - f.crown.y, needH = cur().head * px()[1];
      add(faceH >= needH * 0.75, faceH >= needH * 0.75 ? "Photo resolution is sufficient." : "The photo is low resolution for this size; the print may look soft. Use a sharper photo.");
    }
    add(true, "Remember: no glasses, hats or filters; even light without shadows; check your country's official rules.");
    checks.textContent = ""; items.forEach(function (i) { checks.appendChild(i); });
  }

  // Interaction: drag to move; zoom around the face; rotate slider; arrow nudges.
  var drag = null;
  view.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, sx: state.x, sy: state.y }; view.setPointerCapture(e.pointerId); });
  view.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var k = px()[0] / view.clientWidth;
    state.x = drag.sx + (e.clientX - drag.x) * k; state.y = drag.sy + (e.clientY - drag.y) * k; draw();
  });
  view.addEventListener("pointerup", function () { drag = null; });
  zoom.addEventListener("input", function () { state.scale = state.base * Number(zoom.value); draw(); });
  rotate.addEventListener("input", function () { state.angle = Number(rotate.value) * Math.PI / 180; draw(); });
  function nudge(dx, dy) { state.x += dx * 4; state.y += dy * 4; draw(); }
  [bright, bgSel, guides].forEach(function (x) { x.addEventListener("input", draw); x.addEventListener("change", draw); });
  spec.addEventListener("change", function () { customBox.hidden = spec.value !== "custom"; if (state.cut) autoFit(); });
  [cw, ch].forEach(function (x) { x.addEventListener("input", function () { if (state.cut) autoFit(); }); });

  function single() { var P = px(); return render(document.createElement("canvas"), P[0], P[1]); }

  function underKb(cv, kb) {
    var lo = 0.3, hi = 0.95, best = null, n = 0;
    function step() {
      if (n++ >= 7) return Promise.resolve(best);
      var q = (lo + hi) / 2;
      return I.encode(cv, "jpg", q).then(function (b) { if (b.size <= kb * 1024) { best = b; lo = q; } else hi = q; return step(); });
    }
    return step().then(function (b) { return b || I.encode(cv, "jpg", 0.3); });
  }

  function downloadSingle() {
    var cv = single(), kb = Number(maxKb.value) || 0;
    (kb ? underKb(cv, kb) : I.encode(cv, "jpg", 0.95)).then(function (b) {
      F.download(b, "passport-photo-" + cv.width + "x" + cv.height + ".jpg");
      prog.done("Saved: " + cv.width + "×" + cv.height + " px, " + F.fmtBytes(b.size) + (kb && b.size > kb * 1024 ? " (couldn't get under " + kb + " KB at acceptable quality)" : "") + ".");
    });
  }

  function downloadSheet() {
    var dims = { "4x6": [101.6, 152.4], "5x7": [127, 177.8], a4: [210, 297] }[sheet.value];
    var W = Math.round(dims[0] * MM), H = Math.round(dims[1] * MM), photo = single(), gap = Math.round(2 * MM), margin = Math.round(4 * MM);
    var cols = Math.max(1, Math.floor((W - 2 * margin + gap) / (photo.width + gap))), rows = Math.max(1, Math.floor((H - 2 * margin + gap) / (photo.height + gap)));
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    var ox = Math.round((W - cols * photo.width - (cols - 1) * gap) / 2), oy = Math.round((H - rows * photo.height - (rows - 1) * gap) / 2);
    ctx.strokeStyle = "#bbbbbb"; ctx.lineWidth = 1;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = ox + c * (photo.width + gap), y = oy + r * (photo.height + gap);
      ctx.drawImage(photo, x, y); ctx.strokeRect(x - 0.5, y - 0.5, photo.width + 1, photo.height + 1);
    }
    I.encode(cv, "jpg", 0.95).then(function (b) {
      F.download(b, "passport-photos-" + sheet.value + "-" + cols * rows + ".jpg");
      prog.done("Print sheet saved: " + cols * rows + " photos on " + sheet.options[sheet.selectedIndex].text + ". Print at 100% / actual size (not “fit to page”).");
    });
  }

  function nb(t, label, fn) { return el("button", { type: "button", class: "icon", title: label, "aria-label": label, text: t, onclick: fn }); }
  editor.append(
    el("div", { class: "pp-layout" }, [
      el("div", { class: "pp-stage" }, [view, el("div", { class: "row-actions pp-nudge" }, [
        nb("←", "Move left", function () { nudge(-1, 0); }), nb("↑", "Move up", function () { nudge(0, -1); }),
        nb("↓", "Move down", function () { nudge(0, 1); }), nb("→", "Move right", function () { nudge(1, 0); }),
        F.button("Auto-fit again", autoFit, "btn ghost small-btn")]), info]),
      el("div", {}, [
        el("h3", { text: "Photo checks" }), checks,
        el("div", { class: "fields" }, [el("label", { class: "wide" }, ["Zoom", zoom]), el("label", { class: "wide" }, ["Rotate", rotate]),
          el("label", { class: "wide" }, ["Brightness", bright]), el("label", {}, ["Background", bgSel]), el("label", { class: "inline" }, [guides, " Show guides"])]),
        el("h3", { text: "Download" }),
        el("div", { class: "fields" }, [el("label", {}, ["Max file size (KB, optional)", maxKb])]),
        el("div", { class: "actions" }, [F.button("Download photo", downloadSingle)]),
        el("div", { class: "fields" }, [el("label", { class: "wide" }, ["Print sheet", sheet])]),
        el("div", { class: "actions" }, [F.button("Download print sheet", downloadSheet, "btn ghost")])])]));
  var root = F.root;
  root.textContent = "";
  root.append(
    el("div", { class: "fields" }, [el("label", { class: "wide" }, ["Photo type", spec])]), customBox,
    F.dropzone({ accept: "image/*,.heic,.heif", title: "Choose a photo of yourself",
      hint: "Face the camera, plain background, good light · JPG, PNG, HEIC · or drag and drop", onFiles: open }),
    prog.node, editor);
})();
