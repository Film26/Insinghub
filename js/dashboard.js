// js/dashboard.js

window.DEFAULT_STATUS_OPTIONS = ["คุยแล้ว", "ยังไม่รับสาย", "ไม่สะดวกให้โทร", "ไม่ได้ทานแล้ว", "สนใจซื้อซ้ำ", "รอโปรโมชั่น", "ขอคิดดูก่อน", "ปิดการขายแล้ว", "เปลี่ยนไปใช้ยี่ห้ออื่น", "ติดต่อไม่ได้", "เบอร์ผิด/ไม่ใช่ลูกค้า"];

window.AppData = {
  rawData: [],
  filteredData: [],
  currentView: "dashboard",
  overviewSearchTerm: "",
  notesByKey: {},
  statusOptions: window.DEFAULT_STATUS_OPTIONS.slice(),
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
  // Independent of order loading above — Sales Note/status-config sheets are
  // optional and newer than the Orders sheet, so a failure here (e.g. sheet
  // not created yet) shouldn't block or error out the main data load.
  loadNotesAndStatusOptions();
}

// Fetches saved customer notes + the configurable contact-status list, and
// rebuilds window.AppData.notesByKey (CustomerKey -> latest note/statuses).
// Called on every Refresh, and again after a note or status-option save so
// the InsightHub list/profile reflect the change immediately.
async function loadNotesAndStatusOptions() {
  if (!window.CrmApi.getBaseUrl()) return;

  try {
    const notesResult = await window.CrmApi.getNotes();
    const notesByKey = {};
    (notesResult.rows || []).forEach((row) => {
      const key = (row.CustomerKey || "").toString().trim();
      if (!key) return;
      const statusesRaw = (row.Statuses || "").toString();
      notesByKey[key] = {
        note: (row.Note || "").toString(),
        statuses: statusesRaw ? statusesRaw.split("|").map((s) => s.trim()).filter(Boolean) : [],
        updatedAt: row.UpdatedAt || "",
        updatedBy: row.UpdatedBy || "",
      };
    });
    window.AppData.notesByKey = notesByKey;
  } catch (err) {
    console.warn("[loadNotesAndStatusOptions] โหลด CustomerNotes ไม่สำเร็จ:", err.message);
  }

  try {
    const statusResult = await window.CrmApi.getStatusOptions();
    if (statusResult.options && statusResult.options.length) {
      window.AppData.statusOptions = statusResult.options;
    }
  } catch (err) {
    console.warn("[loadNotesAndStatusOptions] โหลดสถานะการติดต่อไม่สำเร็จ:", err.message);
  }

  // Orders may already have rendered the list before this resolves (it's
  // fetched in parallel, not awaited by the initial load) — re-render so the
  // note/status overlay shows up without the user having to interact first.
  if (window.applyFilters) window.applyFilters();
}
window.loadNotesAndStatusOptions = loadNotesAndStatusOptions;

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

// ---------------------------------------------------------------------------
// Customer Tier / Segment aggregates for the Dashboard's Team Report + Admin
// Priority section. Built on window.buildInsightCustomers (js/insighthub.js)
// so counts always match the Customer InsightHub page — one computation, two
// pages reading it.
// ---------------------------------------------------------------------------

const TIER_ORDER = ["Diamond", "Platinum", "Gold", "Silver", "Junior"];
const TIER_COLORS = {
  Diamond: "#2a78d6",
  Platinum: "#4a3aa7",
  Gold: "#eda100",
  Silver: "#1baf7a",
  Junior: "#008300",
};
const SEGMENT1_ORDER = ["NEW", "ACTIVE", "RISK", "CHURN"];
const SEGMENT1_ICON = { NEW: "fa-star", ACTIVE: "fa-bolt", RISK: "fa-triangle-exclamation", CHURN: "fa-user-slash" };
const SEGMENT2_ORDER = ["NEW", "ACTIVE", "REFILL", "RISK", "CHURN"];
const ADMIN_PRIORITY_ORDER = ["High", "Medium", "Low", "Win-back"];
const ADMIN_PRIORITY_META = {
  High: { icon: "fa-fire", label: "โอกาสสร้างยอดขายสูง" },
  Medium: { icon: "fa-handshake", label: "โอกาสสร้างยอดขายปานกลาง" },
  Low: { icon: "fa-heart", label: "ดูแลความสัมพันธ์" },
  "Win-back": { icon: "fa-rotate-left", label: "โอกาสดึงลูกค้ากลับ" },
};

function pctStr(n, total) {
  return total > 0 ? ((n / total) * 100).toFixed(1) : "0.0";
}

function buildDashboardAggregates(rawData) {
  const { customers } = window.buildInsightCustomers(rawData);
  const tierCounts = { Diamond: 0, Platinum: 0, Gold: 0, Silver: 0, Junior: 0 };
  const segment1Counts = { NEW: 0, ACTIVE: 0, RISK: 0, CHURN: 0 };
  const segment2Counts = { NEW: 0, ACTIVE: 0, REFILL: 0, RISK: 0, CHURN: 0 };

  customers.forEach((c) => {
    const tier = window.getAnnualTier(c.totalRevenue);
    if (tier && tierCounts[tier] !== undefined) tierCounts[tier]++;
    if (segment1Counts[c.segment1] !== undefined) segment1Counts[c.segment1]++;
    if (segment2Counts[c.segment2] !== undefined) segment2Counts[c.segment2]++;
  });

  return { customers, tierCounts, segment1Counts, segment2Counts, total: customers.length };
}

// adminPriority values are e.g. "1. 🟢 High (โอกาสสร้างยอดขาย)" — group by the
// English keyword, same convention getAdminPriClass() uses in js/insighthub.js.
function countAdminPriorities(customers) {
  const counts = { High: 0, Medium: 0, Low: 0, "Win-back": 0 };
  customers.forEach((c) => {
    const key = ADMIN_PRIORITY_ORDER.find((k) => c.adminPriority.includes(k));
    if (key) counts[key]++;
  });
  return counts;
}

const TREND_MONTH_LABELS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function getAdminYearRange(rawData) {
  const years = new Set();
  rawData.forEach((r) => {
    if (!window.isSaleOrder(r)) return;
    const d = window.parseDate(window.getRowValue(r, DATE_KEYS));
    if (d) years.add(d.y);
  });
  return Array.from(years).sort((a, b) => a - b);
}

// yearFilter: a specific year (number/string), or "all" for one point per year.
function buildAdminTrendSeries(rawData, adminName, yearFilter) {
  const rows = rawData.filter((r) => window.isSaleOrder(r) && window.getNormalizedAdmin(r) === adminName);

  if (yearFilter === "all") {
    const years = getAdminYearRange(rawData);
    const totals = years.map((y) =>
      rows.reduce((sum, r) => {
        const d = window.parseDate(window.getRowValue(r, DATE_KEYS));
        return d && d.y === y ? sum + getRowRevenue(r) : sum;
      }, 0)
    );
    return { labels: years.map(String), data: totals };
  }

  const monthTotals = new Array(12).fill(0);
  rows.forEach((r) => {
    const d = window.parseDate(window.getRowValue(r, DATE_KEYS));
    if (d && d.y === Number(yearFilter)) monthTotals[d.m - 1] += getRowRevenue(r);
  });
  return { labels: TREND_MONTH_LABELS, data: monthTotals };
}

// ---------------------------------------------------------------------------
// Chart.js wiring — every chart canvas is re-created on each re-render (the
// container's innerHTML is replaced wholesale each time), so instances are
// tracked by canvas id and destroyed before a new one is built; Chart.js
// throws/leaks if a canvas that already has a live chart gets reused.
// ---------------------------------------------------------------------------

window.__dashboardCharts = window.__dashboardCharts || {};

function renderChartInto(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;
  if (window.__dashboardCharts[canvasId]) {
    window.__dashboardCharts[canvasId].destroy();
  }
  const chart = new Chart(canvas.getContext("2d"), config);
  window.__dashboardCharts[canvasId] = chart;
  return chart;
}

// Draws a leader line + label outside the donut for slices under `threshold`
// share of the total — Chart.js has no built-in outside-label support, so
// this small plugin does it directly on the canvas after Chart.js draws.
const tierOutlabelsPlugin = {
  id: "tierOutlabels",
  afterDraw(chart, args, opts) {
    if (!opts || !opts.enabled) return;
    const meta = chart.getDatasetMeta(0);
    const dataset = chart.data.datasets[0];
    const total = dataset.data.reduce((a, b) => a + b, 0);
    if (!total) return;
    const { ctx } = chart;

    meta.data.forEach((arc, i) => {
      const value = dataset.data[i];
      if (!value) return;
      const share = value / total;
      if (share >= opts.threshold) return; // big slices already read fine in the legend

      const angle = (arc.startAngle + arc.endAngle) / 2;
      const cx = arc.x, cy = arc.y;
      const outerR = arc.outerRadius;
      const startX = cx + Math.cos(angle) * outerR;
      const startY = cy + Math.sin(angle) * outerR;
      const bendR = outerR + 14;
      const bendX = cx + Math.cos(angle) * bendR;
      const bendY = cy + Math.sin(angle) * bendR;
      const isRight = Math.cos(angle) >= 0;
      const labelX = bendX + (isRight ? 16 : -16);

      ctx.save();
      ctx.strokeStyle = "#c3c2b7";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(bendX, bendY);
      ctx.lineTo(labelX, bendY);
      ctx.stroke();

      ctx.fillStyle = "#334155";
      ctx.font = "600 11px Inter, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = isRight ? "left" : "right";
      ctx.fillText(
        `${chart.data.labels[i]}: ${value} (${(share * 100).toFixed(1)}%)`,
        labelX + (isRight ? 4 : -4),
        bendY
      );
      ctx.restore();
    });
  },
};
if (typeof Chart !== "undefined") Chart.register(tierOutlabelsPlugin);

function buildTierDonutConfig(tierCounts, total) {
  return {
    type: "doughnut",
    data: {
      labels: TIER_ORDER,
      datasets: [{
        data: TIER_ORDER.map((t) => tierCounts[t]),
        backgroundColor: TIER_ORDER.map((t) => TIER_COLORS[t]),
        borderColor: "#fff",
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      layout: { padding: 44 }, // room for outside callout labels
      plugins: {
        legend: { display: false }, // custom legend below shows count + %
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.parsed.toLocaleString()} (${pctStr(ctx.parsed, total)}%)`,
          },
        },
        tierOutlabels: { enabled: true, threshold: 0.05 },
      },
    },
  };
}

function buildTrendLineConfig(series, yearFilter) {
  return {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [{
        label: yearFilter === "all" ? "ยอดขายรายปี" : "ยอดขายรายเดือน",
        data: series.data,
        borderColor: "#d95f1d",
        backgroundColor: "rgba(217, 95, 29, 0.12)",
        pointBackgroundColor: "#d95f1d",
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => fmtMoney(ctx.parsed.y) },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => fmtMoney(v) },
          grid: { color: "#f1f5f9" },
        },
        x: { grid: { display: false } },
      },
    },
  };
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
  const dashAgg = buildDashboardAggregates(rawData);

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
      <h3>สัดส่วน Tier ลูกค้า (Customer Tier Distribution)</h3>
      <div class="tier-donut-row">
        <div class="tier-donut-canvas-wrap"><canvas id="team-tier-donut"></canvas></div>
        <div class="tier-legend">
          ${TIER_ORDER.map(
            (t) => `
            <div class="tier-legend-row">
              <span class="tier-legend-dot" style="background:${TIER_COLORS[t]}"></span>
              <span class="tier-legend-name">${t}</span>
              <span class="tier-legend-count">${dashAgg.tierCounts[t].toLocaleString()}</span>
              <span class="tier-legend-pct">${pctStr(dashAgg.tierCounts[t], dashAgg.total)}%</span>
            </div>
          `
          ).join("")}
        </div>
      </div>
    </div>

    <div class="overview-section">
      <h3>Segment ลูกค้า (Customer Segments)</h3>
      <div class="overview-kpi-grid">
        ${SEGMENT1_ORDER.map(
          (seg) => `
          <div class="overview-kpi-card">
            <div class="icon"><i class="fas ${SEGMENT1_ICON[seg]}"></i></div>
            <div class="lbl">${seg}</div>
            <div class="val">${dashAgg.segment1Counts[seg].toLocaleString()}</div>
            <div class="pct">${pctStr(dashAgg.segment1Counts[seg], dashAgg.total)}%</div>
          </div>
        `
        ).join("")}
      </div>
    </div>

    <div class="overview-section">
      <h3>RFM Segment (รอบเติมสินค้ารายบุคคล)</h3>
      <table class="overview-table">
        <thead>
          <tr><th>Segment</th><th style="text-align:right;">จำนวนคน</th><th style="text-align:right;">สัดส่วน %</th></tr>
        </thead>
        <tbody>
          ${SEGMENT2_ORDER.map(
            (seg) => `
            <tr>
              <td style="font-weight:600;">${seg}</td>
              <td style="text-align:right;">${dashAgg.segment2Counts[seg].toLocaleString()}</td>
              <td style="text-align:right;">${pctStr(dashAgg.segment2Counts[seg], dashAgg.total)}%</td>
            </tr>
          `
          ).join("")}
        </tbody>
      </table>
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

  renderChartInto("team-tier-donut", buildTierDonutConfig(dashAgg.tierCounts, dashAgg.total));
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

  const { customers: allCustomers } = window.buildInsightCustomers(rawData);
  const adminCustomers = allCustomers.filter((c) => c.lastAdmin === selected);
  const priorityCounts = countAdminPriorities(adminCustomers);

  const trendYears = getAdminYearRange(rawData);
  let selectedYear = window.AppData.selectedTrendYear || "all";
  if (selectedYear !== "all" && !trendYears.map(String).includes(String(selectedYear))) selectedYear = "all";
  window.AppData.selectedTrendYear = selectedYear;
  const trendSeries = buildAdminTrendSeries(rawData, selected, selectedYear);

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
      <h3>โอกาสสร้างยอดขาย (Admin Priority)</h3>
      <div class="overview-kpi-grid">
        ${ADMIN_PRIORITY_ORDER.map((key) => {
          const meta = ADMIN_PRIORITY_META[key];
          return `
          <div class="overview-kpi-card">
            <div class="icon"><i class="fas ${meta.icon}"></i></div>
            <div class="lbl">${meta.label}</div>
            <div class="val">${priorityCounts[key].toLocaleString()}</div>
            <div class="pct">${pctStr(priorityCounts[key], adminCustomers.length)}%</div>
          </div>
        `;
        }).join("")}
      </div>
    </div>

    <div class="overview-section">
      <div class="overview-section-header">
        <h3>แนวโน้มยอดขาย (Sales Trend)</h3>
        <select id="trend-year-picker" class="trend-year-select">
          <option value="all" ${selectedYear === "all" ? "selected" : ""}>รวมทุกปี</option>
          ${trendYears.map((y) => `<option value="${y}" ${String(y) === String(selectedYear) ? "selected" : ""}>${y}</option>`).join("")}
        </select>
      </div>
      <div class="trend-chart-wrap"><canvas id="admin-trend-chart"></canvas></div>
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

  document.getElementById("trend-year-picker").addEventListener("change", (e) => {
    window.AppData.selectedTrendYear = e.target.value;
    window.applyFilters();
  });

  renderChartInto("admin-trend-chart", buildTrendLineConfig(trendSeries, selectedYear));
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
