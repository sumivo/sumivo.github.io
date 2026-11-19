(function () {
  "use strict";
  var C = window.Calc;
  C.mount([
    { key: "start", label: "Starting amount", value: 1000 },
    { key: "monthly", label: "Monthly contribution", value: 200 },
    { key: "rate", label: "Annual return %", value: 6 },
    { key: "years", label: "Years", value: 20, step: "1" }
  ], function (v) {
    var r = v.rate / 100 / 12, years = Math.min(80, Math.max(1, Math.round(v.years)));
    var bal = v.start, contributed = v.start, rows = [];
    for (var y = 1; y <= years; y++) {
      for (var m = 0; m < 12; m++) { bal = bal * (1 + r) + v.monthly; contributed += v.monthly; }
      if (y <= 5 || y % 5 === 0 || y === years) rows.push(["Year " + y, C.money0(contributed), C.money0(bal - contributed), C.money0(bal)]);
    }
    return [C.stats([
      ["Final balance", C.money0(bal)],
      ["Total contributed", C.money0(contributed)],
      ["Growth from returns", C.money0(bal - contributed)]
    ]), C.table(["", "Contributed", "Growth", "Balance"], rows),
      C.el("p", { class: "note", text: "Returns are compounded monthly and contributions added at the end of each month. Real returns vary." })];
  });
})();
