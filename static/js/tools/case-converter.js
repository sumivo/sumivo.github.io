/* Case converter and text cleaner: UPPER, lower, Title Case (English small-word rules), Sentence
   case, camelCase, snake_case, kebab-case and more, plus whitespace and line-break clean-up. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, el = C.el;
  var SMALL = /^(a|an|and|as|at|but|by|for|if|in|nor|of|on|or|per|so|the|to|up|via|vs?\.?|yet)$/i;
  var text = el("textarea", { class: "bigtext", rows: "12", placeholder: "Type or paste text, then choose a conversion", "aria-label": "Text" });
  var info = el("span", { class: "muted small" });
  function words(s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  var OPS = [
    ["UPPERCASE", function (s) { return s.toUpperCase(); }],
    ["lowercase", function (s) { return s.toLowerCase(); }],
    ["Title Case", function (s) {
      return s.toLowerCase().replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, function (w, off, all) {
        var first = off === 0 || /[.:!?—–-]\s*$/.test(all.slice(0, off));
        return !first && SMALL.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
      });
    }],
    ["Sentence case", function (s) {
      return s.toLowerCase().replace(/(^\s*|[.!?]\s+|\n\s*)(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); })
        .replace(/\bi\b/g, "I");
    }],
    ["Capitalize Each Word", function (s) { return s.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); }); }],
    ["aLtErNaTiNg", function (s) { var i = 0; return s.replace(/\p{L}/gu, function (c) { return i++ % 2 ? c.toUpperCase() : c.toLowerCase(); }); }],
    ["iNVERSE", function (s) { return s.replace(/\p{L}/gu, function (c) { return c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(); }); }],
    ["camelCase", function (s) { return words(s).map(function (w, i) { w = w.toLowerCase(); return i ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(""); }],
    ["PascalCase", function (s) { return words(s).map(function (w) { w = w.toLowerCase(); return w.charAt(0).toUpperCase() + w.slice(1); }).join(""); }],
    ["snake_case", function (s) { return words(s).map(function (w) { return w.toLowerCase(); }).join("_"); }],
    ["kebab-case", function (s) { return words(s).map(function (w) { return w.toLowerCase(); }).join("-"); }],
    ["CONSTANT_CASE", function (s) { return words(s).map(function (w) { return w.toUpperCase(); }).join("_"); }],
    ["Remove extra spaces", function (s) { return s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim(); }],
    ["Remove line breaks", function (s) { return s.replace(/\s*\n+\s*/g, " ").trim(); }],
    ["Remove empty lines", function (s) { return s.replace(/\n\s*\n+/g, "\n"); }]
  ];
  var history = [];
  var buttons = el("div", { class: "seg modes" }, OPS.map(function (op) {
    return el("button", { type: "button", text: op[0], onclick: function () {
      history.push(text.value); text.value = op[1](text.value); info.textContent = "Applied: " + op[0];
    } });
  }));
  var root = F.root;
  root.textContent = "";
  root.append(buttons, text, el("div", { class: "actions" }, [
    F.button("Copy", function () { navigator.clipboard.writeText(text.value); info.textContent = "Copied to the clipboard."; }),
    F.button("Undo", function () { if (history.length) { text.value = history.pop(); info.textContent = "Undone."; } }, "btn ghost"),
    F.button("Download .txt", function () { F.download(new Blob([text.value], { type: "text/plain;charset=utf-8" }), "text.txt"); }, "btn ghost"),
    info]));
})();
