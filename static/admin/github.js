/* Minimal GitHub REST client for the admin panel. The token stays in this browser
   (sessionStorage, or localStorage if "remember" is ticked) and is only ever sent to api.github.com. */
(function (global) {
  "use strict";
  var API = "https://api.github.com";
  var STORE_KEY = "sumivo-admin";

  function b64encodeBytes(bytes) {
    var s = "", chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(s);
  }
  function b64decodeText(b64) {
    var bin = atob(b64.replace(/\n/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }
  function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }

  function Client(cfg) {
    this.token = cfg.token; this.repo = cfg.repo; this.branch = cfg.branch || "main";
  }
  Client.prototype.req = function (method, path, body) {
    return fetch(API + path, {
      method: method,
      headers: { Authorization: "Bearer " + this.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error((data && data.message) || ("GitHub API error " + r.status));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  };
  Client.prototype.repoInfo = function () { return this.req("GET", "/repos/" + this.repo); };
  Client.prototype.get = function (path) {
    var self = this;
    return this.req("GET", "/repos/" + this.repo + "/contents/" + encPath(path) + "?ref=" + encodeURIComponent(this.branch))
      .then(function (d) { return { path: path, sha: d.sha, text: b64decodeText(d.content || ""), size: d.size }; });
  };
  Client.prototype.getOptional = function (path) {
    return this.get(path).catch(function (e) { if (e.status === 404) return null; throw e; });
  };
  Client.prototype.list = function (dir) {
    return this.req("GET", "/repos/" + this.repo + "/contents/" + encPath(dir) + "?ref=" + encodeURIComponent(this.branch))
      .then(function (d) { return Array.isArray(d) ? d : []; })
      .catch(function (e) { if (e.status === 404) return []; throw e; });
  };
  Client.prototype.putText = function (path, text, message, sha) {
    return this.putBytes(path, new TextEncoder().encode(text), message, sha);
  };
  Client.prototype.putBytes = function (path, bytes, message, sha) {
    var body = { message: message, content: b64encodeBytes(bytes), branch: this.branch };
    if (sha) body.sha = sha;
    return this.req("PUT", "/repos/" + this.repo + "/contents/" + encPath(path), body);
  };
  Client.prototype.remove = function (path, sha, message) {
    return this.req("DELETE", "/repos/" + this.repo + "/contents/" + encPath(path), { message: message, sha: sha, branch: this.branch });
  };
  Client.prototype.runs = function (n) {
    return this.req("GET", "/repos/" + this.repo + "/actions/runs?per_page=" + (n || 10)).then(function (d) { return d.workflow_runs || []; });
  };
  Client.prototype.dispatch = function (workflowFile) {
    return this.req("POST", "/repos/" + this.repo + "/actions/workflows/" + workflowFile + "/dispatches", { ref: this.branch });
  };

  function saveSession(cfg, remember) {
    var data = JSON.stringify(cfg);
    sessionStorage.setItem(STORE_KEY, data);
    if (remember) localStorage.setItem(STORE_KEY, data); else localStorage.removeItem(STORE_KEY);
  }
  function loadSession() {
    var raw = sessionStorage.getItem(STORE_KEY) || localStorage.getItem(STORE_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function clearSession() { sessionStorage.removeItem(STORE_KEY); localStorage.removeItem(STORE_KEY); }

  // ---- Username + password sign-in.
  // The token is encrypted in this browser with AES-256-GCM under a key derived from
  // "username\npassword" (PBKDF2-SHA256, 600,000 rounds). Only the encrypted blob is saved
  // (site/admin_login.json, built into the admin page), so the site never contains the token itself.
  var LOGIN_ITER = 600000;
  function b64bytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function deriveKey(username, password, salt, iter) {
    var material = new TextEncoder().encode(String(username).trim().toLowerCase() + "\n" + password);
    return crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, base,
        { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function sealLogin(username, password, payload) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(username, password, salt, LOGIN_ITER).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    }).then(function (ct) {
      return { v: 1, kdf: "PBKDF2-SHA256", iter: LOGIN_ITER, salt: b64encodeBytes(salt), iv: b64encodeBytes(iv),
        ct: b64encodeBytes(new Uint8Array(ct)) };
    });
  }
  function openLogin(blob, username, password) {
    return deriveKey(username, password, b64bytes(blob.salt), blob.iter || LOGIN_ITER).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64bytes(blob.iv) }, key, b64bytes(blob.ct));
    }).then(function (plain) {
      return JSON.parse(new TextDecoder().decode(plain));
    }, function () { throw new Error("Wrong username or password."); });
  }

  global.GH = { Client: Client, saveSession: saveSession, loadSession: loadSession, clearSession: clearSession,
    b64encodeBytes: b64encodeBytes, sealLogin: sealLogin, openLogin: openLogin };
})(window);
