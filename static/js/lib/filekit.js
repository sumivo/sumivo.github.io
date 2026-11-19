/* Helpers for the file and AI tools: drop zones, downloads, progress, lazy library loading.
   Everything runs in the browser; files are never uploaded anywhere. */
(function (global) {
  "use strict";
  var el = global.Calc.el;
  var root = document.getElementById("tool");
  var STATIC = (root && root.dataset.static) || "/static/";

  function asset(path) { return STATIC + String(path).replace(/^\//, ""); }

  var loaded = {};
  function loadScript(path) {
    if (!loaded[path]) {
      loaded[path] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = asset(path); s.async = true;
        s.onload = function () { resolve(); };
        s.onerror = function () { delete loaded[path]; reject(new Error("Couldn't load " + path + ". Check your connection and try again.")); };
        document.head.appendChild(s);
      });
    }
    return loaded[path];
  }

  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function download(blob, name) {
    var a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }

  function baseName(name) { return String(name || "file").replace(/\.[^.]+$/, "") || "file"; }

  /* A drop zone with a hidden file input. opts: {accept, multiple, title, hint, onFiles(FileList[])} */
  function dropzone(opts) {
    var input = el("input", { type: "file", accept: opts.accept || "", class: "visually-hidden" });
    if (opts.multiple) input.multiple = true;
    var zone = el("label", { class: "dropzone" }, [
      input,
      el("strong", { text: opts.title || "Choose files" }),
      el("span", { class: "muted", text: opts.hint || "or drag and drop them here" })
    ]);
    function take(list) { var files = Array.prototype.slice.call(list || []); if (files.length) opts.onFiles(files); }
    input.addEventListener("change", function () { take(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove("over"); }); });
    zone.addEventListener("drop", function (e) { take(e.dataTransfer && e.dataTransfer.files); });
    return zone;
  }

  /* Progress line: set(fraction 0..1 or null for indeterminate, text), done(), error(msg) */
  function progress() {
    var bar = el("div", { class: "pbar" }, [el("i")]);
    var label = el("span", { class: "plabel" });
    var box = el("div", { class: "progress", hidden: "hidden" }, [bar, label]);
    return {
      node: box,
      set: function (f, text) {
        box.hidden = false; box.classList.remove("err");
        bar.classList.toggle("indet", f == null);
        bar.firstChild.style.width = f == null ? "" : Math.round(Math.max(0, Math.min(1, f)) * 100) + "%";
        label.textContent = text || "";
      },
      done: function (text) { if (text) { this.set(1, text); } else { box.hidden = true; } },
      error: function (msg) { box.hidden = false; box.classList.add("err"); bar.firstChild.style.width = "100%"; bar.classList.remove("indet"); label.textContent = msg; }
    };
  }

  function button(text, onclick, cls) { return el("button", { type: "button", class: cls || "btn", text: text, onclick: onclick }); }

  global.FileKit = { asset: asset, loadScript: loadScript, fmtBytes: fmtBytes, download: download, baseName: baseName,
    dropzone: dropzone, progress: progress, button: button, root: root };
})(window);
