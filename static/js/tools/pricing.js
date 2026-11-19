(function () {
  "use strict";
  var C = window.Calc;
  // Same formula as the Handmade Product Pricing Calculator spreadsheet.
  C.mount([
    { key: "materials", label: "Materials per item", value: 4.2 },
    { key: "minutes", label: "Minutes of work", value: 25 },
    { key: "hourly", label: "Your hourly rate", value: 20 },
    { key: "packaging", label: "Packaging per item", value: 1.1 },
    { key: "overhead", label: "Overhead %", value: 10 },
    { key: "markup", label: "Wholesale markup (x)", value: 2 },
    { key: "fees", label: "Marketplace + payment fees %", value: 10 }
  ], function (v) {
    var cost = (v.materials + v.minutes / 60 * v.hourly + v.packaging) * (1 + v.overhead / 100);
    var wholesale = cost * v.markup, retail = wholesale * 2;
    var profit = retail * (1 - v.fees / 100) - cost;
    var nodes = [C.stats([
      ["Cost per item", C.money(cost)],
      ["Wholesale price", C.money(wholesale)],
      ["Retail price", C.money(retail)],
      ["Profit per retail sale", C.money(profit)]
    ])];
    nodes.push(C.el("p", { class: "note", text: "Cost = (materials + labor + packaging) × (1 + overhead). Retail = wholesale × 2. Your labor is already paid inside the cost, so profit is on top of your wage." }));
    return nodes;
  });
})();
