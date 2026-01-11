/**
 * Code.gs — Cali Reign Tour Vote Mini-App (Multi-step + Email Verification)
 *
 * GET  /exec?page=admin
 * GET  /exec?page=leaderboard
 * GET  /exec?page=debug
 * GET  /exec?page=selftest
 *
 * POST (Content-Type: text/plain JSON):
 *   {action:"requestEmailCode", email, name_optional?, discord_handle_optional?}
 *   {action:"verifyEmailCode", email, code, name_optional?, discord_handle_optional?}
 *   {action:"submitVote", session_token, email, city, votes_claimed, payment_method_selected, name_optional?, discord_handle_optional?}
 *   {action:"uploadScreenshot", token, screenshot}
 *   {action:"adminList", password, filter}
 *   {action:"approve", password, submissionId}
 *   {action:"reject", password, submissionId, reason}
 */

const CFG = {
  // ✅ Required
  SHEET_ID: "PASTE_SHEET_ID_HERE",
  SHEET_NAME: "Votes",

  // ✅ Required (for screenshot upload)
  DRIVE_FOLDER_ID: "PASTE_DRIVE_FOLDER_ID_HERE",

  // ✅ Required (for email)
  RESEND_API_KEY: "PASTE_RESEND_API_KEY_HERE",
  SENDER_EMAIL: "voting@ifuckfans.com",

  // ✅ Admin UI password
  ADMIN_PASSWORD: "PASTE_ADMIN_PASSWORD_HERE",

  // GitHub Pages base (used inside emails for payment QR images and upload link)
  FRONTEND_BASE_URL: "https://YOURUSER.github.io/Cali_Votes",
  UPLOAD_PAGE_PATH: "/upload.html",

  // Expiries
  MAGIC_LINK_EXPIRY_DAYS: 7,
  SESSION_EXPIRY_DAYS: 30,
  EMAIL_CODE_EXPIRY_MINUTES: 10,

  // Anti-spam
  RATE_LIMIT_PER_HOUR: 5
};

// -------------------- helpers --------------------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function text_(txt) {
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.TEXT);
}
function now_() { return new Date(); }
function uuid_() { return Utilities.getUuid(); }
function addDays_(d, days) { const x = new Date(d); x.setDate(x.getDate() + days); return x; }
function addMinutes_(d, minutes){ const x = new Date(d); x.setMinutes(x.getMinutes() + minutes); return x; }
function email_(e) { return String(e || "").toLowerCase().trim(); }
function ip_(data) { return data && data.ip ? String(data.ip) : "unknown"; }
function badCity_(c) { return /fuck|shit|ass/i.test(String(c || "")); }

function assertCfg_() {
  if (!CFG.SHEET_ID || CFG.SHEET_ID.includes("PASTE_") || CFG.SHEET_ID.includes("YOUR_")) throw new Error("CFG.SHEET_ID not set");
  if (!CFG.SHEET_NAME) throw new Error("CFG.SHEET_NAME missing");
}
function assertDrive_() {
  if (!CFG.DRIVE_FOLDER_ID || CFG.DRIVE_FOLDER_ID.includes("PASTE_") || CFG.DRIVE_FOLDER_ID.includes("YOUR_")) throw new Error("CFG.DRIVE_FOLDER_ID not set");
}

function sheet_() {
  assertCfg_();
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sh = ss.getSheetByName(CFG.SHEET_NAME);
  if (!sh) throw new Error(`Sheet tab "${CFG.SHEET_NAME}" not found`);
  return sh;
}

function leadsSheet_(){
  assertCfg_();
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  let sh = ss.getSheetByName("Leads");
  if (!sh){
    sh = ss.insertSheet("Leads");
    sh.appendRow(["created_at","email","ip_address","name_optional","discord_handle_optional"]);
  }
  return sh;
}

function uploadUrlFromToken_(token) {
  const base = String(CFG.FRONTEND_BASE_URL || "").replace(/\/+$/, "");
  const path = String(CFG.UPLOAD_PAGE_PATH || "/upload.html");
  return base + path + "?token=" + encodeURIComponent(token);
}

// -------------------- rate limit --------------------
function limited_(ip, email) {
  const cache = CacheService.getScriptCache();
  const key = `rl:${ip}:${email}`;
  const n = Number(cache.get(key) || 0);
  if (n >= CFG.RATE_LIMIT_PER_HOUR) return true;
  cache.put(key, String(n + 1), 3600);
  return false;
}

// -------------------- email code + session cache --------------------
function emailCodeKey_(email){ return `code:${email}`; }
function sessionKey_(token){ return `sess:${token}`; }

function genCode_(){
  const n = Math.floor(100000 + Math.random()*900000);
  return String(n);
}

function storeEmailCode_(email, code){
  const cache = CacheService.getScriptCache();
  const payload = JSON.stringify({
    code,
    exp: addMinutes_(now_(), CFG.EMAIL_CODE_EXPIRY_MINUTES).toISOString()
  });
  cache.put(emailCodeKey_(email), payload, CFG.EMAIL_CODE_EXPIRY_MINUTES * 60);
}

function verifyEmailCode_(email, code){
  const cache = CacheService.getScriptCache();
  const raw = cache.get(emailCodeKey_(email));
  if (!raw) return { ok:false, error:"Code expired. Please resend." };
  const obj = JSON.parse(raw);
  if (String(obj.code) !== String(code).trim()) return { ok:false, error:"Invalid code." };
  // one-time use
  cache.remove(emailCodeKey_(email));
  return { ok:true };
}

function createSession_(email){
  const token = (uuid_() + uuid_()).replace(/-/g,"");
  const cache = CacheService.getScriptCache();
  cache.put(sessionKey_(token), JSON.stringify({ email, created_at: now_().toISOString() }), CFG.SESSION_EXPIRY_DAYS * 24 * 3600);
  return token;
}

function sessionEmail_(token){
  const cache = CacheService.getScriptCache();
  const raw = cache.get(sessionKey_(String(token||"").trim()));
  if (!raw) return "";
  try { return String(JSON.parse(raw).email || ""); } catch { return ""; }
}

// -------------------- routing --------------------
function doGet(e) {
  const qs = (e && e.parameter) ? e.parameter : {};
  const page = String(qs.page || "").toLowerCase();

  if (page === "debug") return text_(JSON.stringify({ received_parameter: qs, raw_event: e }, null, 2));

  if (page === "selftest") {
    try {
      const sh = sheet_();
      return json_({ ok:true, msg:"Selftest passed (sheet opened + tab found)", sheet_id: CFG.SHEET_ID, sheet_name: CFG.SHEET_NAME, last_row: sh.getLastRow() });
    } catch (err) {
      return json_({ ok:false, error: err.message });
    }
  }

  if (page === "admin") return HtmlService.createHtmlOutputFromFile("admin").setTitle("Cali Votes — Admin");
  if (page === "leaderboard") return leaderboard_();
  return text_("OK");
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData?.contents || "{}");
    switch (data.action) {
      case "requestEmailCode": return requestEmailCode_(data);
      case "verifyEmailCode": return verifyEmailCodeAction_(data);
      case "submitVote": return submit_(data);
      case "uploadScreenshot": return upload_(data);
      case "adminList": return adminList_(data);
      case "approve": return approve_(data);
      case "reject": return reject_(data);
      default: return json_({ error: "Invalid action" });
    }
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- requestEmailCode --------------------
function requestEmailCode_(d){
  const email = email_(d.email);
  if (!email) return json_({ error:"Email required" });

  const ip = ip_(d);
  if (limited_(ip, email)) return json_({ error:"Rate limited" });

  const code = genCode_();
  storeEmailCode_(email, code);

  // Lead capture (even if they never buy)
  try {
    leadsSheet_().appendRow([ now_(), email, ip, d.name_optional||"", d.discord_handle_optional||"" ]);
  } catch (e) {
    // non-fatal
  }

  const mail = sendVerifyCodeMail_(email, code);
  return json_({ ok:true, mail });
}

function verifyEmailCodeAction_(d){
  const email = email_(d.email);
  const code = String(d.code || "").trim();
  if (!email) return json_({ error:"Email required" });
  if (!code) return json_({ error:"Code required" });

  const v = verifyEmailCode_(email, code);
  if (!v.ok) return json_({ error: v.error });

  const session_token = createSession_(email);
  return json_({
    ok:true,
    email,
    session_token,
    name_optional: d.name_optional || "",
    discord_handle_optional: d.discord_handle_optional || ""
  });
}

// -------------------- submitVote --------------------
function submit_(d) {
  try {
    const sh = sheet_();

    const email = email_(d.email);
    const city = String(d.city || "").trim();
    const votes = Number(d.votes_claimed);
    const paymentMethod = String(d.payment_method_selected || "").trim();
    const session_token = String(d.session_token || "").trim();

    if (!session_token) return json_({ error:"Missing session. Please verify email again." });

    const sessEmail = sessionEmail_(session_token);
    if (!sessEmail) return json_({ error:"Session expired. Please verify email again." });
    if (email !== sessEmail) return json_({ error:"Email mismatch for session." });

    if (!email) return json_({ error:"Email required" });
    if (!city) return json_({ error:"City required" });
    if (!votes || votes <= 0) return json_({ error:"Invalid votes" });
    if (badCity_(city)) return json_({ error:"Invalid city" });
    if (!paymentMethod) return json_({ error:"Payment method required" });

    const ip = ip_(d);
    if (limited_(ip, email)) return json_({ error:"Rate limited" });

    const submissionId = uuid_();
    const token = (uuid_() + uuid_()).replace(/-/g, "");
    const expires = addDays_(now_(), CFG.MAGIC_LINK_EXPIRY_DAYS);
    const amountUsd = Math.round(votes * 5);

    // Columns A–P (matches your original schema + token/expiry)
    sh.appendRow([
      submissionId, now_(),
      d.name_optional || "", d.discord_handle_optional || "",
      email, city, votes, "",               // H blank
      "pending", paymentMethod,             // I/J
      "", "", "", ip,                       // K/L/M/N
      token, expires                        // O/P
    ]);

    const uploadUrl = uploadUrlFromToken_(token);
    const mail = sendReceiptMail_(email, uploadUrl, paymentMethod, amountUsd);

    return json_({ ok:true, submissionId, upload_url: uploadUrl, amount_due_usd: amountUsd, mail });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- uploadScreenshot --------------------
function upload_(d) {
  try {
    assertDrive_();
    const token = String(d.token || "").trim();
    const img = String(d.screenshot || "");

    if (!token) return json_({ error:"Missing token" });
    if (!img.includes("base64,")) return json_({ error:"Missing screenshot data" });

    const sh = sheet_();
    const rows = sh.getDataRange().getValues();

    // O = upload_token => index 14
    let r = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][14] || "") === token) { r = i; break; }
    }
    if (r < 0) return json_({ error:"Invalid token" });

    const status = String(rows[r][8] || "");
    if (status === "approved") return json_({ error:"Already approved" });

    const exp = rows[r][15];
    if (exp && new Date(exp).getTime() < now_().getTime()) return json_({ error:"Expired" });

    const bytes = Utilities.base64Decode(img.split("base64,")[1]);
    const submissionId = String(rows[r][0] || uuid_());
    const blob = Utilities.newBlob(bytes, "image/jpeg", submissionId + "_proof.jpg");

    const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // K = screenshot_drive_url => col 11
    sh.getRange(r + 1, 11).setValue(file.getUrl());

    return json_({ ok:true, url: file.getUrl() });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- adminList --------------------
function adminList_(d) {
  if (String(d.password || "") !== CFG.ADMIN_PASSWORD) return json_({ error:"Unauthorized" });

  try {
    const filter = String(d.filter || "pending_with_proof");
    const rows = sheet_().getDataRange().getValues();

    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const obj = {
        submission_id: r[0],
        created_at: r[1] ? new Date(r[1]).toLocaleString() : "",
        email: r[4] || "",
        city: r[5] || "",
        votes_claimed: r[6] || 0,
        status: r[8] || "",
        payment_method_selected: r[9] || "",
        screenshot_drive_url: r[10] || ""
      };

      const hasProof = !!obj.screenshot_drive_url;
      const status = String(obj.status || "");

      if (filter === "pending_with_proof") {
        if (status === "pending" && hasProof) out.push(obj);
      } else if (filter === "pending_all") {
        if (status === "pending") out.push(obj);
      } else if (filter === "approved") {
        if (status === "approved") out.push(obj);
      } else if (filter === "rejected") {
        if (status === "rejected") out.push(obj);
      } else {
        out.push(obj);
      }
    }

    return json_({ ok:true, rows: out.reverse() });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- approve / reject --------------------
function approve_(d) {
  if (String(d.password || "") !== CFG.ADMIN_PASSWORD) return json_({ error:"Unauthorized" });
  const id = String(d.submissionId || "").trim();
  if (!id) return json_({ error:"Missing submissionId" });
  return setStatus_(id, "approved");
}

function reject_(d) {
  if (String(d.password || "") !== CFG.ADMIN_PASSWORD) return json_({ error:"Unauthorized" });
  const id = String(d.submissionId || "").trim();
  if (!id) return json_({ error:"Missing submissionId" });
  const reason = String(d.reason || "").trim();
  return setStatus_(id, "rejected", reason);
}

function setStatus_(id, status, note) {
  try {
    const sh = sheet_();
    const rows = sh.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || "") === id) {
        sh.getRange(i + 1, 9).setValue(status);                 // I status
        if (status === "approved") sh.getRange(i + 1, 12).setValue(now_()); // L approved_at
        if (note) sh.getRange(i + 1, 13).setValue(note);        // M admin_notes
        return json_({ ok:true });
      }
    }
    return json_({ error:"Not found" });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- leaderboard --------------------
function leaderboard_() {
  try {
    const rows = sheet_().getDataRange().getValues();
    const totals = {};
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][8] || "") !== "approved") continue;
      const city = String(rows[i][5] || "").trim();
      const votes = Number(rows[i][6] || 0);
      if (!city) continue;
      totals[city] = (totals[city] || 0) + votes;
    }

    const leaderboard = Object.entries(totals)
      .map(([city, votes]) => ({ city, votes }))
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 50);

    return json_({ leaderboard, updated_at: new Date().toISOString() });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- Resend email --------------------
function sendVerifyCodeMail_(to, code){
  const key = String(CFG.RESEND_API_KEY || "").trim();
  if (!key || key.includes("PASTE_") || key.includes("YOUR_")) {
    Logger.log("Resend not configured; would send verify code to " + to + " code: " + code);
    return { attempted:false, skipped:"RESEND_API_KEY not set in CFG" };
  }

  const html = [
    `<p>Your Cali Votes verification code is:</p>`,
    `<p style="font-size:28px;font-weight:900;letter-spacing:2px">${code}</p>`,
    `<p style="color:#666;font-size:12px">This code expires in ~${CFG.EMAIL_CODE_EXPIRY_MINUTES} minutes.</p>`
  ].join("");

  return resendSend_(to, "Your Cali Votes verification code", html);
}

function sendReceiptMail_(to, uploadUrl, paymentMethod, amountUsd){
  const key = String(CFG.RESEND_API_KEY || "").trim();
  if (!key || key.includes("PASTE_") || key.includes("YOUR_")) {
    Logger.log("Resend not configured; would email " + to + " upload: " + uploadUrl);
    return { attempted:false, skipped:"RESEND_API_KEY not set in CFG" };
  }

  const base = String(CFG.FRONTEND_BASE_URL || "").replace(/\/+$/, "");
  const qrMap = {
    "CashApp": base + "/assets/cashapp-qr.png",
    "Venmo":  base + "/assets/venmo-qr.png",
    "SOL":    base + "/assets/sol-qr.png",
    "ETH":    base + "/assets/eth-qr.png",
    "BTC":    base + "/assets/btc-qr.png"
  };

  const pm = String(paymentMethod || "").trim();
  const qr = qrMap[pm] || "";
  const amt = amountUsd ? `$${Number(amountUsd).toFixed(0)}` : "$5 × votes";

  const html = [
    `<p><b>Step 1:</b> Pay <b>${amt}</b> via <b>${pm || "your selected method"}</b>.</p>`,
    qr ? `<p><img src="${qr}" alt="Payment QR" style="max-width:320px;border-radius:12px;border:1px solid rgba(0,0,0,.10)" /></p>` : "",
    `<p><b>Step 2:</b> Upload your payment screenshot here:<br><a href="${uploadUrl}">${uploadUrl}</a></p>`,
    `<p style="color:#666;font-size:12px">If you already paid, skip straight to Step 2.</p>`
  ].join("");

  return resendSend_(to, "Cali Votes — upload your screenshot", html);
}

function resendSend_(to, subject, html){
  const key = String(CFG.RESEND_API_KEY || "").trim();
  try {
    const resp = UrlFetchApp.fetch("https://api.resend.com/emails", {
      method: "post",
      headers: { Authorization: "Bearer " + key },
      contentType: "application/json",
      payload: JSON.stringify({
        from: CFG.SENDER_EMAIL,
        to: [to],
        subject,
        html
      }),
      muteHttpExceptions: true
    });

    return {
      attempted: true,
      http_status: resp.getResponseCode(),
      body_preview: (resp.getContentText() || "").slice(0, 300)
    };
  } catch (e) {
    return { attempted: true, error: String(e && e.message ? e.message : e) };
  }
}
