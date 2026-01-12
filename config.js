// config.js — Cali Votes config (REQUIRED)

(function () {
  const EXEC_URL = "PASTE_EXEC_URL";
  const ASSET_BASE = "https://mrowtown.github.io/Cali_Votes/assets";

  // --- safety checks (catch typos like phttps) ---
  function mustBeHttps(url, name) {
    const s = String(url || "").trim();
    if (!s || s.includes("PASTE_")) throw new Error(`Config missing: ${name}`);
    if (!s.startsWith("https://")) throw new Error(`Config invalid: ${name} must start with https:// (got: ${s.slice(0, 12)}...)`);
    return s;
  }

  window.CALI_VOTES = {
    EXEC_URL: mustBeHttps(EXEC_URL, "CALI_VOTES.EXEC_URL"),
    ASSET_BASE: mustBeHttps(ASSET_BASE, "CALI_VOTES.ASSET_BASE")
  };
})();
