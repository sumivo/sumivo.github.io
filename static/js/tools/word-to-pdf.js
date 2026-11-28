/* Word (.docx with formatting, .doc as text only) and plain text -> PDF.
   .docx is laid out by docx-preview (Apache-2.0) + JSZip (MIT); .doc is read with SheetJS CFB
   (Apache-2.0) and TextKit.docText. The browser's own "Save as PDF" writes the file, which keeps
   text selectable and supports every language and font on the device. Nothing is uploaded. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, TK = window.TextKit, el = C.el;
  var prog = F.progress();
  var preview = el("div", { class: "doc-preview", hidden: "hidden" });
  var note = el("div", { class: "note-box", hidden: "hidden" });
  var size = el("select", { name: "size" }, [["A4", "A4"], ["letter", "US Letter"]].map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
  var sizeField = el("label", { hidden: "hidden" }, ["Page size (for .doc and .txt)", size]);
  var saveBtn = F.button("Download PDF", printPdf);
  var actions = el("div", { class: "actions", hidden: "hidden" }, [saveBtn, el("span", { class: "muted small", text: "In the print window, choose “Save as PDF” as the printer." })]);
  var current = null; // {name, pageCss}

  function open(files) {
    var f = files[0];
    if (!f) return;
    current = null; preview.hidden = true; actions.hidden = true; note.hidden = true; preview.textContent = "";
    var ext = (f.name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
    var job;
    if (ext === "docx") job = openDocx(f);
    else if (ext === "doc") job = openDoc(f);
    else if (ext === "txt" || f.type === "text/plain") job = f.text().then(function (t) { return plain(t, f, false); });
    else return prog.error("Choose a .docx, .doc or .txt file.");
    job.then(function () {
      prog.done(); preview.hidden = false; actions.hidden = false;
      preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (e) { prog.error(e.message || String(e)); });
  }

  function openDocx(f) {
    prog.set(null, "Loading the Word engine…");
    sizeField.hidden = true;
    return F.loadScript("vendor/jszip/jszip.min.js")
      .then(function () { return F.loadScript("vendor/docx-preview/docx-preview.min.js"); })
      .then(function () {
        prog.set(null, "Laying out " + f.name + "…");
        var host = el("div", { class: "docx-host" });
        preview.appendChild(host);
        return window.docx.renderAsync(f, host, null, {
          inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: true, renderHeaders: true, renderFooters: true,
          renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: true
        }).catch(function () { throw new Error("This .docx couldn't be read. It may be damaged or password-protected."); });
      }).then(function () {
        var first = preview.querySelector("section.docx");
        var w = first && first.style.width, h = first && first.style.minHeight;
        current = { name: F.baseName(f.name), pageCss: "@page { size: " + (w && h ? w + " " + h : "auto") + "; margin: 0; }" };
        var pages = preview.querySelectorAll("section.docx").length;
        note.hidden = false; note.textContent = "Preview of " + f.name + " (" + pages + (pages === 1 ? " page" : " pages") +
          "). Check it looks right, then download. Very complex layouts (text boxes, charts, SmartArt) may differ slightly from Word.";
      });
  }

  function openDoc(f) {
    prog.set(null, "Reading " + f.name + "…");
    return F.loadScript("vendor/cfb/cfb.min.js").then(function () { return f.arrayBuffer(); }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) return openDocx(new File([buf], f.name.replace(/\.doc$/i, ".docx"))); // a .docx with the wrong name
      if (bytes[0] === 0x7b && bytes[1] === 0x5c) throw new Error("This is an RTF file saved with a .doc name. Open it in Word or Google Docs and save it as .docx.");
      var cfb;
      try { cfb = window.CFB.read(bytes, { type: "array" }); } catch (e) { throw new Error("This doesn't look like a Word .doc file."); }
      var get = function (n) { var e = window.CFB.find(cfb, n); return e ? Uint8Array.from(e.content) : null; };
      var text = TK.docText(get("WordDocument"), get("0Table"), get("1Table"));
      plain(text, f, true);
    });
  }

  function plain(text, f, fromDoc) {
    sizeField.hidden = false;
    var page = el("section", { class: "plain-page" });
    text.replace(/\r\n?/g, "\n").split(/\n\f\n|\f/).forEach(function (chunk, i) {
      var part = el("div", { class: i ? "page-break" : "" });
      chunk.split("\n").forEach(function (line) {
        if (line.indexOf("\t") !== -1) {
          part.appendChild(el("p", { class: "tabbed" }, line.split("\t").map(function (cell) { return el("span", { text: cell }); })));
        } else {
          part.appendChild(line.trim() ? el("p", { text: line }) : el("p", { class: "blank" }, [document.createTextNode(" ")]));
        }
      });
      page.appendChild(part);
    });
    preview.appendChild(page);
    current = { name: F.baseName(f.name), plain: true };
    note.hidden = false;
    note.textContent = fromDoc
      ? "Old Word (.doc) files are converted as text: paragraphs and table rows are kept, but fonts, images and table borders are not. For an exact copy, open the file in Word or Google Docs, save it as .docx and convert that."
      : "Plain text converted with clean margins. Choose the page size below.";
  }

  function printPdf() {
    if (!current) return;
    var pageCss = current.plain ? "@page { size: " + size.value + "; margin: 22mm 20mm; }" : current.pageCss;
    var style = el("style", { id: "print-page-size", text: pageCss });
    document.head.appendChild(style);
    var holder = el("div", { id: "print-root" });
    var parent = preview.parentNode, next = preview.nextSibling;
    holder.appendChild(preview);
    document.body.appendChild(holder);
    document.body.classList.add("printing");
    var oldTitle = document.title;
    document.title = current.name; // the browser uses this as the PDF file name
    var restored = false;
    function restore() {
      if (restored) return; restored = true;
      parent.insertBefore(preview, next);
      holder.remove(); style.remove();
      document.body.classList.remove("printing");
      document.title = oldTitle;
    }
    // Put the page back once printing is finished (afterprint), never on a timer: on phones the
    // print dialog is asynchronous and the content must stay in place until it closes.
    window.addEventListener("afterprint", restore, { once: true });
    setTimeout(function () { window.print(); }, 50);
  }

  var rootEl = F.root;
  rootEl.textContent = "";
  rootEl.appendChild(F.dropzone({ accept: ".docx,.doc,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain",
    title: "Choose a Word file", hint: ".docx, .doc or .txt · or drag and drop it here", onFiles: open }));
  rootEl.appendChild(el("div", { class: "fields" }, [sizeField]));
  rootEl.appendChild(prog.node);
  rootEl.appendChild(note);
  rootEl.appendChild(actions);
  rootEl.appendChild(preview);
})();
