// js/settings.js
// Renders the Settings view: Apps Script connection, account info, and data controls.
// Invoked on-demand by dashboard.js (window.renderSettingsView) whenever that view is opened.

function settingsRowCount() {
  return (window.AppData && window.AppData.rawData ? window.AppData.rawData.length : 0);
}

function renderSettingsView() {
  const container = document.getElementById("view-settings");
  if (!container) return;

  const session = window.CrmAuth ? window.CrmAuth.getSession() : null;
  const currentBaseUrl = window.CrmApi.getBaseUrl();
  const rowsPerPage = (window.insightHubState && window.insightHubState.rowsPerPage) || 100;

  container.innerHTML = `
    <div class="settings-grid">
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

      <div class="settings-card">
        <h3><i class="fas fa-user-shield"></i> บัญชีผู้ใช้งาน</h3>
        <div class="settings-row">
          <label>ชื่อผู้ใช้</label>
          <strong>${session ? session.username : "-"}</strong>
        </div>
        <div class="settings-row">
          <label>สิทธิ์การใช้งาน</label>
          <strong>${session ? session.role : "-"}</strong>
        </div>
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
    </div>
  `;

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

window.renderSettingsView = renderSettingsView;
