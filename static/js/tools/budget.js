(function () {
  "use strict";
  var C = window.Calc;
  C.mount([
    { key: "income", label: "Monthly take-home pay", value: 4000 },
    { key: "needs", label: "Needs %", value: 50 },
    { key: "wants", label: "Wants %", value: 30 },
    { key: "save", label: "Savings & debt %", value: 20 }
  ], function (v) {
    var total = v.needs + v.wants + v.save;
    var parts = [["Needs (housing, food, bills)", v.needs], ["Wants (fun, dining, shopping)", v.wants], ["Savings & extra debt payments", v.save]];
    var nodes = [C.stats(parts.map(function (p) { return [p[0], C.money(v.income * p[1] / 100)]; }))];
    if (Math.abs(total - 100) > 0.001) nodes.push(C.el("p", { class: "warn", text: "Your percentages add up to " + total + "%, not 100%." }));
    nodes.push(C.table(["Category", "Per month", "Per year"], parts.map(function (p) {
      return [p[0], C.money(v.income * p[1] / 100), C.money0(v.income * p[1] / 100 * 12)];
    })));
    return nodes;
  });
})();
