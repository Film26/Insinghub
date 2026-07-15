// js/dashboard.js
// App shell: navigation, data loading (API / file import / sample data), the
// shared row-reading helpers that js/insighthub.js depends on, and the
// Dashboard Overview view itself.

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
// Data loading: API / file import / bundled sample data
// ---------------------------------------------------------------------------

function setRawData(rows) {
  window.AppData.rawData = rows;
  window.AppData.filteredData = rows;
  window.applyFilters();
}

function parseSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === "undefined") {
      reject(new Error("ไลบรารี XLSX โหลดไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.onload = (evt) => {
      try {
        const workbook = XLSX.read(evt.target.result, { type: "array", raw: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const rows = await parseSpreadsheetFile(file);
    if (!rows.length) {
      window.showToast("ไฟล์นี้ไม่มีข้อมูล", "error");
      return;
    }
    setRawData(rows);
    window.showToast("นำเข้าข้อมูล " + rows.length.toLocaleString() + " แถวสำเร็จ", "success");
  } catch (err) {
    window.showToast("นำเข้าไฟล์ไม่สำเร็จ: " + err.message, "error");
  } finally {
    e.target.value = "";
  }
}

async function loadFromApi() {
  const base = window.CrmApi.getBaseUrl();
  if (!base) {
    window.showToast(
      "ยังไม่ได้ตั้งค่า Apps Script URL — ไปที่ Settings หรือใช้ปุ่ม Load Sample Data / Import",
      "error"
    );
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

function getSampleData() {
  // Small embedded dataset so the whole UI (Overview + InsightHub) is explorable
  // with zero Google Sheets setup. Column names match what getRowValue() looks for.
  const rows = [];
  const customers = [
    { phone: "0812345671", name: "Somsri Jaidee", product: "COLLAGEN = 3", price: 1200, channel: "FB", admin: "แอน" },
    { phone: "0812345672", name: "Malee Suk", product: "GOLD = 3", price: 1800, channel: "LINE", admin: "บีม" },
    { phone: "0812345673", name: "Anan Chai", product: "PLUS = 6", price: 950, channel: "IG", admin: "แอน" },
    { phone: "0812345674", name: "Nid Rungrueang", product: "WISS = 2", price: 1500, channel: "WEB", admin: "ซี" },
    { phone: "0812345675", name: "Ploy Wongsakul", product: "KIDES ORIGINAL = 3", price: 3200, channel: "TELESALE", admin: "บีม" },
    { phone: "0812345676", name: "Chai Somboon", product: "GOLD = 2", price: 800, channel: "FB", admin: "ดาว" },
  ];
  // Orders per customer as [daysBeforeMaxDate, revenueMultiplier]
  const schedule = {
    0: [[280, 1], [180, 1.1], [70, 0.9], [10, 1]], // active/refill
    1: [[200, 1], [100, 1]], // risk
    2: [[310, 1]], // churn (single old order)
    3: [[150, 1], [90, 1], [45, 1], [5, 1]], // healthy repeat
    4: [[260, 2], [130, 2], [15, 2]], // high LTV whale
    5: [[20, 1]], // new
  };
  const maxDate = new Date(2025, 11, 20); // 20 Dec 2025 acts as "today" for the sample

  customers.forEach((c, idx) => {
    (schedule[idx] || []).forEach(([daysBefore, mult]) => {
      const d = new Date(maxDate.getTime() - daysBefore * 24 * 60 * 60 * 1000);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      rows.push({
        "วันที่สร้าง": `${dd}/${mm}/${yyyy}`,
        "Phone": c.phone,
        "CustomerName": c.name,
        "Product Set": c.product,
        "ยอดขาย": String(Math.round(c.price * mult)),
        "Order type": "SALE",
        "ช่องทาง": c.channel,
        "ชื่อแอดมิน": c.admin,
        "Remark": "",
      });
    });
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Dashboard Overview view
// ---------------------------------------------------------------------------

function emptyStateHtml(message) {
  return `
    <div class="empty-state">
      <i class="fas fa-database"></i>
      <div>${message}</div>
      <div class="empty-actions">
        <button class="btn btn-primary" onclick="document.getElementById('load-sample-btn').click()">
          <i class="fas fa-flask"></i> Load Sample Data
        </button>
        <button class="btn btn-secondary" onclick="document.getElementById('import-data-btn').click()">
          <i class="fas fa-file-import"></i> Import File
        </button>
      </div>
    </div>
  `;
}

function renderDashboardOverview(filteredData, rawData) {
  const container = document.getElementById("view-dashboard");
  if (!container) return;

  if (!rawData || rawData.length === 0) {
    container.innerHTML = emptyStateHtml("ยังไม่มีข้อมูล กรุณา Import ไฟล์ หรือกดโหลดข้อมูลตัวอย่าง");
    return;
  }

  const saleRows = rawData.filter((r) => window.isSaleOrder(r));
  let totalRevenue = 0;
  const customerSet = new Set();

  saleRows.forEach((r) => {
    const revStr =
      window.getRowValue(r, ["ยอดขาย", "ราคาสินค้ายังไม่รวมภาษี", "Net Sales", "Revenue", "Amount", "ยอดโอน"]) || "0";
    const rev = parseFloat(revStr.toString().replace(/,/g, ""));
    if (!isNaN(rev)) totalRevenue += rev;

    const phone = window.getRowValue(r, ["Phone", "เบอร์โทร", "เบอร์โทรศัพท์"]);
    const name = window.getRowValue(r, ["CustomerName", "ชื่อผู้ส่ง", "Customer ID", "รหัสลูกค้า"]);
    const key = (phone || name || "").toString().trim().toLowerCase();
    if (key) customerSet.add(key);
  });

  const totalOrders = saleRows.length;
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const term = (window.AppData.overviewSearchTerm || "").toLowerCase();
  let recentRows = saleRows.slice();
  if (term) {
    recentRows = recentRows.filter((r) => {
      const name = (window.getRowValue(r, ["CustomerName", "ชื่อผู้ส่ง", "Customer ID", "รหัสลูกค้า"]) || "")
        .toString()
        .toLowerCase();
      const phone = (window.getRowValue(r, ["Phone", "เบอร์โทร", "เบอร์โทรศัพท์"]) || "").toString();
      return name.includes(term) || phone.includes(term);
    });
  }

  recentRows.sort((a, b) => {
    const da = window.parseDate(window.getRowValue(a, ["วันที่สร้าง", "วันที่โอนเงิน", "OrderDate", "Date", "วันที่"]));
    const db = window.parseDate(window.getRowValue(b, ["วันที่สร้าง", "วันที่โอนเงิน", "OrderDate", "Date", "วันที่"]));
    const ta = da ? new Date(da.y, da.m - 1, da.d).getTime() : 0;
    const tb = db ? new Date(db.y, db.m - 1, db.d).getTime() : 0;
    return tb - ta;
  });
  const recentTop = recentRows.slice(0, 10);

  const fmtMoney = (n) => "฿" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const kpiHtml = `
    <div class="overview-kpi-grid">
      <div class="overview-kpi-card">
        <div class="icon"><i class="fas fa-users"></i></div>
        <div class="lbl">Total Customers</div>
        <div class="val">${customerSet.size.toLocaleString()}</div>
      </div>
      <div class="overview-kpi-card">
        <div class="icon"><i class="fas fa-receipt"></i></div>
        <div class="lbl">Total Orders</div>
        <div class="val">${totalOrders.toLocaleString()}</div>
      </div>
      <div class="overview-kpi-card">
        <div class="icon"><i class="fas fa-sack-dollar"></i></div>
        <div class="lbl">Total Revenue</div>
        <div class="val">${fmtMoney(totalRevenue)}</div>
      </div>
      <div class="overview-kpi-card">
        <div class="icon"><i class="fas fa-scale-balanced"></i></div>
        <div class="lbl">Avg. Order Value</div>
        <div class="val">${fmtMoney(aov)}</div>
      </div>
    </div>
  `;

  const rowsHtml = recentTop
    .map((r) => {
      const date = window.getRowValue(r, ["วันที่สร้าง", "วันที่โอนเงิน", "OrderDate", "Date", "วันที่"]) || "-";
      const name = window.getRowValue(r, ["CustomerName", "ชื่อผู้ส่ง", "Customer ID", "รหัสลูกค้า"]) || "-";
      const product = window.getRowValue(r, ["Product Set", "ชื่อสินค้า", "Product", "รายการขาย"]) || "-";
      const revStr =
        window.getRowValue(r, ["ยอดขาย", "ราคาสินค้ายังไม่รวมภาษี", "Net Sales", "Revenue", "Amount", "ยอดโอน"]) || "0";
      const rev = parseFloat(revStr.toString().replace(/,/g, "")) || 0;
      const channel = window.getRowValue(r, ["ช่องทาง", "Channel"]) || "-";
      const admin = window.getNormalizedAdmin(r);
      return `
        <tr>
          <td>${date}</td>
          <td>${name}</td>
          <td>${product}</td>
          <td style="text-align:right; font-weight:600;">${fmtMoney(rev)}</td>
          <td>${channel}</td>
          <td>${admin === "Unknown" ? "-" : admin}</td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    ${kpiHtml}
    <div class="overview-section">
      <h3>Recent Orders${term ? ` (ค้นหา: "${term}")` : ""}</h3>
      <table class="overview-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Customer</th>
            <th>Product</th>
            <th style="text-align:right;">Revenue</th>
            <th>Channel</th>
            <th>Admin</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="6" style="text-align:center; color:#999; padding:20px;">ไม่พบรายการที่ตรงกับคำค้นหา</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
window.renderDashboardOverview = renderDashboardOverview;

// ---------------------------------------------------------------------------
// View dispatch + navigation
// ---------------------------------------------------------------------------

window.applyFilters = function () {
  const view = window.AppData.currentView;
  const rawData = window.AppData.rawData;
  const filteredData = window.AppData.filteredData;

  if (view === "insighthub") {
    if (typeof window.renderInsightHub === "function") {
      window.renderInsightHub(filteredData, rawData);
    }
  } else if (view === "dashboard") {
    renderDashboardOverview(filteredData, rawData);
  }
};

const VIEW_TITLES = {
  dashboard: ["Dashboard Overview", "ภาพรวมข้อมูลลูกค้าและยอดขาย"],
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

  document.getElementById("import-data-btn").addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });
  document.getElementById("import-file-input").addEventListener("change", handleImportFile);
  document.getElementById("load-sample-btn").addEventListener("click", () => {
    setRawData(getSampleData());
    window.showToast("โหลดข้อมูลตัวอย่างสำเร็จ", "success");
  });
  document.getElementById("refresh-data-btn").addEventListener("click", loadFromApi);

  switchView("dashboard");
  if (window.CrmApi.getBaseUrl()) {
    loadFromApi();
  }
});
