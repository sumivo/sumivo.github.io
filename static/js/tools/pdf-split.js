/* Split PDF: every page as its own PDF, custom ranges as separate PDFs, or extract chosen pages
   into one PDF. pdf-lib in the browser; several files are delivered as a ZIP. */
import { loadPdfLib, pdflib, parseRanges } from "../lib/pdfkit.js";

const { Calc: C, FileKit: F, ImageKit: I } = window;
const el = C.el;
let file = null, src = null;
const info = el("p", { class: "muted" });
const mode = I.select("mode", [["each", "Every page as a separate PDF"], ["ranges", "Split into ranges (one PDF per range)"], ["extract", "Extract pages into one PDF"]], "ranges");
const ranges = el("input", { type: "text", value: "1-3, 4-", placeholder: "e.g. 1-3, 5, 8-", "aria-label": "Pages or ranges" });
const rl = el("label", { class: "wide" }, ["Pages or ranges", ranges]);
const prog = F.progress();
const go = F.button("Split PDF", split);
const box = el("div", { hidden: "hidden" }, [info, el("div", { class: "fields" }, [el("label", { class: "wide" }, ["What to do", mode]), rl]), el("div", { class: "actions" }, [go])]);
mode.addEventListener("change", () => { rl.hidden = mode.value === "each"; });

async function open(files) {
  file = files[0]; src = null;
  try {
    src = await loadPdfLib(file);
    const n = src.getPageCount();
    info.textContent = file.name + ": " + n + " page" + (n === 1 ? "" : "s") + ", " + F.fmtBytes(file.size) + ".";
    if (ranges.value === "1-3, 4-" && n < 4) ranges.value = "1-" + n;
    box.hidden = false; prog.done();
  } catch (e) { box.hidden = true; prog.error(e.message); }
}

async function split() {
  if (!src) return;
  go.disabled = true;
  try {
    const PDF = await pdflib();
    const n = src.getPageCount();
    const groups = mode.value === "each" ? Array.from({ length: n }, (_, i) => [i + 1]) : parseRanges(ranges.value, n);
    const parts = mode.value === "extract" ? [groups.flat()] : groups;
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      prog.set(i / parts.length, "Creating part " + (i + 1) + " of " + parts.length + "…");
      const doc = await PDF.PDFDocument.create();
      (await doc.copyPages(src, parts[i].map((p) => p - 1))).forEach((p) => doc.addPage(p));
      const label = parts[i].length === 1 ? "page-" + parts[i][0] : "pages-" + parts[i][0] + "-" + parts[i][parts[i].length - 1];
      out.push({ name: F.baseName(file.name) + "-" + (mode.value === "extract" ? "extracted" : label) + ".pdf", blob: new Blob([await doc.save()], { type: "application/pdf" }) });
    }
    await I.deliver(out, F.baseName(file.name) + "-split.zip");
    prog.done("Done: " + out.length + " PDF" + (out.length > 1 ? "s (downloaded as a ZIP)" : "") + ".");
  } catch (e) { prog.error(e.message || String(e)); }
  go.disabled = false;
}

F.root.textContent = "";
F.root.append(F.dropzone({ accept: ".pdf,application/pdf", title: "Choose a PDF", hint: "or drag and drop it here", onFiles: open }), box, prog.node);
