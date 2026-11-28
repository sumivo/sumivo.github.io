/* PDF to JPG / PNG: render pages with pdf.js at the chosen resolution; one image or a ZIP. */
import { openPdf, renderPage, parseRanges, canvasBlob } from "../lib/pdfkit.js";

const { Calc: C, FileKit: F, ImageKit: I } = window;
const el = C.el;
let file = null, doc = null;
const info = el("p", { class: "muted" });
const fmt = I.select("fmt", [["jpg", "JPG"], ["png", "PNG"]], "jpg");
const dpi = I.select("dpi", [[96, "Screen (96 dpi)"], [150, "Standard (150 dpi)"], [200, "High (200 dpi)"], [300, "Print (300 dpi)"]], 150);
const pages = el("input", { type: "text", value: "", placeholder: "All pages (or e.g. 1-3, 5)", "aria-label": "Pages" });
const prog = F.progress();
const go = F.button("Convert to images", convert);
const thumbs = el("div", { class: "page-thumbs" });
const box = el("div", { hidden: "hidden" }, [info, el("div", { class: "fields" }, [el("label", {}, ["Format", fmt]), el("label", {}, ["Resolution", dpi]), el("label", {}, ["Pages", pages])]),
  el("div", { class: "actions" }, [go]), thumbs]);

async function open(files) {
  file = files[0];
  try {
    if (doc) doc.destroy();
    prog.set(null, "Opening " + file.name + "…");
    doc = await openPdf(file);
    info.textContent = file.name + ": " + doc.numPages + " page" + (doc.numPages === 1 ? "" : "s") + ".";
    box.hidden = false; prog.done();
    thumbs.textContent = "";
    for (let i = 1; i <= Math.min(doc.numPages, 12); i++) {
      const cv = await renderPage(doc, i, 0.3);
      thumbs.append(el("figure", {}, [cv, el("figcaption", { text: "Page " + i })]));
    }
    if (doc.numPages > 12) thumbs.append(el("p", { class: "muted small", text: "+ " + (doc.numPages - 12) + " more pages" }));
  } catch (e) { box.hidden = true; prog.error(e.message); }
}

async function convert() {
  if (!doc) return;
  go.disabled = true;
  try {
    const list = pages.value.trim() ? parseRanges(pages.value, doc.numPages).flat() : Array.from({ length: doc.numPages }, (_, i) => i + 1);
    const out = [];
    for (let k = 0; k < list.length; k++) {
      prog.set(k / list.length, "Rendering page " + list[k] + " (" + (k + 1) + " of " + list.length + ")…");
      const cv = await renderPage(doc, list[k], Number(dpi.value) / 72);
      const blob = await canvasBlob(cv, fmt.value === "png" ? "image/png" : "image/jpeg", 0.9);
      out.push({ name: F.baseName(file.name) + "-page-" + list[k] + I.ext(fmt.value), blob });
      cv.width = cv.height = 0;
    }
    await I.deliver(out, F.baseName(file.name) + "-images.zip");
    prog.done("Done: " + out.length + " image" + (out.length > 1 ? "s (downloaded as a ZIP)" : "") + ".");
  } catch (e) { prog.error(e.message || String(e)); }
  go.disabled = false;
}

F.root.textContent = "";
F.root.append(F.dropzone({ accept: ".pdf,application/pdf", title: "Choose a PDF", hint: "or drag and drop it here", onFiles: open }), prog.node, box);
