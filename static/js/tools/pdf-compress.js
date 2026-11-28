/* Compress PDF, two methods:
   - "Keep text" (default): recompresses the images inside the PDF (JPEG and 8-bit RGB/grey images)
     at a lower resolution and quality, leaving text, fonts, links, bookmarks and forms untouched.
   - "Maximum": re-renders every page as a JPEG; biggest savings for scans, but text becomes an image.
   The result is only offered when it is smaller than the original. Everything runs in the browser. */
import { openPdf, renderPage, pdflib, canvasBlob } from "../lib/pdfkit.js";

const { Calc: C, FileKit: F, ImageKit: I } = window;
const el = C.el;
let file = null;
const info = el("p", { class: "muted" });
const method = I.select("method", [["images", "Keep text: compress images only (recommended)"], ["raster", "Maximum: turn pages into images"]], "images");
const level = I.select("level", [["light", "Light: best quality"], ["medium", "Recommended"], ["strong", "Strong: smallest file"]], "medium");
const gray = el("input", { type: "checkbox" });
const note = el("p", { class: "muted small" });
const prog = F.progress();
const go = F.button("Compress PDF", compress);
const result = el("div", { class: "result-box", hidden: "hidden" });
const box = el("div", { hidden: "hidden" }, [info, el("div", { class: "fields" }, [el("label", { class: "wide" }, ["Method", method]),
  el("label", {}, ["Compression", level]), el("label", { class: "inline" }, [gray, " Black and white (smaller)"])]), note, el("div", { class: "actions" }, [go])]);
const LEVELS = { // [max image side in px, JPEG quality, page dpi for raster mode]
  light: [2200, 0.8, 150], medium: [1600, 0.65, 120], strong: [1100, 0.5, 96] };
function explain() {
  note.textContent = method.value === "images"
    ? "Text stays sharp, selectable and searchable; links, bookmarks and forms are kept. Works best on PDFs with photos or scanned pages."
    : "Every page becomes a compressed picture: the biggest saving for scans, but text can no longer be selected or searched, and links and forms are removed.";
}
method.addEventListener("change", explain);

async function open(files) {
  file = files[0]; result.hidden = true;
  try {
    const doc = await openPdf(file);
    info.textContent = file.name + ": " + doc.numPages + " page" + (doc.numPages === 1 ? "" : "s") + ", " + F.fmtBytes(file.size) + ".";
    doc.destroy();
    box.hidden = false; prog.done(); explain();
  } catch (e) { box.hidden = true; prog.error(e.message); }
}

/* Method 1: recompress embedded images, keep everything else. */
async function compressImages(bytes, [maxSide, quality], grey) {
  const PDF = await pdflib();
  const { PDFName, PDFRawStream, PDFArray, PDFNumber, decodePDFRawStream } = PDF;
  let doc;
  try { doc = await PDF.PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw new Error(/encrypt/i.test(e.message) ? "This PDF is password-protected. Remove the password first." : "This file couldn't be read as a PDF."); }
  const N = (n) => PDFName.of(n);
  const images = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(N("Subtype")) !== N("Image")) continue;
    images.push([ref, obj]);
  }
  let done = 0, replaced = 0, saved = 0;
  for (const [ref, obj] of images) {
    prog.set(done++ / Math.max(1, images.length), "Compressing image " + done + " of " + images.length + "…");
    const d = obj.dict;
    const num = (k) => { const v = d.lookup(N(k)); return v instanceof PDFNumber ? v.asNumber() : 0; };
    const w = num("Width"), h = num("Height"), bpc = num("BitsPerComponent");
    if (w * h < 250 * 250 || d.has(N("ImageMask")) || d.has(N("Decode")) || d.lookup(N("Mask")) instanceof PDFArray) continue;
    // Colour components: DeviceGray 1, DeviceRGB 3, ICCBased with N=1/3. Skip CMYK, Indexed, Lab, etc.
    let comps = 0;
    const cs = d.lookup(N("ColorSpace"));
    if (cs === N("DeviceGray")) comps = 1; else if (cs === N("DeviceRGB")) comps = 3;
    else if (cs instanceof PDFArray && cs.lookup(0) === N("ICCBased")) { const n = cs.lookup(1).dict.lookup(N("N")); comps = n ? n.asNumber() : 0; }
    if (comps !== 1 && comps !== 3) continue;
    // Filters may be a chain, e.g. [/ASCII85Decode /DCTDecode] (ReportLab) or [/ASCII85Decode /FlateDecode].
    const f = d.lookup(N("Filter"));
    const filters = f instanceof PDFArray ? f.asArray().map((x) => d.context.lookup(x)) : f ? [f] : [];
    const SIMPLE = [N("FlateDecode"), N("LZWDecode"), N("ASCII85Decode"), N("ASCIIHexDecode"), N("RunLengthDecode")];
    if (d.has(N("DecodeParms")) && filters.some((x) => x !== N("DCTDecode"))) continue; // predictors etc.: leave alone
    let bitmap;
    try {
      if (filters.length && filters[filters.length - 1] === N("DCTDecode") && filters.slice(0, -1).every((x) => SIMPLE.includes(x))) {
        let jpeg = obj.contents;
        if (filters.length > 1) {
          const inner = d.clone(doc.context);
          inner.set(N("Filter"), doc.context.obj(filters.slice(0, -1)));
          jpeg = decodePDFRawStream(PDFRawStream.of(inner, obj.contents)).decode();
        }
        bitmap = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
      } else if (filters.length && filters.every((x) => SIMPLE.includes(x)) && bpc === 8) {
        const raw = decodePDFRawStream(obj).decode();
        if (raw.length < w * h * comps) continue;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let i = 0, j = 0; i < w * h; i++, j += comps) {
          rgba[i * 4] = raw[j]; rgba[i * 4 + 1] = raw[j + (comps === 3 ? 1 : 0)]; rgba[i * 4 + 2] = raw[j + (comps === 3 ? 2 : 0)]; rgba[i * 4 + 3] = 255;
        }
        bitmap = await createImageBitmap(new ImageData(rgba, w, h));
      } else continue;
    } catch { continue; }
    const k = Math.min(1, maxSide / Math.max(w, h));
    const cv = I.toCanvas(bitmap, Math.round(w * k), Math.round(h * k), "#ffffff");
    if (grey || comps === 1) {
      const ctx = cv.getContext("2d"), px = ctx.getImageData(0, 0, cv.width, cv.height), a = px.data;
      for (let i = 0; i < a.length; i += 4) { const g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = g; }
      ctx.putImageData(px, 0, 0);
    }
    const jpg = new Uint8Array(await (await canvasBlob(cv, "image/jpeg", quality)).arrayBuffer());
    if (jpg.length >= obj.contents.length * 0.9) continue; // not worth it
    const dict = { Type: "XObject", Subtype: "Image", Width: cv.width, Height: cv.height, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" };
    const smask = d.get(N("SMask"));
    if (smask) dict.SMask = smask; // soft masks (transparency) are kept; they may differ in size from the image
    doc.context.assign(ref, doc.context.stream(jpg, dict));
    saved += obj.contents.length - jpg.length; replaced++;
  }
  prog.set(1, "Saving…");
  return { bytes: await doc.save({ useObjectStreams: true }), replaced, total: images.length };
}

/* Method 2: re-render every page as a JPEG. */
async function compressRaster(dpi, q, grey) {
  const doc = await openPdf(file);
  const PDF = await pdflib();
  const out = await PDF.PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    prog.set((i - 1) / doc.numPages, "Compressing page " + i + " of " + doc.numPages + "…");
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
    const cv = await renderPage(doc, i, dpi / 72);
    if (grey) {
      const ctx = cv.getContext("2d"), d = ctx.getImageData(0, 0, cv.width, cv.height), a = d.data;
      for (let k = 0; k < a.length; k += 4) { const g = 0.299 * a[k] + 0.587 * a[k + 1] + 0.114 * a[k + 2]; a[k] = a[k + 1] = a[k + 2] = g; }
      ctx.putImageData(d, 0, 0);
    }
    const jpg = await out.embedJpg(await (await canvasBlob(cv, "image/jpeg", q)).arrayBuffer());
    out.addPage([vp.width, vp.height]).drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
    cv.width = cv.height = 0;
  }
  doc.destroy();
  return { bytes: await out.save() };
}

async function compress() {
  if (!file) return;
  go.disabled = true; result.hidden = true;
  try {
    const L = LEVELS[level.value];
    let r, label;
    if (method.value === "images") {
      r = await compressImages(await file.arrayBuffer(), [L[0], L[1]], gray.checked);
      label = r.replaced + " of " + r.total + " images recompressed; text untouched";
    } else {
      r = await compressRaster(L[2], L[1] - 0.05, gray.checked);
      label = "pages converted to images";
    }
    const blob = new Blob([r.bytes], { type: "application/pdf" });
    result.hidden = false; result.textContent = "";
    prog.done();
    if (blob.size >= file.size * 0.97) {
      result.append(el("p", { text: method.value === "images"
        ? "This PDF has no large images that could be made smaller (it may be mostly text, or use image types that can't be recompressed safely). Try “Maximum: turn pages into images” if it's a scan, or keep the original."
        : "This PDF is already well compressed: the result (" + F.fmtBytes(blob.size) + ") isn't smaller than the original (" + F.fmtBytes(file.size) + "). Keep the original." }));
    } else {
      const pct = Math.round(100 * (1 - blob.size / file.size));
      const name = F.baseName(file.name) + "-compressed.pdf";
      result.append(C.stats([["original", F.fmtBytes(file.size)], ["compressed", F.fmtBytes(blob.size)], ["smaller", pct + "%"]]),
        el("p", { class: "muted small", text: "Method: " + label + "." }),
        el("div", { class: "actions" }, [F.button("Download " + name, () => F.download(blob, name))]));
      F.download(blob, name);
    }
  } catch (e) { prog.error(e.message || String(e)); }
  go.disabled = false;
}

F.root.textContent = "";
F.root.append(F.dropzone({ accept: ".pdf,application/pdf", title: "Choose a PDF to compress", hint: "Best for PDFs with photos or scanned pages · or drag and drop", onFiles: open }), prog.node, box, result);
