/* app.js — Cali Votes (Multi-step) — Magic Link Version
 *
 * Backend actions used:
 * - requestMagicLink { email, origin }
 * - verifyMagicLink  { token, origin } -> { session, email, expires }
 * - submitVote       { session, city, votes_claimed, payment_method_selected, name_optional, discord_handle_optional, origin }
 * - uploadScreenshot { token, screenshot, origin }
 * - leaderboard via GET ?page=leaderboard
 *
 * Config required:
 * window.CALI_VOTES = { EXEC_URL: "https://script.google.com/.../exec", ASSET_BASE: "https://mrowtown.github.io/Cali_Votes/assets" }
 */

(function () {
  "use strict";

  // -------------------------
  // Config + utilities
  // -------------------------
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

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function qs(key) {
    return new URLSearchParams(window.location.search).get(key);
  }

  function setText(idOrEl, text) {
    const el = typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
    if (el) el.textContent = String(text ?? "");
  }

  function show(el, on = true) {
    if (!el) return;
    el.style.display = on ? "" : "none";
  }

  function setHTML(el, html) {
    if (!el) return;
    el.innerHTML = html;
  }

  // ✅ IMPORTANT: Always include origin in payload
  async function post(action, payload = {}) {
    const { EXEC_URL } = cfg();
    const body = {
      action,
      origin: window.location.origin, // <— this fixes your "origin not allowed"
      ...payload
    };

    const res = await fetch(EXEC_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  async function getLeaderboard() {
    const { EXEC_URL } = cfg();
    const url = EXEC_URL + (EXEC_URL.includes("?") ? "&" : "?") + "page=leaderboard";
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  // -------------------------
  // Session storage (ONE scheme)
  // -------------------------
  const SESSION_KEYS = {
    session: "cali_session",
    email: "cali_email",
    name: "cali_name_optional",
    discord: "cali_discord_handle_optional"
  };

  function saveSession(obj) {
    localStorage.setItem(SESSION_KEYS.session, obj.session || "");
    localStorage.setItem(SESSION_KEYS.email, obj.email || "");
  }

  function setUserProfile({ name_optional, discord_handle_optional }) {
    if (name_optional != null) localStorage.setItem(SESSION_KEYS.name, String(name_optional));
    if (discord_handle_optional != null) localStorage.setItem(SESSION_KEYS.discord, String(discord_handle_optional));
  }

  function getSession() {
    return {
      session: localStorage.getItem(SESSION_KEYS.session) || "",
      email: localStorage.getItem(SESSION_KEYS.email) || "",
      name_optional: localStorage.getItem(SESSION_KEYS.name) || "",
      discord_handle_optional: localStorage.getItem(SESSION_KEYS.discord) || ""
    };
  }

  function clearSession() {
    Object.values(SESSION_KEYS).forEach(k => localStorage.removeItem(k));
  }

  // -------------------------
  // Magic link handler (landing.html?verify=TOKEN)
  // -------------------------
  async function handleMagicLinkIfPresent() {
    const token = qs("verify");
    if (!token) return;

    const statusEl = $("#status") || $("#msg") || $(".status") || $(".msg");
    if (statusEl) setText(statusEl, "Verifying your email…");

    const res = await post("verifyMagicLink", { token });

    if (res.error) {
      console.error("verifyMagicLink error:", res.error);
      if (statusEl) setText(statusEl, "That link is invalid or expired. Please request a new one.");
      else alert("That verification link is invalid or expired. Please request a new one.");
      return;
    }

    saveSession(res);

    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    window.location.href = "vote.html";
  }

  // -------------------------
  // Register page: request magic link
  // -------------------------
  function wireRegisterPage() {
    const form = $("#registerForm") || $("form[data-role='register']") || $("form");
    const emailInput = $("#email") || $("input[type='email']");
    const nameInput = $("#name_optional") || $("#name") || $("input[name='name_optional']");
    const discordInput = $("#discord_handle_optional") || $("#discord") || $("input[name='discord_handle_optional']");
    const msg = $("#msg") || $("#status") || $(".msg") || $(".status");

    if (!form || !emailInput) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = String(emailInput.value || "").trim().toLowerCase();
      const name_optional = nameInput ? String(nameInput.value || "").trim() : "";
      const discord_handle_optional = discordInput ? String(discordInput.value || "").trim() : "";

      if (!email) {
        if (msg) setText(msg, "Email is required.");
        else alert("Email is required.");
        return;
      }

      setUserProfile({ name_optional, discord_handle_optional });

      if (msg) setText(msg, "Sending your verification link…");

      const res = await post("requestMagicLink", { email });

      if (res.error) {
        console.error("requestMagicLink error:", res.error);
        if (msg) setText(msg, "Couldn’t send link. Please try again in a moment.");
        else alert("Couldn’t send link. Please try again.");
        return;
      }

      if (msg) {
        setHTML(msg, `✅ Check your email for a link to continue.<br><span style="opacity:.7;font-size:12px">You can leave this tab open.</span>`);
      } else {
        alert("Check your email for a verification link to continue.");
      }
    });
  }

  // -------------------------
  // Vote page: submit vote (requires session)
  // -------------------------
  function wireVotePage() {
    const s = getSession();
    const needAuthEls = $all("[data-requires-auth]");
    const msg = $("#msg") || $("#status") || $(".msg") || $(".status");

    if (!s.session) {
      needAuthEls.forEach(el => show(el, false));
      if (msg) setHTML(msg, `Please verify your email first. <a href="register.html">Go to registration</a>.`);
      return;
    }

    const form = $("#voteForm") || $("form[data-role='vote']") || $("form");
    const cityInput = $("#city") || $("input[name='city']") || $("#city_input");
    const votesInput = $("#votes_claimed") || $("#votes") || $("input[name='votes_claimed']");
    const pmSelect = $("#payment_method_selected") || $("#payment") || $("select[name='payment_method_selected']");

    if (!form || !cityInput || !votesInput || !pmSelect) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const city = String(cityInput.value || "").trim();
      const votes_claimed = Number(votesInput.value || 0);
      const payment_method_selected = String(pmSelect.value || "").trim();

      if (!city) {
        if (msg) setText(msg, "City is required.");
        else alert("City is required.");
        return;
      }
      if (!votes_claimed || votes_claimed <= 0) {
        if (msg) setText(msg, "Enter a valid vote amount.");
        else alert("Enter a valid vote amount.");
        return;
      }
      if (!payment_method_selected) {
        if (msg) setText(msg, "Choose a payment method.");
        else alert("Choose a payment method.");
        return;
      }

      if (msg) setText(msg, "Creating your submission…");

      const sess = getSession();

      const res = await post("submitVote", {
        session: sess.session,
        city,
        votes_claimed,
        payment_method_selected,
        name_optional: sess.name_optional,
        discord_handle_optional: sess.discord_handle_optional
      });

      if (res.error) {
        console.error("submitVote error:", res.error);
        if (/session/i.test(res.error)) {
          clearSession();
          if (msg) setHTML(msg, `Your session expired. <a href="register.html">Verify again</a>.`);
          else alert("Session expired. Please verify again.");
          return;
        }
        if (msg) setText(msg, res.error);
        else alert(res.error);
        return;
      }

      localStorage.setItem("cali_last_submission_id", res.submissionId || "");
      localStorage.setItem("cali_last_upload_url", res.upload_url || "");
      localStorage.setItem("cali_last_city", city);
      localStorage.setItem("cali_last_votes", String(votes_claimed));
      localStorage.setItem("cali_last_payment_method", payment_method_selected);

      window.location.href = `pay.html?submission=${encodeURIComponent(res.submissionId || "")}`;
    });
  }

  // -------------------------
  // Pay page: show QR + amount + link to upload
  // -------------------------
  function wirePayPage() {
    const pm = (qs("pm") || localStorage.getItem("cali_last_payment_method") || "").trim();
    const votes = Number(qs("votes") || localStorage.getItem("cali_last_votes") || 0);
    const city = (qs("city") || localStorage.getItem("cali_last_city") || "").trim();
    const uploadUrl = localStorage.getItem("cali_last_upload_url") || "";

    const { ASSET_BASE } = cfg();
    const amountUsd = votes ? (votes * 5) : 0;

    setText("pay_city", city);
    setText("pay_votes", votes ? String(votes) : "");
    setText("pay_amount", amountUsd ? `$${amountUsd}` : "");

    const qrImg = $("#qr") || $("#payment_qr") || $("img[data-role='qr']");
    const pmLabel = $("#payment_method") || $("#pm_label") || $("[data-role='pm']");
    const uploadBtn = $("#toUpload") || $("#continueUpload") || $("a[data-role='upload']");
    const msg = $("#msg") || $("#status") || $(".msg") || $(".status");

    if (pmLabel) pmLabel.textContent = pm || "";

    const qrMap = {
      "CashApp": "cashapp-qr.png",
      "Venmo": "venmo-qr.png",
      "SOL": "sol-qr.png",
      "ETH": "eth-qr.png",
      "BTC": "btc-qr.png"
    };

    const file = qrMap[pm] || "";
    if (qrImg) {
      if (!file) {
        qrImg.removeAttribute("src");
        if (msg) setText(msg, "No payment method selected. Go back and choose one.");
      } else {
        qrImg.src = `${String(ASSET_BASE).replace(/\/+$/, "")}/${file}?v=1`;
        qrImg.alt = pm ? `${pm} QR` : "Payment QR";
      }
    }

    if (uploadBtn) {
      uploadBtn.href = uploadUrl ? uploadUrl : "upload_entry.html";
    }
  }

  // -------------------------
  // Upload entry page
  // -------------------------
  function wireUploadEntryPage() {
    const tokenInput = $("#token") || $("input[name='token']");
    const goBtn = $("#go") || $("button[data-role='go']") || $("button");
    if (!tokenInput || !goBtn) return;

    goBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const t = String(tokenInput.value || "").trim();
      if (!t) {
        alert("Paste your upload token (from your email).");
        return;
      }
      window.location.href = `upload.html?token=${encodeURIComponent(t)}`;
    });
  }

  // -------------------------
  // Upload page
  // -------------------------
  function wireUploadPage() {
    const token = qs("token") || "";
    const fileInput = $("#file") || $("#screenshot") || $("input[type='file']");
    const btn = $("#uploadBtn") || $("#upload") || $("button[type='submit']") || $("button");
    const msg = $("#msg") || $("#status") || $(".msg") || $(".status");

    if (!fileInput || !btn) return;

    if (!token) {
      if (msg) setText(msg, "Missing upload token. Use the link from your email.");
      else alert("Missing upload token. Use the link from your email.");
      return;
    }

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const f = fileInput.files && fileInput.files[0];
      if (!f) {
        if (msg) setText(msg, "Choose a screenshot first.");
        else alert("Choose a screenshot first.");
        return;
      }

      if (msg) setText(msg, "Uploading…");
      const dataUrl = await fileToDataURL_(f);

      const res = await post("uploadScreenshot", { token, screenshot: dataUrl });

      if (res.error) {
        console.error("uploadScreenshot error:", res.error);
        if (msg) setText(msg, res.error);
        else alert(res.error);
        return;
      }

      if (msg) setHTML(msg, `✅ Uploaded! Your votes will be reviewed soon.`);
      else alert("Uploaded! Your votes will be reviewed soon.");
    });
  }

  function fileToDataURL_(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // -------------------------
  // Leaderboard
  // -------------------------
  async function wireLeaderboardPage() {
    const root = $("#leaderboard") || $("#rows") || $("#tbody") || $("[data-role='leaderboard']");
    if (!root) return;

    setText(root, "Loading…");
    const res = await getLeaderboard();

    if (res.error) {
      setText(root, "Could not load leaderboard.");
      return;
    }

    const rows = res.leaderboard || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      setText(root, "No approved votes yet.");
      return;
    }

    const isTbody = root.tagName && root.tagName.toLowerCase() === "tbody";
    if (isTbody) {
      setHTML(root, rows.map((r, i) =>
        `<tr><td>${i + 1}</td><td>${esc(r.city)}</td><td><b>${esc(r.votes)}</b></td></tr>`
      ).join(""));
      return;
    }

    const table = `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:1px solid rgba(0,0,0,.12)">#</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid rgba(0,0,0,.12)">City</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid rgba(0,0,0,.12)">Votes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td style="padding:8px;border-bottom:1px solid rgba(0,0,0,.08)">${i + 1}</td>
              <td style="padding:8px;border-bottom:1px solid rgba(0,0,0,.08)">${esc(r.city)}</td>
              <td style="padding:8px;border-bottom:1px solid rgba(0,0,0,.08)"><b>${esc(r.votes)}</b></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    setHTML(root, table);
  }

  // -------------------------
  // Init
  // -------------------------
  document.addEventListener("DOMContentLoaded", () => {
    handleMagicLinkIfPresent();
    wireRegisterPage();
    wireVotePage();
    wirePayPage();
    wireUploadEntryPage();
    wireUploadPage();
    wireLeaderboardPage();
  });

})();
