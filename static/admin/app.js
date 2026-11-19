/* Sumivo admin panel: edits the private source repository through the GitHub API.
   Every save is a commit; the deploy workflow then validates, rebuilds and publishes the site.
   All rendering uses textContent (never innerHTML with repository or user data), except the
   Markdown preview, which escapes everything before converting a small safe subset. */
(function () {
  "use strict";
  var CFG = JSON.parse(document.getElementById("admin-config").textContent);
  var app = document.getElementById("app");
  var gh = null;
  var cache = {};
  var DUMP = { lineWidth: 110, noRefs: true, quotingType: '"', sortKeys: false };
  var STATUSES = ["draft", "ready", "live", "retired"];
  var GENERATORS = ["xlsx_tracker", "pdf_planner", "bundle", "xlsx_budget", "xlsx_debt"];
  var HEADERS = {
    "catalog/products.yaml": "# AssetForge product catalog: the single source of truth.\n# status: draft -> ready (built + QA passed) -> live (has a buy URL) -> retired\n# Edited by the admin panel and by the automation workflows.\n",
    "catalog/backlog.yaml": "# Product idea backlog. The weekly 'generate' workflow promotes the first\n# idea with done: false into catalog/products.yaml as a draft.\n",
    tools: "# Declarative calculators (edited with the admin panel). Inputs -> vars -> outputs.\n# Percent outputs are fractions (0.25 -> 25%). `checks` are independently known answers.\n",
    "site/config.yaml": "# Site settings (edited with the admin panel or by hand).\n"
  };

  // ------------------------------------------------------------------ helpers
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function toast(msg, kind) {
    var t = el("div", { class: "toast " + (kind || "ok"), text: msg, role: "status" });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === "error" ? 9000 : 4500);
  }
  function busy(on) { document.body.classList.toggle("busy", !!on); }
  function fail(e) {
    busy(false);
    var msg = e && e.message ? e.message : String(e);
    if (e && e.status === 409) msg = "Someone (or the automation) changed this file since you opened it. Reload and try again.";
    if (e && e.status === 401) { msg = "Your token was rejected. Sign in again."; GH.clearSession(); }
    toast(msg, "error");
    console.error(e);
  }
  function go(hash) { location.hash = hash; }
  function field(label, control, hint) {
    return el("label", { class: "field" }, [el("span", { text: label }), control, hint ? el("small", { text: hint }) : null]);
  }
  function input(value, attrs) { return el("input", Object.assign({ type: "text", value: value == null ? "" : String(value) }, attrs || {})); }
  function textarea(value, attrs) { var t = el("textarea", attrs || {}); t.value = value == null ? "" : String(value); return t; }
  function select(options, value, attrs) {
    return el("select", attrs || {}, options.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, label = Array.isArray(o) ? o[1] : o;
      var opt = el("option", { value: v, text: label });
      if (String(v) === String(value)) opt.selected = true;
      return opt;
    }));
  }
  function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function dumpYaml(path, doc) {
    var header = HEADERS[path] || (path.indexOf("site/tools") === 0 ? HEADERS.tools : "");
    return header + jsyaml.dump(doc, DUMP);
  }
  function save(path, doc, sha, message) {
    busy(true);
    return gh.putText(path, dumpYaml(path, doc), message, sha).then(function (res) {
      busy(false);
      toast("Saved. The site rebuilds and publishes in about 2–3 minutes.");
      return res.content.sha;
    });
  }
  function counter(inputEl, min, max) {
    var c = el("small", { class: "count" });
    function upd() { var n = inputEl.value.length; c.textContent = n + " characters (aim for " + min + "–" + max + ")"; c.className = "count" + (n < min || n > max ? " bad" : ""); }
    inputEl.addEventListener("input", upd); upd();
    return c;
  }
  function rowsEditor(title, columns, rows, onChange, opts) {
    // columns: [{key, label, type: text|number|select|textarea, options, width}]
    opts = opts || {};
    var wrap = el("div", { class: "rows-editor" }), body = el("div", {});
    function render() {
      clear(body);
      rows.forEach(function (row, idx) {
        var line = el("div", { class: "row-line" });
        columns.forEach(function (c) {
          var ctl;
          if (c.type === "select") ctl = select(c.options, row[c.key]);
          else if (c.type === "textarea") ctl = textarea(row[c.key], { rows: 2 });
          else ctl = input(row[c.key], { type: c.type === "number" ? "text" : "text", inputmode: c.type === "number" ? "decimal" : undefined });
          ctl.setAttribute("aria-label", c.label);
          ctl.placeholder = c.label;
          if (c.width) ctl.style.flex = c.width;
          ctl.addEventListener("input", function () { row[c.key] = ctl.value; onChange(); });
          ctl.addEventListener("change", function () { row[c.key] = ctl.value; onChange(); });
          line.appendChild(ctl);
        });
        line.appendChild(el("button", { type: "button", class: "icon", title: "Move up", text: "↑", onclick: function () {
          if (idx > 0) { rows.splice(idx - 1, 0, rows.splice(idx, 1)[0]); render(); onChange(); } } }));
        line.appendChild(el("button", { type: "button", class: "icon danger", title: "Remove", text: "✕", onclick: function () {
          rows.splice(idx, 1); render(); onChange(); } }));
        body.appendChild(line);
      });
    }
    wrap.appendChild(el("div", { class: "rows-head" }, [el("strong", { text: title }),
      el("button", { type: "button", class: "small", text: "+ Add", onclick: function () {
        var blank = {}; columns.forEach(function (c) { blank[c.key] = c.type === "select" ? c.options[0] : ""; });
        rows.push(blank); render(); onChange(); } })]));
    if (opts.hint) wrap.appendChild(el("small", { text: opts.hint }));
    wrap.appendChild(body);
    render();
    return wrap;
  }
  function errorList(errors) {
    if (!errors.length) return el("p", { class: "ok-msg", text: "✓ No problems found." });
    return el("ul", { class: "errors" }, errors.map(function (e) { return el("li", { text: e }); }));
  }

  // ------------------------------------------------------------------ data
  function loadTools(force) {
    if (cache.tools && !force) return Promise.resolve(cache.tools);
    return gh.list("site/tools").then(function (entries) {
      var paths = ["site/tools.yaml"].concat(entries.filter(function (e) { return /\.ya?ml$/.test(e.name); }).map(function (e) { return e.path; }));
      return Promise.all(paths.map(function (p) { return gh.getOptional(p); }));
    }).then(function (files) {
      var data = { files: {}, tools: [] };
      files.forEach(function (f) {
        if (!f) return;
        var doc = jsyaml.load(f.text) || {};
        doc.tools = doc.tools || [];
        data.files[f.path] = { sha: f.sha, doc: doc };
        var script = f.path === "site/tools.yaml";
        doc.tools.forEach(function (t, i) {
          data.tools.push({ path: f.path, index: i, kind: script ? "script" : "expr",
            niche: t.niche || (doc.defaults && doc.defaults.niche) || "", tool: t });
        });
      });
      cache.tools = data;
      return data;
    });
  }
  function loadYaml(path, key, force) {
    if (cache[path] && !force) return Promise.resolve(cache[path]);
    return gh.get(path).then(function (f) {
      var doc = jsyaml.load(f.text) || {};
      if (key) doc[key] = doc[key] || [];
      cache[path] = { sha: f.sha, doc: doc };
      return cache[path];
    });
  }
  function invalidate() { cache = {}; }

  // ------------------------------------------------------------------ layout
  function shell(active, content) {
    clear(app);
    var nav = [["#/dashboard", "Dashboard"], ["#/tools", "Tools"], ["#/products", "Products"], ["#/backlog", "Backlog"],
      ["#/pages", "Pages"], ["#/files", "Files"], ["#/settings", "Settings"]];
    app.appendChild(el("div", { class: "layout" }, [
      el("aside", { class: "side" }, [
        el("div", { class: "logo", text: CFG.site_name + " admin" }),
        el("nav", {}, nav.map(function (n) { return el("a", { href: n[0], class: n[1] === active ? "active" : "", text: n[1] }); })),
        el("div", { class: "side-foot" }, [
          el("a", { href: CFG.site_url + "/", target: "_blank", rel: "noopener", text: "View site ↗" }),
          el("button", { type: "button", class: "link", text: "Sign out", onclick: function () { GH.clearSession(); gh = null; invalidate(); go("#/login"); route(); } })
        ])
      ]),
      el("main", { class: "main" }, [content])
    ]));
  }

  // ------------------------------------------------------------------ login
  var LOGIN_FILE = "site/admin_login.json";

  // Check a token against the repo, then start the session.
  function startSession(cfg, remember) {
    var client = new GH.Client(cfg);
    busy(true);
    return client.repoInfo().then(function (info) {
      busy(false);
      if (!info.permissions || !info.permissions.push) throw new Error("This token can read the repository but not write to it. Give it Contents: Read and write.");
      GH.saveSession(cfg, remember);
      gh = client;
      go("#/dashboard");
      route();
    });
  }

  function viewLogin(useToken) {
    clear(app);
    if (CFG.login && !useToken) return viewPasswordLogin();
    var repo = input(CFG.repo), branch = input(CFG.branch || "main"), token = input("", { type: "password", autocomplete: "off" });
    var remember = el("input", { type: "checkbox" });
    var form = el("form", { class: "card login", onsubmit: function (ev) {
      ev.preventDefault();
      startSession({ repo: repo.value.trim(), branch: branch.value.trim() || "main", token: token.value.trim() }, remember.checked).catch(fail);
    } }, [
      el("h1", { text: CFG.site_name + " admin" }),
      el("p", { class: "muted", text: "Sign in with a GitHub fine-grained access token. It stays in this browser and is only sent to api.github.com. After signing in you can set a username and password in Settings → Sign-in." }),
      field("Source repository", repo, "owner/name of the private repository"),
      field("Branch", branch),
      field("Access token", token),
      el("label", { class: "check" }, [remember, " Remember on this device"]),
      el("button", { type: "submit", class: "primary", text: "Sign in" }),
      CFG.login ? el("p", {}, [el("button", { type: "button", class: "link", text: "← Sign in with username and password", onclick: function () { viewLogin(false); } })]) : null,
      el("details", {}, [el("summary", { text: "How do I create a token?" }), el("ol", {}, [
        el("li", { text: "Open github.com/settings/personal-access-tokens/new (Settings → Developer settings → Fine-grained tokens → Generate new token)." }),
        el("li", { text: "Repository access: Only select repositories → " + CFG.repo + "." }),
        el("li", { text: "Permissions: Contents = Read and write, Actions = Read and write (Metadata is added automatically)." }),
        el("li", { text: "Choose an expiry (for example 90 days), generate, and paste it here." })
      ])])
    ]);
    app.appendChild(el("div", { class: "center" }, [form]));
  }

  function viewPasswordLogin() {
    var user = input("", { autocomplete: "username" }), pass = input("", { type: "password", autocomplete: "current-password" });
    var remember = el("input", { type: "checkbox" });
    var form = el("form", { class: "card login", onsubmit: function (ev) {
      ev.preventDefault();
      busy(true);
      GH.openLogin(CFG.login, user.value, pass.value).then(function (saved) {
        busy(false);
        return startSession({ repo: saved.repo || CFG.repo, branch: saved.branch || CFG.branch || "main", token: saved.token }, remember.checked)
          .catch(function (e) {
            if (e.status === 401) throw new Error("Your username and password are right, but the saved GitHub token has expired or was revoked. Sign in with a new token, then set the password again in Settings → Sign-in.");
            throw e;
          });
      }).catch(fail);
    } }, [
      el("h1", { text: CFG.site_name + " admin" }),
      field("Username", user),
      field("Password", pass),
      el("label", { class: "check" }, [remember, " Remember on this device"]),
      el("button", { type: "submit", class: "primary", text: "Sign in" }),
      el("p", {}, [el("button", { type: "button", class: "link", text: "Sign in with an access token instead", onclick: function () { viewLogin(true); } })])
    ]);
    app.appendChild(el("div", { class: "center" }, [form]));
  }

  function loginCard() {
    var user = input("", { autocomplete: "username" }), pass = input("", { type: "password", autocomplete: "new-password" }),
      pass2 = input("", { type: "password", autocomplete: "new-password" });
    function saveLogin() {
      var u = user.value.trim(), pw = pass.value;
      if (u.length < 3) return toast("Username: at least 3 characters.", "error");
      if (pw.length < 12) return toast("Password: at least 12 characters (the encrypted token is public, so a long password is what protects it).", "error");
      if (pw !== pass2.value) return toast("The two passwords don't match.", "error");
      if (pw.toLowerCase().indexOf(u.toLowerCase()) >= 0) return toast("The password must not contain the username.", "error");
      busy(true);
      Promise.all([GH.sealLogin(u, pw, { token: gh.token, repo: gh.repo, branch: gh.branch }), gh.getOptional(LOGIN_FILE)])
        .then(function (r) {
          return gh.putText(LOGIN_FILE, JSON.stringify(r[0], null, 1) + "\n", "admin: set username/password sign-in", r[1] && r[1].sha);
        }).then(function () {
          busy(false); pass.value = pass2.value = "";
          toast("Saved. Username and password sign-in works on any device once the site has redeployed (about 2–3 minutes).");
        }).catch(fail);
    }
    function removeLogin() {
      if (!confirm("Turn off username and password sign-in? You'll need the access token to sign in.")) return;
      busy(true);
      gh.getOptional(LOGIN_FILE).then(function (f) {
        if (!f) { busy(false); return toast("Password sign-in is not set up."); }
        return gh.remove(LOGIN_FILE, f.sha, "admin: remove username/password sign-in").then(function () { busy(false); toast("Password sign-in turned off (after the next deploy)."); });
      }).catch(fail);
    }
    return el("section", { class: "card" }, [
      el("h2", { text: "Sign-in" }),
      el("p", { class: "muted", text: (CFG.login ? "Username and password sign-in is ON. " : "Username and password sign-in is OFF. ") +
        "Setting it encrypts the access token you're signed in with (AES-256, key derived from your username and password) and publishes only the encrypted copy. " +
        "Use a long password you don't use anywhere else. When the token expires, sign in with a new token and set the password again." }),
      el("div", { class: "grid2" }, [field("Username", user), el("div"), field("Password (12+ characters)", pass), field("Repeat password", pass2)]),
      el("div", { class: "buttons" }, [
        el("button", { type: "button", class: "primary", text: CFG.login ? "Change username/password" : "Turn on username/password sign-in", onclick: saveLogin }),
        CFG.login ? el("button", { type: "button", text: "Turn off", onclick: removeLogin }) : null])
    ]);
  }

  // ------------------------------------------------------------------ dashboard
  function viewDashboard() {
    var stats = el("div", { class: "stats" }, [el("p", { class: "muted", text: "Loading…" })]);
    var runs = el("div", {}, [el("p", { class: "muted", text: "Loading workflow runs…" })]);
    function action(label, file, hint) {
      return el("div", { class: "action" }, [
        el("button", { type: "button", class: "primary", text: label, onclick: function () {
          busy(true);
          gh.dispatch(file).then(function () { busy(false); toast(label + ": started. Refresh the runs list in a few seconds."); setTimeout(loadRuns, 4000); }).catch(fail);
        } }), el("small", { text: hint })]);
    }
    function loadRuns() {
      gh.runs(10).then(function (list) {
        clear(runs);
        if (!list.length) { runs.appendChild(el("p", { class: "muted", text: "No workflow runs yet." })); return; }
        runs.appendChild(el("table", { class: "list" }, [
          el("thead", {}, [el("tr", {}, ["Workflow", "Result", "Started", ""].map(function (h) { return el("th", { text: h }); }))]),
          el("tbody", {}, list.map(function (r) {
            var result = r.status === "completed" ? r.conclusion : r.status;
            return el("tr", {}, [el("td", { text: r.name }), el("td", {}, [el("span", { class: "badge " + result, text: result })]),
              el("td", { text: new Date(r.created_at).toLocaleString() }),
              el("td", {}, [el("a", { href: r.html_url, target: "_blank", rel: "noopener", text: "Details ↗" })])]);
          }))
        ]));
      }).catch(function (e) { clear(runs); runs.appendChild(el("p", { class: "warn", text: "Couldn't load runs: " + e.message + " (the token needs Actions: Read)." })); });
    }
    shell("Dashboard", el("div", {}, [
      el("h1", { text: "Dashboard" }),
      stats,
      el("h2", { text: "Actions" }),
      el("div", { class: "actions" }, [
        action("Publish site now", "deploy.yml", "Rebuild and publish. Saving anything does this automatically."),
        action("Generate next product", "generate.yml", "Turn the next backlog idea into a product."),
        action("Sync stores", "sync.yml", "Put ready products on Instamojo and mark Gumroad uploads live."),
        action("Weekly report", "report.yml", "Write the report and open it as an issue.")
      ]),
      el("h2", {}, ["Recent workflow runs ", el("button", { type: "button", class: "small", text: "Refresh", onclick: loadRuns })]),
      runs
    ]));
    Promise.all([loadTools(), loadYaml("catalog/products.yaml", "products"), loadYaml("catalog/backlog.yaml", "ideas"), gh.list("site/content/pages")])
      .then(function (res) {
        var products = res[1].doc.products, ideas = res[2].doc.ideas;
        var by = {}; products.forEach(function (p) { by[p.status] = (by[p.status] || 0) + 1; });
        clear(stats);
        [["Tools", res[0].tools.length], ["Products live", by.live || 0], ["Ready to upload", by.ready || 0],
          ["Backlog ideas left", ideas.filter(function (i) { return !i.done; }).length], ["Pages", res[3].filter(function (f) { return /\.md$/.test(f.name); }).length]]
          .forEach(function (s) { stats.appendChild(el("div", { class: "stat" }, [el("b", { text: String(s[1]) }), el("span", { text: s[0] })])); });
      }).catch(fail);
    loadRuns();
  }

  // ------------------------------------------------------------------ tools
  function viewTools() {
    var q = input("", { type: "search", placeholder: "Search tools…" });
    var list = el("div", {});
    shell("Tools", el("div", {}, [
      el("div", { class: "title-row" }, [el("h1", { text: "Tools" }), el("a", { class: "button primary", href: "#/tools/new", text: "+ New tool" })]),
      q, list
    ]));
    loadTools().then(function (data) {
      function render() {
        var term = q.value.toLowerCase();
        clear(list);
        var items = data.tools.filter(function (t) {
          return !term || (t.tool.title + " " + t.tool.slug + " " + (t.tool.category || "") + " " + t.niche).toLowerCase().indexOf(term) >= 0;
        });
        list.appendChild(el("p", { class: "muted", text: items.length + " of " + data.tools.length + " tools" }));
        list.appendChild(el("table", { class: "list" }, [
          el("thead", {}, [el("tr", {}, ["Tool", "Niche", "Category", "Type", ""].map(function (h) { return el("th", { text: h }); }))]),
          el("tbody", {}, items.map(function (t) {
            return el("tr", {}, [el("td", {}, [el("a", { href: "#/tools/edit/" + t.tool.slug, text: t.tool.title })]),
              el("td", { text: CFG.niches[t.niche] || t.niche }), el("td", { text: t.tool.category || "" }),
              el("td", { text: t.kind === "script" ? "custom code" : "formula" }),
              el("td", {}, [el("a", { href: CFG.site_url + "/tools/" + t.tool.slug + "/", target: "_blank", rel: "noopener", text: "View ↗" })])]);
          }))
        ]));
      }
      q.addEventListener("input", render);
      render();
    }).catch(fail);
  }

  function choicesToText(choices) { return (choices || []).map(function (c) { return c[0] + "=" + c[1]; }).join("; "); }
  function textToChoices(text) {
    return String(text || "").split(";").map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var i = s.lastIndexOf("="); return [s.slice(0, i).trim(), Number(s.slice(i + 1))];
    });
  }
  function num(v) { return v === "" || v === undefined || v === null ? undefined : Number(v); }

  function viewToolEdit(slug, duplicateOf) {
    loadTools().then(function (data) {
      var entry = slug ? data.tools.filter(function (t) { return t.tool.slug === slug; })[0] : null;
      var source = entry || (duplicateOf ? data.tools.filter(function (t) { return t.tool.slug === duplicateOf; })[0] : null);
      if (slug && !entry) { shell("Tools", el("p", { text: "Tool not found." })); return; }
      var isNew = !entry;
      var kind = source ? source.kind : "expr";
      if (isNew) kind = "expr";
      var t = JSON.parse(JSON.stringify(source ? source.tool : {
        title: "", short: "", category: "", description: "", intro: "", formula: "",
        inputs: [{ key: "amount", label: "Amount", value: 100 }], vars: {}, outputs: [{ label: "Result", expr: "amount", format: "num" }],
        faq: [{ q: "", a: "" }] }));
      if (duplicateOf) { t.slug = t.slug + "-copy"; t.title = t.title + " (copy)"; delete t.checks; }
      var niche = source ? source.niche : Object.keys(CFG.niches)[0];
      var others = data.tools.filter(function (x) { return x !== entry; }).map(function (x) { return Object.assign({ kind: x.kind }, x.tool); });

      // form state
      var inputs = (t.inputs || []).map(function (i) { return { key: i.key, label: i.label, value: i.value, step: i.step || "", min: i.min == null ? "" : i.min, choices: choicesToText(i.choices) }; });
      var vars = Object.keys(t.vars || {}).map(function (k) { return { name: k, expr: String(t.vars[k]) }; });
      var outputs = (t.outputs || []).map(function (o) { return { label: o.label, expr: o.expr, format: o.format || "num" }; });
      var faq = (t.faq || []).map(function (f) { return { q: f.q, a: f.a }; });
      var f = {
        title: input(t.title), short: input(t.short), slug: input(t.slug, { readonly: !isNew }),
        niche: select(Object.keys(CFG.niches).map(function (k) { return [k, CFG.niches[k]]; }), niche),
        category: input(t.category, { list: "cats" }), related: select([["", "(none)"]].concat(CFG.products.map(function (p) { return [p.id, p.title]; })), t.related || ""),
        featured: el("input", { type: "checkbox", checked: !!t.featured }),
        description: textarea(t.description, { rows: 2 }), intro: textarea(t.intro, { rows: 3 }),
        formula: textarea(t.formula, { rows: 3 }), invalid: input(t.invalid),
        checks: textarea(t.checks ? jsyaml.dump(t.checks, DUMP) : "", { rows: 5, class: "mono", placeholder: "- inputs: {amount: 100}\n  outputs: {Result: 100}" })
      };
      f.title.addEventListener("input", function () { if (isNew) { f.slug.value = slugify(f.title.value); } });
      var cats = el("datalist", { id: "cats" }, Array.from(new Set(data.tools.map(function (x) { return x.tool.category; }).filter(Boolean))).sort().map(function (c) { return el("option", { value: c }); }));

      var preview = el("div", { class: "preview" });
      var timer;
      function collect() {
        var out = { slug: f.slug.value.trim(), title: f.title.value.trim(), short: f.short.value.trim(), category: f.category.value.trim() || undefined };
        if (kind === "script") { out = Object.assign({}, t, out); }
        out.description = f.description.value.trim();
        out.intro = f.intro.value.trim();
        if (f.related.value) out.related = f.related.value; else delete out.related;
        if (kind === "script") { out.featured = f.featured.checked || undefined; }
        if (kind === "expr") {
          out.inputs = inputs.map(function (i) {
            var o = { key: String(i.key).trim(), label: String(i.label).trim(), value: num(i.value) };
            if (i.step !== "" && i.step !== undefined) o.step = String(i.step);
            if (i.min !== "" && i.min !== undefined) o.min = num(i.min);
            var ch = textToChoices(i.choices); if (ch.length) o.choices = ch;
            return o;
          });
          out.vars = {};
          vars.forEach(function (v) { if (String(v.name).trim()) out.vars[String(v.name).trim()] = String(v.expr).trim(); });
          if (!Object.keys(out.vars).length) delete out.vars;
          out.outputs = outputs.map(function (o) { return { label: String(o.label).trim(), expr: String(o.expr).trim(), format: o.format || "num" }; });
          out.formula = f.formula.value.trim();
          if (f.invalid.value.trim()) out.invalid = f.invalid.value.trim();
          if (f.checks.value.trim()) out.checks = jsyaml.load(f.checks.value);
        }
        out.faq = faq.map(function (x) { return { q: String(x.q).trim(), a: String(x.a).trim() }; });
        Object.keys(out).forEach(function (k) { if (out[k] === undefined || out[k] === "") delete out[k]; });
        return out;
      }
      function refresh() {
        clearTimeout(timer);
        timer = setTimeout(function () {
          clear(preview);
          var tool, res;
          try { tool = collect(); } catch (e) { preview.appendChild(errorList(["Checks are not valid YAML: " + e.message])); return; }
          res = ToolValidate.validateTool(Object.assign({ kind: kind }, tool), others);
          preview.appendChild(el("h3", { text: "Validation" }));
          preview.appendChild(errorList(res.errors));
          if (res.results) {
            preview.appendChild(el("h3", { text: "Result with default inputs" }));
            preview.appendChild(el("table", { class: "list" }, [el("tbody", {}, tool.outputs.map(function (o, i) {
              return el("tr", {}, [el("td", { text: o.label }), el("td", { text: String(Math.round(res.results[i] * 10000) / 10000) + "  (" + o.format + ")" })]);
            }))]));
          }
        }, 250);
      }
      Object.keys(f).forEach(function (k) { f[k].addEventListener("input", refresh); f[k].addEventListener("change", refresh); });

      function persist() {
        var tool;
        try { tool = collect(); } catch (e) { toast("Checks are not valid YAML: " + e.message, "error"); return; }
        var res = ToolValidate.validateTool(Object.assign({ kind: kind }, tool), others);
        if (res.errors.length) { toast("Fix the problems listed under Validation first.", "error"); return; }
        var targetNiche = f.niche.value;
        var targetPath = kind === "script" ? "site/tools.yaml" : null;
        if (!targetPath) {
          Object.keys(data.files).forEach(function (p) {
            var d = data.files[p].doc.defaults; if (!targetPath && p !== "site/tools.yaml" && d && d.niche === targetNiche) targetPath = p;
          });
          targetPath = targetPath || "site/tools/" + targetNiche + ".yaml";
        }
        var targetDoc = data.files[targetPath] ? data.files[targetPath].doc : { defaults: { niche: targetNiche }, tools: [] };
        var fileDefaultNiche = targetDoc.defaults && targetDoc.defaults.niche;
        if (kind === "script" || fileDefaultNiche !== targetNiche) tool.niche = targetNiche; else delete tool.niche;
        var steps = Promise.resolve();
        if (entry && entry.path !== targetPath) {
          // moving between files: remove from the old one first
          var old = data.files[entry.path];
          old.doc.tools.splice(entry.index, 1);
          steps = steps.then(function () { return save(entry.path, old.doc, old.sha, "admin: move tool " + tool.slug); });
          targetDoc.tools.push(tool);
        } else if (entry) {
          targetDoc.tools[entry.index] = tool;
        } else {
          targetDoc.tools.push(tool);
        }
        var sha = data.files[targetPath] ? data.files[targetPath].sha : undefined;
        steps.then(function () { return save(targetPath, targetDoc, sha, "admin: " + (isNew ? "add" : "update") + " tool " + tool.slug); })
          .then(function () { invalidate(); go("#/tools/edit/" + tool.slug); route(); }).catch(fail);
      }
      function remove() {
        if (!confirm("Delete the tool '" + t.title + "'? Its page will disappear from the site.")) return;
        var file = data.files[entry.path];
        file.doc.tools.splice(entry.index, 1);
        save(entry.path, file.doc, file.sha, "admin: delete tool " + t.slug).then(function () { invalidate(); go("#/tools"); route(); }).catch(fail);
      }

      var basics = el("section", { class: "card" }, [
        el("h2", { text: "Basics" }),
        el("div", { class: "grid2" }, [field("Title", f.title), field("Short name (cards)", f.short), field("Slug (page address)", f.slug, isNew ? "Set automatically from the title" : "Can't be changed after creation"),
          field("Niche", f.niche), field("Category", f.category), field("Related product", f.related)]),
        kind === "script" ? el("label", { class: "check" }, [f.featured, " Featured on the home page"]) : null,
        field("Meta description", f.description), counter(f.description, 50, 165),
        field("Introduction", f.intro)
      ]);
      var logic = kind === "script" ? el("section", { class: "card" }, [el("p", { class: "muted", text: "This tool's calculator is custom code (" + t.script + "). You can edit its text and FAQ here; changing the calculation needs a developer." })]) :
        el("section", { class: "card" }, [
          el("h2", { text: "Calculator" }),
          rowsEditor("Inputs", [{ key: "key", label: "key", width: "1" }, { key: "label", label: "Label", width: "3" }, { key: "value", label: "Default", type: "number", width: "1" },
            { key: "step", label: "Step", width: "0.7" }, { key: "min", label: "Min", width: "0.7" }, { key: "choices", label: "Choices: Label=value; …", width: "3" }], inputs, refresh,
            { hint: "Keys are short names used in formulas (letters, digits, _). Leave Choices empty for a number box." }),
          rowsEditor("Variables (worked out in order)", [{ key: "name", label: "name", width: "1" }, { key: "expr", label: "formula", width: "5" }], vars, refresh,
            { hint: "Use + − * / ^, parentheses and if(c,a,b), min, max, round, floor, ceil, abs, sqrt, ln, log10, pow, exp. Divide by zero → no result." }),
          rowsEditor("Outputs", [{ key: "label", label: "Label", width: "3" }, { key: "expr", label: "formula", width: "4" },
            { key: "format", label: "format", type: "select", options: ToolValidate.FORMATS, width: "1" }], outputs, refresh,
            { hint: "Percent formats expect a fraction (0.25 shows as 25%)." }),
          field("How it's calculated (shown on the page)", f.formula),
          field("Message when results can't be calculated (optional)", f.invalid),
          field("Known-answer checks (YAML, recommended)", f.checks, "Independently known results; saving is blocked if a check fails.")
        ]);
      var faqs = el("section", { class: "card" }, [rowsEditor("FAQ", [{ key: "q", label: "Question", width: "2" }, { key: "a", label: "Answer", type: "textarea", width: "4" }], faq, refresh)]);
      shell("Tools", el("div", {}, [
        cats,
        el("div", { class: "title-row" }, [el("h1", { text: isNew ? "New tool" : t.title }), el("a", { href: "#/tools", text: "← All tools" })]),
        el("div", { class: "editor" }, [
          el("div", { class: "editor-main" }, [basics, logic, faqs]),
          el("div", { class: "editor-side" }, [el("div", { class: "card sticky" }, [preview,
            el("div", { class: "buttons" }, [
              el("button", { type: "button", class: "primary", text: isNew ? "Create tool" : "Save changes", onclick: persist }),
              !isNew && kind === "expr" ? el("a", { class: "button", href: "#/tools/duplicate/" + t.slug, text: "Duplicate" }) : null,
              !isNew ? el("button", { type: "button", class: "danger", text: "Delete", onclick: remove }) : null
            ])])])
        ])
      ]));
      refresh();
    }).catch(fail);
  }

  // ------------------------------------------------------------------ products & backlog
  function productForm(item, opts) {
    var f = {
      id: input(item.id, { readonly: !opts.isNew }), title: input(item.title), price: input(item.price, { inputmode: "decimal" }),
      price_inr: input(item.price_inr, { inputmode: "numeric", placeholder: "auto" }),
      niche: select(Object.keys(CFG.niches).map(function (k) { return [k, CFG.niches[k]]; }), item.niche),
      status: select(STATUSES, item.status || "draft"), generator: select(GENERATORS, item.generator || "xlsx_tracker", { disabled: !opts.isNew }),
      summary: textarea(item.summary, { rows: 2 }), description: textarea(item.description, { rows: 4 }),
      features: textarea((item.features || []).join("\n"), { rows: 5 }), tags: input((item.tags || []).join(", ")),
      gumroad_url: input(item.gumroad_url, { type: "url" }), instamojo_url: input(item.instamojo_url, { type: "url" }),
      kofi_url: input(item.kofi_url, { type: "url" }),
      params: textarea(item.params ? jsyaml.dump(item.params, DUMP) : "", { rows: 14, class: "mono" }),
      done: el("input", { type: "checkbox", checked: !!item.done })
    };
    f.title.addEventListener("input", function () { if (opts.isNew) f.id.value = slugify(f.title.value); });
    var node = el("div", {}, [
      el("section", { class: "card" }, [el("div", { class: "grid2" }, [
        field("Title", f.title), field("ID (URL slug, also the Gumroad custom URL)", f.id),
        field("Niche", f.niche), field("Price (USD)", f.price),
        field("Price (INR, optional)", f.price_inr, "Leave empty for automatic: about Rs 50 per dollar, ending in 49/99 ($9 = Rs 449)."),
        opts.backlog ? null : field("Status", f.status), field("Generator", f.generator)]),
        opts.backlog ? el("label", { class: "check" }, [f.done, " Already promoted (done)"]) : null,
        field("Summary", f.summary), counter(f.summary, 50, 220),
        field("Description (optional; generated if empty)", f.description),
        field("Features (one per line, at least 3)", f.features),
        field("Tags (comma separated, at least 3)", f.tags)]),
      opts.backlog ? null : el("section", { class: "card" }, [el("h2", { text: "Store links" }),
        field("Gumroad URL (USD)", f.gumroad_url, "Filled automatically by the sync workflow once uploaded with the matching URL slug."),
        field("Instamojo URL (INR)", f.instamojo_url, "Filled automatically: the sync workflow creates the Instamojo product for every ready product."),
        field("Ko-fi URL (optional)", f.kofi_url)]),
      el("section", { class: "card" }, [el("h2", { text: "Generator settings (advanced)" }),
        el("p", { class: "muted", text: "YAML settings for the generator: columns, formulas, layouts, accent colour… Copy an existing product as a model." }),
        f.params])
    ]);
    function read() {
      var out = {};
      out.id = f.id.value.trim(); out.niche = f.niche.value; out.title = f.title.value.trim(); out.price = Number(f.price.value);
      if (f.price_inr.value.trim()) out.price_inr = Number(f.price_inr.value);
      out.generator = f.generator.value;
      if (!opts.backlog) out.status = f.status.value;
      out.summary = f.summary.value.trim();
      if (f.description.value.trim()) out.description = f.description.value.trim();
      out.features = f.features.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      out.tags = f.tags.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!opts.backlog) {
        if (f.gumroad_url.value.trim()) out.gumroad_url = f.gumroad_url.value.trim();
        if (f.instamojo_url.value.trim()) out.instamojo_url = f.instamojo_url.value.trim();
        if (f.kofi_url.value.trim()) out.kofi_url = f.kofi_url.value.trim();
      }
      out.params = f.params.value.trim() ? jsyaml.load(f.params.value) : {};
      if (opts.backlog) out.done = f.done.checked;
      ["added", "sources", "done_on"].forEach(function (k) { if (item[k] !== undefined) out[k] = item[k]; });
      return out;
    }
    function check(p, all) {
      var e = [];
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id || "")) e.push("ID must be lowercase words joined by hyphens.");
      if (all.some(function (o) { return o !== item && o.id === p.id; })) e.push("Another item already uses this ID.");
      if (!(p.title.length >= 15 && p.title.length <= 70)) e.push("Title should be 15–70 characters.");
      if (!(p.summary.length >= 50 && p.summary.length <= 220)) e.push("Summary should be 50–220 characters.");
      if (!(p.price >= 1 && p.price <= 99)) e.push("Price must be between 1 and 99.");
      if (p.price < 6) e.push("Policy: nothing under $6 (fixed store fees eat small prices).");
      if (p.features.length < 3) e.push("Add at least 3 features.");
      if (p.tags.length < 3) e.push("Add at least 3 tags.");
      if (p.price_inr !== undefined && !(Number.isInteger(p.price_inr) && p.price_inr >= 10 && p.price_inr <= 9999)) e.push("INR price must be a whole number of rupees, 10–9999.");
      if (p.status === "live" && !p.gumroad_url && !p.instamojo_url && !p.kofi_url) e.push("Live products need a Gumroad, Instamojo or Ko-fi URL.");
      ["gumroad_url", "instamojo_url", "kofi_url"].forEach(function (k) { if (p[k] && p[k].indexOf("https://") !== 0) e.push(k + " must start with https://"); });
      return e;
    }
    return { node: node, read: read, check: check };
  }

  function viewCatalog(kind) {
    var path = kind === "backlog" ? "catalog/backlog.yaml" : "catalog/products.yaml";
    var key = kind === "backlog" ? "ideas" : "products";
    var body = el("div", {}, [el("p", { class: "muted", text: "Loading…" })]);
    shell(kind === "backlog" ? "Backlog" : "Products", el("div", {}, [
      el("div", { class: "title-row" }, [el("h1", { text: kind === "backlog" ? "Backlog" : "Products" }),
        el("a", { class: "button primary", href: "#/" + kind + "/new", text: kind === "backlog" ? "+ New idea" : "+ New product" })]),
      kind === "backlog" ? el("p", { class: "muted", text: "The weekly workflow turns the first idea that isn't done into a product. Reorder to set priority." }) :
        el("p", { class: "muted", text: "Set status to 'retired' to hide a product from the site without deleting it." }),
      body]));
    loadYaml(path, key).then(function (file) {
      var items = file.doc[key];
      clear(body);
      body.appendChild(el("table", { class: "list" }, [
        el("thead", {}, [el("tr", {}, (kind === "backlog" ? ["#", "Idea", "Niche", "Price", "Done", ""] : ["Product", "Niche", "Price", "Status", ""]).map(function (h) { return el("th", { text: h }); }))]),
        el("tbody", {}, items.map(function (p, i) {
          var cells = kind === "backlog" ?
            [el("td", { text: String(i + 1) }), el("td", {}, [el("a", { href: "#/backlog/edit/" + p.id, text: p.title })]), el("td", { text: CFG.niches[p.niche] || p.niche }),
              el("td", { text: "$" + p.price }), el("td", { text: p.done ? "✓ " + (p.done_on || "") : "" }),
              el("td", {}, [el("button", { type: "button", class: "icon", title: "Move up", text: "↑", onclick: function () { move(i, -1); } }),
                el("button", { type: "button", class: "icon", title: "Move down", text: "↓", onclick: function () { move(i, 1); } })])] :
            [el("td", {}, [el("a", { href: "#/products/edit/" + p.id, text: p.title })]), el("td", { text: CFG.niches[p.niche] || p.niche }),
              el("td", { text: "$" + p.price }), el("td", {}, [el("span", { class: "badge " + p.status, text: p.status })]),
              el("td", {}, [p.status === "ready" || p.status === "live" ? el("a", { href: CFG.site_url + "/products/" + p.id + "/", target: "_blank", rel: "noopener", text: "View ↗" }) : null])];
          return el("tr", {}, cells);
        }))
      ]));
      function move(i, d) {
        var j = i + d; if (j < 0 || j >= items.length) return;
        items.splice(j, 0, items.splice(i, 1)[0]);
        save(path, file.doc, file.sha, "admin: reorder backlog").then(function () { invalidate(); route(); }).catch(fail);
      }
    }).catch(fail);
  }

  function viewCatalogEdit(kind, id) {
    var path = kind === "backlog" ? "catalog/backlog.yaml" : "catalog/products.yaml";
    var key = kind === "backlog" ? "ideas" : "products";
    loadYaml(path, key).then(function (file) {
      var items = file.doc[key];
      var item = id ? items.filter(function (p) { return p.id === id; })[0] : null;
      if (id && !item) { shell("Products", el("p", { text: "Not found." })); return; }
      var isNew = !item;
      item = item || { id: "", title: "", niche: Object.keys(CFG.niches)[0], price: 7, generator: "xlsx_tracker", status: "draft", features: [], tags: [], params: {} };
      var form = productForm(item, { isNew: isNew, backlog: kind === "backlog" });
      var problems = el("div", {});
      function persist() {
        var p;
        try { p = form.read(); } catch (e) { toast("Generator settings are not valid YAML: " + e.message, "error"); return; }
        var errs = form.check(p, items);
        clear(problems).appendChild(errorList(errs));
        if (errs.length) { toast("Fix the problems listed first.", "error"); return; }
        if (isNew) { if (!p.added) p.added = new Date().toISOString().slice(0, 10); items.push(p); }
        else items[items.indexOf(item)] = p;
        save(path, file.doc, file.sha, "admin: " + (isNew ? "add" : "update") + " " + (kind === "backlog" ? "idea " : "product ") + p.id)
          .then(function () { invalidate(); go("#/" + kind + "/edit/" + p.id); route(); }).catch(fail);
      }
      function remove() {
        var msg = kind === "backlog" ? "Delete this idea?" : "Delete this product completely? (Tip: set status to 'retired' to hide it instead.)";
        if (!confirm(msg)) return;
        items.splice(items.indexOf(item), 1);
        save(path, file.doc, file.sha, "admin: delete " + item.id).then(function () { invalidate(); go("#/" + kind); route(); }).catch(fail);
      }
      shell(kind === "backlog" ? "Backlog" : "Products", el("div", {}, [
        el("div", { class: "title-row" }, [el("h1", { text: isNew ? (kind === "backlog" ? "New idea" : "New product") : item.title }), el("a", { href: "#/" + kind, text: "← Back" })]),
        isNew && kind !== "backlog" ? el("p", { class: "warn", text: "Tip: new products are usually best added as backlog ideas, so the weekly workflow builds and checks them." }) : null,
        form.node, problems,
        el("div", { class: "buttons" }, [el("button", { type: "button", class: "primary", text: "Save", onclick: persist }),
          !isNew ? el("button", { type: "button", class: "danger", text: "Delete", onclick: remove }) : null])
      ]));
    }).catch(fail);
  }

  // ------------------------------------------------------------------ pages
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function miniMarkdown(md) {
    // Escape first, then convert a small subset. Used only for the editor preview.
    var lines = escapeHtml(md).split("\n"), out = [], inList = false, para = [];
    function inline(s) {
      return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]*)\)/g, '<a href="$2" rel="noopener">$1</a>');
    }
    function flush() { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } }
    lines.forEach(function (l) {
      var h = /^(#{1,3})\s+(.*)$/.exec(l), li = /^[-*]\s+(.*)$/.exec(l);
      if (h) { flush(); if (inList) { out.push("</ul>"); inList = false; } out.push("<h" + (h[1].length + 1) + ">" + inline(h[2]) + "</h" + (h[1].length + 1) + ">"); }
      else if (li) { flush(); if (!inList) { out.push("<ul>"); inList = true; } out.push("<li>" + inline(li[1]) + "</li>"); }
      else if (!l.trim()) { flush(); if (inList) { out.push("</ul>"); inList = false; } }
      else para.push(l);
    });
    flush(); if (inList) out.push("</ul>");
    return out.join("\n");
  }
  function parseFront(text) {
    var m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
    return m ? { meta: jsyaml.load(m[1]) || {}, body: m[2] } : { meta: {}, body: text };
  }
  function viewPages() {
    var body = el("div", {});
    shell("Pages", el("div", {}, [el("div", { class: "title-row" }, [el("h1", { text: "Pages" }), el("a", { class: "button primary", href: "#/pages/new", text: "+ New page" })]),
      el("p", { class: "muted", text: "Content pages such as About, guides or FAQs. Each appears at /<slug>/." }), body]));
    gh.list("site/content/pages").then(function (files) {
      body.appendChild(el("table", { class: "list" }, [el("tbody", {}, files.filter(function (f) { return /\.md$/.test(f.name); }).map(function (f) {
        var slug = f.name.replace(/\.md$/, "");
        return el("tr", {}, [el("td", {}, [el("a", { href: "#/pages/edit/" + slug, text: slug })]),
          el("td", {}, [el("a", { href: CFG.site_url + "/" + slug + "/", target: "_blank", rel: "noopener", text: "View ↗" })])]);
      }))]));
    }).catch(fail);
  }
  var RESERVED = ["tools", "products", "c", "admin", "static", "assets", "privacy", "404"];
  function viewPageEdit(slug) {
    var load = slug ? gh.get("site/content/pages/" + slug + ".md") : Promise.resolve(null);
    load.then(function (file) {
      var parsed = file ? parseFront(file.text) : { meta: { title: "", description: "", nav: "footer", order: 10 }, body: "" };
      var m = parsed.meta;
      var f = { slug: input(slug || "", { readonly: !!slug }), title: input(m.title), description: textarea(m.description, { rows: 2 }),
        nav: select([["footer", "Show in footer"], ["none", "Don't link (direct URL only)"]], m.nav || "footer"),
        order: input(m.order == null ? 10 : m.order), body: textarea(parsed.body, { rows: 22, class: "mono" }) };
      var preview = el("div", { class: "prose-preview" });
      function refresh() { preview.innerHTML = miniMarkdown(f.body.value); }  // safe: miniMarkdown escapes first
      f.body.addEventListener("input", refresh);
      f.title.addEventListener("input", function () { if (!slug) f.slug.value = slugify(f.title.value); });
      function persist() {
        var s = f.slug.value.trim(), errs = [];
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) errs.push("Slug must be lowercase words joined by hyphens.");
        if (RESERVED.indexOf(s) >= 0) errs.push("That slug is reserved.");
        var d = f.description.value.trim().length; if (d < 50 || d > 165) errs.push("Description should be 50–165 characters.");
        if (!f.title.value.trim()) errs.push("Add a title.");
        if (errs.length) { toast(errs.join(" "), "error"); return; }
        var meta = { title: f.title.value.trim(), description: f.description.value.trim(), nav: f.nav.value, order: Number(f.order.value) || 10 };
        var text = "---\n" + jsyaml.dump(meta, DUMP) + "---\n" + f.body.value.replace(/\s+$/, "") + "\n";
        busy(true);
        gh.putText("site/content/pages/" + s + ".md", text, "admin: " + (slug ? "update" : "add") + " page " + s, file ? file.sha : undefined)
          .then(function () { busy(false); toast("Saved. The site rebuilds and publishes in about 2–3 minutes."); go("#/pages/edit/" + s); route(); }).catch(fail);
      }
      function remove() {
        if (!confirm("Delete the page '" + slug + "'?")) return;
        busy(true);
        gh.remove("site/content/pages/" + slug + ".md", file.sha, "admin: delete page " + slug)
          .then(function () { busy(false); toast("Page deleted."); go("#/pages"); route(); }).catch(fail);
      }
      shell("Pages", el("div", {}, [
        el("div", { class: "title-row" }, [el("h1", { text: slug ? m.title || slug : "New page" }), el("a", { href: "#/pages", text: "← All pages" })]),
        el("section", { class: "card" }, [el("div", { class: "grid2" }, [field("Title", f.title), field("Slug (address)", f.slug), field("Navigation", f.nav), field("Footer order", f.order)]),
          field("Meta description", f.description), counter(f.description, 50, 165)]),
        el("div", { class: "editor" }, [
          el("section", { class: "card editor-main" }, [field("Content (Markdown: # heading, **bold**, - list, [link](https://…))", f.body)]),
          el("section", { class: "card editor-side" }, [el("h3", { text: "Preview" }), preview])]),
        el("div", { class: "buttons" }, [el("button", { type: "button", class: "primary", text: "Save page", onclick: persist }),
          slug ? el("button", { type: "button", class: "danger", text: "Delete", onclick: remove }) : null])
      ]));
      refresh();
    }).catch(fail);
  }

  // ------------------------------------------------------------------ files
  var FILE_DIRS = [["site/static/uploads", "Images & downloads", "/static/uploads/"], ["site/root", "Site root (verification files)", "/"]];
  function viewFiles() {
    var body = el("div", {});
    shell("Files", el("div", {}, [el("h1", { text: "Files" }),
      el("p", { class: "muted", text: "Upload images or downloads to use in pages, and search-engine verification files that must sit at the site root." }), body]));
    FILE_DIRS.forEach(function (d) {
      var box = el("section", { class: "card" }, [el("h2", { text: d[1] }), el("p", { class: "muted", text: "Loading…" })]);
      body.appendChild(box);
      var picker = el("input", { type: "file", multiple: true });
      picker.addEventListener("change", function () {
        var files = Array.from(picker.files);
        busy(true);
        files.reduce(function (p, file) {
          return p.then(function () {
            if (file.size > 20 * 1024 * 1024) throw new Error(file.name + " is larger than 20 MB.");
            var name = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
            return file.arrayBuffer().then(function (buf) {
              return gh.list(d[0]).then(function (existing) {
                var same = existing.filter(function (e) { return e.name === name; })[0];
                return gh.putBytes(d[0] + "/" + name, new Uint8Array(buf), "admin: upload " + name, same ? same.sha : undefined);
              });
            });
          });
        }, Promise.resolve()).then(function () { busy(false); toast("Uploaded. The site rebuilds in about 2–3 minutes."); route(); }).catch(fail);
      });
      gh.list(d[0]).then(function (files) {
        files = files.filter(function (f) { return f.type === "file" && f.name[0] !== "."; });
        clear(box);
        box.appendChild(el("h2", { text: d[1] }));
        box.appendChild(el("label", { class: "field" }, [el("span", { text: "Upload files" }), picker]));
        if (!files.length) { box.appendChild(el("p", { class: "muted", text: "No files yet." })); return; }
        box.appendChild(el("table", { class: "list" }, [el("tbody", {}, files.map(function (f) {
          var url = CFG.site_url + d[2] + f.name;
          return el("tr", {}, [el("td", { text: f.name }), el("td", { text: Math.ceil(f.size / 1024) + " KB" }),
            el("td", {}, [el("a", { href: url, target: "_blank", rel: "noopener", text: url })]),
            el("td", {}, [el("button", { type: "button", class: "danger small", text: "Delete", onclick: function () {
              if (!confirm("Delete " + f.name + "?")) return;
              busy(true);
              gh.remove(f.path, f.sha, "admin: delete " + f.name).then(function () { busy(false); toast("Deleted."); route(); }).catch(fail);
            } })])]);
        }))]));
      }).catch(fail);
    });
  }

  // ------------------------------------------------------------------ settings
  function viewSettings() {
    loadYaml("site/config.yaml").then(function (file) {
      var c = file.doc;
      var f = { name: input(c.name), tagline: input(c.tagline), kofi_url: input(c.kofi_url, { type: "url" }), goatcounter: input(c.goatcounter),
        contact_email: input(c.contact_email, { type: "email" }), base_url: input(c.base_url), base_path: input(c.base_path),
        social: textarea(jsyaml.dump(c.social || [], DUMP), { rows: 4, class: "mono" }), niches: textarea(jsyaml.dump(c.niches || {}, DUMP), { rows: 14, class: "mono" }) };
      function persist() {
        try {
          c.name = f.name.value.trim(); c.tagline = f.tagline.value.trim(); c.kofi_url = f.kofi_url.value.trim(); c.goatcounter = f.goatcounter.value.trim();
          c.contact_email = f.contact_email.value.trim(); c.base_url = f.base_url.value.trim().replace(/\/+$/, ""); c.base_path = f.base_path.value.trim().replace(/\/+$/, "");
          c.social = jsyaml.load(f.social.value) || []; c.niches = jsyaml.load(f.niches.value) || {};
        } catch (e) { toast("Not valid YAML: " + e.message, "error"); return; }
        if (c.kofi_url && c.kofi_url.indexOf("https://") !== 0) { toast("Ko-fi URL must start with https://", "error"); return; }
        save("site/config.yaml", c, file.sha, "admin: update site settings").then(function () { invalidate(); route(); }).catch(fail);
      }
      shell("Settings", el("div", {}, [el("h1", { text: "Site settings" }), loginCard(),
        el("section", { class: "card" }, [el("div", { class: "grid2" }, [field("Site name", f.name), field("Tagline", f.tagline),
          field("Ko-fi page URL", f.kofi_url), field("GoatCounter code", f.goatcounter, "e.g. sumivo for sumivo.goatcounter.com"),
          field("Contact email (shown on the About page)", f.contact_email), field("Public site URL", f.base_url),
          field("Base path ('' for a root site)", f.base_path)])]),
        el("section", { class: "card" }, [el("h2", { text: "Social profile links" }), el("p", { class: "muted", text: "YAML list of {name, url}." }), f.social]),
        el("section", { class: "card" }, [el("h2", { text: "Niches" }), el("p", { class: "muted", text: "Sections of the site: key → nav, title, description." }), f.niches]),
        el("div", { class: "buttons" }, [el("button", { type: "button", class: "primary", text: "Save settings", onclick: persist })])]));
    }).catch(fail);
  }

  // ------------------------------------------------------------------ router
  function route() {
    var session = GH.loadSession();
    if (!gh && session) gh = new GH.Client(session);
    var h = location.hash.replace(/^#\/?/, "").split("/");
    if (!gh || h[0] === "login") return viewLogin();
    switch (h[0]) {
      case "tools":
        if (h[1] === "new") return viewToolEdit(null);
        if (h[1] === "duplicate") return viewToolEdit(null, decodeURIComponent(h[2]));
        if (h[1] === "edit") return viewToolEdit(decodeURIComponent(h[2]));
        return viewTools();
      case "products":
      case "backlog":
        if (h[1] === "new") return viewCatalogEdit(h[0], null);
        if (h[1] === "edit") return viewCatalogEdit(h[0], decodeURIComponent(h[2]));
        return viewCatalog(h[0]);
      case "pages":
        if (h[1] === "new") return viewPageEdit(null);
        if (h[1] === "edit") return viewPageEdit(decodeURIComponent(h[2]));
        return viewPages();
      case "files": return viewFiles();
      case "settings": return viewSettings();
      default: return viewDashboard();
    }
  }
  window.addEventListener("hashchange", route);
  route();
})();
