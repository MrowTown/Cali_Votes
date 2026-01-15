// config.js — Cali Votes config (drop-in replacement)

(function () {
  // Google Apps Script Web App (/exec)
  const EXEC_URL = "https://script.google.com/macros/s/AKfycbxoGbVDc90uokYkCl0jo8lFznSM6oTfz2a7YyKHHp9DjRBKl8zQ_jMSssW-zs83m1e_8g/exec";

  // GitHub Pages *site base* (NOT /assets). Example: https://mrowtown.github.io/Cali_Votes
  const SITE_BASE = "https://mrowtown.github.io/Cali_Votes";

  function normalizeHttps(url, name) {
    const s = String(url || "").trim().replace(/\/+$/, "");
    if (!s || s.includes("PASTE_")) throw new Error("Config missing: " + name);
    if (!s.startsWith("https://")) throw new Error("Config invalid: " + name + " must start with https://");
    return s;
  }

  const exec = normalizeHttps(EXEC_URL, "CALI_VOTES.EXEC_URL");
  const site = normalizeHttps(SITE_BASE, "CALI_VOTES.SITE_BASE");

  window.CALI_VOTES = {
    EXEC_URL: exec,
    SITE_BASE: site,

    // Back-compat: existing pages use ASSET_BASE + "/assets/xxx.png"
    ASSET_BASE: site
  };
})();
