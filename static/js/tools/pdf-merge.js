/* Merge PDF: combine several PDFs (in any order) into one, in the browser with pdf-lib. */
import { loadPdfLib, pdflib, openPdf } from "../lib/pdfkit.js";

const { Calc: C, FileKit: F } = window;
const el = C.el;
let items = []; // {file, pages}
const list = el("ol", { class: "batch-list sortable" });
const prog = F.progress();
const go = F.button("Merge PDFs", merge);

async function add(files) {
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") continue;
    const it = { file: f, pages: "…" };
    items.push(it);
    openPdf(f).then((d) => { it.pages = d.numPages; d.destroy(); render(); }).catch((e) => { it.error = e.message; render(); });
  }
  render();
}

function render() {
  list.textContent = "";
  items.forEach((it, i) => {
    list.append(el("li", {}, [
      el("span", { class: "fname", text: (i + 1) + ". " + it.file.name }),
      el("span", { class: it.error ? "warn small" : "muted small", text: it.error || (it.pages + " page" + (it.pages === 1 ? "" : "s") + " · " + F.fmtBytes(it.file.size)) }),
      el("span", { class: "row-actions" }, [
        btn("↑", "Move up", () => move(i, -1), i === 0), btn("↓", "Move down", () => move(i, 1), i === items.length - 1),
        btn("✕", "Remove", () => { items.splice(i, 1); render(); })]),
    ]));
  });
  go.disabled = items.length < 2 || items.some((x) => x.error);
  go.textContent = items.length > 1 ? "Merge " + items.length + " PDFs" : "Merge PDFs";
}
function btn(t, label, fn, disabled) { const b = el("button", { type: "button", class: "icon", title: label, "aria-label": label, text: t, onclick: fn }); b.disabled = !!disabled; return b; }
function move(i, d) { [items[i], items[i + d]] = [items[i + d], items[i]]; render(); }

async function merge() {
  go.disabled = true;
  try {
    const PDF = await pdflib();
    const out = await PDF.PDFDocument.create();
    for (let i = 0; i < items.length; i++) {
      prog.set(i / items.length, "Adding " + items[i].file.name + "…");
      const src = await loadPdfLib(items[i].file);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    prog.set(1, "Saving…");
    const blob = new Blob([await out.save()], { type: "application/pdf" });
    F.download(blob, "merged.pdf");
    prog.done("Done: merged.pdf, " + out.getPageCount() + " pages, " + F.fmtBytes(blob.size) + ".");
  } catch (e) { prog.error(e.message || String(e)); }
  render();
}

F.root.textContent = "";
F.root.append(
  F.dropzone({ accept: ".pdf,application/pdf", multiple: true, title: "Choose PDF files", hint: "Two or more PDFs · or drag and drop · reorder them below", onFiles: add }),
  list, el("div", { class: "actions" }, [go]), prog.node);
render();
