/**
 * Code.gs — Cali Votes — Phase 1 Hardening (Jan 2026)
 *
 * Changes:
 * - Script Properties for secrets (no plaintext in code)
 * - Strict origin allowlist (exact origins)
 * - Magic links persisted in Sheet (Auth tab), single-use, expiry
 * - Sessions persisted in Sheet (Auth tab), 24h expiry
 * - Upload validation (size + basic mime sniff)
 * - Idempotency key for submitVote (prevents dupes)
 * - Drive sharing configurable (public vs private)
 * - Rate limit + optional disposable domain blocklist hook
 *
 * Tabs:
 * - Votes (existing schema A–P plus optional Q idem_key)
 * - Auth (new)
 * - Idem (new)
 */

const CFG = {
  SHEET_ID: '1Kk2BVH0zJSVquJ0ln6XOG0gPdZ8ouAthXh61BHh4Dlg',
  VOTES_SHEET: 'Votes',
  AUTH_SHEET: 'Auth',
  IDEM_SHEET: 'Idem',

  // Public frontend base (for redirect links)
  FRONTEND_BASE_URL: 'https://MrowTown.github.io/Cali_Votes',
  UPLOAD_PAGE_PATH: '/upload.html',
  LANDING_PAGE_PATH: '/landing.html',

  // Allowlist: exact origins only (no prefix)
  // Add your production embed origin(s) here too (Strikingly custom domains, etc)
  ALLOWED_ORIGINS: [
    'https://mrowtown.github.io',
    'http://127.0.0.1:5500',
    'http://localhost:5500'
  ],

  // Magic link & session
  MAGIC_LINK_EXPIRY_MINUTES: 30,
  SESSION_EXPIRY_HOURS: 24,

  // Upload link
  UPLOAD_LINK_EXPIRY_DAYS: 7,

  // Upload validation
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024, // 5MB
  ALLOW_PUBLIC_PROOF_LINKS: true, // set false to keep proof private by default

  // Rate limiting
  RATE_LIMIT_PER_HOUR: 8,

  // Optional: naive disposable domain block (keep empty to disable)
  BLOCKED_EMAIL_DOMAINS: [
    // 'mailinator.com',
    // 'tempmail.com'
  ]
};

// ---- Script Properties keys ----
const PROP_KEYS = {
  DRIVE_FOLDER_ID: '1yUXw6Dqay5503TFN6uhPxWyUozXQuaLx',
  RESEND_API_KEY: 're_72iRHvPa_EpHZUyoj77RaqUNDqq39cgHh',
  ADMIN_PASSWORD: 'BeTheBitch2014',
  SENDER_EMAIL: 'voting@ifuckfans.com'
};

// -------------------- helpers --------------------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function text_(txt) {
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.TEXT);
}
function now_() { return new Date(); }
function addDays_(d, days) { const x = new Date(d); x.setDate(x.getDate() + days); return x; }
function addMinutes_(d, mins) { const x = new Date(d); x.setMinutes(x.getMinutes() + mins); return x; }
function addHours_(d, hrs) { const x = new Date(d); x.setHours(x.getHours() + hrs); return x; }
function uuid_() { return Utilities.getUuid(); }
function email_(e) { return String(e || '').toLowerCase().trim(); }

function assertCfg_() {
  if (!CFG.SHEET_ID || CFG.SHEET_ID.includes('PASTE_')) throw new Error('CFG.SHEET_ID not set');
  if (!CFG.VOTES_SHEET) throw new Error('CFG.VOTES_SHEET missing');
  if (!CFG.AUTH_SHEET) throw new Error('CFG.AUTH_SHEET missing');
  if (!CFG.IDEM_SHEET) throw new Error('CFG.IDEM_SHEET missing');
}

function props_() { return PropertiesService.getScriptProperties(); }
function mustProp_(key) {
  const v = String(props_().getProperty(key) || '').trim();
  if (!v) throw new Error(`Missing Script Property: ${key}`);
  return v;
}

function sheetByName_(name) {
  assertCfg_();
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Sheet tab "${name}" not found`);
  return sh;
}

function votes_() { return sheetByName_(CFG.VOTES_SHEET); }
function auth_() { return sheetByName_(CFG.AUTH_SHEET); }
function idem_() { return sheetByName_(CFG.IDEM_SHEET); }

function strictOrigin_(o) {
  const origin = String(o || '').trim().toLowerCase();
  if (!origin) return { ok: false, error: 'Forbidden (origin not allowed)', received_origin: '' };

  // Normalize to origin only if they accidentally send full URL
  let normalized = origin;
  try { normalized = new URL(origin).origin.toLowerCase(); } catch (_) { /* keep */ }

  const allowed = CFG.ALLOWED_ORIGINS.map(x => String(x).toLowerCase());
  if (!allowed.includes(normalized)) {
    return {
      ok: false,
      error: 'Forbidden (origin not allowed)',
      received_origin: normalized,
      allowed: CFG.ALLOWED_ORIGINS
    };
  }
  return { ok: true, origin: normalized };
}

function badEmailDomain_(email) {
  const parts = String(email || '').split('@');
  if (parts.length !== 2) return true;
  const domain = parts[1].toLowerCase();
  if (!domain) return true;
  const blocked = (CFG.BLOCKED_EMAIL_DOMAINS || []).map(x => String(x).toLowerCase().trim()).filter(Boolean);
  return blocked.includes(domain);
}

function uploadUrlFromToken_(token) {
  const base = String(CFG.FRONTEND_BASE_URL || '').replace(/\/+$/, '');
  const path = String(CFG.UPLOAD_PAGE_PATH || '/upload.html');
  return base + path + '?token=' + encodeURIComponent(token);
}

function landingVerifyUrl_(verifyToken) {
  const base = String(CFG.FRONTEND_BASE_URL || '').replace(/\/+$/, '');
  const path = String(CFG.LANDING_PAGE_PATH || '/landing.html');
  return base + path + '?verify=' + encodeURIComponent(verifyToken);
}

// -------------------- rate limit --------------------
function limited_(bucketKey) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(bucketKey) || 0);
  if (n >= CFG.RATE_LIMIT_PER_HOUR) return true;
  cache.put(bucketKey, String(n + 1), 3600);
  return false;
}

// -------------------- routing --------------------
function doGet(e) {
  const qs = (e && e.parameter) ? e.parameter : {};
  const page = String(qs.page || '').toLowerCase();

  if (page === 'selftest') {
    try {
      votes_(); auth_(); idem_();
      return json_({ ok: true, sheet: CFG.VOTES_SHEET, last_row: votes_().getLastRow() });
    } catch (err) {
      return json_({ ok: false, error: err.message });
    }
  }

  if (page === 'admin') {
    return HtmlService.createHtmlOutputFromFile('admin').setTitle('Cali Votes — Admin');
  }

  if (page === 'leaderboard') {
    return leaderboard_();
  }

  return text_('OK');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData?.contents || '{}');
    const action = String(data.action || '');

    // enforce strict origin on all user-facing actions
    const originRequired = !['adminList','approve','reject'].includes(action);
    if (originRequired) {
      const gate = strictOrigin_(data.origin);
      if (!gate.ok) return json_(gate);
      data._origin = gate.origin;
    }

    switch (action) {
      case 'requestMagicLink': return requestMagicLink_(data);
      case 'verifyMagicLink': return verifyMagicLink_(data);
      case 'submitVote': return submitVote_(data);
      case 'uploadScreenshot': return upload_(data);

      case 'adminList': return adminList_(data);
      case 'approve': return approve_(data);
      case 'reject': return reject_(data);

      default: return json_({ error: 'Invalid action' });
    }
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- Auth tab helpers --------------------
function authFindRow_(kind, token) {
  const sh = auth_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === kind && String(rows[i][1] || '') === token) return { rowIndex: i + 1, row: rows[i] };
  }
  return null;
}

function authInsert_(kind, token, email, expiresAt, metaObj) {
  auth_().appendRow([
    kind,
    token,
    email,
    now_(),
    expiresAt,
    '', // used_at
    metaObj ? JSON.stringify(metaObj) : ''
  ]);
}

function authMarkUsed_(rowIndex) {
  auth_().getRange(rowIndex, 6).setValue(now_()); // F used_at
}

function authExpired_(expiresCell) {
  if (!expiresCell) return true;
  const exp = new Date(expiresCell);
  return exp.getTime() < now_().getTime();
}

// -------------------- Idempotency tab helpers --------------------
function idemGet_(key) {
  const sh = idem_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === key) return { key, created_at: rows[i][1], submission_id: rows[i][2], rowIndex: i + 1 };
  }
  return null;
}

function idemPut_(key, submissionId) {
  idem_().appendRow([ key, now_(), submissionId ]);
}

// -------------------- Magic link flow --------------------
function requestMagicLink_(d) {
  const email = email_(d.email);
  if (!email) return json_({ error: 'Email required' });
  if (badEmailDomain_(email)) return json_({ error: 'Email provider not allowed' });

  const rlKey = `rl:magic:${email}`;
  if (limited_(rlKey)) return json_({ error: 'Rate limited' });

  const verifyToken = (uuid_() + uuid_()).replace(/-/g, '');
  const exp = addMinutes_(now_(), CFG.MAGIC_LINK_EXPIRY_MINUTES);

  authInsert_('magic', verifyToken, email, exp, { origin: d._origin });

  const link = landingVerifyUrl_(verifyToken);
  const mail = sendMagicLinkMail_(email, link);

  return json_({ ok: true, mail, expires_at: exp.toISOString() });
}

function verifyMagicLink_(d) {
  const token = String(d.token || '').trim();
  if (!token) return json_({ error: 'Missing token' });

  const found = authFindRow_('magic', token);
  if (!found) return json_({ error: 'Invalid or expired token' });

  const row = found.row;
  const email = email_(row[2]);
  const expiresAt = row[4];
  const usedAt = row[5];

  if (usedAt) return json_({ error: 'Invalid or expired token' });
  if (authExpired_(expiresAt)) return json_({ error: 'Invalid or expired token' });

  // burn magic token
  authMarkUsed_(found.rowIndex);

  // create session
  const session = (uuid_() + uuid_()).replace(/-/g, '');
  const sessExp = addHours_(now_(), CFG.SESSION_EXPIRY_HOURS);

  authInsert_('session', session, email, sessExp, { origin: d._origin });

  return json_({ ok: true, session, email, expires_at: sessExp.toISOString() });
}

function requireSessionEmail_(session) {
  const s = String(session || '').trim();
  if (!s) return { ok: false, error: 'Missing session' };

  const found = authFindRow_('session', s);
  if (!found) return { ok: false, error: 'Invalid or expired session' };

  const row = found.row;
  const email = email_(row[2]);
  const expiresAt = row[4];
  const usedAt = row[5];

  // We don't "use" sessions; usedAt is ignored for sessions
  if (authExpired_(expiresAt)) return { ok: false, error: 'Invalid or expired session' };
  return { ok: true, email };
}

// -------------------- Submit vote (idempotent) --------------------
function submitVote_(d) {
  const sess = requireSessionEmail_(d.session);
  if (!sess.ok) return json_({ error: sess.error });

  const email = sess.email;
  const city = String(d.city || '').trim();
  const votes = Number(d.votes_claimed || 0);
  const pm = String(d.payment_method_selected || '').trim();

  if (!city) return json_({ error: 'City required' });
  if (!votes || votes <= 0) return json_({ error: 'Invalid votes' });
  if (!pm) return json_({ error: 'Payment method required' });
  if (badCity_(city)) return json_({ error: 'Invalid city' });

  // Idempotency key: (session + city + votes + pm) stable hash
  const idemKey = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${d.session}|${city}|${votes}|${pm}`)
  );

  const existing = idemGet_(idemKey);
  if (existing) {
    return json_({
      ok: true,
      submissionId: existing.submission_id,
      upload_url: uploadUrlFromToken_(getUploadTokenBySubmission_(existing.submission_id) || ''),
      amount_due_usd: Math.round(votes * 5),
      idem: true
    });
  }

  const sh = votes_();
  const submissionId = uuid_();
  const uploadToken = (uuid_() + uuid_()).replace(/-/g, '');
  const uploadExp = addDays_(now_(), CFG.UPLOAD_LINK_EXPIRY_DAYS);
  const amountUsd = Math.round(votes * 5);

  // Append row A–P plus optional Q idem_key
  // A submission_id
  // ...
  // O upload_token
  // P upload_expires_at
  // Q idem_key (optional)
  const row = [
    submissionId, now_(),
    d.name_optional || '', d.discord_handle_optional || '',
    email, city, votes, '',
    'pending', pm,
    '', '', '', '', // ip/admin meta unused here
    uploadToken, uploadExp
  ];

  sh.appendRow(row);

  // try write Q if present
  try {
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    // If Q exists (>=17 cols), write it at col 17
    if (lastCol >= 17) sh.getRange(lastRow, 17).setValue(idemKey);
  } catch (_) {}

  idemPut_(idemKey, submissionId);

  return json_({
    ok: true,
    submissionId,
    upload_url: uploadUrlFromToken_(uploadToken),
    amount_due_usd: amountUsd,
    idem: false
  });
}

function getUploadTokenBySubmission_(submissionId) {
  const sh = votes_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === submissionId) {
      return String(rows[i][14] || ''); // O upload_token
    }
  }
  return '';
}

// -------------------- Upload proof (validated) --------------------
function upload_(d) {
  try {
    const folderId = mustProp_(PROP_KEYS.DRIVE_FOLDER_ID);

    const token = String(d.token || '').trim();
    const img = String(d.screenshot || '');

    if (!token) return json_({ error: 'Missing token' });
    if (!img.includes('base64,')) return json_({ error: 'Missing screenshot data' });

    // Estimate size from base64 length (rough)
    const b64 = img.split('base64,')[1] || '';
    const approxBytes = Math.floor((b64.length * 3) / 4);
    if (approxBytes > CFG.MAX_UPLOAD_BYTES) return json_({ error: 'File too large (max 5MB)' });

    const sh = votes_();
    const rows = sh.getDataRange().getValues();

    let r = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][14] || '') === token) { r = i; break; }
    }
    if (r < 0) return json_({ error: 'Invalid token' });

    const status = String(rows[r][8] || '');
    if (status === 'approved') return json_({ error: 'Already approved' });

    const exp = rows[r][15];
    if (exp && new Date(exp).getTime() < now_().getTime()) return json_({ error: 'Expired' });

    const bytes = Utilities.base64Decode(b64);

    // Basic MIME sniff (JPEG/PNG)
    const isJpg = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8;
    const isPng = bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;

    if (!isJpg && !isPng) return json_({ error: 'Only JPG/PNG allowed' });

    const submissionId = String(rows[r][0] || uuid_());
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const ext = isPng ? 'png' : 'jpg';
    const blob = Utilities.newBlob(bytes, mime, submissionId + '_proof.' + ext);

    const folder = DriveApp.getFolderById(folderId);
    const file = folder.createFile(blob);

    if (CFG.ALLOW_PUBLIC_PROOF_LINKS) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } else {
      // Leave private; admin will need Drive access
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    }

    sh.getRange(r + 1, 11).setValue(file.getUrl()); // K screenshot_drive_url
    return json_({ ok: true, url: file.getUrl() });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- Admin --------------------
function adminList_(d) {
  if (String(d.password || '') !== mustProp_(PROP_KEYS.ADMIN_PASSWORD)) return json_({ error: 'Unauthorized' });

  try {
    const filter = String(d.filter || 'pending_with_proof');
    const rows = votes_().getDataRange().getValues();

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
  } catch (err) {
    return json_({ error: err.message });
  }
}

function approve_(d) {
  if (String(d.password || '') !== mustProp_(PROP_KEYS.ADMIN_PASSWORD)) return json_({ error: 'Unauthorized' });
  const id = String(d.submissionId || '').trim();
  if (!id) return json_({ error: 'Missing submissionId' });
  return setStatus_(id, 'approved');
}

function reject_(d) {
  if (String(d.password || '') !== mustProp_(PROP_KEYS.ADMIN_PASSWORD)) return json_({ error: 'Unauthorized' });
  const id = String(d.submissionId || '').trim();
  if (!id) return json_({ error: 'Missing submissionId' });
  const reason = String(d.reason || '').trim();
  return setStatus_(id, 'rejected', reason);
}

function setStatus_(id, status, note) {
  try {
    const sh = votes_();
    const rows = sh.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '') === id) {
        sh.getRange(i + 1, 9).setValue(status); // I status
        if (status === 'approved') sh.getRange(i + 1, 12).setValue(now_()); // L approved_at
        if (note) sh.getRange(i + 1, 13).setValue(note); // M notes
        return json_({ ok: true });
      }
    }
    return json_({ error: 'Not found' });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- Leaderboard (unchanged) --------------------
function leaderboard_() {
  try {
    const rows = votes_().getDataRange().getValues();
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
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- Resend email --------------------
function sendMagicLinkMail_(to, link) {
  const key = mustProp_(PROP_KEYS.RESEND_API_KEY);
  const from = mustProp_(PROP_KEYS.SENDER_EMAIL);

  const html = [
    `<p><b>Verify your email</b> to vote for Cali’s tour city:</p>`,
    `<p><a href="${link}">${link}</a></p>`,
    `<p style="color:#666;font-size:12px">This link expires in ${CFG.MAGIC_LINK_EXPIRY_MINUTES} minutes.</p>`
  ].join('');

  try {
    const resp = UrlFetchApp.fetch('https://api.resend.com/emails', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + key },
      contentType: 'application/json',
      payload: JSON.stringify({
        from,
        to: [to],
        subject: 'Cali Votes — verify your email',
        html
      }),
      muteHttpExceptions: true
    });

    return {
      attempted: true,
      http_status: resp.getResponseCode(),
      body_preview: (resp.getContentText() || '').slice(0, 200)
    };
  } catch (e) {
    return { attempted: true, error: String(e && e.message ? e.message : e) };
  }
}
