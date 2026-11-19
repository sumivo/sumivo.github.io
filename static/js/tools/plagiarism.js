/* Plagiarism / similarity checker. Compares a text with sources the user provides using
   word-sequence fingerprints (TextKit.compare), highlights matching passages, and builds
   exact-phrase web searches for the most distinctive sentences. Runs entirely in the browser. */
(function () {
  "use strict";
  var C = window.Calc, F = window.FileKit, TK = window.TextKit, el = C.el;
  var COLORS = 6;
  var text = el("textarea", { rows: "10", class: "bigtext", placeholder: "Paste the text you want to check (an essay, article, assignment…)" });
  var count = el("span", { class: "muted small" });
  var sourcesBox = el("div", { class: "sources" });
  var minWords = el("select", { name: "min" }, [6, 8, 10, 12, 15].map(function (n) {
    var o = el("option", { value: n, text: n + " words" }); if (n === 8) o.selected = true; return o;
  }));
  var out = el("div", { class: "result-box", hidden: "hidden" });
  var sources = [];

  function addSource(value, label) {
    if (sources.length >= 10) return;
    var ta = el("textarea", { rows: "5", placeholder: "Paste a source: an article, a website's text, another student's essay…" });
    if (value) ta.value = value;
    var name = el("input", { type: "text", placeholder: "Name (optional), e.g. Wikipedia article", value: label || "" });
    var box = el("div", { class: "source c" + (sources.length % COLORS) }, [
      el("div", { class: "source-head" }, [el("strong", { text: "Source " + (sources.length + 1) }), name,
        fileButton(function (t, n) { ta.value = t; if (!name.value) name.value = n; }),
        el("button", { type: "button", class: "icon", title: "Remove", "aria-label": "Remove source", text: "✕", onclick: function () {
          sources.splice(sources.indexOf(entry), 1); box.remove(); renumber();
        } })]),
      ta]);
    var entry = { ta: ta, name: name, box: box };
    sources.push(entry);
    sourcesBox.appendChild(box);
  }
  function renumber() {
    sources.forEach(function (s, i) { s.box.className = "source c" + (i % COLORS); s.box.querySelector("strong").textContent = "Source " + (i + 1); });
  }

  function fileButton(onText) {
    var input = el("input", { type: "file", accept: ".txt,.docx,.md,text/plain", class: "visually-hidden" });
    input.addEventListener("change", function () {
      var f = input.files[0]; input.value = "";
      if (f) readFile(f).then(function (t) { onText(t, f.name); }).catch(function (e) { alert(e.message); });
    });
    return el("label", { class: "btn ghost small-btn" }, [input, "Load .txt/.docx"]);
  }

  function readFile(f) {
    if (/\.docx$/i.test(f.name)) {
      return F.loadScript("vendor/jszip/jszip.min.js").then(function () { return window.JSZip.loadAsync(f); })
        .then(function (zip) {
          var doc = zip.file("word/document.xml");
          if (!doc) throw new Error("This .docx has no document text.");
          return doc.async("string");
        }).then(function (xml) {
          var d = new DOMParser().parseFromString(xml, "application/xml");
          var W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
          return Array.prototype.map.call(d.getElementsByTagNameNS(W, "p"), function (p) {
            var s = "";
            Array.prototype.forEach.call(p.getElementsByTagNameNS(W, "*"), function (n) {
              if (n.localName === "t") s += n.textContent; else if (n.localName === "tab") s += "\t"; else if (n.localName === "br") s += "\n";
            });
            return s;
          }).join("\n");
        });
    }
    return f.text();
  }

  function check() {
    var t = text.value;
    if (TK.countWords(t) < 15) { out.hidden = false; out.textContent = "Paste at least a few sentences (15+ words) to check."; return; }
    var srcs = sources.map(function (s) { return s.ta.value; });
    var withText = srcs.filter(function (s) { return TK.countWords(s) >= 8; }).length;
    out.hidden = false; out.textContent = "";
    if (withText) {
      var r = TK.compare(t, srcs, { minWords: Number(minWords.value) });
      var pct = r.percent;
      out.appendChild(C.stats([
        ["of your text matches a source", pct.toFixed(pct < 10 ? 1 : 0) + "%"],
        ["matching words", r.matchedWords + " of " + r.words],
        ["matching passages", String(r.spans.length)]
      ]));
      var verdict = pct === 0 ? "No copied passages found in these sources." : pct < 15 ? "Low overlap. Check each highlighted passage is quoted and cited."
        : pct < 40 ? "Moderate overlap. Rewrite or quote and cite the highlighted passages." : "High overlap. Large parts of the text appear in the sources.";
      out.appendChild(el("p", { class: "verdict", text: verdict }));
      out.appendChild(el("ul", { class: "legend" }, r.sources.map(function (s, i) {
        return el("li", { class: "c" + (i % COLORS) }, [el("i"), (sources[i].name.value || "Source " + (i + 1)) + ": " + s.percent.toFixed(1) + "% (" + s.matchedWords + " words)"]);
      })));
      out.appendChild(el("h3", { text: "Your text, with matching passages highlighted" }));
      var view = el("div", { class: "marked" }), pos = 0;
      r.spans.forEach(function (sp) {
        view.appendChild(document.createTextNode(t.slice(pos, sp.start)));
        view.appendChild(el("mark", { class: "c" + (sp.source % COLORS), title: "Matches " + (sources[sp.source].name.value || "Source " + (sp.source + 1)), text: t.slice(sp.start, sp.end) }));
        pos = sp.end;
      });
      view.appendChild(document.createTextNode(t.slice(pos)));
      out.appendChild(view);
    } else {
      out.appendChild(el("p", { class: "muted", text: "No sources added, so nothing was compared. Add a source above, or search the web for your sentences below." }));
    }
    var phrases = TK.searchPhrases(t, 8);
    if (phrases.length) {
      out.appendChild(el("h3", { text: "Check the web for these sentences" }));
      out.appendChild(el("p", { class: "muted small", text: "Each link searches for the exact sentence in quotes. If a search finds the same wording on another page, that sentence may be copied." }));
      out.appendChild(el("ol", { class: "phrases" }, phrases.map(function (p) {
        var q = encodeURIComponent('"' + p + '"');
        return el("li", {}, [el("span", { text: p }), " ",
          el("a", { href: "https://www.google.com/search?q=" + q, target: "_blank", rel: "noopener nofollow", text: "Google" }), " · ",
          el("a", { href: "https://www.bing.com/search?q=" + q, target: "_blank", rel: "noopener nofollow", text: "Bing" }), " · ",
          el("a", { href: "https://duckduckgo.com/?q=" + q, target: "_blank", rel: "noopener nofollow", text: "DuckDuckGo" })]);
      })));
    }
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  text.addEventListener("input", function () { count.textContent = TK.countWords(text.value) + " words"; });
  var rootEl = F.root;
  rootEl.textContent = "";
  rootEl.appendChild(el("label", { class: "block" }, [el("span", {}, ["Your text ", count]), text]));
  rootEl.appendChild(el("div", { class: "actions" }, [fileButton(function (t) { text.value = t; text.dispatchEvent(new Event("input")); })]));
  rootEl.appendChild(el("h3", { text: "Sources to compare against" }));
  rootEl.appendChild(sourcesBox);
  rootEl.appendChild(el("div", { class: "actions" }, [
    F.button("+ Add another source", function () { addSource(); }, "btn ghost"),
    el("label", { class: "inline" }, ["Count a match from ", minWords])]));
  rootEl.appendChild(el("div", { class: "actions" }, [F.button("Check for plagiarism", check)]));
  rootEl.appendChild(out);
  addSource();
  count.textContent = "0 words";
})();
