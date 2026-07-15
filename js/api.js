// js/api.js
// Thin client for the Google Apps Script backend (apps-script/Code.gs).
// Deploy Code.gs as a Web App ("Execute as: Me", "Who has access: Anyone with the link"),
// then paste the resulting /exec URL into the Settings page (stored in localStorage).

(function () {
  const BASE_URL_KEY = "crm_api_base_url";

  function getBaseUrl() {
    return (localStorage.getItem(BASE_URL_KEY) || "").trim();
  }

  function setBaseUrl(url) {
    localStorage.setItem(BASE_URL_KEY, (url || "").trim());
  }

  // Apps Script web apps don't handle JSON POST bodies well (CORS preflight issues),
  // so every call is a plain GET with query-string params to avoid the preflight entirely.
  async function apiRequest(action, params) {
    const base = getBaseUrl();
    if (!base) {
      throw new Error("ยังไม่ได้ตั้งค่า Apps Script URL กรุณาไปที่หน้า Settings เพื่อกรอก URL ก่อน");
    }

    let url;
    try {
      url = new URL(base);
    } catch (e) {
      throw new Error("Apps Script URL ไม่ถูกต้อง กรุณาตรวจสอบที่หน้า Settings");
    }
    url.searchParams.set("action", action);
    Object.keys(params || {}).forEach((key) => {
      url.searchParams.set(key, params[key]);
    });

    let res;
    try {
      res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    } catch (e) {
      throw new Error("เชื่อมต่อ Apps Script ไม่สำเร็จ (เครือข่าย/CORS) กรุณาตรวจสอบ URL และการ Deploy");
    }

    if (!res.ok) {
      throw new Error("เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP " + res.status + ")");
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error("รูปแบบข้อมูลที่ได้รับไม่ถูกต้อง (ไม่ใช่ JSON)");
    }

    if (data && data.success === false) {
      throw new Error(data.error || "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์");
    }
    return data;
  }

  window.CrmApi = {
    getBaseUrl,
    setBaseUrl,
    ping() {
      return apiRequest("ping", {});
    },
    login(username, password) {
      return apiRequest("login", { user: username, pass: password });
    },
    getOrders() {
      return apiRequest("orders", {});
    },
  };
})();
