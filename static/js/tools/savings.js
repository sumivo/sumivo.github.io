(function () {
  "use strict";
  var C = window.Calc;
  C.mount([
    { key: "goal", label: "Savings goal", value: 10000 },
    { key: "have", label: "Already saved", value: 1500 },
    { key: "months", label: "Months to reach it", value: 24, step: "1" },
    { key: "rate", label: "Annual interest %", value: 4 }
  ], function (v) {
    var n = Math.max(1, Math.round(v.months)), r = v.rate / 100 / 12;
    var fvHave = v.have * Math.pow(1 + r, n);
    var need = Math.max(0, v.goal - fvHave);
    // Payment at the end of each month: PMT = need * r / ((1+r)^n - 1)
    var pmt = r > 0 ? need * r / (Math.pow(1 + r, n) - 1) : need / n;
    var contributed = pmt * n;
    var interest = v.goal - v.have - contributed;
    return [C.stats([
      ["Save each month", C.money(pmt)],
      ["Save each week", C.money(pmt * 12 / 52)],
      ["You'll contribute", C.money0(contributed)],
      ["Interest earned", C.money0(Math.max(0, interest))]
    ]), need === 0 ? C.el("p", { class: "note", text: "Good news: what you've already saved reaches the goal with interest alone." }) : null];
  });
})();
