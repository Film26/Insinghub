// js/settings.js

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

  // Status options (the multi-select shown on a customer's Sales Note card) —
  // editable by Super Admin and Manager; every role can still pick from the
  // list on a customer profile.
  const canEditStatusOptions = isSuperAdmin || role === ROLES.MANAGER;
  const statusOptionsCardHtml = canEditStatusOptions
    ? `
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3><i class="fas fa-list-check"></i> จัดการสถานะการติดต่อ (Sales Note)</h3>
        <p class="text-muted" style="font-size:12.5px; margin-top:-8px;">
          รายการสถานะที่แอดมินเลือกได้ตอนบันทึก Sales Note ในหน้าโปรไฟล์ลูกค้า (เลือกได้มากกว่า 1 รายการต่อครั้ง)
        </p>
        <div id="status-options-rows" style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
          ${(window.AppData.statusOptions && window.AppData.statusOptions.length ? window.AppData.statusOptions : window.DEFAULT_STATUS_OPTIONS)
            .map(
              (opt) => `
            <div class="status-option-row" style="display:flex; gap:8px;">
              <input type="text" class="so-label" value="${window.escapeHtml(opt)}" style="flex-grow:1;">
              <button type="button" class="btn btn-secondary so-remove-btn"><i class="fas fa-trash"></i></button>
            </div>
          `
            )
            .join("")}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary" id="so-add-btn"><i class="fas fa-plus"></i> เพิ่มสถานะ</button>
          <button class="btn btn-primary" id="so-save-btn"><i class="fas fa-save"></i> บันทึกรายการสถานะ</button>
        </div>
      </div>
    `
    : "";

  // Advanced config: Loyalty Index thresholds, Admin Priority x Segment
  // matrix, Trend Visual thresholds, refill buffer — all backed by the
  // generic Config_App sheet (see apps-script/Code.gs handleGetAppConfig).
  const appConfig = window.AppData.appConfig || window.DEFAULT_APP_CONFIG;
  const SEGMENT1_KEYS = ["NEW", "ACTIVE", "RISK", "CHURN"];
  const SEGMENT2_KEYS = ["NEW", "ACTIVE", "REFILL", "RISK", "CHURN"];
  const PRIORITY_LEVELS = ["High", "Medium", "Low", "Win-back"];
  const advancedConfigCardHtml = canEditStatusOptions
    ? `
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3><i class="fas fa-sliders"></i> ตั้งค่าเงื่อนไขระบบ (Advanced Config)</h3>

        <div style="margin-bottom:20px;">
          <h4 style="font-size:13px; margin:0 0 8px 0;">Loyalty Index (จำนวนวันสะสม)</h4>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:10px;">
            <label style="font-size:11px; color:#64748b;">Seedling ถึง (วัน)
              <input type="number" id="cfg-loyalty-seedling" value="${appConfig.loyaltyIndex.seedlingMaxDays}" min="0" style="width:100%; margin-top:4px;">
            </label>
            <label style="font-size:11px; color:#64748b;">Regular ถึง (วัน)
              <input type="number" id="cfg-loyalty-regular" value="${appConfig.loyaltyIndex.regularMaxDays}" min="0" style="width:100%; margin-top:4px;">
            </label>
            <label style="font-size:11px; color:#64748b;">Veteran ถึง (วัน)
              <input type="number" id="cfg-loyalty-veteran" value="${appConfig.loyaltyIndex.veteranMaxDays}" min="0" style="width:100%; margin-top:4px;">
            </label>
          </div>
          <button class="btn btn-secondary" id="cfg-loyalty-save-btn"><i class="fas fa-save"></i> บันทึก Loyalty Index</button>
        </div>

        <div style="margin-bottom:20px; border-top:1px dashed #e2e8f0; padding-top:16px;">
          <h4 style="font-size:13px; margin:0 0 8px 0;">Admin Priority × Segment</h4>
          <p class="text-muted" style="font-size:11.5px; margin-top:-4px;">แถว = Segment 1 (Standard Period), คอลัมน์ = Segment 2 (Dynamic Refill)</p>
          <div style="overflow-x:auto;">
            <table class="overview-table" style="min-width:560px;">
              <thead><tr><th></th>${SEGMENT2_KEYS.map((s2) => `<th>${s2}</th>`).join("")}</tr></thead>
              <tbody>
                ${SEGMENT1_KEYS.map(
                  (s1) => `
                  <tr>
                    <td style="font-weight:600;">${s1}</td>
                    ${SEGMENT2_KEYS.map((s2) => {
                      const key = s1 + "|" + s2;
                      const val = appConfig.adminPriorityMatrix[key] || "Win-back";
                      return `<td><select class="cfg-priority-cell" data-key="${key}">
                        ${PRIORITY_LEVELS.map((lvl) => `<option value="${lvl}" ${lvl === val ? "selected" : ""}>${lvl}</option>`).join("")}
                      </select></td>`;
                    }).join("")}
                  </tr>
                `
                ).join("")}
              </tbody>
            </table>
          </div>
          <button class="btn btn-secondary" id="cfg-priority-save-btn" style="margin-top:10px;"><i class="fas fa-save"></i> บันทึก Admin Priority</button>
        </div>

        <div style="margin-bottom:20px; border-top:1px dashed #e2e8f0; padding-top:16px;">
          <h4 style="font-size:13px; margin:0 0 8px 0;">Trend Visual</h4>
          <div style="display:flex; gap:20px; align-items:end; flex-wrap:wrap; margin-bottom:10px;">
            <label style="font-size:11px; color:#64748b;">Neutral band (%)
              <input type="number" id="cfg-trend-band" value="${appConfig.trendVisual.neutralBandPercent}" min="0" step="0.5" style="width:100px; display:block; margin-top:4px;">
            </label>
            <label style="font-size:12px; color:#334155; display:flex; align-items:center; gap:6px;">
              <input type="checkbox" id="cfg-trend-interpolate" ${appConfig.trendVisual.interpolateCurrentYear ? "checked" : ""}>
              Interpolate ปีปัจจุบันที่ยังไม่ครบปี
            </label>
          </div>
          <button class="btn btn-secondary" id="cfg-trend-save-btn"><i class="fas fa-save"></i> บันทึก Trend Visual</button>
        </div>

        <div style="border-top:1px dashed #e2e8f0; padding-top:16px;">
          <h4 style="font-size:13px; margin:0 0 8px 0;">Refill Buffer</h4>
          <p class="text-muted" style="font-size:11.5px; margin-top:-4px;">ตัวคูณรอบเติมสินค้าที่คาดการณ์ (ค่าเริ่มต้น 1.1)</p>
          <input type="number" id="cfg-refill-buffer" value="${appConfig.refillBuffer}" min="1" step="0.05" style="width:100px; margin-bottom:10px; display:block;">
          <button class="btn btn-secondary" id="cfg-refill-save-btn"><i class="fas fa-save"></i> บันทึก Refill Buffer</button>
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
      ${statusOptionsCardHtml}
      ${advancedConfigCardHtml}
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

  if (canEditStatusOptions) {
    wireStatusOptionsCard(session);
    wireAdvancedConfigCard(session);
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

// Add/remove rows are plain DOM manipulation (no full renderSettingsView()
// re-render) so typing in one input never gets interrupted by a redraw —
// same reasoning as the Sales Note textarea in js/insighthub.js. Save reads
// current input values straight off the DOM and does a full re-render after
// the server confirms, same as the user-management save buttons above.
function wireStatusOptionsCard(session) {
  const rowsContainer = document.getElementById("status-options-rows");
  const addBtn = document.getElementById("so-add-btn");
  const saveBtn = document.getElementById("so-save-btn");
  if (!rowsContainer || !addBtn || !saveBtn) return;

  function makeRow(value) {
    const row = document.createElement("div");
    row.className = "status-option-row";
    row.style.cssText = "display:flex; gap:8px;";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "so-label";
    input.value = value || "";
    input.style.flexGrow = "1";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-secondary";
    removeBtn.innerHTML = '<i class="fas fa-trash"></i>';
    removeBtn.addEventListener("click", () => row.remove());

    row.appendChild(input);
    row.appendChild(removeBtn);
    return row;
  }

  rowsContainer.querySelectorAll(".so-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".status-option-row").remove());
  });

  addBtn.addEventListener("click", () => {
    const row = makeRow("");
    rowsContainer.appendChild(row);
    row.querySelector("input").focus();
  });

  saveBtn.addEventListener("click", async () => {
    const values = Array.from(rowsContainer.querySelectorAll(".so-label"))
      .map((inp) => inp.value.trim())
      .filter(Boolean);
    const unique = Array.from(new Set(values));
    if (unique.length === 0) {
      window.showToast("ต้องมีสถานะอย่างน้อย 1 รายการ", "error");
      return;
    }
    try {
      await window.CrmApi.saveStatusOptions(session.username, unique.join("|"));
      window.showToast("บันทึกรายการสถานะแล้ว", "success");
      if (window.loadNotesAndStatusOptions) await window.loadNotesAndStatusOptions();
      renderSettingsView();
    } catch (err) {
      window.showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
    }
  });
}

// Each of the 4 sub-sections (Loyalty Index, Admin Priority matrix, Trend
// Visual, Refill Buffer) saves independently via the generic
// CrmApi.saveAppConfig(requestUser, key, valueObj) — same Config_App sheet,
// one row per key (see apps-script/Code.gs). Updates window.AppData.appConfig
// in place + re-renders so buildInsightCustomers picks up the new values
// immediately without a full page reload.
function wireAdvancedConfigCard(session) {
  const loyaltySaveBtn = document.getElementById("cfg-loyalty-save-btn");
  if (!loyaltySaveBtn) return; // card not rendered (not permitted)

  async function saveConfig(key, value, label, btn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    try {
      await window.CrmApi.saveAppConfig(session.username, key, value);
      window.AppData.appConfig[key] = value;
      window.showToast("บันทึก " + label + " แล้ว", "success");
      if (window.applyFilters) window.applyFilters();
    } catch (err) {
      window.showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  loyaltySaveBtn.addEventListener("click", () => {
    const value = {
      seedlingMaxDays: parseInt(document.getElementById("cfg-loyalty-seedling").value, 10) || 45,
      regularMaxDays: parseInt(document.getElementById("cfg-loyalty-regular").value, 10) || 180,
      veteranMaxDays: parseInt(document.getElementById("cfg-loyalty-veteran").value, 10) || 365,
    };
    saveConfig("loyaltyIndex", value, "Loyalty Index", loyaltySaveBtn);
  });

  document.getElementById("cfg-priority-save-btn").addEventListener("click", (e) => {
    const matrix = {};
    document.querySelectorAll(".cfg-priority-cell").forEach((sel) => {
      matrix[sel.dataset.key] = sel.value;
    });
    saveConfig("adminPriorityMatrix", matrix, "Admin Priority", e.currentTarget);
  });

  document.getElementById("cfg-trend-save-btn").addEventListener("click", (e) => {
    const value = {
      neutralBandPercent: parseFloat(document.getElementById("cfg-trend-band").value) || 0,
      interpolateCurrentYear: document.getElementById("cfg-trend-interpolate").checked,
    };
    saveConfig("trendVisual", value, "Trend Visual", e.currentTarget);
  });

  document.getElementById("cfg-refill-save-btn").addEventListener("click", (e) => {
    const value = parseFloat(document.getElementById("cfg-refill-buffer").value) || 1.1;
    saveConfig("refillBuffer", value, "Refill Buffer", e.currentTarget);
  });
}

window.renderSettingsView = renderSettingsView;
