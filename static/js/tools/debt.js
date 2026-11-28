/* Debt snowball / avalanche calculator. The simulate() algorithm matches the spreadsheet
   (assetforge/generators/xlsx_debt.py) and is tested against the same reference in tests/. */
(function (global) {
  "use strict";

  function simulate(debts, method, extra, maxMonths) {
    maxMonths = maxMonths || 600;
    var list = debts.filter(function (d) { return d.balance > 0; }).map(function (d, i) {
      return { name: d.name || "Debt " + (i + 1), bal: d.balance, apr: d.apr / 100, min: d.min, row: i };
    });
    list.sort(function (a, b) {
      var ka = method === "Avalanche" ? -a.apr : a.bal, kb = method === "Avalanche" ? -b.apr : b.bal;
      return ka - kb || a.row - b.row;
    });
    var budget = list.reduce(function (s, d) { return s + d.min; }, 0) + extra;
    var interest = 0, paidOff = {}, months = null;
    for (var t = 1; t <= maxMonths; t++) {
      var dues = list.map(function (d) { return Math.round(d.bal * (1 + d.apr / 12) * 100) / 100; });
      interest += dues.reduce(function (s, x) { return s + x; }, 0) - list.reduce(function (s, d) { return s + d.bal; }, 0);
      var mins = list.map(function (d, i) { return Math.min(dues[i], d.min); });
      var left = Math.max(0, budget - mins.reduce(function (s, x) { return s + x; }, 0));
      list.forEach(function (d, i) {
        var ex = Math.max(0, Math.min(dues[i] - mins[i], left));
        left -= ex;
        d.bal = dues[i] - mins[i] - ex;
        if (d.bal <= 0.005 && !(d.name in paidOff)) paidOff[d.name] = t;
      });
      if (list.every(function (d) { return d.bal <= 0.005; })) { months = t; break; }
    }
    return { months: months, interest: Math.round(interest * 100) / 100, order: list.map(function (d) { return d.name; }), paidOff: paidOff, budget: budget };
  }

  if (typeof module !== "undefined" && module.exports) { module.exports = { simulate: simulate }; return; }
  if (!global.Calc || !global.Calc.root) return;

  var C = global.Calc, el = C.el;
  var rows = el("div", { class: "rows" });
  var settings = el("div", { class: "fields" });
  var out = el("div", {});
  var defaults = [["Credit card", 3200, 22.9, 95], ["Car loan", 8900, 6.9, 245], ["Store card", 650, 26.9, 35]];

  function addRow(d) {
    d = d || ["", "", "", ""];
    var remove = el("button", { class: "link", type: "button", text: "Remove", onclick: function () { row.remove(); run(); } });
    var row = el("div", { class: "row" }, [
      el("label", {}, ["Debt name", el("input", { type: "text", value: d[0], oninput: run, "data-k": "name" })]),
      el("label", {}, ["Balance", el("input", { type: "number", min: "0", step: "any", value: d[1], oninput: run, "data-k": "balance" })]),
      el("label", {}, ["APR %", el("input", { type: "number", min: "0", step: "any", value: d[2], oninput: run, "data-k": "apr" })]),
      el("label", {}, ["Min. payment", el("input", { type: "number", min: "0", step: "any", value: d[3], oninput: run, "data-k": "min" })]),
      remove
    ]);
    rows.appendChild(row);
  }

  settings.appendChild(C.input({ key: "method", label: "Method", value: "Snowball", options: ["Snowball", "Avalanche"] }, run));
  settings.appendChild(C.input({ key: "extra", label: "Extra payment / month", value: 100 }, run));

  function read() {
    return Array.prototype.map.call(rows.querySelectorAll(".row"), function (r) {
      var g = function (k) { return r.querySelector("[data-k='" + k + "']").value; };
      return { name: g("name"), balance: C.num(g("balance")), apr: C.num(g("apr")), min: C.num(g("min")) };
    });
  }

  function run() {
    var debts = read();
    var method = settings.querySelector("[name=method]").value;
    var extra = C.num(settings.querySelector("[name=extra]").value);
    out.textContent = "";
    if (!debts.some(function (d) { return d.balance > 0; })) { out.appendChild(el("p", { class: "note", text: "Add at least one debt with a balance." })); return; }
    var r = simulate(debts, method, extra, 600);
    var other = simulate(debts, method === "Snowball" ? "Avalanche" : "Snowball", extra, 600);
    var date = r.months ? new Date(new Date().getFullYear(), new Date().getMonth() + r.months, 1)
      .toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Not within 50 years";
    out.appendChild(C.stats([
      ["Debt-free", date],
      ["Months to go", r.months ? String(r.months) : "-"],
      ["Total interest", C.money(r.interest)],
      ["Monthly budget", C.money(r.budget)]
    ]));
    if (!r.months) out.appendChild(el("p", { class: "warn", text: "Your payments don't cover the interest. Increase the extra payment." }));
    out.appendChild(C.table(["Payoff order", "Paid off in month"], r.order.map(function (n, i) { return [(i + 1) + ". " + n, r.paidOff[n] || "-"]; })));
    if (other.months && r.months) {
      var diff = other.interest - r.interest, name = method === "Snowball" ? "Avalanche" : "Snowball";
      var text = Math.abs(diff) < 0.01 && other.months === r.months
        ? name + " gives the same result for these debts."
        : name + " would take " + other.months + " months and " +
          (diff > 0 ? "cost " + C.money(diff) + " more" : "save " + C.money(-diff)) + " in interest.";
      out.appendChild(el("p", { class: "note", text: text }));
    }
  }

  C.root.textContent = "";
  C.root.appendChild(settings);
  C.root.appendChild(el("h3", { text: "Your debts" }));
  C.root.appendChild(rows);
  C.root.appendChild(el("button", { class: "link", type: "button", text: "+ Add another debt", onclick: function () { addRow(); } }));
  C.root.appendChild(out);
  defaults.forEach(addRow);
  run();
})(typeof window !== "undefined" ? window : globalThis);
