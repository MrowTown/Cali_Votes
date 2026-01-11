/**
 * Cali Votes — Multi-Step Backend (Magic Link Verification)
 *
 * Actions (POST text/plain JSON):
 * - requestMagicLink  { email }
 * - verifyMagicLink   { token } -> { session }
 * - submitVote        { session, city, votes_claimed, payment_method_selected, name_optional, discord_handle_optional }
 * - uploadScreenshot  { token, screenshot }
 * - adminList         { password, filter }
 * - approve           { password, submissionId }
 * - reject            { password, submissionId, reason }
 *
 * GET:
 * - ?page=admin
 * - ?page=leaderboard
 * - ?page=selftest
 */

const CFG = {
  // REQUIRED
  SHEET_ID: 'PASTE_SHEET_ID_HERE',
  SHEET_NAME: 'Votes',
  DRIVE_FOLDER_ID: 'PASTE_DRIVE_FOLDER_ID_HERE',
  ADMIN_PASSWORD: 'PASTE_ADMIN_PASSWORD_HERE',

  // Email via Resend
  RESEND_API_KEY: 'PASTE_RESEND_API_KEY_HERE',
  SENDER_EMAIL: 'voting@ifuckfans.com',

  // Frontend
  FRONTEND_BASE_URL: 'https://mrowtown.github.io/Cali_Votes',
  // Where the user lands when they click the magic link
  // (Make sure this file exists in your repo; landing.html does.)
  MAGIC_LINK_PATH: '/landing.html',

  // Token/session lifetimes
  MAGIC_LINK_EXPIRY_MINUTES: 30,
  SESSION_EXPIRY_DAYS: 7,

  // Basic abuse control
  RATE_LIMIT_PER_HOUR: 5
};

/* =========================
   SECURITY: allow only your site + local dev
========================= */

const SECURITY = {
  ALLOWED_ORIGINS: [
    'https://mrowtown.github.io',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  ALLOWED_REFERER_PREFIXES: [
    'https://mrowtown.github.io/Cali_Votes',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://script.google.com'
  ]
};

function getHeader_(e, name) {
  const h = e && e.headers ? e.headers : {};
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? String(h[key]) : '';
}

function isAllowedRequest_(e) {
  const origin = getHeader_(e, 'Origin');
  const referer = getHeader_(e, 'Referer');

  // If browser provides Origin, enforce strict match
  if (origin) return SECURITY.ALLOWED_ORIGINS.includes(origin);

  // Otherwise, fall back to Referer prefix match
  if (referer) return SECURITY.ALLOWED_REFERER_PREFIXES.some(p => referer.startsWith(p));

  // If neither header exists (curl/bot), block
  return false;
}

/* =========================
   HELPERS
========================= */

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function text_(t) {
  return ContentService.createTextOutput(String(t)).setMimeType(ContentService.MimeType.TEXT);
}

function now_() { return new Date(); }
function uuid_() { return Utilities.getUuid(); }

function addMinutes_(d, m) { const x = new Date(d); x.setMinutes(x.getMinutes() + m); return x; }
function addDays_(d, days) { const x = new Date(d); x.setDate(x.getDate() + days); return x; }

function email_(e) { return String(e || '').toLowerCase().trim(); }

function sheet_() {
  if (!CFG.SHEET_ID || CFG.SHEET_ID.includes('PASTE_')) throw new Error('CFG.SHEET_ID not set');
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sh = ss.getSheetByName(CFG.SHEET_NAME);
  if (!sh) throw new Error(`Sheet tab "${CFG.SHEET_NAME}" not found`);
  return sh;
}

function assertDrive_() {
  if (!CFG.DRIVE_FOLDER_ID || CFG.DRIVE_FOLDER_ID.includes('PASTE_')) throw new Error('CFG.DRIVE_FOLDER_ID not set');
}

/* =========================
   RATE LIMIT
========================= */

function limited_(ip, email) {
  const cache = CacheService.getScriptCache();
  const key = `rl:${ip}:${email}`;
  const n = Number(cache.get(key) || 0);
  if (n >= CFG.RATE_LIMIT_PER_HOUR) return true;
  cache.put(key, String(n + 1), 3600);
  return false;
}

/* =========================
   ROUTING
========================= */

function doGet(e) {
  const qs = e && e.parameter ? e.parameter : {};
  const page = String(qs.page || '').toLowerCase();

  if (page === 'admin') {
    return HtmlService.createHtmlOutputFromFile('admin').setTitle('Cali Votes — Admin');
  }

  if (page === 'leaderboard') {
    return leaderboard_();
  }

  if (page === 'selftest') {
    try {
      const sh = sheet_();
      return json_({ ok: true, sheet: CFG.SHEET_NAME, last_row: sh.getLastRow() });
    } catch (err) {
      return json_({ ok: false, error: err.message });
    }
  }

  return text_('OK');
}

function doPost(e) {
  try {
    if (!isAllowedRequest_(e)) return json_({ error: 'Forbidden (origin not allowed)' });

    const data = JSON.parse(e.postData?.contents || '{}');

    switch (data.action) {
      case 'requestMagicLink': return requestMagicLink_(data, e);
      case 'verifyMagicLink':  return verifyMagicLink_(data);

      case 'submitVote':       return submitVote_(data);
      case 'uploadScreenshot': return upload_(data);

      case 'adminList':        return adminList_(data);
      case 'approve':          return approve_(data);
      case 'reject':           return reject_(data);

      default:
        return json_({ error: 'Invalid action' });
    }
  } catch (err) {
    return json_({ error: err.message });
  }
}

/* =========================
   MAGIC LINK: request + verify
========================= */

function requestMagicLink_(d, e) {
  const em = email_(d.email);
  if (!em) return json_({ error: 'Email required' });

  // best-effort ip (Apps Script doesn’t reliably provide it; keep placeholder)
  const ip = 'unknown';

  if (limited_(ip, em)) return json_({ error: 'Rate limited' });

  const token = (uuid_() + uuid_()).replace(/-/g, '');
  const expires = addMinutes_(now_(), CFG.MAGIC_LINK_EXPIRY_MINUTES);

  // Store the magic token → email mapping in cache
  CacheService.getScriptCache().put(
    `magic:${token}`,
    JSON.stringify({ email: em, expires: expires.toISOString() }),
    CFG.MAGIC_LINK_EXPIRY_MINUTES * 60
  );

  const link =
    String(CFG.FRONTEND_BASE_URL).replace(/\/+$/, '') +
    String(CFG.MAGIC_LINK_PATH || '/landing.html') +
    `?verify=${encodeURIComponent(token)}`;

  const html = [
    `<p>Click to verify your email and continue voting:</p>`,
    `<p><a href="${link}">${link}</a></p>`,
    `<p style="color:#666;font-size:12px">This link expires in ${CFG.MAGIC_LINK_EXPIRY_MINUTES} minutes.</p>`
  ].join('');

  const sent = sendResend_(em, 'Cali Votes — verify your email', html);

  return json_({ ok: true, sent, expires_in_minutes: CFG.MAGIC_LINK_EXPIRY_MINUTES });
}

function verifyMagicLink_(d) {
  const token = String(d.token || '').trim();
  if (!token) return json_({ error: 'Missing token' });

  const raw = CacheService.getScriptCache().get(`magic:${token}`);
  if (!raw) return json_({ error: 'Link expired or invalid' });

  const obj = JSON.parse(raw);
  const exp = new Date(obj.expires);
  if (exp.getTime() < Date.now()) return json_({ error: 'Link expired' });

  const session = uuid_();
  const sessionExp = addDays_(now_(), CFG.SESSION_EXPIRY_DAYS);

  CacheService.getScriptCache().put(
    `session:${session}`,
    JSON.stringify({ email: obj.email, expires: sessionExp.toISOString() }),
    CFG.SESSION_EXPIRY_DAYS * 86400
  );

  // Optionally invalidate the magic link right away (one-time use)
  CacheService.getScriptCache().remove(`magic:${token}`);

  return json_({ ok: true, session, email: obj.email, expires: sessionExp.toISOString() });
}

function getSession_(token) {
  const raw = CacheService.getScriptCache().get(`session:${token}`);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (new Date(s.expires).getTime() < Date.now()) return null;
  return s;
}

/* =========================
   SUBMIT VOTE (requires session)
========================= */

function submitVote_(d) {
  const sess = getSession_(d.session);
  if (!sess) return json_({ error: 'Session expired (verify again)' });

  const city = String(d.city || '').trim();
  const votes = Number(d.votes_claimed);
  const paymentMethod = String(d.payment_method_selected || '').trim();

  if (!city) return json_({ error: 'City required' });
  if (!votes || votes <= 0) return json_({ error: 'Invalid votes' });

  const submissionId = uuid_();
  const uploadToken = (uuid_() + uuid_()).replace(/-/g, '');
  const uploadExpires = addDays_(now_(), CFG.SESSION_EXPIRY_DAYS);

  // Columns A–P
  sheet_().appendRow([
    submissionId, now_(),
    d.name_optional || '', d.discord_handle_optional || '',
    sess.email, city, votes, '',
    'pending', paymentMethod,
    '', '', '', 'unknown',
    uploadToken, uploadExpires
  ]);

  const uploadUrl =
    String(CFG.FRONTEND_BASE_URL).replace(/\/+$/, '') +
    String('/upload.html') +
    `?token=${encodeURIComponent(uploadToken)}`;

  return json_({ ok: true, submissionId, upload_url: uploadUrl });
}

/* =========================
   UPLOAD SCREENSHOT
========================= */

function upload_(d) {
  assertDrive_();

  const token = String(d.token || '').trim();
  const img = String(d.screenshot || '');

  if (!token) return json_({ error: 'Missing token' });
  if (!img.includes('base64,')) return json_({ error: 'Missing screenshot data' });

  const sh = sheet_();
  const rows = sh.getDataRange().getValues();

  // O upload_token = index 14, P expiry = index 15
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][14] || '') === token) { rowIndex = i; break; }
  }
  if (rowIndex < 0) return json_({ error: 'Invalid token' });

  const exp = rows[rowIndex][15];
  if (exp && new Date(exp).getTime() < Date.now()) return json_({ error: 'Expired' });

  const bytes = Utilities.base64Decode(img.split('base64,')[1]);
  const submissionId = String(rows[rowIndex][0] || uuid_());
  const blob = Utilities.newBlob(bytes, 'image/jpeg', `${submissionId}_proof.jpg`);

  const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // K screenshot_drive_url = col 11
  sh.getRange(rowIndex + 1, 11).setValue(file.getUrl());

  return json_({ ok: true, url: file.getUrl() });
}

/* =========================
   ADMIN
========================= */

function adminList_(d) {
  if (String(d.password || '') !== CFG.ADMIN_PASSWORD) return json_({ error: 'Unauthorized' });

  const filter = String(d.filter || 'pending_with_proof');
  const rows = sheet_().getDataRange().getValues();

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {
      submission_id: r[0],
      created_at: r[1] ? new Date(r[1]).toLocaleString() : '',
      email: r[4] || '',
      city: r[5] || '',
      votes_claimed: r[6] || 0,
      status: r[8] || '',
      payment_method_selected: r[9] || '',
      screenshot_drive_url: r[10] || ''
    };

    const hasProof = !!obj.screenshot_drive_url;
    const status = String(obj.status || '');

    if (filter === 'pending_with_proof') {
      if (status === 'pending' && hasProof) out.push(obj);
    } else if (filter === 'pending_all') {
      if (status === 'pending') out.push(obj);
    } else if (filter === 'approved') {
      if (status === 'approved') out.push(obj);
    } else if (filter === 'rejected') {
      if (status === 'rejected') out.push(obj);
    } else {
      out.push(obj);
    }
  }

  return json_({ ok: true, rows: out.reverse() });
}

function approve_(d) {
  if (String(d.password || '') !== CFG.ADMIN_PASSWORD) return json_({ error: 'Unauthorized' });
  const id = String(d.submissionId || '').trim();
  if (!id) return json_({ error: 'Missing submissionId' });
  return setStatus_(id, 'approved');
}

function reject_(d) {
  if (String(d.password || '') !== CFG.ADMIN_PASSWORD) return json_({ error: 'Unauthorized' });
  const id = String(d.submissionId || '').trim();
  if (!id) return json_({ error: 'Missing submissionId' });
  const reason = String(d.reason || '').trim();
  return setStatus_(id, 'rejected', reason);
}

function setStatus_(id, status, note) {
  const sh = sheet_();
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === id) {
      sh.getRange(i + 1, 9).setValue(status); // I status
      if (status === 'approved') sh.getRange(i + 1, 12).setValue(now_()); // L approved_at
      if (note) sh.getRange(i + 1, 13).setValue(note); // M admin_notes
      return json_({ ok: true });
    }
  }
  return json_({ error: 'Not found' });
}

/* =========================
   LEADERBOARD (approved only)
========================= */

function leaderboard_() {
  const rows = sheet_().getDataRange().getValues();
  const totals = {};

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][8] || '') !== 'approved') continue;
    const city = String(rows[i][5] || '').trim();
    const votes = Number(rows[i][6] || 0);
    if (!city) continue;
    totals[city] = (totals[city] || 0) + votes;
  }

  const leaderboard = Object.entries(totals)
    .map(([city, votes]) => ({ city, votes }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 50);

  return json_({ leaderboard, updated_at: new Date().toISOString() });
}

/* =========================
   RESEND
========================= */

function sendResend_(to, subject, html) {
  const key = String(CFG.RESEND_API_KEY || '').trim();
  if (!key || key.includes('PASTE_')) {
    Logger.log(`Resend not configured. Would send to=${to} subject=${subject}`);
    Logger.log(html);
    return { attempted: false, skipped: 'RESEND_API_KEY not set' };
  }

  try {
    const resp = UrlFetchApp.fetch('https://api.resend.com/emails', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + key },
      contentType: 'application/json',
      payload: JSON.stringify({
        from: CFG.SENDER_EMAIL,
        to: [to],
        subject,
        html
      }),
      muteHttpExceptions: true
    });

    return { attempted: true, http_status: resp.getResponseCode(), body: (resp.getContentText() || '').slice(0, 200) };
  } catch (e) {
    return { attempted: true, error: String(e && e.message ? e.message : e) };
  }
}
