/* Rotate and organize PDF pages: page thumbnails (pdf.js) you can rotate, delete and reorder,
   then save with pdf-lib. Text and quality are untouched (pages are copied, not re-rendered). */
import { openPdf, loadPdfLib, pdflib, renderPage } from "../lib/pdfkit.js";

const { Calc: C, FileKit: F } = window;
const el = C.el;
let file = null, src = null, pages = []; // {index, rotate, thumb}
const grid = el("ol", { class: "page-grid" });
const prog = F.progress();
const save = F.button("Save PDF", savePdf);
const bar = el("div", { class: "actions", hidden: "hidden" }, [
  F.button("⟲ Rotate all left", () => rotateAll(-90), "btn ghost"), F.button("⟳ Rotate all right", () => rotateAll(90), "btn ghost"),
  F.button("Reset", () => open([file]), "btn ghost"), save]);

async function open(files) {
  file = files[0]; pages = []; grid.textContent = "";
  try {
    prog.set(null, "Opening " + file.name + "…");
    src = await loadPdfLib(file);
    const doc = await openPdf(file);
    for (let i = 1; i <= doc.numPages; i++) {
      prog.set((i - 1) / doc.numPages, "Loading page " + i + " of " + doc.numPages + "…");
      pages.push({ index: i - 1, rotate: 0, thumb: await renderPage(doc, i, 0.25) });
      if (i % 6 === 0 || i === doc.numPages) render();
    }
    doc.destroy();
    bar.hidden = false; prog.done();
  } catch (e) { bar.hidden = true; prog.error(e.message); }
}

function render() {
  grid.textContent = "";
  pages.forEach((p, i) => {
    const img = el("img", { src: p.thumb.toDataURL("image/jpeg", 0.7), alt: "Page " + (p.index + 1) });
    img.style.transform = "rotate(" + p.rotate + "deg)";
    grid.append(el("li", {}, [
      el("div", { class: "thumb" }, [img]),
      el("div", { class: "small", text: "Page " + (p.index + 1) + (p.rotate ? " · " + ((p.rotate % 360) + 360) % 360 + "°" : "") }),
      el("div", { class: "row-actions" }, [
        icon("⟲", "Rotate left", () => { p.rotate -= 90; render(); }), icon("⟳", "Rotate right", () => { p.rotate += 90; render(); }),
        icon("←", "Move earlier", () => move(i, -1), i === 0), icon("→", "Move later", () => move(i, 1), i === pages.length - 1),
        icon("✕", "Delete page", () => { pages.splice(i, 1); render(); }, pages.length === 1)]),
    ]));
  });
  save.textContent = "Save PDF (" + pages.length + " page" + (pages.length === 1 ? "" : "s") + ")";
}
function icon(t, label, fn, disabled) { const b = el("button", { type: "button", class: "icon", title: label, "aria-label": label, text: t, onclick: fn }); b.disabled = !!disabled; return b; }
function move(i, d) { [pages[i], pages[i + d]] = [pages[i + d], pages[i]]; render(); }
function rotateAll(d) { pages.forEach((p) => (p.rotate += d)); render(); }

async function savePdf() {
  save.disabled = true;
  try {
    const PDF = await pdflib();
    const out = await PDF.PDFDocument.create();
    const copied = await out.copyPages(src, pages.map((p) => p.index));
    copied.forEach((pg, k) => {
      const turn = pages[k].rotate;
      if (turn) pg.setRotation(PDF.degrees((((pg.getRotation().angle + turn) % 360) + 360) % 360));
      out.addPage(pg);
    });
    const blob = new Blob([await out.save()], { type: "application/pdf" });
    F.download(blob, F.baseName(file.name) + "-edited.pdf");
    prog.done("Saved: " + pages.length + " pages, " + F.fmtBytes(blob.size) + ".");
  } catch (e) { prog.error(e.message || String(e)); }
  save.disabled = false;
}

F.root.textContent = "";
F.root.append(F.dropzone({ accept: ".pdf,application/pdf", title: "Choose a PDF", hint: "Rotate, delete or reorder its pages · or drag and drop", onFiles: open }), prog.node, bar, grid);
