(function () {
  "use strict";
  var C = window.Calc;
  C.mount([
    { key: "income", label: "Target take-home per year", value: 60000 },
    { key: "costs", label: "Business costs per year", value: 6000 },
    { key: "tax", label: "Estimated tax %", value: 25 },
    { key: "weeks", label: "Working weeks per year", value: 46, step: "1" },
    { key: "hours", label: "Working hours per week", value: 40 },
    { key: "billable", label: "Billable share of hours %", value: 60 }
  ], function (v) {
    var taxRate = Math.min(95, v.tax) / 100;
    var gross = v.income / (1 - taxRate) + v.costs;
    var billableHours = v.weeks * v.hours * v.billable / 100;
    if (billableHours <= 0) return [C.el("p", { class: "warn", text: "Enter working weeks, hours and billable share above zero." })];
    var rate = gross / billableHours;
    return [C.stats([
      ["Minimum hourly rate", C.money(rate)],
      ["Day rate (8h billable)", C.money0(rate * 8)],
      ["Revenue needed per year", C.money0(gross)],
      ["Billable hours per year", Math.round(billableHours).toLocaleString("en-US")]
    ]), C.el("p", { class: "note", text: "Revenue needed = take-home ÷ (1 − tax rate) + costs. Tax is a rough estimate; check your local rules." })];
  });
})();
