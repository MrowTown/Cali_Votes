/**
 * Code.gs — Cali Votes (Multi-step) — Magic Link + Origin Gate (FULL REPLACEMENT)
 *
 * GET  /exec?page=selftest
 * GET  /exec?page=leaderboard
 * GET  /exec?page=admin
 *
 * POST (text/plain JSON):
 * - { action:"requestMagicLink", email, origin }
 * - { action:"verifyMagicLink", token, origin }
 * - { action:"submitVote", session, city, votes_claimed, payment_method_selected, name_optional, discord_handle_optional, origin }
 * - { action:"uploadScreenshot", token, screenshot, origin }
 * - { action:"adminList", password, filter }
 * - { action:"approve", password, submissionId }
 * - { action:"reject", password, submissionId, reason }
 */

const CFG = {
  SHEET_ID: '15fYGXqlmN7300gu91ho7QYizNxIHr_mFPEQIXWigqjk',
  SHEET_NAME: 'Votes',

  DRIVE_FOLDER_ID: '1yUXw6Dqay5503TFN6uhPxWyUozXQuaLx',
  RESEND_API_KEY: 're_72iRHvPa_EpHZUyoj77RaqUNDqq39cgHh',
  ADMIN_PASSWORD: 'BeTheBitch2014',

  SENDER_EMAIL: 'voting@ifuckfans.com',

  FRONTEND_BASE_URL: 'https://MrowTown.github.io/Cali_Votes',
  UPLOAD_PAGE_PATH: '/upload.html',

  MAGIC_LINK_EXPIRY_MINUTES: 30,
  UPLOAD_LINK_EXPIRY_DAYS: 7,
  RATE_LIMIT_PER_HOUR: 8,

  // ✅ Allowed origins (dev + prod)
  ALLOW_ORIGINS: [
    'https://MrowTown.github.io',
    'http://localhost',
    'http://127.0.0.1'
  ]
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
function uuid_() { return Utilities.getUuid(); }
function email_(e) { return String(e || '').toLowerCase().trim(); }
function badCity_(c) { return /fuck|shit|ass/i.test(String(c || '')); }

function uploadUrlFromToken_(token) {
  const base = String(CFG.FRONTEND_BASE_URL || '').replace(/\/+$/, '');
  const path = String(CFG.UPLOAD_PAGE_PATH || '/upload.html');
  return base + path + '?token=' + encodeURIComponent(token);
}

function landingVerifyUrl_(verifyToken) {
  const base = String(CFG.FRONTEND_BASE_URL || '').replace(/\/+$/, '');
  return base + '/landing.html?verify=' + encodeURIComponent(verifyToken);
}

function assertCfg_() {
  if (!CFG.SHEET_ID || CFG.SHEET_ID.includes('PASTE_')) throw new Error('CFG.SHEET_ID not set');
  if (!CFG.SHEET_NAME) throw new Error('CFG.SHEET_NAME missing');
}
function assertDrive_() {
  if (!CFG.DRIVE_FOLDER_ID || CFG.DRIVE_FOLDER_ID.includes('PASTE_')) throw new Error('CFG.DRIVE_FOLDER_ID not set');
}
function sheet_() {
  assertCfg_();
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sh = ss.getSheetByName(CFG.SHEET_NAME);
  if (!sh) throw new Error(`Sheet tab "${CFG.SHEET_NAME}" not found`);
  return sh;
}

// -------------------- origin gate --------------------
function normalizeOrigin_(o) {
  const s = String(o || '').trim();
  // accept full origin, OR accept full URL (we strip to origin)
  // e.g. "http://127.0.0.1:5500/path" -> "http://127.0.0.1:5500"
  if (!s) return '';
  try {
    // If s is already an origin like http://localhost:5500, URL() works too
    const u = new URL(s);
    return u.origin;
  } catch (_) {
    // If it isn't parseable as URL, return as-is (we'll compare prefixes)
    return s;
  }
}

function originAllowed_(origin) {
  const o = normalizeOrigin_(origin);

  if (!o) return false;

  // Allow if origin starts with any allowed prefix:
  // - https://MrowTown.github.io
  // - http://localhost:xxxx
  // - http://127.0.0.1:xxxx
  return CFG.ALLOW_ORIGINS.some(prefix => o.startsWith(prefix));
}

function requireOrigin_(data) {
  const provided = normalizeOrigin_(data && (data.origin || data.site_origin || data.frontend_origin));
  if (!provided) {
    return { ok: false, error: 'Forbidden (origin not allowed)', received_origin: '' };
  }
  if (!originAllowed_(provided)) {
    return { ok: false, error: 'Forbidden (origin not allowed)', received_origin: provided, allowed_prefixes: CFG.ALLOW_ORIGINS };
  }
  return { ok: true, origin: provided };
}

// -------------------- rate limit --------------------
function limited_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key) || 0);
  if (n >= CFG.RATE_LIMIT_PER_HOUR) return true;
  cache.put(key, String(n + 1), 3600);
  return false;
}

// -------------------- routing --------------------
function doGet(e) {
  const qs = (e && e.parameter) ? e.parameter : {};
  const page = String(qs.page || '').toLowerCase();

  if (page === 'selftest') {
    try {
      const sh = sheet_();
      return json_({ ok: true, sheet: CFG.SHEET_NAME, last_row: sh.getLastRow() });
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

    // ✅ enforce origin on all user-facing actions
    const action = String(data.action || '');
    const needsOrigin = !['adminList','approve','reject'].includes(action);
    if (needsOrigin) {
      const gate = requireOrigin_(data);
      if (!gate.ok) return json_(gate);
    }

    switch (data.action) {
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

// -------------------- magic link --------------------
function requestMagicLink_(d) {
  const email = email_(d.email);
  if (!email) return json_({ error: 'Email required' });

  const rlKey = `rl:magic:${email}`;
  if (limited_(rlKey)) return json_({ error: 'Rate limited' });

  const token = (uuid_() + uuid_()).replace(/-/g, '');
  const exp = addMinutes_(now_(), CFG.MAGIC_LINK_EXPIRY_MINUTES);

  // Store token in Cache (simple + fast). If you need persistence, store in sheet.
  const cache = CacheService.getScriptCache();
  cache.put(`ml:${token}`, JSON.stringify({ email, exp: exp.toISOString() }), CFG.MAGIC_LINK_EXPIRY_MINUTES * 60);

  const link = landingVerifyUrl_(token);
  const mail = sendMagicLinkMail_(email, link);

  return json_({ ok: true, mail, expires_at: exp.toISOString() });
}

function verifyMagicLink_(d) {
  const token = String(d.token || '').trim();
  if (!token) return json_({ error: 'Missing token' });

  const cache = CacheService.getScriptCache();
  const raw = cache.get(`ml:${token}`);
  if (!raw) return json_({ error: 'Invalid or expired token' });

  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) {}
  const email = email_(obj && obj.email);
  const expIso = obj && obj.exp;
  if (!email) return json_({ error: 'Invalid or expired token' });

  // burn token (single-use)
  cache.remove(`ml:${token}`);

  // create session
  const session = (uuid_() + uuid_()).replace(/-/g, '');
  const sessExp = addMinutes_(now_(), 60 * 24); // 24 hours

  cache.put(`sess:${session}`, JSON.stringify({ email, exp: sessExp.toISOString() }), 60 * 60 * 24);

  return json_({
    ok: true,
    session,
    email,
    expires_at: sessExp.toISOString()
  });
}

function requireSessionEmail_(session) {
  const s = String(session || '').trim();
  if (!s) return { ok: false, error: 'Missing session' };

  const cache = CacheService.getScriptCache();
  const raw = cache.get(`sess:${s}`);
  if (!raw) return { ok: false, error: 'Invalid or expired session' };

  try {
    const obj = JSON.parse(raw);
    const email = email_(obj.email);
    if (!email) return { ok: false, error: 'Invalid or expired session' };
    return { ok: true, email };
  } catch (_) {
    return { ok: false, error: 'Invalid or expired session' };
  }
}

// -------------------- submit vote --------------------
function submitVote_(d) {
  const sess = requireSessionEmail_(d.session);
  if (!sess.ok) return json_({ error: sess.error });

  const email = sess.email;
  const city = String(d.city || '').trim();
  const votes = Number(d.votes_claimed || 0);
  const pm = String(d.payment_method_selected || '').trim();

  if (!city) return json_({ error: 'City required' });
  if (!votes || votes <= 0) return json_({ error: 'Invalid votes' });
  if (badCity_(city)) return json_({ error: 'Invalid city' });
  if (!pm) return json_({ error: 'Payment method required' });

  const sh = sheet_();
  const submissionId = uuid_();
  const uploadToken = (uuid_() + uuid_()).replace(/-/g, '');
  const uploadExp = addDays_(now_(), CFG.UPLOAD_LINK_EXPIRY_DAYS);

  const amountUsd = Math.round(votes * 5);

  // Columns A–P
  sh.appendRow([
    submissionId, now_(),
    d.name_optional || '', d.discord_handle_optional || '',
    email, city, votes, '',
    'pending', pm,
    '', '', '', (d.origin || ''),
    uploadToken, uploadExp
  ]);

  const uploadUrl = uploadUrlFromToken_(uploadToken);

  // optional: send "pay + upload" email here if you want
  // (keeping it off for now because your UX is in-app)

  return json_({
    ok: true,
    submissionId,
    upload_url: uploadUrl,
    amount_due_usd: amountUsd
  });
}

// -------------------- upload proof --------------------
function upload_(d) {
  try {
    assertDrive_();

    const token = String(d.token || '').trim();
    const img = String(d.screenshot || '');

    if (!token) return json_({ error: 'Missing token' });
    if (!img.includes('base64,')) return json_({ error: 'Missing screenshot data' });

    const sh = sheet_();
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

    const bytes = Utilities.base64Decode(img.split('base64,')[1]);
    const submissionId = String(rows[r][0] || uuid_());
    const blob = Utilities.newBlob(bytes, 'image/jpeg', submissionId + '_proof.jpg');

    const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    sh.getRange(r + 1, 11).setValue(file.getUrl()); // K screenshot_drive_url

    return json_({ ok: true, url: file.getUrl() });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// -------------------- admin --------------------
function adminList_(d) {
  if (String(d.password || '') !== CFG.ADMIN_PASSWORD) return json_({ error: 'Unauthorized' });

  try {
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
  } catch (err) {
    return json_({ error: err.message });
  }
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
  try {
    const sh = sheet_();
    const rows = sh.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '') === id) {
        sh.getRange(i + 1, 9).setValue(status);
        if (status === 'approved') sh.getRange(i + 1, 12).setValue(now_());
        if (note) sh.getRange(i + 1, 13).setValue(note);
        return json_({ ok: true });
      }
    }
    return json_({ error: 'Not found' });
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

// -------------------- email --------------------
function sendMagicLinkMail_(to, link) {
  const key = String(CFG.RESEND_API_KEY || '').trim();
  if (!key || key.includes('PASTE_')) {
    Logger.log('Resend not configured; would send magic link to ' + to + ': ' + link);
    return { attempted: false, skipped: 'RESEND_API_KEY not set' };
  }

  const html = [
    `<p>Tap to verify your email and continue voting:</p>`,
    `<p><a href="${link}">${link}</a></p>`,
    `<p style="color:#666;font-size:12px">This link expires soon.</p>`
  ].join('');

  try {
    const resp = UrlFetchApp.fetch('https://api.resend.com/emails', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + key },
      contentType: 'application/json',
      payload: JSON.stringify({
        from: CFG.SENDER_EMAIL,
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
