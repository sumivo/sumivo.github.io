/* Text utilities shared by the writing and document tools. Pure functions, no network, no DOM.
   Works in the browser (window.TextKit) and in Node (require) so the tests can run it. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TextKit = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ------------------------------------------------------------------ sentences
  var ABBREV = /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|inc|ltd|co|corp|no|fig|approx|dept|est|e\.g|i\.e|u\.s|u\.k|a\.m|p\.m|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.$/i;

  /* Split one paragraph into sentences. Each sentence keeps its trailing space so that
     joining them gives back the original text exactly. */
  function splitSentences(text) {
    // Terminators: . ! ? … plus the Devanagari danda (। ॥) and CJK full-width 。！？
    var parts = String(text).match(/[^.!?…।॥。！？]+(?:[.!?…।॥。！？]+["'”’)\]]*|$)\s*/g) || [];
    var out = [];
    parts.forEach(function (p) {
      if (!p) return;
      var prev = out[out.length - 1];
      var prevTrim = prev ? prev.replace(/\s+$/, "") : "";
      // Merge after abbreviations, initials ("J. Smith"), decimals ("3.5") and lower-case continuations.
      if (prev && (ABBREV.test(prevTrim) || /(?:^|\s)[A-Z]\.$/.test(prevTrim) ||
          (/\d\.$/.test(prevTrim) && /^\d/.test(p)) || /^[a-z]/.test(p))) {
        out[out.length - 1] = prev + p;
      } else {
        out.push(p);
      }
    });
    return out;
  }

  /* Paragraphs (split on blank lines or single newlines) -> [{sentences:[...], sep:"\n"}] */
  function paragraphs(text) {
    var out = [], re = /([^\n]*)(\n+|$)/g, m;
    while ((m = re.exec(String(text))) !== null) {
      if (m[0] === "") break;
      out.push({ text: m[1], sep: m[2], sentences: m[1].trim() ? splitSentences(m[1]) : [] });
    }
    return out;
  }

  function countWords(text) {
    var m = String(text).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    return m ? m.length : 0;
  }

  // ------------------------------------------------------------------ word diff
  function tokens(s) { return String(s).match(/\s+|[^\s]+/g) || []; }
  function norm(w) { return w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""); }

  /* Mark which words of `b` are new compared with `a` (longest common subsequence on words).
     Returns [{text, changed}] covering `b` exactly, whitespace included. */
  function wordDiff(a, b) {
    var ta = tokens(a).filter(function (t) { return /\S/.test(t); }).map(norm);
    var tb = tokens(b);
    var wb = [], idx = [];
    tb.forEach(function (t, i) { if (/\S/.test(t)) { wb.push(norm(t)); idx.push(i); } });
    var n = ta.length, m = wb.length;
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Uint16Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = ta[i] === wb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var same = {};
    i = 0; j = 0;
    while (i < n && j < m) {
      if (ta[i] === wb[j]) { same[idx[j]] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return tb.map(function (t, k) { return { text: t, changed: /\S/.test(t) && !same[k] && norm(t) !== "" }; });
  }

  function changedShare(a, b) {
    var d = wordDiff(a, b), words = d.filter(function (x) { return /\S/.test(x.text); });
    if (!words.length) return 0;
    return words.filter(function (x) { return x.changed; }).length / words.length;
  }

  // ------------------------------------------------------------------ similarity (plagiarism)
  /* Words with their character positions in the original text. */
  function wordsWithPos(text) {
    var re = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, out = [], m;
    while ((m = re.exec(text)) !== null) out.push({ w: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length });
    return out;
  }

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }

  /* Fingerprints of every k-word sequence: hash -> true. */
  function shingles(words, k) {
    var set = new Map();
    for (var i = 0; i + k <= words.length; i++) {
      var key = words.slice(i, i + k).map(function (x) { return x.w; }).join(" ");
      set.set(fnv1a(key), true);
    }
    return set;
  }

  /* Compare `text` with each source. A passage counts as matching when at least `minWords`
     consecutive words (after normalising case and punctuation) also appear in a source.
     Returns {words, matchedWords, percent, sources:[{index, matchedWords, percent}], spans:[{start,end,words,source}]} */
  function compare(text, sources, opts) {
    opts = opts || {};
    var k = Math.max(3, Math.min(opts.k || 5, opts.minWords || 8));
    var minWords = Math.max(k, opts.minWords || 8);
    var words = wordsWithPos(text);
    var owner = new Int16Array(words.length).fill(-1);
    var perSource = sources.map(function () { return 0; });
    sources.forEach(function (src, si) {
      var fp = shingles(wordsWithPos(src || ""), k);
      if (!fp.size) return;
      var covered = new Uint8Array(words.length);
      for (var i = 0; i + k <= words.length; i++) {
        var key = words.slice(i, i + k).map(function (x) { return x.w; }).join(" ");
        if (fp.has(fnv1a(key))) for (var j = i; j < i + k; j++) covered[j] = 1;
      }
      // Keep only runs of at least minWords words.
      var i0 = 0;
      while (i0 < words.length) {
        if (!covered[i0]) { i0++; continue; }
        var i1 = i0;
        while (i1 < words.length && covered[i1]) i1++;
        if (i1 - i0 >= minWords) {
          perSource[si] += i1 - i0;
          for (var x = i0; x < i1; x++) if (owner[x] === -1) owner[x] = si;
        }
        i0 = i1;
      }
    });
    var spans = [], i = 0;
    while (i < words.length) {
      if (owner[i] === -1) { i++; continue; }
      var s = owner[i], e = i;
      while (e < words.length && owner[e] === s) e++;
      spans.push({ start: words[i].start, end: words[e - 1].end, words: e - i, source: s });
      i = e;
    }
    var matched = 0;
    for (i = 0; i < owner.length; i++) if (owner[i] !== -1) matched++;
    var total = words.length;
    return {
      words: total, matchedWords: matched, percent: total ? 100 * matched / total : 0,
      sources: perSource.map(function (n, si) { return { index: si, matchedWords: n, percent: total ? 100 * n / total : 0 }; }),
      spans: spans
    };
  }

  var STOP = new Set(("a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those " +
    "i you he she we they me him her us them my your his our their not no so than too very can will just do does did have has had " +
    "about into over after before also more most such only own same other some any each both all").split(" "));

  /* The sentences most worth searching for on the web: long, specific, few stop words.
     Returns exact-phrase queries (at most 32 words, a search-engine limit). */
  function searchPhrases(text, n) {
    var cands = [];
    paragraphs(text).forEach(function (p) {
      p.sentences.forEach(function (s) {
        var ws = wordsWithPos(s).map(function (x) { return x.w; });
        if (ws.length < 8) return;
        var content = ws.filter(function (w) { return !STOP.has(w) && w.length > 3; }).length;
        var score = content / ws.length + Math.min(ws.length, 30) / 60;
        var phrase = s.trim().split(/\s+/).slice(0, 32).join(" ").replace(/["“”]/g, "");
        cands.push({ phrase: phrase, score: score });
      });
    });
    cands.sort(function (a, b) { return b.score - a.score; });
    var seen = new Set();
    return cands.filter(function (c) { if (seen.has(c.phrase)) return false; seen.add(c.phrase); return true; })
      .slice(0, n || 8).map(function (c) { return c.phrase; });
  }

  // ------------------------------------------------------------------ legacy Word (.doc)
  var CP1252 = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
    0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d,
    0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178 };

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  /* Text of the main document of a Word 97-2003 file, from its "WordDocument" stream and the
     "0Table"/"1Table" streams ([MS-DOC] piece table). Formatting, images and tables are not kept;
     table cells become tab-separated lines. Throws a readable Error for unsupported files. */
  function docText(wordDoc, table0, table1) {
    var b = wordDoc;
    if (!b || b.length < 512 || u16(b, 0) !== 0xa5ec) throw new Error("This is not a Word 97–2003 document.");
    var nFib = u16(b, 2), flags = u16(b, 0x0a);
    if (flags & 0x0100) throw new Error("This document is password-protected. Remove the password in Word first.");
    if (nFib < 0x00c1) throw new Error("This file is from Word 95 or older, which isn't supported. Open it in Word and save it as .docx.");
    var table = (flags & 0x0200) ? table1 : table0;
    if (!table) throw new Error("The document's table stream is missing; the file may be damaged.");
    var csw = u16(b, 32), rgLw = 32 + 2 + csw * 2, cslw = u16(b, rgLw);
    var ccpText = u32(b, rgLw + 2 + 12);
    var rgFcLcb = rgLw + 2 + cslw * 4 + 2;
    var fcClx = u32(b, rgFcLcb + 33 * 8), lcbClx = u32(b, rgFcLcb + 33 * 8 + 4);
    if (!lcbClx || fcClx + lcbClx > table.length) throw new Error("Couldn't find the text in this document; the file may be damaged.");
    var pos = fcClx, end = fcClx + lcbClx;
    while (pos < end && table[pos] === 0x01) pos += 3 + u16(table, pos + 1); // skip Prc (formatting)
    if (table[pos] !== 0x02) throw new Error("Couldn't find the text in this document; the file may be damaged.");
    var lcb = u32(table, pos + 1), plc = pos + 5, n = (lcb - 4) / 12;
    var chars = [];
    for (var i = 0; i < n; i++) {
      var cpStart = u32(table, plc + i * 4), cpEnd = Math.min(u32(table, plc + (i + 1) * 4), ccpText);
      if (cpStart >= ccpText) break;
      var fcVal = u32(table, plc + (n + 1) * 4 + i * 8 + 2);
      var compressed = (fcVal & 0x40000000) !== 0, fc = fcVal & 0x3fffffff;
      var len = cpEnd - cpStart;
      if (compressed) {
        var o = fc / 2;
        for (var c = 0; c < len; c++) { var ch = b[o + c]; chars.push(CP1252[ch] || ch); }
      } else {
        for (c = 0; c < len; c++) chars.push(u16(b, fc + c * 2));
      }
    }
    // Fields: drop the instructions (between 0x13 and 0x14), keep the shown result.
    var out = [], depth = 0, hiding = [];
    for (i = 0; i < chars.length; i++) {
      var code = chars[i];
      if (code === 0x13) { depth++; hiding.push(true); continue; }
      if (code === 0x14) { if (hiding.length) hiding[hiding.length - 1] = false; continue; }
      if (code === 0x15) { if (depth) { depth--; hiding.pop(); } continue; }
      if (hiding.indexOf(true) !== -1) continue;
      out.push(code);
    }
    var s = "";
    for (i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.slice(i, i + 8192));
    return s
      .replace(/\x07\r?\x07/g, "\n")      // end of a table row
      .replace(/\x07/g, "\t")            // end of a table cell
      .replace(/\r/g, "\n")
      .replace(/\x0b/g, "\n")            // manual line break
      .replace(/\x0c/g, "\n\f\n")         // page / section break
      .replace(/\x1e/g, "-").replace(/[\x1f\x01\x02\x03\x04\x05\x08]/g, "")
      .replace(/\t\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ------------------------------------------------------------------ AI safety helpers
  var SHORT = { tmrw: "tomorrow", tmr: "tomorrow", tmrow: "tomorrow", "2moro": "tomorrow", "2day": "today", "2nite": "tonight",
    u: "you", ur: "your", pls: "please", plz: "please", thx: "thanks", thnx: "thanks", ty: "thank you", msg: "message",
    b4: "before", bc: "because", cuz: "because", coz: "because", ppl: "people", abt: "about", idk: "I don't know",
    imo: "in my opinion", btw: "by the way", wanna: "want to", gonna: "going to", gotta: "have to", cant: "can't",
    wont: "won't", dont: "don't", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", wasnt: "wasn't", im: "I'm", ive: "I've" };

  /* Expand chat shorthand so small AI models don't guess (e.g. "tmrw" -> "Tuesday"). */
  function expandShorthand(text) {
    return String(text).replace(/\b[a-z0-9]+\b/gi, function (w) {
      var r = SHORT[w.toLowerCase()];
      if (!r) return w;
      return w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? r[0].toUpperCase() + r.slice(1) : r;
    });
  }

  var FACT = /\b(?:\d[\d,.:%]*|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;
  /* Numbers, days and months in `output` that don't appear in `input`: worth a human check. */
  function newFacts(input, output) {
    var have = new Set((String(input).match(FACT) || []).map(function (x) { return x.toLowerCase().replace(/[,.:]+$/, ""); }));
    var seen = new Set(), out = [];
    (String(output).match(FACT) || []).forEach(function (x) {
      var k = x.toLowerCase().replace(/[,.:]+$/, "");
      if (k && !have.has(k) && !seen.has(k)) { seen.add(k); out.push(x.replace(/[,.:]+$/, "")); }
    });
    return out;
  }

  return { expandShorthand: expandShorthand, newFacts: newFacts, splitSentences: splitSentences, paragraphs: paragraphs, countWords: countWords, wordDiff: wordDiff,
    changedShare: changedShare, compare: compare, searchPhrases: searchPhrases, docText: docText, wordsWithPos: wordsWithPos };
});
