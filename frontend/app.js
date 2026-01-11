// Shared helpers
function cfg(){
  const c = (window.CALI_VOTES || {});
  if (!c.EXEC_URL || c.EXEC_URL.includes("PASTE_")) throw new Error("Config missing: CALI_VOTES.EXEC_URL");
  if (!c.ASSET_BASE || c.ASSET_BASE.includes("PASTE_")) throw new Error("Config missing: CALI_VOTES.ASSET_BASE");
  return c;
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}
function qs(k){ return new URLSearchParams(location.search).get(k); }
async function post(action, payload){
  const { EXEC_URL } = cfg();
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type":"text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text }; }
}
function saveSession(s){
  localStorage.setItem("cali_session_token", s.session_token);
  localStorage.setItem("cali_email", s.email);
  if (s.name_optional) localStorage.setItem("cali_name_optional", s.name_optional);
  if (s.discord_handle_optional) localStorage.setItem("cali_discord_handle_optional", s.discord_handle_optional);
}
function getSession(){
  return {
    session_token: localStorage.getItem("cali_session_token") || "",
    email: localStorage.getItem("cali_email") || "",
    name_optional: localStorage.getItem("cali_name_optional") || "",
    discord_handle_optional: localStorage.getItem("cali_discord_handle_optional") || ""
  };
}
function clearSession(){
  ["cali_session_token","cali_email","cali_name_optional","cali_discord_handle_optional"].forEach(k=>localStorage.removeItem(k));
}
