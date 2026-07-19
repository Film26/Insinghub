// js/settings.js
// Renders the Settings view: Apps Script connection, account info, data controls,
// and (Super Admin only) the User Management panel for role/AdminName assignment.
// Invoked on-demand by dashboard.js (window.renderSettingsView) whenever that view is opened.

function settingsRowCount() {
  return window.AppData && window.AppData.rawData ? window.AppData.rawData.length : 0;
}

function roleOptionsHtml(selectedRole) {
  return window.CrmRoles.ROLE_ORDER.map(
    (r) => `<option value="${r}" ${r === selectedRole ? "selected" : ""}>${window.CrmRoles.ROLE_LABELS[r]}</option>`
  ).join("");
}

function renderSettingsView() {
  const container = document.getElementById("view-settings");
  if (!container) return;

  const session = window.CrmAuth ? window.CrmAuth.getSession() : null;
  const ROLES = window.CrmRoles.ROLES;
  const role = session ? session.role : ROLES.SALES_ADMIN;
  const isSuperAdmin = role === ROLES.SUPER_ADMIN;
  const currentBaseUrl = window.CrmApi.getBaseUrl();
  const rowsPerPage = (window.insightHubState && window.insightHubState.rowsPerPage) || 100;

  // Manager/Sales Admin can't edit core system settings — connection setup is Super Admin only.
  const connectionCardHtml = isSuperAdmin
    ? `
      <div class="settings-card">
        <h3><i class="fas fa-plug"></i> การเชื่อมต่อ Google Apps Script</h3>
        <p class="text-muted" style="font-size:12.5px; margin-top:-8px;">
          วาง URL ของ Web App ที่ deploy จาก <code>apps-script/Code.gs</code> (ลงท้ายด้วย <code>/exec</code>)
          หากยังไม่ตั้งค่า ระบบจะใช้ข้อมูลตัวอย่าง/ไฟล์ import แทน และล็อกอินได้ด้วยบัญชีทดลอง admin / admin
        </p>
        <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:8px;">
          <input type="url" id="settings-api-url" placeholder="https://script.google.com/macros/s/XXXX/exec"
                 value="${currentBaseUrl}" style="width:100%; min-width:0;">
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary" id="settings-save-url-btn"><i class="fas fa-save"></i> บันทึก</button>
            <button class="btn btn-secondary" id="settings-test-url-btn"><i class="fas fa-satellite-dish"></i> ทดสอบการเชื่อมต่อ</button>
          </div>
          <div id="settings-connection-status" style="font-size:12.5px;"></div>
        </div>
      </div>
    `
    : `
      <div class="settings-card">
        <h3><i class="fas fa-plug"></i> การเชื่อมต่อ Google Apps Script</h3>
        <p class="text-muted" style="font-size:12.5px;">
          การตั้งค่าการเชื่อมต่อระบบเป็นสิทธิ์ของ Super Admin เท่านั้น ติดต่อ Super Admin หากต้องการเปลี่ยนแปลง
        </p>
        <div class="settings-row">
          <label>สถานะ</label>
          <strong>${currentBaseUrl ? "เชื่อมต่อแล้ว" : "ยังไม่ได้เชื่อมต่อ (Demo)"}</strong>
        </div>
      </div>
    `;

  const userMgmtCardHtml = isSuperAdmin
    ? `
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3><i class="fas fa-users-gear"></i> จัดการผู้ใช้งาน</h3>
        <div id="user-mgmt-body">
          <p class="text-muted" style="font-size:12.5px;">กำลังโหลดรายชื่อผู้ใช้...</p>
        </div>
      </div>
    `
    : "";

  container.innerHTML = `
    <div class="settings-grid">
      ${connectionCardHtml}

      <div class="settings-card">
        <h3><i class="fas fa-user-shield"></i> บัญชีผู้ใช้งาน</h3>
        <div class="settings-row">
          <label>ชื่อผู้ใช้</label>
          <strong>${session ? session.username : "-"}</strong>
        </div>
        <div class="settings-row">
          <label>สิทธิ์การใช้งาน</label>
          <strong>${window.CrmRoles.ROLE_LABELS[role]}</strong>
        </div>
        ${
          session && session.adminName
            ? `<div class="settings-row"><label>AdminName ที่ผูกไว้</label><strong>${session.adminName}</strong></div>`
            : ""
        }
        <div class="settings-row">
          <label>โหมด</label>
          <strong>${session && session.demo ? "Demo (ยังไม่เชื่อมต่อ Apps Script)" : "Connected"}</strong>
        </div>
        <div class="settings-row">
          <button class="btn btn-secondary" id="settings-logout-btn"><i class="fas fa-right-from-bracket"></i> ออกจากระบบ</button>
        </div>
      </div>

      <div class="settings-card">
        <h3><i class="fas fa-table"></i> ข้อมูลที่โหลดอยู่</h3>
        <div class="settings-row">
          <label>จำนวนแถวที่โหลด</label>
          <strong>${settingsRowCount().toLocaleString()}</strong>
        </div>
        <div class="settings-row">
          <label>แถวต่อหน้าใน InsightHub</label>
          <input type="number" id="settings-rows-per-page" min="10" max="1000" step="10" value="${rowsPerPage}">
        </div>
        <div class="settings-row">
          <button class="btn btn-secondary" id="settings-clear-data-btn"><i class="fas fa-trash"></i> ล้างข้อมูลที่โหลดอยู่</button>
        </div>
      </div>

      <div class="settings-card">
        <h3><i class="fas fa-circle-info"></i> เกี่ยวกับระบบ</h3>
        <div class="settings-row">
          <label>แอปพลิเคชัน</label>
          <strong>InsightHub CRM</strong>
        </div>
        <div class="settings-row">
          <label>Backend</label>
          <strong>Google Apps Script + Google Sheets</strong>
        </div>
      </div>

      ${userMgmtCardHtml}
    </div>
  `;

  if (isSuperAdmin) {
    document.getElementById("settings-save-url-btn").addEventListener("click", () => {
      const val = document.getElementById("settings-api-url").value.trim();
      window.CrmApi.setBaseUrl(val);
      window.showToast(val ? "บันทึก Apps Script URL แล้ว" : "ล้างค่า Apps Script URL แล้ว", "success");
      renderSettingsView();
    });

    document.getElementById("settings-test-url-btn").addEventListener("click", async () => {
      const statusEl = document.getElementById("settings-connection-status");
      statusEl.textContent = "กำลังทดสอบ...";
      statusEl.style.color = "#7a665e";
      try {
        await window.CrmApi.ping();
        statusEl.textContent = "✔ เชื่อมต่อสำเร็จ";
        statusEl.style.color = "#15803d";
      } catch (err) {
        statusEl.textContent = "✘ " + err.message;
        statusEl.style.color = "#b91c1c";
      }
    });

    loadUserManagementPanel(session);
  }

  document.getElementById("settings-logout-btn").addEventListener("click", () => {
    window.CrmAuth.logout();
  });

  document.getElementById("settings-rows-per-page").addEventListener("change", (e) => {
    const val = Math.max(10, parseInt(e.target.value, 10) || 100);
    if (window.insightHubState) {
      window.insightHubState.rowsPerPage = val;
      window.insightHubState.currentPage = 1;
    }
    window.showToast("ตั้งค่าแถวต่อหน้าเป็น " + val, "success");
  });

  document.getElementById("settings-clear-data-btn").addEventListener("click", () => {
    window.AppData.rawData = [];
    window.AppData.filteredData = [];
    window.__hubCache = null;
    if (window.insightHubState) window.insightHubState.allCustomers = [];
    window.showToast("ล้างข้อมูลที่โหลดอยู่แล้ว", "success");
    renderSettingsView();
  });
}

async function loadUserManagementPanel(session) {
  const body = document.getElementById("user-mgmt-body");
  if (!body) return;

  if (!window.CrmApi.getBaseUrl()) {
    body.innerHTML = `<p class="text-muted" style="font-size:12.5px;">
      ต้องตั้งค่า Apps Script URL ก่อนจึงจะจัดการผู้ใช้งานได้ (โหมด Demo ยังไม่มีชีต Users ให้อ่าน)
    </p>`;
    return;
  }

  try {
    const result = await window.CrmApi.listUsers(session.username);
    renderUserManagementTable(body, session, result.users || []);
  } catch (err) {
    // Missing "Users" sheet isn't an error to alarm over — role management is optional;
    // data loading (Refresh) works fine without it. Show a calm note instead of red text.
    if (/ไม่พบชีต "?Users"?/i.test(err.message)) {
      body.innerHTML = `<p class="text-muted" style="font-size:12.5px;">
        ยังไม่ได้สร้างชีต "Users" — ไม่จำเป็นสำหรับการดึงข้อมูลออเดอร์มาแสดง (ใช้บัญชีทดลอง admin/admin ได้ตามปกติ)
        สร้างชีตนี้ภายหลังได้เมื่อต้องการเปิดให้คนอื่น login ด้วยบัญชีจริง/จำกัดสิทธิ์ตาม Role
      </p>`;
      return;
    }
    body.innerHTML = `<p style="font-size:12.5px; color:#b91c1c;">โหลดรายชื่อผู้ใช้ไม่สำเร็จ: ${err.message}</p>`;
  }
}

function renderUserManagementTable(body, session, users) {
  body.innerHTML = `
    <table class="user-mgmt-table">
      <thead>
        <tr><th>Username</th><th>Role</th><th>AdminName</th><th>New Password</th><th></th></tr>
      </thead>
      <tbody>
        ${users
          .map(
            (u, i) => `
          <tr data-username="${u.username}">
            <td style="font-weight:600;">${u.username}</td>
            <td><select class="um-role">${roleOptionsHtml(u.role)}</select></td>
            <td><input type="text" class="um-adminname" value="${u.adminName || ""}" placeholder="เช่น แอน"></td>
            <td><input type="password" class="um-password" placeholder="(ไม่เปลี่ยน)"></td>
            <td><button class="btn btn-primary um-save-btn" data-idx="${i}"><i class="fas fa-save"></i></button></td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>

    <div class="new-user-form">
      <div>
        <label>Username</label>
        <input type="text" id="um-new-username" placeholder="username">
      </div>
      <div>
        <label>Role</label>
        <select id="um-new-role">${roleOptionsHtml(window.CrmRoles.ROLES.SALES_ADMIN)}</select>
      </div>
      <div>
        <label>AdminName</label>
        <input type="text" id="um-new-adminname" placeholder="เช่น แอน (สำหรับ Sales Admin)">
      </div>
      <div>
        <label>Password</label>
        <input type="password" id="um-new-password" placeholder="รหัสผ่านเริ่มต้น">
      </div>
      <div>
        <button class="btn btn-primary" id="um-create-btn" style="width:100%;"><i class="fas fa-user-plus"></i> เพิ่มผู้ใช้</button>
      </div>
    </div>
  `;

  body.querySelectorAll(".um-save-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tr = btn.closest("tr");
      const targetUsername = tr.dataset.username;
      const roleVal = tr.querySelector(".um-role").value;
      const adminNameVal = tr.querySelector(".um-adminname").value.trim();
      const newPassword = tr.querySelector(".um-password").value;

      if (roleVal === window.CrmRoles.ROLES.SALES_ADMIN && !adminNameVal) {
        window.showToast("Sales Admin ต้องระบุ AdminName ให้ตรงกับคอลัมน์ชื่อแอดมินในชีต Orders", "error");
        return;
      }

      try {
        await window.CrmApi.upsertUser(session.username, {
          targetUsername,
          role: roleVal,
          adminName: adminNameVal,
          newPassword,
        });
        window.showToast("บันทึกสิทธิ์ของ " + targetUsername + " แล้ว", "success");
        loadUserManagementPanel(session);
      } catch (err) {
        window.showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
      }
    });
  });

  document.getElementById("um-create-btn").addEventListener("click", async () => {
    const targetUsername = document.getElementById("um-new-username").value.trim();
    const roleVal = document.getElementById("um-new-role").value;
    const adminNameVal = document.getElementById("um-new-adminname").value.trim();
    const newPassword = document.getElementById("um-new-password").value;

    if (!targetUsername) {
      window.showToast("กรุณากรอก Username", "error");
      return;
    }
    if (!newPassword) {
      window.showToast("กรุณาตั้งรหัสผ่านเริ่มต้น", "error");
      return;
    }
    if (roleVal === window.CrmRoles.ROLES.SALES_ADMIN && !adminNameVal) {
      window.showToast("Sales Admin ต้องระบุ AdminName ให้ตรงกับคอลัมน์ชื่อแอดมินในชีต Orders", "error");
      return;
    }

    try {
      await window.CrmApi.upsertUser(session.username, {
        targetUsername,
        role: roleVal,
        adminName: adminNameVal,
        newPassword,
      });
      window.showToast("เพิ่มผู้ใช้ " + targetUsername + " แล้ว", "success");
      loadUserManagementPanel(session);
    } catch (err) {
      window.showToast("เพิ่มผู้ใช้ไม่สำเร็จ: " + err.message, "error");
    }
  });
}

window.renderSettingsView = renderSettingsView;