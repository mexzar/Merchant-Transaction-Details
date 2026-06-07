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

function renderList(ulId, items, getText) {
  const ul = $(ulId);
  ul.innerHTML = "";
  if (!items || !items.length) {
    const li = document.createElement("li");
    li.textContent = "(none)";
    ul.appendChild(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = getText(it);
    ul.appendChild(li);
  }
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
    full_details: f.full_details.checked,
    include_orders: f.include_orders.checked,
    include_transactions: f.include_transactions.checked,
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
    const dl = $("#download-link");
    dl.href = "/download/" + encodeURIComponent(data.filename);
    dl.textContent = "Download " + data.filename;
    renderList("#txn-list", r.transactions, (t) => t.summary);
    renderList("#order-list", r.orders, (o) => o.summary);
    $("#result").hidden = false;
  } catch (err) {
    setStatus("Request failed: " + err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("#config-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const status = $("#config-status");
  const payload = {
    endpoint: {
      enabled: f.enabled.checked,
      url: f.url.value.trim(),
      auth_header_name: f.auth_header_name.value.trim(),
      auth_header_value: f.auth_header_value.value.trim(),
    },
    export_dir: null,
  };
  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("save failed");
    status.textContent = "Saved.";
    status.className = "status ok";
  } catch (err) {
    status.textContent = "Could not save: " + err.message;
    status.className = "status err";
  }
});
