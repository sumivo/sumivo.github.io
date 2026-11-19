/* Images (JPG, PNG, WebP, GIF, BMP, and HEIC where the browser can read it) -> one PDF.
   Uses pdf-lib (MIT), loaded on first use. Nothing is uploaded. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, el = C.el;
  var PAGE = { a4: [595.28, 841.89], letter: [612, 792] };
  var MARGIN = { none: 0, small: 18, large: 42 };
  var items = []; // {file, url, rotate}

  var list = el("ol", { class: "filelist thumbs-grid" });
  var size = el("select", { name: "size" }, [["fit", "Same as image"], ["a4", "A4"], ["letter", "US Letter"]].map(opt));
  var orient = el("select", { name: "orient" }, [["auto", "Automatic"], ["portrait", "Portrait"], ["landscape", "Landscape"]].map(opt));
  var margin = el("select", { name: "margin" }, [["none", "No margin"], ["small", "Small margin"], ["large", "Large margin"]].map(opt));
  var quality = el("select", { name: "quality" }, [["original", "Original quality"], ["compact", "Smaller file"]].map(opt));
  var prog = F.progress();
  var go = F.button("Convert to PDF", convert);
  var clear = F.button("Clear all", function () { items.forEach(function (i) { URL.revokeObjectURL(i.url); }); items = []; render(); }, "btn ghost");
  var result = el("div", { class: "result-box", hidden: "hidden" });

  function opt(o) { return el("option", { value: o[0], text: o[1] }); }

  function add(files) {
    files.forEach(function (f) {
      if (!/^image\//.test(f.type) && !/\.(heic|heif|jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)) return;
      items.push({ file: f, url: URL.createObjectURL(f), rotate: 0 });
    });
    render();
  }

  function render() {
    list.textContent = "";
    items.forEach(function (it, i) {
      var img = el("img", { src: it.url, alt: it.file.name, loading: "lazy" });
      img.style.transform = "rotate(" + it.rotate + "deg)";
      img.onerror = function () { img.replaceWith(el("span", { class: "noprev", text: "No preview" })); };
      list.appendChild(el("li", {}, [
        el("div", { class: "thumb" }, [img]),
        el("div", { class: "fname", text: (i + 1) + ". " + it.file.name }),
        el("div", { class: "row-actions" }, [
          small("↑", "Move up", function () { move(i, -1); }, i === 0),
          small("↓", "Move down", function () { move(i, 1); }, i === items.length - 1),
          small("⟳", "Rotate", function () { it.rotate = (it.rotate + 90) % 360; render(); }),
          small("✕", "Remove", function () { URL.revokeObjectURL(it.url); items.splice(i, 1); render(); })
        ])
      ]));
    });
    go.disabled = !items.length; clear.hidden = !items.length;
    go.textContent = items.length > 1 ? "Convert " + items.length + " images to PDF" : "Convert to PDF";
    result.hidden = true;
  }
  function small(t, label, fn, disabled) {
    var b = el("button", { type: "button", class: "icon", "aria-label": label, title: label, text: t, onclick: fn });
    if (disabled) b.disabled = true;
    return b;
  }
  function move(i, d) { var t = items[i]; items[i] = items[i + d]; items[i + d] = t; render(); }

  /* EXIF orientation of a JPEG (1 = normal). */
  function jpegOrientation(buf) {
    var v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
    var off = 2;
    while (off + 4 < v.byteLength) {
      var marker = v.getUint16(off), len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
        var t = off + 10, le = v.getUint16(t) === 0x4949;
        var ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
        for (var k = 0; k < n; k++) {
          var e = ifd + 2 + k * 12;
          if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
        }
        return 1;
      }
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + len;
    }
    return 1;
  }

  /* Returns {bytes, kind:'jpg'|'png', w, h} ready for pdf-lib. */
  function prepare(it, compact) {
    return it.file.arrayBuffer().then(function (buf) {
      var isJpeg = /jpe?g$/i.test(it.file.type) || /\.jpe?g$/i.test(it.file.name);
      var isPng = it.file.type === "image/png" || /\.png$/i.test(it.file.name);
      if (!it.rotate && !compact && isPng) return { bytes: buf, kind: "png" };
      if (!it.rotate && !compact && isJpeg && jpegOrientation(buf) === 1) return { bytes: buf, kind: "jpg" };
      // Everything else is drawn on a canvas (applies EXIF rotation, user rotation, other formats).
      // ImageKit.decode reads every browser format plus iPhone HEIC (libheif, loaded only when needed).
      return window.ImageKit.decode(it.file).then(function (bmp) {
        var maxSide = compact ? 2000 : 6000;
        var scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
        var w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
        var swap = it.rotate === 90 || it.rotate === 270;
        var cv = document.createElement("canvas");
        cv.width = swap ? h : w; cv.height = swap ? w : h;
        var ctx = cv.getContext("2d");
        var keepAlpha = isPng || /\.(webp|gif)$/i.test(it.file.name);
        if (!keepAlpha) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); }
        ctx.translate(cv.width / 2, cv.height / 2);
        ctx.rotate(it.rotate * Math.PI / 180);
        ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
        var type = keepAlpha && !compact ? "image/png" : "image/jpeg";
        return new Promise(function (res) { cv.toBlob(res, type, compact ? 0.8 : 0.92); })
          .then(function (blob) { return blob.arrayBuffer(); })
          .then(function (b) { return { bytes: b, kind: type === "image/png" ? "png" : "jpg" }; });
      });
    });
  }

  function convert() {
    if (!items.length) return;
    go.disabled = true;
    prog.set(null, "Loading the PDF engine…");
    F.loadScript("vendor/pdf-lib/pdf-lib.min.js").then(function () {
      var PDF = window.PDFLib;
      return PDF.PDFDocument.create().then(function (doc) {
        doc.setTitle(F.baseName(items[0].file.name));
        doc.setProducer("Sumivo Image to PDF (pdf-lib)");
        var compact = quality.value === "compact";
        var chain = Promise.resolve();
        items.forEach(function (it, i) {
          chain = chain.then(function () {
            prog.set(i / items.length, "Adding image " + (i + 1) + " of " + items.length + "…");
            return prepare(it, compact);
          }).then(function (p) {
            return (p.kind === "png" ? doc.embedPng(p.bytes) : doc.embedJpg(p.bytes)).then(function (img) {
              var m = MARGIN[margin.value], iw = img.width, ih = img.height, pw, ph;
              if (size.value === "fit") { pw = iw * 0.75 + 2 * m; ph = ih * 0.75 + 2 * m; } // 96 dpi pixels -> points
              else {
                var dims = PAGE[size.value], land = orient.value === "landscape" || (orient.value === "auto" && iw > ih);
                pw = land ? dims[1] : dims[0]; ph = land ? dims[0] : dims[1];
              }
              var page = doc.addPage([pw, ph]);
              var s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih);
              if (size.value === "fit") s = 0.75;
              page.drawImage(img, { x: (pw - iw * s) / 2, y: (ph - ih * s) / 2, width: iw * s, height: ih * s });
            });
          });
        });
        return chain.then(function () { prog.set(1, "Saving…"); return doc.save(); });
      });
    }).then(function (bytes) {
      var blob = new Blob([bytes], { type: "application/pdf" });
      var name = (items.length === 1 ? F.baseName(items[0].file.name) : "images") + ".pdf";
      prog.done();
      result.hidden = false; result.textContent = "";
      result.appendChild(el("p", {}, [el("strong", { text: "Your PDF is ready: " }), name + " (" + items.length + (items.length === 1 ? " page, " : " pages, ") + F.fmtBytes(blob.size) + ")"]));
      result.appendChild(F.button("Download PDF", function () { F.download(blob, name); }));
      F.download(blob, name);
    }).catch(function (e) { prog.error(e.message || String(e)); })
      .then(function () { go.disabled = !items.length; });
  }

  var rootEl = F.root;
  rootEl.textContent = "";
  rootEl.appendChild(F.dropzone({ accept: "image/*,.heic,.heif", multiple: true, title: "Choose images",
    hint: "JPG, PNG, WebP, HEIC, GIF or BMP · or drag and drop · or paste (Ctrl+V)", onFiles: add }));
  rootEl.appendChild(list);
  rootEl.appendChild(el("div", { class: "fields" }, [
    el("label", {}, ["Page size", size]), el("label", {}, ["Orientation", orient]),
    el("label", {}, ["Margin", margin]), el("label", {}, ["Quality", quality])]));
  rootEl.appendChild(el("div", { class: "actions" }, [go, clear]));
  rootEl.appendChild(prog.node);
  rootEl.appendChild(result);
  document.addEventListener("paste", function (e) {
    var files = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) add(files);
  });
  render();
})();
