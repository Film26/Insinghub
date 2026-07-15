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

## Running it locally (no Google setup required)

Open `index.html` in a browser and sign in with the demo account:

- **Username:** `admin`
- **Password:** `admin`

(The demo account only works while no Apps Script URL is configured in
Settings — see below.) From the dashboard, use **Load Sample Data** to see
the Overview and Customer InsightHub views populated, or **Import** to load
your own `.csv` / `.xlsx` file directly in the browser (nothing is uploaded
anywhere).

## Connecting to Google Sheets

1. Create a Google Sheet with two tabs:
   - `Users` — header row: `Username | PasswordHash | Role`
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

## Notes

- Sessions are stored in `localStorage` only — this is an internal tool,
  not a hardened public-facing auth system.
- All API calls are GET requests with query-string params, since Apps
  Script web apps don't handle CORS preflights for POST/JSON bodies well.
- `js/insighthub.js` caches its computed customer table on the raw data
  array reference (`window.__hubCache`); `js/dashboard.js` always replaces
  that array wholesale on load/import so the cache invalidates correctly.
