/* PDF helpers (ES module) for the PDF tools: pdf.js (Apache-2.0) to read and render pages,
   pdf-lib (MIT) to write PDFs. Both load on first use. Everything happens in the browser. */
const VENDOR = new URL("../../vendor/", import.meta.url).href;

let pdfjsPromise = null;
export function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(VENDOR + "pdfjs/pdf.min.js").then((m) => {
      m.GlobalWorkerOptions.workerSrc = VENDOR + "pdfjs/pdf.worker.min.js";
      return m;
    });
  }
  return pdfjsPromise;
}

export async function pdflib() {
  await window.FileKit.loadScript("vendor/pdf-lib/pdf-lib.min.js");
  return window.PDFLib;
}

/* Open a PDF file with pdf.js. Throws a readable error for passwords and damaged files. */
export async function openPdf(file) {
  const lib = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await lib.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw new Error(file.name + " is password-protected. Remove the password first.");
    throw new Error(file.name + " couldn't be read as a PDF.");
  }
}

/* Open with pdf-lib for editing. */
export async function loadPdfLib(file) {
  const PDF = await pdflib();
  try {
    return await PDF.PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error(file.name + " is password-protected. Remove the password first.");
    throw new Error(file.name + " couldn't be read as a PDF.");
  }
}

/* Render page `n` (1-based) of a pdf.js document to a canvas at `scale` (1 = 72 dpi). */
export async function renderPage(doc, n, scale, background = "#ffffff") {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

/* "1-3, 5, 8-" -> [[1,2,3],[5],[8..n]] (1-based, validated against n pages). */
export function parseRanges(text, n) {
  const groups = [];
  for (const part of String(text).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*(?:-|–|to)\s*(\d*)$/i) || part.match(/^(\d+)$/);
    if (!m) throw new Error("“" + part + "” isn't a page or range. Use numbers like 1-3, 5, 8-.");
    let a, b;
    if (m.length === 2) { a = b = Number(m[1]); } else { a = m[1] ? Number(m[1]) : 1; b = m[2] ? Number(m[2]) : n; }
    if (a < 1 || b > n || a > b) throw new Error("“" + part + "” is outside 1–" + n + ".");
    const g = [];
    for (let i = a; i <= b; i++) g.push(i);
    groups.push(g);
  }
  if (!groups.length) throw new Error("Enter at least one page or range.");
  return groups;
}

export function canvasBlob(canvas, type = "image/jpeg", quality = 0.85) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}
