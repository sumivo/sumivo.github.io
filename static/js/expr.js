/* Safe arithmetic expression evaluator for the declarative calculators (no eval/Function).
   Grammar: numbers, variables, + - * / ^ (right-assoc), unary -, parentheses, comparisons
   (< <= > >= == !=, giving 1/0) and functions: if(c,a,b) min max round(x[,d]) floor ceil abs
   sqrt ln log10 pow exp.  Mirrors assetforge/expr.py exactly; tests check they agree. */
(function (global) {
  "use strict";
  var FUNCS = {
    min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, abs: Math.abs,
    sqrt: Math.sqrt, ln: Math.log, log10: function (x) { return Math.log(x) / Math.LN10; },
    pow: Math.pow, exp: Math.exp,
    round: function (x, d) { var m = Math.pow(10, d || 0); return Math.round(x * m) / m; }
  };

  function tokenize(src) {
    var re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|[-+*\/^(),<>]))/y;
    var out = [], m, pos = 0;
    src = String(src);
    while (pos < src.length) {
      if (/^\s*$/.test(src.slice(pos))) break;
      re.lastIndex = pos;
      m = re.exec(src);
      if (!m) throw new Error("Unexpected character at " + pos + " in: " + src);
      if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1]) });
      else if (m[2] !== undefined) out.push({ t: "id", v: m[2] });
      else out.push({ t: "op", v: m[3] });
      pos = re.lastIndex;
    }
    return out;
  }

  var BIN = { "<": 1, "<=": 1, ">": 1, ">=": 1, "==": 1, "!=": 1, "+": 2, "-": 2, "*": 3, "/": 3, "^": 5 };

  function parse(src) {
    var toks = tokenize(src), i = 0;
    function peek() { return toks[i]; }
    function next() { return toks[i++]; }
    function expect(v) { var t = next(); if (!t || t.v !== v) throw new Error("Expected '" + v + "' in: " + src); }
    function primary() {
      var t = next();
      if (!t) throw new Error("Unexpected end of: " + src);
      if (t.t === "num") return { k: "num", v: t.v };
      if (t.v === "(") { var e = expr(0); expect(")"); return e; }
      if (t.v === "-") return { k: "neg", a: expr(4) };
      if (t.v === "+") return expr(4);
      if (t.t === "id") {
        if (peek() && peek().v === "(") {
          next();
          var args = [];
          if (!(peek() && peek().v === ")")) {
            do { args.push(expr(0)); } while (peek() && peek().v === "," && next());
          }
          expect(")");
          if (t.v !== "if" && !FUNCS[t.v]) throw new Error("Unknown function " + t.v);
          return { k: "call", f: t.v, args: args };
        }
        return { k: "var", v: t.v };
      }
      throw new Error("Unexpected '" + t.v + "' in: " + src);
    }
    function expr(minPrec) {
      var left = primary();
      for (;;) {
        var t = peek();
        if (!t || t.t !== "op" || !BIN[t.v] || BIN[t.v] < minPrec) break;
        var prec = BIN[t.v];
        next();
        var right = expr(t.v === "^" ? prec : prec + 1);
        left = { k: "bin", op: t.v, a: left, b: right };
      }
      return left;
    }
    var tree = expr(0);
    if (i < toks.length) throw new Error("Unexpected '" + toks[i].v + "' in: " + src);
    return tree;
  }

  function evaluate(node, env) {
    switch (node.k) {
      case "num": return node.v;
      case "var":
        if (!(node.v in env)) throw new Error("Unknown variable " + node.v);
        return env[node.v];
      case "neg": return -evaluate(node.a, env);
      case "call":
        if (node.f === "if") return evaluate(node.args[0], env) ? evaluate(node.args[1], env) : evaluate(node.args[2], env);
        return FUNCS[node.f].apply(null, node.args.map(function (a) { return evaluate(a, env); }));
      case "bin":
        var a = evaluate(node.a, env), b = evaluate(node.b, env);
        switch (node.op) {
          case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b;
          case "^": return Math.pow(a, b);
          case "<": return a < b ? 1 : 0; case "<=": return a <= b ? 1 : 0;
          case ">": return a > b ? 1 : 0; case ">=": return a >= b ? 1 : 0;
          case "==": return a === b ? 1 : 0; case "!=": return a !== b ? 1 : 0;
        }
    }
    throw new Error("Bad node");
  }

  /* Run a tool spec: inputs (values), vars (ordered [name, expr]), outputs ([{label, expr}]). */
  function run(spec, values) {
    var env = {};
    Object.keys(values).forEach(function (k) { env[k] = values[k]; });
    (spec.vars || []).forEach(function (pair) { env[pair[0]] = evaluate(parse(pair[1]), env); });
    return spec.outputs.map(function (o) { return evaluate(parse(o.expr), env); });
  }

  var api = { parse: parse, evaluate: evaluate, run: run };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Expr = api;
})(typeof window !== "undefined" ? window : globalThis);
