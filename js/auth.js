// js/auth.js
// Session handling for index.html (login form) and dashboard.html (session guard + logout),
// plus the role model shared by dashboard.js/settings.js/insighthub.js scoping.
// Session is a plain object stored in localStorage; there is no server-side session store,
// this is a lightweight internal tool, not a public-facing auth system. Real permission
// checks for anything that writes data still happen server-side in Code.gs.

(function () {
  const SESSION_KEY = "crm_session";
  // Demo account usable before Code.gs is deployed / Settings API URL is configured,
  // so the whole UI can be tried out with zero Google setup.
  const DEMO_USER = { username: "admin", password: "admin" };

  const ROLES = { SUPER_ADMIN: "super_admin", MANAGER: "manager", SALES_ADMIN: "sales_admin" };
  // Order matters here: this is the exact order/labels used everywhere a role
  // list or picker is shown (Settings > User Management, etc).
  const ROLE_ORDER = [ROLES.SUPER_ADMIN, ROLES.MANAGER, ROLES.SALES_ADMIN];
  const ROLE_LABELS = {
    [ROLES.SUPER_ADMIN]: "SUPER ADMIN",
    [ROLES.MANAGER]: "MANAGER",
    [ROLES.SALES_ADMIN]: "SALES ADMIN",
  };

  // Mirrors normalizeRole() in apps-script/Code.gs so an unrecognized/missing
  // role value fails safe to the least-privileged role on the client too.
  function normalizeRole(raw) {
    const r = (raw || "").toString().trim().toLowerCase().replace(/[\s\-]+/g, "_");
    if (r === "super_admin" || r === "superadmin" || r === "owner" || r === "admin") return ROLES.SUPER_ADMIN;
    if (r === "manager" || r === "supervisor" || r === "manager_supervisor") return ROLES.MANAGER;
    if (r === "sales_admin" || r === "salesadmin" || r === "operation" || r === "operation_admin")
      return ROLES.SALES_ADMIN;
    return ROLES.SALES_ADMIN;
  }

  window.CrmRoles = { ROLES, ROLE_ORDER, ROLE_LABELS, normalizeRole };

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

        // Demo account always works, with or without an Apps Script URL configured —
        // login (Users sheet) and data loading (Orders sheet) are independent, so this
        // account is enough to see real Sheets data via Refresh without setting up Users.
        if (username === DEMO_USER.username && password === DEMO_USER.password) {
          sessionData = {
            username,
            role: ROLES.SUPER_ADMIN,
            adminName: "",
            demo: true,
            loginAt: Date.now(),
          };
        } else if (baseUrl) {
          const result = await window.CrmApi.login(username, password);
          sessionData = {
            username: result.username || username,
            role: normalizeRole(result.role),
            adminName: (result.adminName || "").toString().trim(),
            demo: false,
            loginAt: Date.now(),
          };
        } else {
          throw new Error(
            "ยังไม่ได้เชื่อมต่อ Apps Script — ใช้บัญชีทดลอง admin / admin ก่อน หรือไปตั้งค่า API URL ที่หน้า Settings"
          );
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
      const roleEl = document.getElementById("sidebar-role");
      if (roleEl) roleEl.textContent = ROLE_LABELS[normalizeRole(session.role)];
    }
    logoutBtn.addEventListener("click", logout);
  }
})();
