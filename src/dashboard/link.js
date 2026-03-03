(function() {
  
  var code = document.getElementById("device-code").getAttribute("data-code");
  var codeEl = document.getElementById("device-code");
  codeEl.textContent = code;

  if (!code) {
    document.getElementById("link-status").textContent = "No device code provided.";
    document.getElementById("link-status").className = "status error";
    return;
  }

  var token = localStorage.getItem("entendi_token");

  function getHeaders() {
    var headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    return headers;
  }

  function checkAuth() {
    if (token) {
      return fetch("/api/me", { headers: getHeaders() })
        .then(function(r) { if (r.ok) return r.json(); throw new Error("unauth"); })
        .then(function(data) { return data.user; });
    }
    return fetch("/api/me", { credentials: "include" })
      .then(function(r) { if (r.ok) return r.json(); throw new Error("unauth"); })
      .then(function(data) { return data.user; });
  }

  function showConfirm(user) {
    var content = document.getElementById("link-content");
    content.textContent = "";
    var info = document.createElement("div");
    info.style.cssText = "font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem;";
    info.textContent = "Linking as " + (user.name || user.email);
    content.appendChild(info);

    var btn = document.createElement("button");
    btn.className = "btn-confirm";
    btn.textContent = "Confirm Link";
    btn.onclick = function() {
      btn.disabled = true;
      btn.textContent = "Linking...";
      fetch("/api/auth/device-code/" + encodeURIComponent(code) + "/confirm", {
        method: "POST",
        headers: getHeaders(),
        credentials: "include"
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var status = document.getElementById("link-status");
          if (data.error) {
            status.textContent = data.error;
            status.className = "status error";
            btn.disabled = false;
            btn.textContent = "Confirm Link";
          } else {
            status.textContent = "Device linked successfully!";
            status.className = "status success";
            btn.style.display = "none";
            setTimeout(function() { window.close(); }, 1500);
          }
        })
        .catch(function() {
          var status = document.getElementById("link-status");
          status.textContent = "Network error. Please try again.";
          status.className = "status error";
          btn.disabled = false;
          btn.textContent = "Confirm Link";
        });
    };
    content.appendChild(btn);
  }

  function showLogin() {
    var content = document.getElementById("link-content");
    content.textContent = "";
    var form = document.createElement("div");
    form.className = "inline-login";

    var emailLabel = document.createElement("label");
    emailLabel.setAttribute("for", "link-email");
    emailLabel.textContent = "Email";
    form.appendChild(emailLabel);

    var emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.id = "link-email";
    emailInput.placeholder = "you@example.com";
    form.appendChild(emailInput);

    var passLabel = document.createElement("label");
    passLabel.setAttribute("for", "link-pass");
    passLabel.textContent = "Password";
    form.appendChild(passLabel);

    var passInput = document.createElement("input");
    passInput.type = "password";
    passInput.id = "link-pass";
    passInput.placeholder = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    form.appendChild(passInput);

    var btn = document.createElement("button");
    btn.className = "btn-confirm";
    btn.id = "link-signin-btn";
    btn.textContent = "Sign in & Link Device";
    form.appendChild(btn);

    var errEl = document.createElement("div");
    errEl.className = "login-error";
    errEl.id = "link-login-error";
    form.appendChild(errEl);

    content.appendChild(form);

    btn.onclick = function() {
      var email = emailInput.value;
      var pass = passInput.value;
      if (!email || !pass) { errEl.textContent = "Email and password required"; return; }
      btn.disabled = true;
      btn.textContent = "Signing in...";
      errEl.textContent = "";
      fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email, password: pass })
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.token) {
            token = data.token;
            localStorage.setItem("entendi_token", token);
          }
          if (data.user || data.token) {
            checkAuth()
              .then(function(user) { showConfirm(user); })
              .catch(function() { errEl.textContent = "Signed in but auth check failed"; btn.disabled = false; btn.textContent = "Sign in & Link Device"; });
          } else {
            errEl.textContent = data.message || "Sign in failed";
            btn.disabled = false;
            btn.textContent = "Sign in & Link Device";
          }
        })
        .catch(function() {
          errEl.textContent = "Network error";
          btn.disabled = false;
          btn.textContent = "Sign in & Link Device";
        });
    };
  }

  checkAuth()
    .then(function(user) { showConfirm(user); })
    .catch(function() { showLogin(); });
})();
