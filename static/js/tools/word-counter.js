/* Word counter: words, characters, sentences, paragraphs, reading and speaking time, top keywords
   and limits for common places (titles, meta descriptions, posts). Updates as you type. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, TK = window.TextKit, el = C.el;
  var STOP = new Set(("a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those i you he she we they " +
    "me him her us them my your his our their not no so than too very can will just do does did have has had about into over after before also more most such " +
    "only own same other some any each both all there here what which who whom when where why how then out up down off again further once am would could should").split(" "));
  var LIMITS = [["SEO title", 60], ["Meta description", 160], ["X (Twitter) post", 280], ["SMS message", 160], ["Instagram caption", 2200], ["LinkedIn post", 3000]];
  var text = el("textarea", { class: "bigtext", rows: "12", placeholder: "Type or paste your text here", "aria-label": "Text to count" });
  var stats = el("div"), limits = el("div", { class: "limits" }), kw = el("div");

  function update() {
    var t = text.value;
    var words = TK.countWords(t);
    var chars = t.length, noSpace = t.replace(/\s/g, "").length;
    var paras = t.split(/\n\s*\n|\n/).filter(function (p) { return p.trim(); }).length;
    var sentences = 0, longest = 0;
    TK.paragraphs(t).forEach(function (p) { p.sentences.forEach(function (s) { sentences++; longest = Math.max(longest, TK.countWords(s)); }); });
    var list = TK.wordsWithPos(t).map(function (w) { return w.w; });
    var unique = new Set(list).size;
    function mins(wpm) { var m = words / wpm; return m < 1 ? Math.max(1, Math.round(m * 60)) + " sec" : Math.round(m * 10) / 10 + " min"; }
    stats.textContent = "";
    stats.appendChild(C.stats([["Words", String(words)], ["Characters", String(chars)], ["Characters (no spaces)", String(noSpace)],
      ["Sentences", String(sentences)], ["Paragraphs", String(paras)], ["Reading time", words ? mins(238) : "0"],
      ["Speaking time", words ? mins(150) : "0"], ["Unique words", String(unique)],
      ["Average sentence", sentences ? Math.round(words / sentences) + " words" : "–"], ["Longest sentence", longest + " words"]]));
    limits.textContent = "";
    LIMITS.forEach(function (l) {
      var pct = Math.min(100, (chars / l[1]) * 100);
      limits.appendChild(el("div", { class: "limit" + (chars > l[1] ? " over" : "") }, [
        el("span", { text: l[0] }), el("span", { class: "meter" }, [el("i", { style: "width:" + pct + "%" })]),
        el("span", { class: "small", text: chars + " / " + l[1] })]));
    });
    var counts = {};
    list.forEach(function (w) { if (!STOP.has(w) && w.length > 2 && !/^\d+$/.test(w)) counts[w] = (counts[w] || 0) + 1; });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 10);
    kw.textContent = "";
    if (top.length) {
      kw.appendChild(el("h3", { text: "Most used words" }));
      kw.appendChild(C.table(["Word", "Times", "Density"], top.map(function (w) { return [w, counts[w], (100 * counts[w] / words).toFixed(1) + "%"]; })));
    }
  }
  text.addEventListener("input", update);
  var root = F.root;
  root.textContent = "";
  root.append(text, stats, el("h3", { text: "Length limits" }), limits, kw);
  update();
})();
