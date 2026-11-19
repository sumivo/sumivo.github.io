/* Tiny helper for the calculators. No dependencies, no network calls.
   All output uses textContent / DOM nodes (never innerHTML with user input). */
(function (global) {
  "use strict";
  var root = typeof document !== "undefined" ? document.getElementById("tool") : null;
  var cur = (root && root.dataset.currency) || "$";
  var LOCALE = "en-US"; // matches the $ currency; avoids e.g. "$3,20,000" in en-IN browsers

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function num(v) { var x = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(x) ? x : 0; }
  function money(x) {
    var neg = x < 0; x = Math.abs(x);
    return (neg ? "-" : "") + cur + x.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function money0(x) { return (x < 0 ? "-" : "") + cur + Math.round(Math.abs(x)).toLocaleString(LOCALE); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 1 : d) + "%"; }

  function input(f, onChange) {
    var ctl;
    if (f.options) {
      ctl = el("select", { name: f.key, onchange: onChange },
        f.options.map(function (o) { var opt = el("option", { value: o, text: o }); if (o === f.value) opt.selected = true; return opt; }));
    } else {
      ctl = el("input", { name: f.key, type: "number", inputmode: "decimal", step: f.step || "any", min: f.min != null ? f.min : "0", value: f.value, oninput: onChange });
    }
    return el("label", {}, [f.label, ctl]);
  }

  function stats(list) {
    return el("div", { class: "results" }, list.map(function (s) {
      return el("div", { class: "stat" }, [el("b", { text: s[1] }), el("span", { text: s[0] })]);
    }));
  }

  function table(headers, rows) {
    return el("table", {}, [
      el("thead", {}, [el("tr", {}, headers.map(function (h) { return el("th", { text: h }); }))]),
      el("tbody", {}, rows.map(function (r) { return el("tr", {}, r.map(function (c) { return el("td", { text: String(c) }); })); }))
    ]);
  }

  /* mount(fields, compute): fields = [{key,label,value,step,options}], compute(values) -> Node[] */
  function mount(fields, compute) {
    if (!root) return;
    var out = el("div", {});
    var form = el("div", { class: "fields" });
    function run() {
      var v = {};
      fields.forEach(function (f) {
        var c = form.querySelector("[name='" + f.key + "']");
        v[f.key] = f.options ? c.value : num(c.value);
      });
      out.textContent = "";
      (compute(v) || []).forEach(function (n) { if (n) out.appendChild(n); });
    }
    fields.forEach(function (f) { form.appendChild(input(f, run)); });
    root.textContent = "";
    root.appendChild(form);
    root.appendChild(out);
    run();
    return run;
  }

  global.Calc = { locale: LOCALE, el: el, num: num, money: money, money0: money0, pct: pct, stats: stats, table: table, mount: mount, root: root, input: input };
})(typeof window !== "undefined" ? window : globalThis);
