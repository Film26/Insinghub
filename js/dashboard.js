// js/dashboard.js

window.AppData = {
  rawData: [],
  filteredData: [],
  currentView: "dashboard",
  overviewSearchTerm: "",
};

// ---------------------------------------------------------------------------
// Shared row helpers (consumed by js/insighthub.js via window.*)
// ---------------------------------------------------------------------------

const __rowKeyCache = new WeakMap();

function __normalizeKey(k) {
  return k.toString().trim().toLowerCase().replace(/\s+/g, "");
}

function __getNormalizedRowMap(row) {
  let map = __rowKeyCache.get(row);
  if (!map) {
    map = {};
    for (const k in row) {
      if (Object.prototype.hasOwnProperty.call(row, k)) {
        map[__normalizeKey(k)] = row[k];
      }
    }
    __rowKeyCache.set(row, map);
  }
  return map;
}

// Looks up the first non-empty value among several possible column-name spellings.
window.getRowValue = function (row, keys) {
  if (!row) return "";
  const map = __getNormalizedRowMap(row);
  for (let i = 0; i < keys.length; i++) {
    const val = map[__normalizeKey(keys[i])];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      return val;
    }
  }
  return "";
};

// Parses common date formats into {y, m, d}. Accepts Date objects, ISO
// (YYYY-MM-DD), and DD/MM/YYYY-style strings; falls back to Date parsing.
window.parseDate = function (dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    if (isNaN(dateStr.getTime())) return null;
    return { y: dateStr.getFullYear(), m: dateStr.getMonth() + 1, d: dateStr.getDate() };
  }
  const s = dateStr.toString().trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };

  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };

  const d = new Date(s);
  if (!isNaN(d.getTime())) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  return null;
};

const SALE_EXCLUDE_PATTERN = /ยกเลิก|คืนเงิน|คืนสินค้า|refund|cancel|void|return/i;

// Treats a row as a real sale unless an order-type/status column says otherwise;
// rows/files without such a column are all counted as sales.
window.isSaleOrder = function (row) {
  const typeVal = window.getRowValue(row, [
    "Order type",
    "OrderType",
    "ประเภทเอกสาร",
    "ประเภท",
    "สถานะ",
    "DocType",
    "Document Type",
    "Status",
    "Type",
  ]);
  if (!typeVal) return true;
  return !SALE_EXCLUDE_PATTERN.test(typeVal.toString());
};

window.getNormalizedAdmin = function (row) {
  const admin = window.getRowValue(row, ["ชื่อแอดมิน", "Admin", "Admin Name"]);
  const trimmed = (admin || "").toString().trim();
  return trimmed || "Unknown";
};

// ---------------------------------------------------------------------------
// Toast helper (shared with settings.js)
// ---------------------------------------------------------------------------

window.showToast = function (message, type) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
};

// ---------------------------------------------------------------------------
// Data loading: Google Sheets via the Apps Script API only
// ---------------------------------------------------------------------------

function setRawData(rows) {
  window.AppData.rawData = rows;
  window.AppData.filteredData = rows;
  window.applyFilters();
}

async function loadFromApi() {
  const base = window.CrmApi.getBaseUrl();
  if (!base) {
    window.showToast("ยังไม่ได้เชื่อมต่อ Google Sheets — ไปที่ Settings เพื่อตั้งค่า Apps Script URL", "error");
    return;
  }
  try {
    window.showToast("กำลังโหลดข้อมูลจาก Google Sheets...", "");
    const result = await window.CrmApi.getOrders();
    const rows = result.rows || result.data || [];
    setRawData(rows);
    const sheetNote = result.sheetName ? ` (ชีต "${result.sheetName}")` : "";
    window.showToast("โหลดข้อมูล " + rows.length.toLocaleString() + " แถวสำเร็จ" + sheetNote, "success");
  } catch (err) {
    window.showToast("โหลดข้อมูลไม่สำเร็จ: " + err.message, "error");
  }
}

// ---------------------------------------------------------------------------
// Dashboard: Team Report + Individual Admin report (role-scoped)
// ---------------------------------------------------------------------------

const REVENUE_KEYS = ["ยอดขาย", "ราคาสินค้ายังไม่รวมภาษี", "Net Sales", "Revenue", "Amount", "ยอดโอน"];
const DATE_KEYS = ["วันที่สร้าง", "วันที่โอนเงิน", "OrderDate", "Date", "วันที่"];
const NAME_KEYS = ["CustomerName", "ชื่อผู้ส่ง", "Customer ID", "รหัสลูกค้า"];
const PHONE_KEYS = ["Phone", "เบอร์โทร", "เบอร์โทรศัพท์"];

function fmtMoney(n) {
  return "฿" + Math.round(n || 0).toLocaleString();
}

function getRowRevenue(row) {
  const revStr = window.getRowValue(row, REVENUE_KEYS) || "0";
  const rev = parseFloat(revStr.toString().replace(/,/g, ""));
  return isNaN(rev) ? 0 : rev;
}

function getRowDateTime(row) {
  const parsed = window.parseDate(window.getRowValue(row, DATE_KEYS));
  return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d).getTime() : 0;
}

function getCustomerKeyLite(row) {
  const phone = window.getRowValue(row, PHONE_KEYS);
  const name = window.getRowValue(row, NAME_KEYS);
  return (phone || name || "").toString().trim().toLowerCase();
}

// Buckets the raw channel value into the 3 groups referenced in the Team
// Report (matches window.standardizeChannel()'s main channels, defined in
// js/insighthub.js, once that script has loaded).
const CHANNEL_GROUP_MAP = {
  Facebook: "Online",
  Instagram: "Online",
  Line: "Online",
  Website: "Online",
  Email: "Online",
  CRM: "Online",
  Telesale: "Online",
  Call: "Online",
  Lazada: "Marketplace",
  Shopee: "Marketplace",
  Tiktok: "Marketplace",
  PC: "Offline/Other",
  Other: "Offline/Other",
};
function getChannelGroup(row) {
  const raw = window.getRowValue(row, ["ช่องทาง", "Channel"]);
  if (!raw) return "Offline/Other";
  if (typeof window.standardizeChannel === "function") {
    const std = window.standardizeChannel(raw);
    return CHANNEL_GROUP_MAP[std.mainChannel] || "Offline/Other";
  }
  return "Offline/Other";
}

// Per-admin (ชื่อแอดมิน) aggregation used by both the Team Report's
// performance table and the Individual Admin report.
function buildAdminStats(rows) {
  const map = {};
  rows.forEach((r) => {
    if (!window.isSaleOrder(r)) return;
    const admin = window.getNormalizedAdmin(r);
    if (!map[admin]) map[admin] = { admin, orders: 0, revenue: 0, customers: new Set() };
    map[admin].orders += 1;
    map[admin].revenue += getRowRevenue(r);
    const key = getCustomerKeyLite(r);
    if (key) map[admin].customers.add(key);
  });
  return Object.values(map)
    .map((a) => ({
      admin: a.admin,
      orders: a.orders,
      revenue: a.revenue,
      customers: a.customers.size,
      aov: a.orders > 0 ? a.revenue / a.orders : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function emptyStateHtml(message) {
  return `
    <div class="empty-state">
      <i class="fas fa-database"></i>
      <div>${message}</div>
      <div class="empty-actions">
        <button class="btn btn-primary" onclick="document.getElementById('refresh-data-btn').click()">
          <i class="fas fa-rotate"></i> Refresh
        </button>
        <button class="btn btn-secondary" onclick="document.querySelector('.nav-item[data-view=\\'settings\\']').click()">
          <i class="fas fa-gear"></i> ไปที่ Settings
        </button>
      </div>
    </div>
  `;
}

function buildRecentOrdersTable(rows, limit) {
  const term = (window.AppData.overviewSearchTerm || "").toLowerCase();
  let filtered = rows;
  if (term) {
    filtered = rows.filter((r) => {
      const name = (window.getRowValue(r, NAME_KEYS) || "").toString().toLowerCase();
      const phone = (window.getRowValue(r, PHONE_KEYS) || "").toString();
      return name.includes(term) || phone.includes(term);
    });
  }
  const sorted = filtered.slice().sort((a, b) => getRowDateTime(b) - getRowDateTime(a));
  const top = sorted.slice(0, limit);

  const rowsHtml = top
    .map((r) => {
      const date = window.getRowValue(r, DATE_KEYS) || "-";
      const name = window.getRowValue(r, NAME_KEYS) || "-";
      const product = window.getRowValue(r, ["Product Set", "ชื่อสินค้า", "Product", "รายการขาย"]) || "-";
      const channel = window.getRowValue(r, ["ช่องทาง", "Channel"]) || "-";
      const admin = window.getNormalizedAdmin(r);
      return `
        <tr>
          <td>${date}</td>
          <td>${name}</td>
          <td>${product}</td>
          <td style="text-align:right; font-weight:600;">${fmtMoney(getRowRevenue(r))}</td>
          <td>${channel}</td>
          <td>${admin === "Unknown" ? "-" : admin}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <table class="overview-table">
      <thead>
        <tr>
          <th>Date</th><th>Customer</th><th>Product</th>
          <th style="text-align:right;">Revenue</th><th>Channel</th><th>Admin</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="6" style="text-align:center; color:#999; padding:20px;">ไม่พบรายการที่ตรงกับคำค้นหา</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderTeamReport(container, rawData, session) {
  const saleRows = rawData.filter((r) => window.isSaleOrder(r));
  const totalRevenue = saleRows.reduce((sum, r) => sum + getRowRevenue(r), 0);
  const customerSet = new Set(saleRows.map(getCustomerKeyLite).filter(Boolean));
  const totalOrders = saleRows.length;
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const channelTotals = { Online: 0, Marketplace: 0, "Offline/Other": 0 };
  saleRows.forEach((r) => {
    channelTotals[getChannelGroup(r)] += getRowRevenue(r);
  });
  const maxChannelRevenue = Math.max(1, ...Object.values(channelTotals));

  const adminStats = buildAdminStats(rawData);

  const confidentialHtml =
    session.role === window.CrmRoles.ROLES.SUPER_ADMIN
      ? `
    <div class="overview-section confidential-card">
      <h3><i class="fas fa-lock"></i> ข้อมูลระดับความลับ (Super Admin เท่านั้น)</h3>
      <p class="confidential-placeholder">
        ยังไม่มีคอลัมน์ต้นทุน (เช่น "ต้นทุน"/"Cost") ในชีต Orders และยังไม่มีการบันทึกงบประมาณการตลาดไว้ในระบบ —
        เพิ่มคอลัมน์เหล่านี้ในชีต Orders (หรือแจ้งให้เพิ่มฟีเจอร์บันทึกงบประมาณ) เพื่อให้ Super Admin
        เห็นต้นทุน/กำไรสุทธิ และงบประมาณการตลาดภาพรวมที่นี่
      </p>
    </div>
  `
      : "";

  container.innerHTML = `
    <div class="overview-kpi-grid">
      <div class="overview-kpi-card"><div class="icon"><i class="fas fa-users"></i></div><div class="lbl">Total Customers</div><div class="val">${customerSet.size.toLocaleString()}</div></div>
      <div class="overview-kpi-card"><div class="icon"><i class="fas fa-receipt"></i></div><div class="lbl">Total Orders</div><div class="val">${totalOrders.toLocaleString()}</div></div>
      <div class="overview-kpi-card"><div class="icon"><i class="fas fa-sack-dollar"></i></div><div class="lbl">Total Revenue</div><div class="val">${fmtMoney(totalRevenue)}</div></div>
      <div class="overview-kpi-card"><div class="icon"><i class="fas fa-scale-balanced"></i></div><div class="lbl">Avg. Order Value</div><div class="val">${fmtMoney(aov)}</div></div>
    </div>

    <div class="overview-section">
      <h3>ยอดขายแยกตามช่องทาง (Online / Marketplace / Offline)</h3>
      ${Object.keys(channelTotals)
        .map(
          (group) => `
        <div class="channel-bar-row">
          <div class="channel-bar-label">${group}</div>
          <div class="channel-bar-track"><div class="channel-bar-fill" style="width:${(channelTotals[group] / maxChannelRevenue) * 100}%"></div></div>
          <div class="channel-bar-value">${fmtMoney(channelTotals[group])}</div>
        </div>
      `
        )
        .join("")}
    </div>

    <div class="overview-section">
      <h3>ผลงานทีมแยกรายแอดมิน</h3>
      <table class="overview-table">
        <thead>
          <tr><th>Admin</th><th style="text-align:right;">Orders</th><th style="text-align:right;">Revenue</th><th style="text-align:right;">AOV</th><th style="text-align:right;">Customers</th></tr>
        </thead>
        <tbody>
          ${adminStats
            .map(
              (a) => `
            <tr>
              <td style="font-weight:600;">${a.admin === "Unknown" ? "-" : a.admin}</td>
              <td style="text-align:right;">${a.orders.toLocaleString()}</td>
              <td style="text-align:right; font-weight:600;">${fmtMoney(a.revenue)}</td>
              <td style="text-align:right;">${fmtMoney(a.aov)}</td>
              <td style="text-align:right;">${a.customers.toLocaleString()}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>

    ${confidentialHtml}

    <div class="overview-section">
      <h3>Recent Orders${window.AppData.overviewSearchTerm ? ` (ค้นหา: "${window.AppData.overviewSearchTerm}")` : ""}</h3>
      ${buildRecentOrdersTable(saleRows, 10)}
    </div>
  `;
}

function renderIndividualAdminReport(container, rawData, session) {
  const adminStats = buildAdminStats(rawData);
  const isLocked = session.role === window.CrmRoles.ROLES.SALES_ADMIN;

  if (isLocked && !session.adminName) {
    container.innerHTML = `
      <div class="locked-note">
        <i class="fas fa-triangle-exclamation"></i>
        บัญชีนี้ยังไม่ได้ผูก AdminName กับข้อมูลออเดอร์ — กรุณาแจ้ง Super Admin ให้ตั้งค่า AdminName
        ในหน้า Settings &gt; จัดการผู้ใช้งาน ให้ตรงกับคอลัมน์ "ชื่อแอดมิน" ในชีต Orders
      </div>
    `;
    return;
  }

  const options = isLocked ? [session.adminName] : adminStats.map((a) => a.admin);
  if (!isLocked && options.length === 0) {
    container.innerHTML = emptyStateHtml("ยังไม่มีข้อมูลออเดอร์ให้แสดงรายงานรายบุคคล");
    return;
  }

  let selected = window.AppData.selectedAdminFilter;
  if (isLocked) selected = session.adminName;
  if (!selected || !options.includes(selected)) selected = options[0];
  window.AppData.selectedAdminFilter = selected;

  const stat = adminStats.find((a) => a.admin === selected) || { orders: 0, revenue: 0, aov: 0, customers: 0 };
  const adminRows = rawData.filter((r) => window.isSaleOrder(r) && window.getNormalizedAdmin(r) === selected);

  container.innerHTML = `
    <div class="admin-picker-row">
      <label for="admin-report-picker">เลือกแอดมิน:</label>
      <select id="admin-report-picker" ${isLocked ? "disabled" : ""}>
        ${options.map((o) => `<option value="${o}" ${o === selected ? "selected" : ""}>${o === "Unknown" ? "(ไม่ระบุ)" : o}</option>`).join("")}
      </select>
      ${isLocked ? '<span class="text-muted" style="font-size:12px;"><i class="fas fa-lock"></i> ล็อกเฉพาะบัญชีของคุณ</span>' : ""}
    </div>

    <div class="overview-kpi-grid">
      <div class="overview-kpi-card"><div class="icon"><i class="fas fa-receipt"></i></div><div class="lbl">Orders Handled</div><div class="val">${stat.orders.toLocaleString()}</div></div>
      <div class="overview-kpi-card"><div class="icon"><i class="fas fa-sack-dollar"></i></div><div class="lbl">Revenue</div><div class="val">${fmtMoney(stat.revenue)}</div></div>
      <div class="overview-kpi-card"><div class="icon"><i class="fas fa-scale-balanced"></i></div><div class="lbl">Avg. Order Value</div><div class="val">${fmtMoney(stat.aov)}</div></div>
      <div class="overview-kpi-card"><div class="icon"><i class="fas fa-users"></i></div><div class="lbl">Customers Handled</div><div class="val">${stat.customers.toLocaleString()}</div></div>
    </div>

    <div class="overview-section">
      <h3>ออเดอร์ล่าสุดของ ${selected === "Unknown" ? "(ไม่ระบุ)" : selected}${window.AppData.overviewSearchTerm ? ` (ค้นหา: "${window.AppData.overviewSearchTerm}")` : ""}</h3>
      ${buildRecentOrdersTable(adminRows, 15)}
    </div>
  `;

  if (!isLocked) {
    document.getElementById("admin-report-picker").addEventListener("change", (e) => {
      window.AppData.selectedAdminFilter = e.target.value;
      window.applyFilters();
    });
  }
}

function renderDashboardOverview(filteredData, rawData) {
  const container = document.getElementById("view-dashboard");
  if (!container) return;

  const session = (window.CrmAuth && window.CrmAuth.getSession()) || { role: window.CrmRoles.ROLES.SALES_ADMIN };
  const ROLES = window.CrmRoles.ROLES;

  if (!rawData || rawData.length === 0) {
    container.innerHTML = emptyStateHtml(
      window.CrmApi.getBaseUrl()
        ? "ยังไม่มีข้อมูลในชีต Orders หรือโหลดไม่สำเร็จ ลองกด Refresh อีกครั้ง"
        : "ยังไม่ได้เชื่อมต่อ Google Sheets กรุณาไปที่ Settings เพื่อตั้งค่า Apps Script URL"
    );
    return;
  }

  // Sales Admin only ever sees their own individual report — Team Report
  // (channel splits, team-wide admin comparison) is manager/super_admin only.
  const canSeeTeamReport = session.role !== ROLES.SALES_ADMIN;
  if (!canSeeTeamReport) window.AppData.dashboardTab = "individual";
  if (!window.AppData.dashboardTab) window.AppData.dashboardTab = "team";

  const tabsHtml = `
    <div class="dash-subtabs">
      <button class="dash-subtab-btn ${window.AppData.dashboardTab === "team" ? "active" : ""}"
              id="dash-tab-team" ${canSeeTeamReport ? "" : "disabled title=\"Sales Admin ไม่มีสิทธิ์ดูรายงานทีม\""}>
        <i class="fas fa-people-group"></i> รายงานทีม
      </button>
      <button class="dash-subtab-btn ${window.AppData.dashboardTab === "individual" ? "active" : ""}" id="dash-tab-individual">
        <i class="fas fa-user"></i> แอดมินรายบุคคล
      </button>
    </div>
    <div id="dash-report-body"></div>
  `;
  container.innerHTML = tabsHtml;

  const body = document.getElementById("dash-report-body");
  if (window.AppData.dashboardTab === "team" && canSeeTeamReport) {
    renderTeamReport(body, rawData, session);
  } else {
    renderIndividualAdminReport(body, rawData, session);
  }

  if (canSeeTeamReport) {
    document.getElementById("dash-tab-team").addEventListener("click", () => {
      window.AppData.dashboardTab = "team";
      window.applyFilters();
    });
  }
  document.getElementById("dash-tab-individual").addEventListener("click", () => {
    window.AppData.dashboardTab = "individual";
    window.applyFilters();
  });
}
window.renderDashboardOverview = renderDashboardOverview;

// ---------------------------------------------------------------------------
// View dispatch + navigation
// ---------------------------------------------------------------------------

window.applyFilters = function () {
  const view = window.AppData.currentView;
  const rawData = window.AppData.rawData;
  let filteredData = window.AppData.filteredData;

  if (view === "insighthub") {
    const session = (window.CrmAuth && window.CrmAuth.getSession()) || {};
    // Sales Admin only sees customers/orders that belong to their own AdminName —
    // scoped here (not in insighthub.js) since it builds its customer list from
    // this same rawData argument.
    if (session.role === window.CrmRoles.ROLES.SALES_ADMIN && session.adminName) {
      const scoped = rawData.filter((r) => window.getNormalizedAdmin(r) === session.adminName);
      filteredData = scoped;
      if (typeof window.renderInsightHub === "function") window.renderInsightHub(scoped, scoped);
      return;
    }
    if (typeof window.renderInsightHub === "function") {
      window.renderInsightHub(filteredData, rawData);
    }
  } else if (view === "dashboard") {
    renderDashboardOverview(filteredData, rawData);
  }
};

const VIEW_TITLES = {
  dashboard: ["Dashboard", "รายงานทีมและแอดมินรายบุคคล"],
  insighthub: ["Customer InsightHub", "วิเคราะห์เชิงลึกรายลูกค้า"],
  settings: ["Settings", "ตั้งค่าการเชื่อมต่อและระบบ"],
};

function switchView(viewName) {
  window.AppData.currentView = viewName;

  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === viewName));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + viewName));

  const [title, subtitle] = VIEW_TITLES[viewName] || ["", ""];
  document.getElementById("page-title").textContent = title;
  document.getElementById("page-subtitle").textContent = subtitle;

  const searchBox = document.getElementById("global-search");
  if (searchBox) searchBox.style.display = viewName === "settings" ? "none" : "";

  if (viewName === "settings" && typeof window.renderSettingsView === "function") {
    window.renderSettingsView();
  } else {
    window.applyFilters();
  }
}

document.addEventListener("DOMContentLoaded", function () {
  if (window.CrmAuth && !window.CrmAuth.getSession()) return; // auth.js is already redirecting

  document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", () => switchView(el.dataset.view));
  });

  const searchBox = document.getElementById("global-search");
  if (searchBox) {
    searchBox.addEventListener("input", (e) => {
      const term = e.target.value;
      if (window.AppData.currentView === "insighthub" && window.insightHubState) {
        window.insightHubState.searchTerm = term;
        window.insightHubState.currentPage = 1;
        window.applyFilters();
      } else if (window.AppData.currentView === "dashboard") {
        window.AppData.overviewSearchTerm = term;
        window.applyFilters();
      }
    });
  }

  document.getElementById("refresh-data-btn").addEventListener("click", loadFromApi);

  switchView("dashboard");
  if (window.CrmApi.getBaseUrl()) {
    loadFromApi();
  }
});
