/* Image converter (also the HEIC to JPG page): any image the browser can read, plus iPhone HEIC,
   to JPG, PNG or WebP. Batch, ZIP download, nothing uploaded. Page config: data-config {to, heic}. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, I = window.ImageKit, el = C.el;
  var cfg = JSON.parse(F.root.dataset.config || "{}");
  var fmt = I.select("fmt", [["jpg", "JPG"], ["png", "PNG"], ["webp", "WebP"]], cfg.to || "jpg");
  var quality = I.select("quality", [[0.95, "Maximum (95%)"], [0.9, "High (90%)"], [0.8, "Good (80%)"], [0.65, "Smaller file (65%)"]], 0.9);
  var bg = el("input", { type: "color", value: "#ffffff", "aria-label": "Background for transparent areas" });
  var qLabel = el("label", {}, ["Quality", quality]);
  var bgLabel = el("label", {}, ["Fill transparent areas with", bg]);
  function sync() { qLabel.hidden = fmt.value === "png"; bgLabel.hidden = fmt.value !== "jpg"; }
  fmt.addEventListener("change", sync);
  I.batchTool({
    title: cfg.heic ? "Choose HEIC photos" : "Choose images",
    hint: cfg.heic ? "iPhone .heic / .heif photos · or drag and drop · several at once is fine"
      : "JPG, PNG, WebP, GIF, BMP, AVIF, HEIC · or drag and drop · several at once is fine",
    accept: cfg.heic ? ".heic,.heif,image/heic,image/heif" : "image/*,.heic,.heif",
    controls: [el("label", {}, ["Convert to", fmt]), qLabel, bgLabel],
    button: "Convert",
    zipName: "converted-images.zip",
    process: function (file) {
      return I.decode(file).then(function (bmp) {
        var cv = I.toCanvas(bmp, bmp.width, bmp.height, fmt.value === "jpg" ? bg.value : null);
        return I.encode(cv, fmt.value, Number(quality.value)).then(function (blob) {
          return { name: F.baseName(file.name) + I.ext(fmt.value), blob: blob, info: bmp.width + "×" + bmp.height };
        });
      });
    }
  });
  sync();
})();
