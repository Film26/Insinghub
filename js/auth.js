// js/auth.js
// Session handling for index.html (login form) and dashboard.html (session guard + logout).
// Session is a plain object stored in localStorage; there is no server-side session store,
// this is a lightweight internal tool, not a public-facing auth system.

(function () {
  const SESSION_KEY = "crm_session";
  // Demo account usable before Code.gs is deployed / Settings API URL is configured,
  // so the whole UI can be tried out with zero Google setup.
  const DEMO_USER = { username: "admin", password: "admin" };

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
      return null;
    }
  }

  function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function logout() {
    clearSession();
    window.location.href = "index.html";
  }

  window.CrmAuth = { getSession, setSession, clearSession, logout };

  // ---------- index.html: login form ----------
  const form = document.getElementById("login-form");
  if (form) {
    if (getSession()) {
      window.location.href = "dashboard.html";
      return;
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value;
      const errorBox = document.getElementById("login-error");
      const submitBtn = document.getElementById("login-submit-btn");
      const submitLabel = document.getElementById("login-submit-label");

      errorBox.classList.remove("show");
      errorBox.textContent = "";
      submitBtn.disabled = true;
      submitLabel.innerHTML = '<span class="spinner"></span>';

      try {
        let sessionData;
        const baseUrl = window.CrmApi.getBaseUrl();

        if (!baseUrl) {
          if (username === DEMO_USER.username && password === DEMO_USER.password) {
            sessionData = { username, role: "admin", demo: true, loginAt: Date.now() };
          } else {
            throw new Error(
              "ยังไม่ได้เชื่อมต่อ Apps Script — ใช้บัญชีทดลอง admin / admin ก่อน หรือไปตั้งค่า API URL ที่หน้า Settings"
            );
          }
        } else {
          const result = await window.CrmApi.login(username, password);
          sessionData = {
            username: result.username || username,
            role: result.role || "user",
            demo: false,
            loginAt: Date.now(),
          };
        }

        setSession(sessionData);
        window.location.href = "dashboard.html";
      } catch (err) {
        errorBox.textContent = err.message || "เข้าสู่ระบบไม่สำเร็จ";
        errorBox.classList.add("show");
      } finally {
        submitBtn.disabled = false;
        submitLabel.textContent = "เข้าสู่ระบบ";
      }
    });
  }

  // ---------- dashboard.html: session guard + logout ----------
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    const session = getSession();
    if (!session) {
      window.location.href = "index.html";
    } else {
      const nameEl = document.getElementById("sidebar-username");
      if (nameEl) nameEl.textContent = session.username + (session.demo ? " (Demo)" : "");
    }
    logoutBtn.addEventListener("click", logout);
  }
})();
