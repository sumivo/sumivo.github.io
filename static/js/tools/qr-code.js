/* QR code generator: links, text, Wi-Fi, UPI payments (India), email, phone, SMS and contact cards.
   Uses qrcode-generator (MIT). Download PNG (any size) or SVG; colours and error correction adjustable.
   The QR codes are static: they never expire and don't go through a redirect service. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, I = window.ImageKit, el = C.el;
  var type = I.select("type", [["url", "Link (URL)"], ["text", "Plain text"], ["wifi", "Wi-Fi network"], ["upi", "UPI payment (India)"],
    ["email", "Email"], ["tel", "Phone call"], ["sms", "SMS"], ["vcard", "Contact card"]], "url");
  var inputs = {};
  function inp(key, label, attrs) { inputs[key] = el(attrs && attrs.textarea ? "textarea" : "input", Object.assign({ type: "text", rows: "3" }, attrs || {})); inputs[key].addEventListener("input", draw); return el("label", { class: attrs && attrs.wide ? "wide" : "" }, [label, inputs[key]]); }
  var groups = {
    url: [inp("url", "Website link", { value: "https://", wide: true, inputmode: "url" })],
    text: [inp("text", "Text", { textarea: true, wide: true })],
    wifi: [inp("ssid", "Network name (SSID)"), inp("wpass", "Password"), (function () {
      inputs.enc = I.select("enc", [["WPA", "WPA/WPA2/WPA3"], ["WEP", "WEP"], ["nopass", "No password"]], "WPA"); inputs.enc.addEventListener("change", draw);
      return el("label", {}, ["Security", inputs.enc]); })()],
    upi: [inp("pa", "UPI ID (VPA)", { placeholder: "name@bank" }), inp("pn", "Payee name"), inp("am", "Amount in ₹ (optional)", { inputmode: "decimal" }), inp("tn", "Note (optional)")],
    email: [inp("to", "Email address", { inputmode: "email" }), inp("sub", "Subject"), inp("body", "Message", { textarea: true, wide: true })],
    tel: [inp("tel", "Phone number (with country code)", { inputmode: "tel", placeholder: "+91 98765 43210" })],
    sms: [inp("smsto", "Phone number", { inputmode: "tel" }), inp("smsbody", "Message", { textarea: true, wide: true })],
    vcard: [inp("vn", "Full name"), inp("vorg", "Company"), inp("vtel", "Phone", { inputmode: "tel" }), inp("vmail", "Email", { inputmode: "email" }), inp("vurl", "Website")]
  };
  var fg = el("input", { type: "color", value: "#000000", "aria-label": "QR colour" }), bg = el("input", { type: "color", value: "#ffffff", "aria-label": "Background colour" });
  var ecc = I.select("ecc", [["L", "Low (7%)"], ["M", "Medium (15%)"], ["Q", "Quartile (25%)"], ["H", "High (30%)"]], "M");
  var size = I.select("size", [[512, "512 px"], [1024, "1024 px"], [2048, "2048 px (print)"]], 1024);
  [fg, bg, ecc].forEach(function (x) { x.addEventListener("input", draw); x.addEventListener("change", draw); });
  var fieldBox = el("div", { class: "fields" });
  var canvas = el("canvas", { class: "qr-canvas", width: "320", height: "320", "aria-label": "QR code preview" });
  var payload = el("p", { class: "muted small qr-payload" });
  var warn = el("p", { class: "warn small" });

  function esc(s) { return String(s || "").replace(/([\\;,:"])/g, "\\$1"); }
  function value(k) { return (inputs[k] && inputs[k].value || "").trim(); }
  function data() {
    switch (type.value) {
      case "url": return value("url").replace(/^https?:\/\/$/, "");
      case "text": return value("text");
      case "wifi": return value("ssid") ? "WIFI:T:" + inputs.enc.value + ";S:" + esc(value("ssid")) + ";" + (inputs.enc.value === "nopass" ? "" : "P:" + esc(value("wpass")) + ";") + ";" : "";
      case "upi":
        if (!value("pa")) return "";
        var q = "pa=" + encodeURIComponent(value("pa")).replace(/%40/g, "@") + (value("pn") ? "&pn=" + encodeURIComponent(value("pn")) : "") +
          (value("am") ? "&am=" + encodeURIComponent(Number(value("am").replace(/,/g, "")).toFixed(2)) : "") + "&cu=INR" + (value("tn") ? "&tn=" + encodeURIComponent(value("tn")) : "");
        return "upi://pay?" + q;
      case "email": return value("to") ? "mailto:" + value("to") + "?subject=" + encodeURIComponent(value("sub")) + "&body=" + encodeURIComponent(value("body")) : "";
      case "tel": return value("tel") ? "tel:" + value("tel").replace(/[^\d+]/g, "") : "";
      case "sms": return value("smsto") ? "SMSTO:" + value("smsto").replace(/[^\d+]/g, "") + ":" + value("smsbody") : "";
      case "vcard": return value("vn") ? ["BEGIN:VCARD", "VERSION:3.0", "FN:" + value("vn"), value("vorg") && "ORG:" + value("vorg"), value("vtel") && "TEL:" + value("vtel"),
        value("vmail") && "EMAIL:" + value("vmail"), value("vurl") && "URL:" + value("vurl"), "END:VCARD"].filter(Boolean).join("\n") : "";
    }
    return "";
  }

  var qr = null;
  function make() {
    var d = data();
    if (!d) return null;
    window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];
    var q = window.qrcode(0, ecc.value);
    q.addData(d, "Byte");
    q.make();
    return { q: q, d: d };
  }
  function paint(cv, px) {
    var n = qr.q.getModuleCount(), margin = 4, cell = px / (n + margin * 2);
    cv.width = cv.height = px;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = bg.value; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = fg.value;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.q.isDark(r, c)) ctx.fillRect(Math.floor((c + margin) * cell), Math.floor((r + margin) * cell), Math.ceil(cell), Math.ceil(cell));
  }
  function contrastOk() {
    function lum(h) { var v = parseInt(h.slice(1), 16); return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; }
    return lum(bg.value) - lum(fg.value) > 0.4;
  }
  function draw() {
    try { qr = make(); } catch (e) { qr = null; warn.textContent = "Too much data for one QR code. Shorten the text or lower the error correction."; return; }
    warn.textContent = contrastOk() ? "" : "Use a dark code on a light background, or some phones won't scan it.";
    if (!qr) { canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); payload.textContent = "Fill in the details to see your QR code."; return; }
    paint(canvas, 320);
    payload.textContent = "Contains: " + (qr.d.length > 140 ? qr.d.slice(0, 140) + "…" : qr.d);
  }
  function showType() {
    fieldBox.textContent = "";
    groups[type.value].forEach(function (g) { fieldBox.appendChild(g); });
    draw();
  }
  type.addEventListener("change", showType);

  function svg() {
    var n = qr.q.getModuleCount(), m = 4, s = n + m * 2, path = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.q.isDark(r, c)) path += "M" + (c + m) + " " + (r + m) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + " " + s + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="' + bg.value + '"/><path fill="' + fg.value + '" d="' + path + '"/></svg>';
  }

  var root = F.root;
  root.textContent = "";
  root.append(el("div", { class: "qr-layout" }, [
    el("div", {}, [el("div", { class: "fields" }, [el("label", { class: "wide" }, ["QR code for", type])]), fieldBox,
      el("div", { class: "fields" }, [el("label", {}, ["Colour", fg]), el("label", {}, ["Background", bg]), el("label", {}, ["Error correction", ecc]), el("label", {}, ["PNG size", size])])]),
    el("div", { class: "qr-preview" }, [canvas, payload, warn, el("div", { class: "actions" }, [
      F.button("Download PNG", function () { if (!qr) return; var cv = document.createElement("canvas"); paint(cv, Number(size.value)); cv.toBlob(function (b) { F.download(b, "qr-code.png"); }); }),
      F.button("Download SVG", function () { if (qr) F.download(new Blob([svg()], { type: "image/svg+xml" }), "qr-code.svg"); }, "btn ghost")])])
  ]));
  F.loadScript("vendor/qrcode/qrcode.js").then(showType).catch(function (e) { warn.textContent = e.message; });
})();
