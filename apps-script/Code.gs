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
 *      - A "Users" tab with header row: Username | PasswordHash | Role
 *        (create this tab yourself — it's for login, not order data).
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
    return jsonOutput({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleLogin(username, password) {
  if (!username || !password) {
    return jsonOutput({ success: false, error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
  }

  var sheet = getSpreadsheet().getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    return jsonOutput({
      success: false,
      error:
        'ไม่พบชีต "' + USERS_SHEET_NAME + '" กรุณาสร้างชีตนี้ก่อน (คอลัมน์: Username | PasswordHash | Role)',
    });
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  var idxUser = headers.indexOf("username");
  var idxHash = headers.indexOf("passwordhash");
  var idxRole = headers.indexOf("role");
  if (idxUser === -1 || idxHash === -1) {
    return jsonOutput({ success: false, error: "ชีต Users ต้องมีคอลัมน์ Username และ PasswordHash" });
  }

  var hash = hashPassword(password);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if ((row[idxUser] || "").toString().trim().toLowerCase() === username.trim().toLowerCase()) {
      var storedHash = (row[idxHash] || "").toString().trim();
      if (storedHash === hash) {
        return jsonOutput({
          success: true,
          username: row[idxUser],
          role: idxRole >= 0 ? row[idxRole] : "user",
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
