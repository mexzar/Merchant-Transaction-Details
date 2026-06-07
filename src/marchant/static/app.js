"use strict";

const $ = (sel) => document.querySelector(sel);

// Show the Year field only when the "year" range is selected.
const timeRange = $("#time_range");
const yearField = $("#year-field");
timeRange.addEventListener("change", () => {
  yearField.hidden = timeRange.value !== "year";
});

function setStatus(msg, kind) {
  const card = $("#status-card");
  const el = $("#status-msg");
  card.hidden = false;
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

// --- Saved accounts (OS keychain) -----------------------------------------
const savedAccount = $("#saved-account");
const forgetBtn = $("#forget-btn");

function applySavedAccount() {
  if (!savedAccount) return;
  const opt = savedAccount.selectedOptions[0];
  const form = $("#scrape-form");
  const hasPassword = opt && opt.dataset.password === "1";
  const hasOtp = opt && opt.dataset.otp === "1";
  const email = savedAccount.value;

  form.email.value = email || "";
  if (form.remember_password) form.remember_password.checked = !!hasPassword;
  if (form.remember_otp_secret) form.remember_otp_secret.checked = !!hasOtp;
  // Don't echo stored secrets back into the page; hint that they'll be used.
  $("#password-hint").hidden = !hasPassword;
  $("#otp-hint").hidden = !hasOtp;
  if (hasPassword) form.password.value = "";
  if (hasOtp) form.otp_secret_key.value = "";
  if (forgetBtn) forgetBtn.hidden = !email;
}

if (savedAccount) {
  savedAccount.addEventListener("change", applySavedAccount);
  applySavedAccount();
}

if (forgetBtn) {
  forgetBtn.addEventListener("click", async () => {
    const email = savedAccount.value;
    if (!email) return;
    const status = $("#forget-status");
    try {
      const res = await fetch("/api/accounts/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("request failed");
      // Remove the option and reset selection.
      savedAccount.selectedOptions[0].remove();
      savedAccount.value = "";
      applySavedAccount();
      status.textContent = "Forgotten.";
      status.className = "status ok";
    } catch (err) {
      status.textContent = "Could not forget: " + err.message;
      status.className = "status err";
    }
  });
}

$("#scrape-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $("#run-btn");
  const payload = {
    email: f.email.value.trim(),
    password: f.password.value,
    otp: f.otp.value.trim() || null,
    otp_secret_key: f.otp_secret_key.value.trim() || null,
    time_range: f.time_range.value,
    year: f.year.value ? parseInt(f.year.value, 10) : null,
    remember_password: f.remember_password ? f.remember_password.checked : false,
    remember_otp_secret: f.remember_otp_secret ? f.remember_otp_secret.checked : false,
  };

  btn.disabled = true;
  $("#result").hidden = true;
  setStatus("Logging in and downloading… this can take a minute.");

  try {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.detail || "Something went wrong.", "err");
      return;
    }
    const r = data.result;
    setStatus("Done.", "ok");
    $("#counts").textContent =
      `${r.transaction_count} transaction(s), ${r.order_count} order(s) — ${r.range_label}`;
    $("#export-path").textContent = data.export_path;
    const dl = $("#download-link");
    dl.href = "/download/" + encodeURIComponent(data.filename);
    dl.textContent = "Download " + data.filename;
    $("#result").hidden = false;
  } catch (err) {
    setStatus("Request failed: " + err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("#copy-path-btn").addEventListener("click", async () => {
  const path = $("#export-path").textContent;
  const btn = $("#copy-path-btn");
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(path);
    btn.textContent = "Copied!";
  } catch (err) {
    // Fallback: select the text so the user can ⌘C it.
    const range = document.createRange();
    range.selectNodeContents($("#export-path"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = "Selected — press ⌘C";
  }
  setTimeout(() => { btn.textContent = original; }, 1800);
});
