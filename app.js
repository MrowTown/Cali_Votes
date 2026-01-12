// app.js — shared helpers + session handling + "logged in as" banner (Cali Votes)

function cfg(){
  const c = (window.CALI_VOTES || {});
  if (!c.EXEC_URL || String(c.EXEC_URL).includes("PASTE_")) throw new Error("Config missing: CALI_VOTES.EXEC_URL");
  if (!c.ASSET_BASE || String(c.ASSET_BASE).includes("PASTE_")) throw new Error("Config missing: CALI_VOTES.ASSET_BASE");
  return c;
}

function qs(name){
  return new URLSearchParams(window.location.search).get(name);
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

async function post(action, payload){
  const { EXEC_URL } = cfg();
  const body = { action, ...payload };
  if (!Object.prototype.hasOwnProperty.call(body, "origin")) {
    body.origin = window.location.origin;
  }
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type":"text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text }; }
}

// -------- session storage --------
// Session shape expected from backend verifyMagicLink:
// { session_token, email, name_optional, discord_handle_optional, expires_at }
function saveSession(sessionObj){
  if (!sessionObj) return;
  const token = sessionObj.session_token || sessionObj.session || "";
  if (token) localStorage.setItem("cali_session_token", token);
  if (sessionObj.email) localStorage.setItem("cali_email", sessionObj.email);
  if (sessionObj.name_optional) localStorage.setItem("cali_name_optional", sessionObj.name_optional);
  if (sessionObj.discord_handle_optional) localStorage.setItem("cali_discord_handle_optional", sessionObj.discord_handle_optional);
  if (sessionObj.expires_at) localStorage.setItem("cali_expires_at", sessionObj.expires_at);
}

function getSession(){
  const session_token = localStorage.getItem("cali_session_token") || "";
  return {
    session_token,
    session: session_token,
    email: localStorage.getItem("cali_email") || "",
    name_optional: localStorage.getItem("cali_name_optional") || "",
    discord_handle_optional: localStorage.getItem("cali_discord_handle_optional") || "",
    expires_at: localStorage.getItem("cali_expires_at") || ""
  };
}

function clearSession(){
  [
    "cali_session_token",
    "cali_email",
    "cali_name_optional",
    "cali_discord_handle_optional",
    "cali_expires_at"
  ].forEach(k => localStorage.removeItem(k));
}

// -------- magic link handling --------
// Looks for ?verify=TOKEN. If present, calls verifyMagicLink and stores session.
// Options:
//  - onSuccessRedirect: "vote.html" (default)
// Returns: { handled:boolean, ok:boolean, error?:string }
async function handleMagicLinkIfPresent(opts = {}){
  const token = qs("verify");
  if (!token) return { handled: false, ok: true };

  const origin = window.location.origin;

  const res = await post("verifyMagicLink", { token, origin });
  if (res.error) return { handled: true, ok: false, error: res.error };

  // Backend may return { session: {...} } OR {...}
  const sessionObj = res.session ? res.session : res;
  saveSession(sessionObj);

  // Clean URL
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);

  const dest = opts.onSuccessRedirect || "vote.html";
  window.location.href = dest;
  return { handled: true, ok: true };
}

// -------- banner: "Currently logged in as X" --------
// Place a <div id="sessionBanner"></div> in your HTML (top of body).
function mountSessionBanner(){
  const el = document.getElementById("sessionBanner");
  if (!el) return;

  const s = getSession();
  if (!s.email || !s.session_token) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }

  el.style.display = "block";
  el.innerHTML = `
    <div style="
      display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;
      padding:10px 12px; border-radius:14px;
      background: rgba(0,0,0,.18);
      border: 1px solid rgba(255,255,255,.10);
      margin: 12px auto; max-width: 980px;
    ">
      <div style="font-size:13px; opacity:.9;">
        Currently logged in as <b>${esc(s.email)}</b>
      </div>
      <button id="bannerLogout" style="
        cursor:pointer; font-weight:900;
        border-radius: 12px;
        padding: 8px 12px;
        border: 1px solid rgba(255,255,255,.18);
        background: rgba(255,255,255,.06);
        color: inherit;
      ">
        Not you? Log out
      </button>
    </div>
  `;

  const btn = document.getElementById("bannerLogout");
  btn.addEventListener("click", () => {
    clearSession();
    window.location.href = "landing.html";
  });
}

// -------- guard: require session --------
function requireSessionOrRedirect(){
  const s = getSession();
  if (!s.session_token || !s.email) {
    window.location.href = "landing.html";
    return false;
  }
  return true;
}
