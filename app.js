/* app.js — Cali Votes frontend controller (FULL REPLACEMENT)
 *
 * Pages:
 * - landing.html  (handles ?verify=TOKEN)
 * - register.html (request magic link)
 * - vote.html     (requires session)
 * - pay.html      (shows QR + creates submission)
 * - upload.html   (uploads screenshot via upload token)
 * - upload_entry.html (manual entry to upload)
 * - leaderboard.html
 *
 * Requires config.js:
 * window.CALI_VOTES = { EXEC_URL, ASSET_BASE }
 */

(() => {
  // ---------- config / helpers ----------
  function cfg() {
    const c = window.CALI_VOTES || {};
    if (!c.EXEC_URL || String(c.EXEC_URL).includes("PASTE_")) {
      throw new Error("Config missing: CALI_VOTES.EXEC_URL");
    }
    if (!c.ASSET_BASE || String(c.ASSET_BASE).includes("PASTE_")) {
      throw new Error("Config missing: CALI_VOTES.ASSET_BASE");
    }
    return c;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function qs(k) {
    return new URLSearchParams(location.search).get(k);
  }

  async function post(action, payload) {
    const { EXEC_URL } = cfg();
    const res = await fetch(EXEC_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action,
        origin: window.location.origin, // ✅ always send origin
        ...payload
      })
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  // ---------- session storage ----------
  const SKEY = {
    session: "cali_session",
    email: "cali_email",
    name: "cali_name_optional",
    discord: "cali_discord_handle_optional"
  };

  function saveSession({ session, email, name_optional, discord_handle_optional }) {
    localStorage.setItem(SKEY.session, session || "");
    localStorage.setItem(SKEY.email, email || "");
    localStorage.setItem(SKEY.name, name_optional || "");
    localStorage.setItem(SKEY.discord, discord_handle_optional || "");
  }

  function getSession() {
    return {
      session: localStorage.getItem(SKEY.session) || "",
      email: localStorage.getItem(SKEY.email) || "",
      name_optional: localStorage.getItem(SKEY.name) || "",
      discord_handle_optional: localStorage.getItem(SKEY.discord) || ""
    };
  }

  function clearSession() {
    Object.values(SKEY).forEach(k => localStorage.removeItem(k));
  }

  function requireAuthOrShowMessage() {
    const s = getSession();
    if (s.session) return true;

    const msg = document.getElementById("msg");
    if (msg) {
      msg.innerHTML = `Please verify your email first. <a href="register.html">Go to registration</a>.`;
      msg.style.display = "block";
    }

    // Also disable any form that expects auth
    document.querySelectorAll("form[data-requires-auth]").forEach(f => {
      const btn = f.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
    });

    return false;
  }

  // ---------- page: landing (magic link verify) ----------
  async function handleMagicLinkOnLanding() {
    // Only run on landing.html
    if (!location.pathname.endsWith("/landing.html") && !location.pathname.endsWith("landing.html")) return;

    const token = qs("verify");
    if (!token) return;

    const status = document.getElementById("status");
    if (status) status.textContent = "Verifying your email…";

    const res = await post("verifyMagicLink", { token });

    if (res.error) {
      if (status) status.innerHTML = `This link is invalid or expired. <a href="register.html">Try again</a>.`;
      return;
    }

    // Expect { ok:true, session, email, ... }
    saveSession({
      session: res.session,
      email: res.email
    });

    // Clean URL
    const clean = window.location.origin + window.location.pathname;
    history.replaceState({}, document.title, clean);

    // Continue
    window.location.href = "vote.html";
  }

  // ---------- page: register ----------
  async function wireRegisterPage() {
    if (!location.pathname.endsWith("/register.html") && !location.pathname.endsWith("register.html")) return;

    const form = document.getElementById("registerForm");
    const msg = document.getElementById("msg");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg && (msg.textContent = "Sending magic link…");

      const email = (document.getElementById("email")?.value || "").trim();
      const name_optional = (document.getElementById("name_optional")?.value || "").trim();
      const discord_handle_optional = (document.getElementById("discord_handle_optional")?.value || "").trim();

      // Store optional info now so after verification it’s remembered
      localStorage.setItem(SKEY.email, email);
      localStorage.setItem(SKEY.name, name_optional);
      localStorage.setItem(SKEY.discord, discord_handle_optional);

      const res = await post("requestMagicLink", { email });

      if (res.error) {
        msg && (msg.textContent = `Error: ${res.error}`);
        return;
      }

      msg && (msg.innerHTML = `Magic link sent to <b>${esc(email)}</b>. Check your inbox.`);
    });
  }

  // ---------- page: vote ----------
  async function wireVotePage() {
    if (!location.pathname.endsWith("/vote.html") && !location.pathname.endsWith("vote.html")) return;

    const authed = requireAuthOrShowMessage();
    const form = document.getElementById("voteForm");
    if (!form || !authed) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const city = (document.getElementById("city")?.value || "").trim();
      const votes_claimed = Number(document.getElementById("votes_claimed")?.value || 0);
      const payment_method_selected = (document.getElementById("payment_method_selected")?.value || "").trim();

      if (!city || !votes_claimed || votes_claimed <= 0 || !payment_method_selected) {
        const msg = document.getElementById("msg");
        if (msg) msg.textContent = "Please fill city, votes, and payment method.";
        return;
      }

      // Save as checkout state (pay.html will use it)
      const s = getSession();
      localStorage.setItem("cali_checkout_city", city);
      localStorage.setItem("cali_checkout_votes", String(votes_claimed));
      localStorage.setItem("cali_checkout_pm", payment_method_selected);

      window.location.href = "pay.html";
    });
  }

  // ---------- page: pay ----------
  function wirePayPage() {
    if (!location.pathname.endsWith("/pay.html") && !location.pathname.endsWith("pay.html")) return;

    const authed = requireAuthOrShowMessage();
    if (!authed) return;

    const { ASSET_BASE } = cfg();
    const city = localStorage.getItem("cali_checkout_city") || "";
    const votes = Number(localStorage.getItem("cali_checkout_votes") || 0);
    const pm = localStorage.getItem("cali_checkout_pm") || "";

    const amt = votes ? (votes * 5) : 0;

    const elCity = document.getElementById("pay_city");
    const elVotes = document.getElementById("pay_votes");
    const elAmt = document.getElementById("pay_amount");
    const elPm = document.getElementById("pay_method");
    const elQr = document.getElementById("pay_qr");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("createSubmission");

    if (elCity) elCity.textContent = city || "—";
    if (elVotes) elVotes.textContent = votes ? String(votes) : "—";
    if (elAmt) elAmt.textContent = amt ? `$${amt}` : "—";
    if (elPm) elPm.textContent = pm || "—";

    const qrMap = {
      CashApp: `${ASSET_BASE}/cashapp-qr.png`,
      Venmo: `${ASSET_BASE}/venmo-qr.png`,
      SOL: `${ASSET_BASE}/sol-qr.png`,
      ETH: `${ASSET_BASE}/eth-qr.png`,
      BTC: `${ASSET_BASE}/btc-qr.png`
    };

    if (elQr) {
      const src = qrMap[pm] || "";
      if (src) {
        elQr.src = src;
        elQr.alt = `QR for ${pm}`;
        elQr.style.display = "block";
      } else {
        elQr.style.display = "none";
      }
    }

    if (btn) {
      btn.addEventListener("click", async () => {
        msg && (msg.textContent = "Creating your submission…");

        const s = getSession();
        const res = await post("submitVote", {
          session: s.session,
          city,
          votes_claimed: votes,
          payment_method_selected: pm,
          name_optional: s.name_optional,
          discord_handle_optional: s.discord_handle_optional
        });

        if (res.error) {
          msg && (msg.textContent = `Error: ${res.error}`);
          return;
        }

        msg && (msg.textContent = "Submission created. Redirecting to upload…");
        if (res.upload_url) {
          window.location.href = res.upload_url; // tokenized upload link
        } else {
          window.location.href = "upload_entry.html";
        }
      });
    }
  }

  // ---------- boot ----------
  function boot() {
    // If config is missing, show it clearly
    try { cfg(); } catch (e) { console.error(e); }

    handleMagicLinkOnLanding().catch(console.error);
    wireRegisterPage().catch(console.error);
    wireVotePage().catch(console.error);
    wirePayPage();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
