# CRM InsightHub

A lightweight customer-analytics CRM: a static HTML/CSS/JS frontend backed by a
Google Sheet through a Google Apps Script web app.

## Structure

```
CRM-Insinghub/
│
├── index.html          ← Login
├── dashboard.html       ← App shell (Overview, InsightHub, Settings)
│
├── css/
│   ├── login.css
│   ├── dashboard.css
│   └── style.css
│
├── js/
│   ├── auth.js          ← login form + session guard/logout
│   ├── api.js           ← client for the Apps Script backend
│   ├── dashboard.js      ← nav, data loading, row helpers, Overview view
│   ├── insighthub.js    ← customer segmentation/analytics table
│   └── settings.js      ← Settings view (API URL, account, data controls)
│
├── assets/
│   ├── images/
│   └── icons/
│
├── apps-script/
│   └── Code.gs          ← Google Apps Script backend (deploy as Web App)
│
└── README.md
```

## Data source

The app has exactly one data source: the `Orders` tab of the connected
Google Sheet, read through `Code.gs`. There is no file-import or bundled
sample-data option — until Google Sheets is connected (see below), the
dashboard and Customer InsightHub just show an empty state pointing to
Settings. The demo login (`admin` / `admin`, only usable while no Apps
Script URL is set) is for checking that the login/dashboard shell itself
works — it won't show any real data.

## Connecting to Google Sheets

1. Create a Google Sheet with two tabs:
   - `Users` — header row: `Username | PasswordHash | Role | AdminName`
     (see **Roles** below for what `Role` and `AdminName` must contain).
   - `Orders` — header row of order columns (Thai or English names both
     work — see the `getRowValue()` calls in `js/dashboard.js` /
     `js/insighthub.js` for every spelling that's recognized), e.g.
     `วันที่สร้าง | Phone | CustomerName | Product Set | ยอดขาย | Order type | ช่องทาง | ชื่อแอดมิน | Remark`.
2. Open **Extensions > Apps Script** on that Sheet and paste in
   `apps-script/Code.gs`.
3. Edit and run `generatePasswordHash()` once per user (set the `pass`
   value first), then copy the logged hash into that user's `PasswordHash`
   cell.
4. **Deploy > New deployment > Web app**, with *Execute as: Me* and
   *Who has access: Anyone with the link*. Copy the `/exec` URL.
5. In the app, go to **Settings** and paste that URL into "การเชื่อมต่อ
   Google Apps Script", then click **บันทึก** and **ทดสอบการเชื่อมต่อ**.
6. Log out and log back in with a real account from the `Users` sheet;
   **Refresh** on the dashboard now pulls live data from the `Orders` sheet.

## Sales Note & contact status

Each customer's profile page (Customer InsightHub → click a customer) has a
**Sales Note** card under the AI Summary: a free-text note plus a
multi-select "สถานะการติดต่อ" (contact status, e.g. คุยแล้ว / ยังไม่รับสาย /
ไม่สะดวกให้โทร / ไม่ได้ทานแล้ว — more than one can be selected). Saving
overwrites that customer's note/status (it's a current-state field, not a
call log), and the value round-trips through two more optional sheet tabs:

- `CustomerNotes` — one row per customer, header row
  `CustomerKey | CustomerName | Note | Statuses | UpdatedAt | UpdatedBy`.
  `CustomerKey` is the same key InsightHub already uses everywhere else
  (normalized phone, or the RAW2021 customer code). `Statuses` is stored
  pipe-joined (`|`). Created automatically the first time anyone saves a
  note — you don't need to create it by hand.
- `Config_Status` — single column `Label`, one contact-status option per
  row; this is what the multi-select on the profile page and the
  "จัดการสถานะการติดต่อ" panel in Settings (Super Admin/Manager only) both
  read from. If this tab doesn't exist yet, the app falls back to a
  built-in default list (คุยแล้ว / ยังไม่รับสาย / ไม่สะดวกให้โทร / ไม่ได้ทานแล้ว)
  until someone saves a custom list from Settings, which creates the tab.

Both tabs are optional the same way `Users` is — the rest of the app (Orders
import, dashboard, InsightHub table) works fine without them.

The InsightHub table also gets two extra columns after the last "ยอดซื้อปี"
column — **สถานะล่าสุด (Contact)** (Excel-style filterable, same as Admin
Priority) and **Sales Note ล่าสุด** (sortable; not filterable since it's
free text) — reflecting each customer's current `CustomerNotes` row.

## Roles

Three role levels, checked both client-side (what's shown) and server-side
in `Code.gs` (who's allowed to manage users — a client can't just claim a
role it doesn't have):

| Role (`Users` sheet `Role` column) | Dashboard | Customer InsightHub | Settings |
|---|---|---|---|
| `super_admin` → **SUPER ADMIN** | Team Report + Individual Admin (any admin) | Everyone's customers | Full: Apps Script connection + User Management (add/change role of others) |
| `manager` → **MANAGER** | Team Report + Individual Admin (any admin) | Everyone's customers | Own account only — can't edit connection settings or manage users |
| `sales_admin` → **SALES ADMIN** | Individual Admin only, locked to their own `AdminName` | Only their own customers/orders (filtered by `AdminName`) | Own account only |

- `AdminName` (Users sheet) must match exactly the value that appears in the
  Orders sheet's admin-name column (ชื่อแอดมิน/Admin) for that person — that's
  the only way the app knows which orders/customers a Sales Admin owns.
  It's required for `sales_admin` accounts; ignored for the other two roles.
- An unrecognized/blank `Role` value fails safe to `sales_admin` (least
  privilege), both client- and server-side.
- Super Admins manage everyone's role/AdminName/password from **Settings >
  จัดการผู้ใช้งาน** — this calls `Code.gs`'s `listUsers`/`upsertUser` actions,
  which re-check the caller's role against the `Users` sheet on every call.
- The "ข้อมูลระดับความลับ" (confidential) card on the Super Admin's Team
  Report is a placeholder until the Orders sheet has a cost column and/or a
  marketing-budget figure is wired up — it won't fabricate numbers that
  aren't in the data.

## Notes

- Sessions are stored in `localStorage` only — this is an internal tool,
  not a hardened public-facing auth system.
- All API calls are GET requests with query-string params, since Apps
  Script web apps don't handle CORS preflights for POST/JSON bodies well.
- `js/insighthub.js` caches its computed customer table on the raw data
  array reference (`window.__hubCache`); `js/dashboard.js` always replaces
  that array wholesale on every **Refresh** so the cache invalidates correctly.
