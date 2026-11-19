/* Password generator using the browser's cryptographic random generator (crypto.getRandomValues)
   with unbiased selection; strength shown as entropy and estimated cracking time. Also checks a
   password you type (locally). Nothing is sent anywhere or stored. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, el = C.el;
  var SETS = { lower: "abcdefghijklmnopqrstuvwxyz", upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", digits: "0123456789", symbols: "!@#$%^&*()-_=+[]{};:,.?/~" };
  var AMBIG = /[Il1O0o|`'"]/g;
  var len = el("input", { type: "range", min: "6", max: "64", value: "16", "aria-label": "Length" });
  var lenLbl = el("b", { text: "16" });
  var checks = {};
  ["lower", "upper", "digits", "symbols"].forEach(function (k) { checks[k] = el("input", { type: "checkbox", checked: "checked" }); });
  var noAmbig = el("input", { type: "checkbox" });
  var out = el("ul", { class: "pw-list" });
  var meter = el("div", { class: "pw-meter" });

  function rand(n) { // unbiased integer in [0, n)
    var buf = new Uint32Array(1), limit = Math.floor(0x100000000 / n) * n;
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }
  function generate() {
    var pools = Object.keys(SETS).filter(function (k) { return checks[k].checked; }).map(function (k) { return noAmbig.checked ? SETS[k].replace(AMBIG, "") : SETS[k]; });
    if (!pools.length) return null;
    var all = pools.join(""), n = Number(len.value), chars = [];
    pools.forEach(function (p) { chars.push(p[rand(p.length)]); }); // at least one of each chosen set
    while (chars.length < n) chars.push(all[rand(all.length)]);
    for (var i = chars.length - 1; i > 0; i--) { var j = rand(i + 1), t = chars[i]; chars[i] = chars[j]; chars[j] = t; } // Fisher-Yates
    return { pw: chars.slice(0, n).join(""), bits: n * Math.log2(all.length) };
  }
  function crackTime(bits) {
    var secs = Math.pow(2, bits - 1) / 1e10; // 10 billion guesses a second (offline attack, fast hash)
    var units = [["centuries", 3.15e9], ["years", 3.15e7], ["days", 86400], ["hours", 3600], ["minutes", 60], ["seconds", 1]];
    if (secs > 3.15e13) return "longer than the age of the universe";
    for (var i = 0; i < units.length; i++) if (secs >= units[i][1]) return Math.round(secs / units[i][1]).toLocaleString("en-US") + " " + units[i][0];
    return "instantly";
  }
  function label(bits) { return bits < 40 ? ["Weak", "weak"] : bits < 60 ? ["Fair", "fair"] : bits < 80 ? ["Strong", "strong"] : ["Very strong", "vstrong"]; }
  function render() {
    lenLbl.textContent = len.value;
    out.textContent = "";
    var first = null;
    for (var i = 0; i < 5; i++) {
      var g = generate();
      if (!g) { out.appendChild(el("li", { class: "warn", text: "Choose at least one character type." })); meter.textContent = ""; return; }
      first = first || g;
      (function (pw) {
        var b = el("button", { type: "button", class: "btn small-btn", text: "Copy", onclick: function () { navigator.clipboard.writeText(pw); b.textContent = "Copied ✓"; setTimeout(function () { b.textContent = "Copy"; }, 1500); } });
        out.appendChild(el("li", {}, [el("code", { text: pw }), b]));
      })(g.pw);
    }
    var l = label(first.bits);
    meter.textContent = "";
    meter.appendChild(el("div", { class: "bar-wrap" }, [el("i", { class: l[1], style: "width:" + Math.min(100, first.bits / 1.28) + "%" })]));
    meter.appendChild(el("p", { text: l[0] + ": about " + Math.round(first.bits) + " bits of entropy. Guessing it at 10 billion tries a second would take " + crackTime(first.bits) + "." }));
  }
  var test = el("input", { type: "password", placeholder: "Type a password to test it (stays on this device)", autocomplete: "off", "aria-label": "Password to test" });
  var testOut = el("p", { class: "small" });
  test.addEventListener("input", function () {
    var p = test.value;
    if (!p) { testOut.textContent = ""; return; }
    var pool = (/[a-z]/.test(p) ? 26 : 0) + (/[A-Z]/.test(p) ? 26 : 0) + (/\d/.test(p) ? 10 : 0) + (/[^A-Za-z0-9]/.test(p) ? 33 : 0);
    var bits = p.length * Math.log2(Math.max(pool, 2));
    var common = /^(password|123456|qwerty|111111|abc123|iloveyou|admin|welcome|letmein|monkey|dragon)/i.test(p) || /(.)\1{3,}/.test(p) || /(0123|1234|2345|3456|4567|5678|6789|abcd)/i.test(p);
    if (common) bits = Math.min(bits, 20);
    testOut.textContent = label(bits)[0] + " (about " + Math.round(bits) + " bits): " + crackTime(bits) + " to guess." + (common ? " It contains a very common pattern." : "") + (p.length < 12 ? " Use at least 12 characters." : "");
  });
  [len, noAmbig].concat(Object.keys(checks).map(function (k) { return checks[k]; })).forEach(function (x) { x.addEventListener("input", render); x.addEventListener("change", render); });

  var root = F.root;
  root.textContent = "";
  root.append(
    el("div", { class: "fields" }, [el("label", { class: "wide" }, [el("span", {}, ["Length ", lenLbl]), len])]),
    el("div", { class: "checks" }, [
      el("label", { class: "inline" }, [checks.lower, " a–z"]), el("label", { class: "inline" }, [checks.upper, " A–Z"]),
      el("label", { class: "inline" }, [checks.digits, " 0–9"]), el("label", { class: "inline" }, [checks.symbols, " Symbols !@#"]),
      el("label", { class: "inline" }, [noAmbig, " Avoid look-alikes (I, l, 1, O, 0)"])]),
    meter, out, el("div", { class: "actions" }, [F.button("Generate new passwords", render)]),
    el("h3", { text: "Check a password" }), test, testOut);
  render();
})();
