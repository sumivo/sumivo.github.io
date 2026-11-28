/* Banner ads: fills each .ad-slot with a sandboxed iframe (/ad.html) when it comes near the
   viewport, after the page has loaded. Slots have a fixed reserved height (CSS), so nothing jumps.
   Unit settings come from data attributes rendered from site/config.yaml (ads.units). */
(function () {
  "use strict";
  var slots = Array.prototype.slice.call(document.querySelectorAll(".ad-slot[data-units]"));
  if (!slots.length) return;
  var frameUrl = document.currentScript.getAttribute("data-frame");

  function fill(slot) {
    // [[unit name, width, height, min viewport width], ...]: the first that fits is used. The CSS
    // reserves the same heights at the same breakpoints, so the page never shifts.
    var units = JSON.parse(slot.getAttribute("data-units"));
    var u = units.filter(function (x) { return window.matchMedia("(min-width: " + x[3] + "px)").matches; })[0];
    if (!u) return;
    var f = document.createElement("iframe");
    f.src = frameUrl + "?u=" + encodeURIComponent(u[0]);
    f.width = u[1]; f.height = u[2];
    f.title = "Advertisement";
    f.setAttribute("loading", "lazy");
    f.setAttribute("scrolling", "no");
    // Scripts and popups (clicked ads open in a new tab) are allowed; navigating the page is not.
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    var box = slot.querySelector(".ad-box");
    box.appendChild(f);
    // Scale the fixed-size creative to the box (whose size CSS already reserved from the aspect ratio).
    function fit() { var k = Math.min(1.5, box.clientWidth / u[1]); f.style.transform = "scale(" + k + ")"; }
    fit();
    if ("ResizeObserver" in window) new ResizeObserver(fit).observe(box);
    // No ad after 10 s (network had nothing to show, or the ad script was blocked): show our own promo
    // in the same reserved box instead of an empty frame. Same size, so nothing moves.
    setTimeout(function () {
      var doc = null;
      try { doc = f.contentDocument; } catch (e) { return; }
      if (doc && doc.querySelector("iframe, img, a")) return;
      var a = document.createElement("a");
      a.className = "ad-house";
      a.href = house.href;
      a.innerHTML = "<strong></strong><span></span>";
      a.firstChild.textContent = house.title;
      a.lastChild.textContent = house.text;
      box.textContent = "";
      box.appendChild(a);
      slot.querySelector(".ad-label").textContent = "From Sumivo";
    }, 10000);
  }
  var house = JSON.parse(document.currentScript.getAttribute("data-house") || "{}");

  function start() {
    if (!("IntersectionObserver" in window)) { slots.forEach(fill); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); fill(e.target); } });
    }, { rootMargin: "300px 0px" });
    slots.forEach(function (s) { io.observe(s); });
  }
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
