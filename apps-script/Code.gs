/**
 * Backend for InsightHub CRM.
 *
 * This is wired to a specific spreadsheet by ID (below), so this script can
 * live either bound to that Sheet or as a standalone Apps Script project —
 * either way it reads/writes the same spreadsheet.
 *
 * Setup:
 * 1. In the Apps Script editor (script.google.com, or Extensions > Apps
 *    Script from the Sheet itself), paste this file in as Code.gs.
 * 2. Make sure the spreadsheet has:
 *      - An "Orders" tab with a header row of order columns, e.g.:
 *          วันที่สร้าง | Phone | CustomerName | Product Set | ยอดขาย | Order type | ช่องทาง | ชื่อแอดมิน | Remark
 *        (js/dashboard.js and js/insighthub.js read several possible header
 *        spellings for each field — see getRowValue() calls in those files —
 *        so exact column names/order are flexible as long as the data is there.)
 *        If there's no tab literally named "Orders", the first tab in the
 *        spreadsheet is used instead — rename ORDERS_SHEET_NAME below if
 *        your order data lives on a differently-named tab.
 *      - A "Users" tab with header row: Username | PasswordHash | Role | AdminName
 *        (create this tab yourself — it's for login, not order data).
 *        - Role must be one of: super_admin | manager | sales_admin
 *        - AdminName is required for sales_admin accounts: it must match
 *          exactly the value that appears in the Orders sheet's admin-name
 *          column (ชื่อแอดมิน/Admin) for that person's rows, since that's how
 *          a Sales Admin's view gets scoped to only their own orders/customers.
 * 3. Run generatePasswordHash() once per user (edit the `pass` value first),
 *    copy the logged hash into that user's PasswordHash cell in the Users sheet.
 * 4. Deploy > New deployment > Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone with the link
 * 5. Copy the resulting /exec URL into the app's Settings page (js/settings.js).
 *
 * All calls are plain GET requests with an `action` query param — Apps Script
 * web apps don't handle CORS preflights for POST/JSON well, so GET avoids that
 * entirely (see js/api.js).
 */

var SPREADSHEET_ID = "1s5_nfe3EgsRg5evPrkoa3jXEqNrTtwAZKzmIycP0ZQw";
var ORDERS_SHEET_NAME = "Orders";
var USERS_SHEET_NAME = "Users";
var VALID_ROLES = ["super_admin", "manager", "sales_admin"];
var CUSTOMER_NOTES_SHEET_NAME = "CustomerNotes";
var STATUS_CONFIG_SHEET_NAME = "Config_Status";
var DEFAULT_STATUS_OPTIONS = ["คุยแล้ว", "ยังไม่รับสาย", "ไม่สะดวกให้โทร", "ไม่ได้ทานแล้ว", "สนใจซื้อซ้ำ", "รอโปรโมชั่น", "ขอคิดดูก่อน", "ปิดการขายแล้ว", "เปลี่ยนไปใช้ยี่ห้ออื่น", "ติดต่อไม่ได้", "เบอร์ผิด/ไม่ใช่ลูกค้า"];

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function doGet(e) {
  var action = (e.parameter.action || "").toString();
  try {
    if (action === "ping") {
      return jsonOutput({ success: true, message: "pong", time: new Date().toISOString() });
    }
    if (action === "login") {
      return handleLogin(e.parameter.user, e.parameter.pass);
    }
    if (action === "orders") {
      return handleGetOrders();
    }
    if (action === "listUsers") {
      return handleListUsers(e.parameter.requestUser);
    }
    if (action === "upsertUser") {
      return handleUpsertUser(e.parameter);
    }
    if (action === "notes") {
      return handleGetNotes();
    }
    if (action === "upsertNote") {
      return handleUpsertNote(e.parameter);
    }
    if (action === "statusOptions") {
      return handleGetStatusOptions();
    }
    if (action === "saveStatusOptions") {
      return handleSaveStatusOptions(e.parameter);
    }
    return jsonOutput({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Accepts common spellings/casings and folds them onto the three canonical
// roles; unrecognized values fail safe to the least-privileged role.
function normalizeRole(raw) {
  var r = (raw || "").toString().trim().toLowerCase().replace(/[\s\-]+/g, "_");
  if (r === "super_admin" || r === "superadmin" || r === "owner" || r === "admin") return "super_admin";
  if (r === "manager" || r === "supervisor" || r === "manager_supervisor") return "manager";
  if (r === "sales_admin" || r === "salesadmin" || r === "operation" || r === "operation_admin") return "sales_admin";
  return "sales_admin";
}

function getUsersSheet() {
  var sheet = getSpreadsheet().getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    throw new Error(
      'ไม่พบชีต "' + USERS_SHEET_NAME + '" กรุณาสร้างชีตนี้ก่อน (คอลัมน์: Username | PasswordHash | Role | AdminName)'
    );
  }
  return sheet;
}

function getUsersHeaderIndex(headerRow) {
  var headers = headerRow.map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  return {
    user: headers.indexOf("username"),
    hash: headers.indexOf("passwordhash"),
    role: headers.indexOf("role"),
    adminName: headers.indexOf("adminname"),
  };
}

function handleLogin(username, password) {
  if (!username || !password) {
    return jsonOutput({ success: false, error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
  }

  var sheet;
  try {
    sheet = getUsersSheet();
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  }

  var data = sheet.getDataRange().getValues();
  var idx = getUsersHeaderIndex(data[0]);
  if (idx.user === -1 || idx.hash === -1) {
    return jsonOutput({ success: false, error: "ชีต Users ต้องมีคอลัมน์ Username และ PasswordHash" });
  }

  var hash = hashPassword(password);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if ((row[idx.user] || "").toString().trim().toLowerCase() === username.trim().toLowerCase()) {
      var storedHash = (row[idx.hash] || "").toString().trim();
      if (storedHash === hash) {
        return jsonOutput({
          success: true,
          username: row[idx.user],
          role: normalizeRole(idx.role >= 0 ? row[idx.role] : ""),
          adminName: idx.adminName >= 0 ? (row[idx.adminName] || "").toString().trim() : "",
        });
      }
      return jsonOutput({ success: false, error: "รหัสผ่านไม่ถูกต้อง" });
    }
  }
  return jsonOutput({ success: false, error: "ไม่พบชื่อผู้ใช้นี้" });
}

function hashPassword(pass) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass, Utilities.Charset.UTF_8);
  return digest
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
}

/**
 * Run manually from the Apps Script editor (set `pass` below first) to generate
 * a PasswordHash value to paste into the Users sheet. Check View > Logs for the result.
 */
function generatePasswordHash() {
  var pass = "changeme";
  Logger.log(hashPassword(pass));
}

function handleGetOrders() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  if (!sheet) sheet = ss.getSheets()[0]; // fall back to the first tab if "Orders" doesn't exist
  if (!sheet) return jsonOutput({ success: false, error: "ไม่พบชีตข้อมูลออเดอร์ในสเปรดชีตนี้" });

  // getDisplayValues() keeps dates/numbers as the formatted text shown in the
  // sheet, which is what window.parseDate() in js/dashboard.js expects.
  var data = sheet.getDataRange().getDisplayValues();
  if (data.length < 1) return jsonOutput({ success: true, rows: [], sheetName: sheet.getName() });

  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var rowObj = {};
    var isEmpty = true;
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j].toString().trim();
      if (!key) continue;
      rowObj[key] = data[i][j];
      if (data[i][j] !== "") isEmpty = false;
    }
    if (!isEmpty) rows.push(rowObj);
  }
  return jsonOutput({ success: true, rows: rows, sheetName: sheet.getName() });
}

// Looks up requestUser's role directly from the Users sheet — never trust a
// role claim coming from the client for permission checks.
function requireSuperAdmin(requestUsername) {
  if (!requestUsername) throw new Error("ต้องระบุ requestUser");
  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();
  var idx = getUsersHeaderIndex(data[0]);
  for (var i = 1; i < data.length; i++) {
    if ((data[i][idx.user] || "").toString().trim().toLowerCase() === requestUsername.trim().toLowerCase()) {
      var role = normalizeRole(idx.role >= 0 ? data[i][idx.role] : "");
      if (role !== "super_admin") throw new Error("เฉพาะ Super Admin เท่านั้นที่จัดการผู้ใช้งานได้");
      return;
    }
  }
  throw new Error("ไม่พบบัญชี requestUser นี้ในชีต Users");
}

// Same as requireSuperAdmin, but also allows the manager role — used for
// settings that Super Admin and Manager may both edit (e.g. status options).
function requireSuperAdminOrManager(requestUsername) {
  if (!requestUsername) throw new Error("ต้องระบุ requestUser");
  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();
  var idx = getUsersHeaderIndex(data[0]);
  for (var i = 1; i < data.length; i++) {
    if ((data[i][idx.user] || "").toString().trim().toLowerCase() === requestUsername.trim().toLowerCase()) {
      var role = normalizeRole(idx.role >= 0 ? data[i][idx.role] : "");
      if (role !== "super_admin" && role !== "manager") {
        throw new Error("เฉพาะ Super Admin หรือ Manager เท่านั้นที่จัดการสถานะการติดต่อได้");
      }
      return;
    }
  }
  throw new Error("ไม่พบบัญชี requestUser นี้ในชีต Users");
}

// Returns every user (never the password hash) for the Super Admin's
// User Management panel.
function handleListUsers(requestUser) {
  try {
    requireSuperAdmin(requestUser);
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  }

  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();
  var idx = getUsersHeaderIndex(data[0]);
  var users = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[idx.user]) continue;
    users.push({
      username: row[idx.user],
      role: normalizeRole(idx.role >= 0 ? row[idx.role] : ""),
      adminName: idx.adminName >= 0 ? (row[idx.adminName] || "").toString().trim() : "",
    });
  }
  return jsonOutput({ success: true, users: users });
}

// Creates a new user or updates role/adminName/password for an existing one.
// params: requestUser (must be super_admin), targetUsername, role, adminName, newPassword (optional)
function handleUpsertUser(params) {
  try {
    requireSuperAdmin(params.requestUser);
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  }

  var targetUsername = (params.targetUsername || "").toString().trim();
  if (!targetUsername) return jsonOutput({ success: false, error: "กรุณาระบุ Username" });

  var role = normalizeRole(params.role);
  var adminName = (params.adminName || "").toString().trim();
  if (role === "sales_admin" && !adminName) {
    return jsonOutput({ success: false, error: "Sales Admin ต้องระบุ AdminName ให้ตรงกับคอลัมน์ชื่อแอดมินในชีต Orders" });
  }

  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();
  var idx = getUsersHeaderIndex(data[0]);
  if (idx.user === -1 || idx.hash === -1) {
    return jsonOutput({ success: false, error: "ชีต Users ต้องมีคอลัมน์ Username และ PasswordHash" });
  }

  var rowIndex = -1; // 0-based within `data`, header excluded search starts at 1
  for (var i = 1; i < data.length; i++) {
    if ((data[i][idx.user] || "").toString().trim().toLowerCase() === targetUsername.toLowerCase()) {
      rowIndex = i;
      break;
    }
  }

  var newPassword = (params.newPassword || "").toString();
  if (rowIndex === -1) {
    // Create: a password is required for a brand-new account.
    if (!newPassword) return jsonOutput({ success: false, error: "กรุณาตั้งรหัสผ่านเริ่มต้นสำหรับผู้ใช้ใหม่" });
    var newRow = [];
    newRow[idx.user] = targetUsername;
    newRow[idx.hash] = hashPassword(newPassword);
    newRow[idx.role] = role;
    if (idx.adminName >= 0) newRow[idx.adminName] = adminName;
    sheet.appendRow(newRow);
    return jsonOutput({ success: true, created: true, username: targetUsername, role: role, adminName: adminName });
  }

  // Update: role/adminName always; password only if a new one was provided.
  var sheetRowNumber = rowIndex + 1; // convert 0-based data index to 1-based sheet row
  sheet.getRange(sheetRowNumber, idx.role + 1).setValue(role);
  if (idx.adminName >= 0) sheet.getRange(sheetRowNumber, idx.adminName + 1).setValue(adminName);
  if (newPassword) sheet.getRange(sheetRowNumber, idx.hash + 1).setValue(hashPassword(newPassword));

  return jsonOutput({ success: true, created: false, username: targetUsername, role: role, adminName: adminName });
}

// ---------------------------------------------------------------------------
// Customer Notes (Sales Note + contact status, shown on the customer profile
// page). One row per customer — saving again overwrites that customer's row
// rather than logging history. The "CustomerNotes" tab is created lazily on
// first save; reading it before that just returns an empty list (not an error).
// ---------------------------------------------------------------------------

function getCustomerNotesHeaderIndex(headerRow) {
  var headers = headerRow.map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  return {
    key: headers.indexOf("customerkey"),
    name: headers.indexOf("customername"),
    note: headers.indexOf("note"),
    statuses: headers.indexOf("statuses"),
    updatedAt: headers.indexOf("updatedat"),
    updatedBy: headers.indexOf("updatedby"),
  };
}

function getOrCreateCustomerNotesSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(CUSTOMER_NOTES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CUSTOMER_NOTES_SHEET_NAME);
    sheet.appendRow(["CustomerKey", "CustomerName", "Note", "Statuses", "UpdatedAt", "UpdatedBy"]);
  }
  return sheet;
}

// Returns every saved customer note (client filters/matches by CustomerKey
// against the customer key it already computes locally).
function handleGetNotes() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(CUSTOMER_NOTES_SHEET_NAME);
  if (!sheet) return jsonOutput({ success: true, rows: [] });

  var data = sheet.getDataRange().getValues();
  if (data.length < 1) return jsonOutput({ success: true, rows: [] });

  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var rowObj = {};
    var isEmpty = true;
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j].toString().trim();
      if (!key) continue;
      var val = data[i][j];
      rowObj[key] = val instanceof Date ? val.toISOString() : val;
      if (val !== "" && val !== null && val !== undefined) isEmpty = false;
    }
    if (!isEmpty) rows.push(rowObj);
  }
  return jsonOutput({ success: true, rows: rows });
}

// Creates or updates the single note row for a customer.
// params: customerKey (required), customerName, note, statuses (pipe-joined), requestUser
function handleUpsertNote(params) {
  var customerKey = (params.customerKey || "").toString().trim();
  if (!customerKey) return jsonOutput({ success: false, error: "กรุณาระบุ customerKey" });

  var sheet = getOrCreateCustomerNotesSheet();
  var data = sheet.getDataRange().getValues();
  var idx = getCustomerNotesHeaderIndex(data[0]);

  var customerName = (params.customerName || "").toString();
  var note = (params.note || "").toString();
  var statuses = (params.statuses || "").toString();
  var updatedAt = new Date().toISOString();
  var updatedBy = (params.requestUser || "").toString();

  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if ((data[i][idx.key] || "").toString().trim().toLowerCase() === customerKey.toLowerCase()) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) {
    var newRow = [];
    newRow[idx.key] = customerKey;
    newRow[idx.name] = customerName;
    newRow[idx.note] = note;
    newRow[idx.statuses] = statuses;
    newRow[idx.updatedAt] = updatedAt;
    newRow[idx.updatedBy] = updatedBy;
    sheet.appendRow(newRow);
  } else {
    var sheetRowNumber = rowIndex + 1;
    sheet.getRange(sheetRowNumber, idx.name + 1).setValue(customerName);
    sheet.getRange(sheetRowNumber, idx.note + 1).setValue(note);
    sheet.getRange(sheetRowNumber, idx.statuses + 1).setValue(statuses);
    sheet.getRange(sheetRowNumber, idx.updatedAt + 1).setValue(updatedAt);
    sheet.getRange(sheetRowNumber, idx.updatedBy + 1).setValue(updatedBy);
  }

  return jsonOutput({
    success: true,
    customerKey: customerKey,
    customerName: customerName,
    note: note,
    statuses: statuses,
    updatedAt: updatedAt,
    updatedBy: updatedBy,
  });
}

// ---------------------------------------------------------------------------
// Contact status options (configurable list shown as the multi-select on the
// customer profile page). Editable from Settings by Super Admin/Manager only;
// readable by anyone so every role can pick from it on a customer profile.
// ---------------------------------------------------------------------------

function handleGetStatusOptions() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(STATUS_CONFIG_SHEET_NAME);
  if (!sheet) return jsonOutput({ success: true, options: DEFAULT_STATUS_OPTIONS });

  var data = sheet.getDataRange().getValues();
  var options = [];
  for (var i = 1; i < data.length; i++) {
    var label = (data[i][0] || "").toString().trim();
    if (label) options.push(label);
  }
  if (options.length === 0) return jsonOutput({ success: true, options: DEFAULT_STATUS_OPTIONS });
  return jsonOutput({ success: true, options: options });
}

// params: requestUser (must be super_admin or manager), options (pipe-joined list)
function handleSaveStatusOptions(params) {
  try {
    requireSuperAdminOrManager(params.requestUser);
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  }

  var options = (params.options || "")
    .toString()
    .split("|")
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });

  if (options.length === 0) {
    return jsonOutput({ success: false, error: "ต้องมีสถานะอย่างน้อย 1 รายการ" });
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(STATUS_CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STATUS_CONFIG_SHEET_NAME);
    sheet.appendRow(["Label"]);
  } else {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 1).clearContent();
  }

  sheet.getRange(2, 1, options.length, 1).setValues(options.map(function (o) { return [o]; }));

  return jsonOutput({ success: true, options: options });
}
