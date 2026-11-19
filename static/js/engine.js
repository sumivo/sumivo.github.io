/* Declarative calculator runner: reads the tool spec embedded in the page (#tool-spec),
   builds the form and evaluates outputs with Expr (safe parser, no eval). */
(function () {
  "use strict";
  var C = window.Calc, el = C.el;
  var specNode = document.getElementById("tool-spec");
  if (!C.root || !specNode) return;
  var spec = JSON.parse(specNode.textContent);

  function fmt(v, kind) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    switch (kind) {
      case "money": return C.money(v);
      case "money0": return C.money0(v);
      case "pct": return C.pct(v, 2);
      case "pct1": return C.pct(v, 1);
      case "int": return Math.round(v).toLocaleString("en-US");
      case "num0": return Math.round(v).toLocaleString("en-US");
      case "months":
        var m = Math.ceil(v - 1e-9), y = Math.floor(m / 12), r = m % 12;
        return (y ? y + (y === 1 ? " year" : " years") : "") + (y && r ? " " : "") + (r || !y ? r + (r === 1 ? " month" : " months") : "");
      case "years": return (Math.round(v * 10) / 10).toLocaleString("en-US") + " years";
      case "days": return Math.ceil(v - 1e-9).toLocaleString("en-US") + " days";
      case "hours": return (Math.round(v * 10) / 10).toLocaleString("en-US") + " hours";
      default: return (Math.round(v * 100) / 100).toLocaleString("en-US");
    }
  }

  var form = el("div", { class: "fields" });
  var out = el("div", {});
  spec.inputs.forEach(function (f) {
    var ctl;
    if (f.choices) {
      ctl = el("select", { name: f.key, onchange: run }, f.choices.map(function (c) {
        var o = el("option", { value: String(c[1]), text: c[0] });
        if (c[1] === f.value) o.selected = true;
        return o;
      }));
    } else {
      ctl = el("input", { name: f.key, type: "number", inputmode: "decimal", step: f.step || "any",
        min: f.min != null ? String(f.min) : "0", value: String(f.value), oninput: run });
    }
    form.appendChild(el("label", {}, [f.label, ctl]));
  });

  function run() {
    var values = {};
    spec.inputs.forEach(function (f) { values[f.key] = C.num(form.querySelector("[name='" + f.key + "']").value); });
    out.textContent = "";
    var results;
    try { results = Expr.run(spec, values); } catch (e) { out.appendChild(el("p", { class: "warn", text: "Please check the inputs." })); return; }
    out.appendChild(C.stats(spec.outputs.map(function (o, i) { return [o.label, fmt(results[i], o.format)]; })));
    if (results.some(function (r) { return typeof r !== "number" || !isFinite(r); })) {
      out.appendChild(el("p", { class: "warn", text: spec.invalid || "Some results can't be calculated with these inputs. Check for zero or negative values." }));
    }
  }

  C.root.textContent = "";
  C.root.appendChild(form);
  C.root.appendChild(out);
  run();
})();
