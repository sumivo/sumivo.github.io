/* Tool validation for the admin panel. Mirrors assetforge/tools.py validate() so problems are
   caught before saving; the deploy workflow re-runs the Python validator as the final gate.
   Works in the browser (window.ToolValidate) and in Node (module.exports) for tests. */
(function (global) {
  "use strict";
  var Expr = global.Expr || (typeof require !== "undefined" ? require("../js/expr.js") : null);
  var FORMATS = ["money", "money0", "pct", "pct1", "int", "num", "num0", "months", "years", "days", "hours"];
  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
  var RESERVED_KEYS = ["on", "off", "yes", "no", "true", "false", "null", "y", "n"];

  function variables(node, out) {
    out = out || {};
    if (!node) return out;
    if (node.k === "var") out[node.v] = true;
    else if (node.k === "neg") variables(node.a, out);
    else if (node.k === "call") node.args.forEach(function (a) { variables(a, out); });
    else if (node.k === "bin") { variables(node.a, out); variables(node.b, out); }
    return out;
  }

  function varsList(tool) {
    var v = tool.vars || {};
    if (Array.isArray(v)) return v;
    return Object.keys(v).map(function (k) { return [k, String(v[k])]; });
  }

  function defaults(tool) {
    var d = {};
    (tool.inputs || []).forEach(function (i) { d[i.key] = Number(i.value); });
    return d;
  }

  function spec(tool) {
    return { inputs: tool.inputs || [], vars: varsList(tool), outputs: tool.outputs || [] };
  }

  /* Returns {errors: [...], results: [...] | null}. `others` = the other tools, for uniqueness. */
  function validateTool(tool, others) {
    var errs = [], name = tool.slug || "(new tool)";
    others = others || [];
    ["slug", "title", "short", "description", "intro"].forEach(function (k) {
      if (!tool[k] || !String(tool[k]).trim()) errs.push("Missing " + k + ".");
    });
    if (tool.slug && !SLUG.test(tool.slug)) errs.push("Slug must be lowercase words joined by hyphens.");
    var d = (tool.description || "").length;
    if (d < 50 || d > 165) errs.push("Description should be 50–165 characters (now " + d + ").");
    if (!tool.faq || !tool.faq.length) errs.push("Add at least one FAQ.");
    (tool.faq || []).forEach(function (f, i) { if (!f.q || !f.a) errs.push("FAQ " + (i + 1) + " needs a question and an answer."); });
    others.forEach(function (o) {
      if (o.slug === tool.slug) errs.push("Another tool already uses the slug '" + tool.slug + "'.");
      if (o.title && tool.title && o.title.toLowerCase() === tool.title.toLowerCase()) errs.push("Another tool already has this title.");
    });
    if (tool.kind === "script") return { errors: errs, results: null };

    if (!tool.formula) errs.push("Missing the formula explanation.");
    var inputs = tool.inputs || [];
    if (!inputs.length) errs.push("Add at least one input.");
    var known = {};
    inputs.forEach(function (i, n) {
      if (!i.key || !KEY.test(i.key)) errs.push("Input " + (n + 1) + ": key must start with a letter and use letters, digits or _.");
      else if (RESERVED_KEYS.indexOf(i.key.toLowerCase()) >= 0) errs.push("Input key '" + i.key + "' is reserved in YAML; choose another.");
      if (known[i.key]) errs.push("Duplicate input key '" + i.key + "'.");
      if (!i.label) errs.push("Input " + (n + 1) + " needs a label.");
      if (!isFinite(Number(i.value))) errs.push("Input '" + i.key + "' needs a numeric default value.");
      known[i.key] = true;
    });
    varsList(tool).forEach(function (pair) {
      if (!KEY.test(pair[0])) errs.push("Variable name '" + pair[0] + "' is not valid.");
      try {
        var missing = Object.keys(variables(Expr.parse(pair[1]))).filter(function (v) { return !known[v]; });
        if (missing.length) errs.push("Variable '" + pair[0] + "' uses undefined: " + missing.join(", ") + ".");
      } catch (e) { errs.push("Variable '" + pair[0] + "': " + e.message); }
      known[pair[0]] = true;
    });
    var outputs = tool.outputs || [], labels = {};
    if (!outputs.length) errs.push("Add at least one output.");
    outputs.forEach(function (o, n) {
      if (!o.label) errs.push("Output " + (n + 1) + " needs a label.");
      if (labels[o.label]) errs.push("Duplicate output label '" + o.label + "'.");
      labels[o.label] = true;
      if (FORMATS.indexOf(o.format || "num") < 0) errs.push("Output '" + o.label + "' has an unknown format.");
      try {
        var missing = Object.keys(variables(Expr.parse(o.expr))).filter(function (v) { return !known[v]; });
        if (missing.length) errs.push("Output '" + o.label + "' uses undefined: " + missing.join(", ") + ".");
      } catch (e) { errs.push("Output '" + (o.label || n + 1) + "': " + e.message); }
    });
    if (errs.length) return { errors: errs, results: null };

    var results = null;
    try {
      results = Expr.run(spec(tool), defaults(tool));
      results.forEach(function (r, i) {
        if (typeof r !== "number" || !isFinite(r)) errs.push("Default inputs give no result for '" + outputs[i].label + "'.");
      });
    } catch (e) { errs.push("Evaluation failed: " + e.message); }
    (tool.checks || []).forEach(function (c, n) {
      try {
        var vals = defaults(tool);
        Object.keys(c.inputs || {}).forEach(function (k) { vals[k] = Number(c.inputs[k]); });
        var got = Expr.run(spec(tool), vals), byLabel = {};
        outputs.forEach(function (o, i) { byLabel[o.label] = got[i]; });
        Object.keys(c.outputs || {}).forEach(function (label) {
          var want = Number(c.outputs[label]), have = byLabel[label];
          var tol = Math.max(0.006, Math.abs(want) * 1e-4);
          if (have === undefined) errs.push("Check " + (n + 1) + ": no output called '" + label + "'.");
          else if (!(Math.abs(have - want) <= tol)) errs.push("Check " + (n + 1) + " failed for '" + label + "': expected " + want + ", got " + have + ".");
        });
      } catch (e) { errs.push("Check " + (n + 1) + ": " + e.message); }
    });
    // identical formulas to another tool
    var sig = outputs.map(function (o) { return String(o.expr).replace(/\s/g, ""); }).sort().join("|") + "#" + JSON.stringify(varsList(tool));
    others.forEach(function (o) {
      if (o.kind === "script" || !o.outputs) return;
      var s2 = o.outputs.map(function (x) { return String(x.expr).replace(/\s/g, ""); }).sort().join("|") + "#" + JSON.stringify(varsList(o));
      if (s2 === sig) errs.push("Formulas are identical to '" + o.slug + "'. Every tool must be unique.");
    });
    return { errors: errs, results: results };
  }

  var api = { validateTool: validateTool, spec: spec, defaults: defaults, varsList: varsList, FORMATS: FORMATS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.ToolValidate = api;
})(typeof window !== "undefined" ? window : globalThis);
