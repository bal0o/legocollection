const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmt = (n) => (n == null ? "—" : `£${Number(n).toFixed(2)}`);
const fmtWhole = (n) => (n == null ? "—" : `£${Number(n)}`);

function setImageUrl(set) {
  if (set.image_url) return set.image_url;
  return `https://images.brickset.com/sets/images/${set.set_number}-1.jpg`;
}

const STATUS_LABELS = {
  collection: "In collection",
  for_sale: "For sale",
  sold: "Sold",
};

let soldTargetId = null;
let soldEditMode = false;
let forSaleTargetId = null;
let forSaleEditMode = false;
let detailTargetId = null;
let detailCurrentSet = null;
let searchDebounce = null;
let cachedSets = [];
let sortColumn = "set_number";
let sortDir = "asc";

const RATING_ORDER = { Poor: 0, Average: 1, Good: 2, Excellent: 3 };
const STATUS_ORDER = { collection: 0, for_sale: 1, sold: 2 };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, type = "success") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add("hidden"), 3500);
}

async function loadStats() {
  const s = await api("/api/stats");
  $("#stat-collection").textContent = `${s.collection_count} · ${s.pieces_in_collection ?? s.collection_count} pcs · ${fmt(s.collection_value)}`;
  $("#stat-for-sale").textContent = `${s.for_sale_count} · ${s.pieces_listed ?? s.for_sale_count} listed · ${fmt(s.for_sale_value)}`;
  $("#stat-held-value").textContent = fmt(s.held_value);
  $("#stat-sold").textContent = `${s.sold_count} · ${fmt(s.sold_value)}`;
  $("#stat-rrp").textContent = fmt(s.total_rrp);
}

function statusBadge(status) {
  const cls = `badge badge-${status}`;
  return `<span class="${cls}">${STATUS_LABELS[status] || status}</span>`;
}

function statusSelect(id, current) {
  return `
    <select class="status-select" data-status-id="${id}" aria-label="Change status">
      <option value="collection" ${current === "collection" ? "selected" : ""}>In collection</option>
      <option value="for_sale" ${current === "for_sale" ? "selected" : ""}>For sale</option>
      <option value="sold" ${current === "sold" ? "selected" : ""}>Sold</option>
    </select>`;
}

function sortSets(sets) {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...sets].sort((a, b) => {
    let av = a[sortColumn];
    let bv = b[sortColumn];

    if (sortColumn === "set_number") {
      av = parseInt(av, 10) || 0;
      bv = parseInt(bv, 10) || 0;
      return (av - bv) * dir;
    }
    if (sortColumn === "listing_status") {
      av = STATUS_ORDER[av] ?? 0;
      bv = STATUS_ORDER[bv] ?? 0;
      return (av - bv) * dir;
    }
    if (sortColumn === "investment_rating") {
      av = RATING_ORDER[av] ?? -1;
      bv = RATING_ORDER[bv] ?? -1;
      return (av - bv) * dir;
    }
    if (sortColumn === "sold_price") {
      av = a.listing_status === "sold" ? (a.sold_price ?? 0) : -1;
      bv = b.listing_status === "sold" ? (b.sold_price ?? 0) : -1;
      return (av - bv) * dir;
    }
    if (["bl_used_avg", "bl_sealed_avg", "ebay_sold_avg", "private_sale_value", "ebay_listing_price", "listed_price", "sold_price", "quantity_held", "quantity_listed", "uk_rrp"].includes(sortColumn)) {
      av = av ?? -1;
      bv = bv ?? -1;
      return (av - bv) * dir;
    }

    av = String(av ?? "").toLowerCase();
    bv = String(bv ?? "").toLowerCase();
    return av.localeCompare(bv) * dir;
  });
}

function updateSortHeaders() {
  $$(".sort-btn").forEach((btn) => {
    btn.classList.remove("active", "asc", "desc");
    if (btn.dataset.sort === sortColumn) {
      btn.classList.add("active", sortDir);
    }
  });
}

function bindSortHeaders() {
  $$(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const col = btn.dataset.sort;
      if (sortColumn === col) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortColumn = col;
        sortDir = col === "set_number" || col.includes("_avg") || col.includes("_value") || col.includes("_price") || col.includes("_rrp") ? "desc" : "asc";
      }
      updateSortHeaders();
      renderSets(cachedSets);
    });
  });
  updateSortHeaders();
}

function renderSets(sets) {
  const sorted = sortSets(sets);
  const tbody = $("#sets-body");
  const empty = $("#empty-state");
  const statusFilter = $("#filter-status").value;
  const showSoldCol = statusFilter === "sold";
  const showListedCol = statusFilter !== "sold";

  document.querySelectorAll(".sold-col").forEach((el) => {
    el.classList.toggle("hidden", !showSoldCol);
  });
  document.querySelectorAll(".listed-col").forEach((el) => {
    el.classList.toggle("hidden", !showListedCol);
  });

  if (sorted.length === 0) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  tbody.innerHTML = sorted
    .map(
      (s) => `
    <tr class="row-${s.listing_status} row-clickable" data-id="${s.id}">
      <td><strong>${s.set_number}</strong></td>
      <td class="name">${esc(s.description)}</td>
      <td>${esc(s.condition)}</td>
      <td>${statusSelect(s.id, s.listing_status)}</td>
      <td class="num">${s.quantity_held ?? 1}</td>
      <td class="num">${s.listing_status === "for_sale" ? (s.quantity_listed ?? 0) : "—"}</td>
      <td class="num hide-mobile">${fmt(s.uk_rrp)}</td>
      <td class="num">${fmt(s.bl_used_avg)}</td>
      <td class="num hide-mobile">${fmt(s.bl_sealed_avg)}</td>
      <td class="num hide-mobile">${fmt(s.ebay_sold_avg)}</td>
      <td class="num">${fmtWhole(s.private_sale_value)}</td>
      <td class="num">${fmtWhole(s.ebay_listing_price)}</td>
      <td class="num listed-col${s.listing_status === "for_sale" ? " listed-price-edit" : ""}${showListedCol ? "" : " hidden"}" data-edit-listed="${s.listing_status === "for_sale" ? s.id : ""}" title="${s.listing_status === "for_sale" ? "Click to edit listed price" : ""}">${s.listing_status === "for_sale" ? fmtWhole(s.listed_price) : "—"}</td>
      <td class="num sold-col${showSoldCol ? " sold-price-edit" : " hidden"}" data-edit-sold="${s.id}" title="Click to edit sold price">${fmt(s.sold_price)}</td>
      <td class="rating-${s.investment_rating || "Average"}">${s.investment_rating || "—"}</td>
      <td class="col-actions actions">
        <button class="btn btn-sm btn-ghost" data-history="${s.id}" title="Price history">📈</button>
        <button class="btn btn-sm btn-ghost" data-refresh="${s.id}" title="Refresh prices">↻</button>
      </td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", () => onStatusChange(sel));
  });
  tbody.querySelectorAll("[data-refresh]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      refreshSet(btn.dataset.refresh, btn);
    });
  });
  tbody.querySelectorAll("[data-history]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openHistoryModal(btn.dataset.history);
    });
  });
  tbody.querySelectorAll("[data-edit-listed]").forEach((cell) => {
    if (!cell.dataset.editListed) return;
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = cell.closest("tr");
      const label = `${row.querySelector("strong").textContent} ${row.querySelector(".name").textContent}`;
      openForSaleModal(cell.dataset.editListed, label, true);
    });
  });
  tbody.querySelectorAll("[data-edit-sold]").forEach((cell) => {
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = cell.closest("tr");
      const label = `${row.querySelector("strong").textContent} ${row.querySelector(".name").textContent}`;
      openSoldModal(cell.dataset.editSold, label, true);
    });
  });
  tbody.querySelectorAll("tr.row-clickable").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button, select, a")) return;
      openSetDetail(row.dataset.id);
    });
  });
}

async function loadSets() {
  const search = $("#filter-search").value;
  const status = $("#filter-status").value;
  cachedSets = await api(`/api/sets?status=${status}&search=${encodeURIComponent(search)}`);
  renderSets(cachedSets);
}

async function onStatusChange(sel) {
  const id = sel.dataset.statusId;
  const newStatus = sel.value;
  const row = sel.closest("tr");
  const prev = row.className.match(/row-(\w+)/)?.[1] || "collection";

  if (newStatus === "sold") {
    const label = `${row.querySelector("strong").textContent} ${row.querySelector(".name").textContent}`;
    sel.value = prev;
    openSoldModal(id, label);
    return;
  }

  if (newStatus === "for_sale") {
    const label = `${row.querySelector("strong").textContent} ${row.querySelector(".name").textContent}`;
    sel.value = prev;
    openForSaleModal(id, label);
    return;
  }

  try {
    await api(`/api/sets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ listing_status: newStatus }),
    });
    toast(`Moved to ${STATUS_LABELS[newStatus]}`);
    await refresh();
  } catch (err) {
    sel.value = prev;
    toast(err.message, "error");
  }
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML.replace(/"/g, "&quot;");
}

async function refresh() {
  await Promise.all([loadStats(), loadSets()]);
}

function openHistoryModal(id) {
  const set = cachedSets.find((s) => String(s.id) === String(id));
  if (!set) return;

  $("#history-title").textContent = `${set.set_number} — ${set.description}`;
  const refreshed = set.prices_refreshed_at
    ? new Date(set.prices_refreshed_at).toLocaleString("en-GB")
    : "—";
  $("#history-meta").textContent = `${set.condition} · Last refresh: ${refreshed}${set.notes ? ` · ${set.notes}` : ""}`;

  const history = [...(set.price_history || [])].reverse();
  $("#history-body").innerHTML =
    history.length === 0
      ? '<tr><td colspan="5">No history yet — refresh prices to record a snapshot.</td></tr>'
      : history
          .map(
            (h) => `
      <tr>
        <td>${h.date ? new Date(h.date).toLocaleDateString("en-GB") : "—"}</td>
        <td class="num">${fmt(h.bl_used_avg)}</td>
        <td class="num">${fmt(h.bl_sealed_avg)}</td>
        <td class="num">${fmt(h.ebay_sold_avg)}</td>
        <td class="num">${fmtWhole(h.private_sale_value)}</td>
        <td class="num">${fmtWhole(h.ebay_listing_price)}</td>
      </tr>`
          )
          .join("");

  const sales = set.ebay_sold_recent || [];
  $("#history-ebay-sales").innerHTML =
    sales.length === 0
      ? "<li>No recent eBay sales scraped.</li>"
      : sales
          .map(
            (sale) =>
              `<li><strong>${sale.date}</strong> ${fmt(sale.price_gbp)} — ${esc(sale.title || "eBay sale")}</li>`
          )
          .join("");

  $("#modal-history").showModal();
}

async function refreshSet(id, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    await api(`/api/sets/${id}/refresh`, { method: "POST" });
    toast("Prices updated");
    await refresh();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "↻";
  }
}

async function refreshAll() {
  const btn = $("#btn-refresh-all");
  const progress = $("#refresh-progress");
  const fill = $("#refresh-progress-fill");
  const label = $("#refresh-progress-label");
  const detail = $("#refresh-progress-detail");

  btn.disabled = true;
  btn.textContent = "Refreshing…";
  progress.classList.remove("hidden");
  fill.style.width = "0%";
  label.textContent = "Starting…";
  detail.textContent = "";

  try {
    const res = await fetch("/api/sets/refresh-all", { method: "POST" });
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data: ")) continue;
        const data = JSON.parse(line.slice(6));

        if (data.type === "start") {
          label.textContent = `0 / ${data.total}`;
        } else if (data.type === "progress") {
          const pct = Math.round((data.current / data.total) * 100);
          fill.style.width = `${pct}%`;
          label.textContent = `${data.current} / ${data.total}`;
          const statusIcon = data.status === "done" ? "✓" : data.status === "failed" ? "✗" : "…";
          detail.textContent = `${statusIcon} ${data.set_number} ${data.description || ""}`;
        } else if (data.type === "complete") {
          finalResult = data;
        }
      }
    }

    if (finalResult) {
      toast(
        `Refreshed ${finalResult.refreshed} sets${finalResult.failed?.length ? `, ${finalResult.failed.length} failed` : ""}`
      );
    }
    await refresh();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh all prices";
    setTimeout(() => progress.classList.add("hidden"), 1500);
  }
}

function openSetDetail(id) {
  openSetDetailAsync(id).catch((err) => toast(err.message, "error"));
}

function updateDetailStatusFields(status, set = detailCurrentSet) {
  $("#detail-listed-fields").classList.toggle("hidden", status !== "for_sale");
  $("#detail-sold-fields").classList.toggle("hidden", status !== "sold");
  $("#detail-quantity-listed").disabled = status !== "for_sale";

  if (status === "for_sale") {
    if (!$("#detail-listed-price-input").value && set) {
      $("#detail-listed-price-input").value =
        set.listed_price ?? set.private_sale_value ?? set.ebay_listing_price ?? "";
    }
    if (!$("#detail-listed-date-input").value) {
      $("#detail-listed-date-input").value =
        set?.listed_date || new Date().toISOString().slice(0, 10);
    }
  }
  if (status === "sold") {
    if (!$("#detail-sold-price-input").value && set) {
      $("#detail-sold-price-input").value =
        set.sold_price ?? set.listed_price ?? set.private_sale_value ?? "";
    }
    if (!$("#detail-sold-date-input").value) {
      $("#detail-sold-date-input").value =
        set?.sold_date || new Date().toISOString().slice(0, 10);
    }
  }
}

function populateDetailManageForm(set) {
  detailCurrentSet = set;
  $("#detail-status").value = set.listing_status || "collection";
  $("#detail-quantity-held").value = set.quantity_held ?? 1;
  $("#detail-quantity-listed").value = set.quantity_listed ?? 0;
  $("#detail-listed-price-input").value = set.listed_price ?? "";
  $("#detail-listed-date-input").value =
    set.listed_date || new Date().toISOString().slice(0, 10);
  $("#detail-sold-price-input").value = set.sold_price ?? "";
  $("#detail-sold-date-input").value =
    set.sold_date || new Date().toISOString().slice(0, 10);
  updateDetailStatusFields(set.listing_status, set);
}

async function openSetDetailAsync(id) {
  let set = await api(`/api/sets/${id}`);
  if (!set) return;

  detailTargetId = id;
  $("#detail-title").textContent = `${set.set_number} — ${set.description}`;
  const img = $("#detail-image");
  img.src = setImageUrl(set);
  img.alt = set.description;
  img.onerror = () => {
    img.onerror = null;
    img.src = `https://images.brickset.com/sets/images/${set.set_number}-1.jpg`;
  };

  const refreshed = set.prices_refreshed_at
    ? new Date(set.prices_refreshed_at).toLocaleString("en-GB")
    : "—";
  $("#detail-meta").textContent = [
    set.condition,
    set.release_year ? `Year ${set.release_year}` : null,
    set.retirement_status,
    STATUS_LABELS[set.listing_status],
    `Updated ${refreshed}`,
  ]
    .filter(Boolean)
    .join(" · ");

  $("#detail-private").textContent = fmtWhole(set.private_sale_value);
  $("#detail-ebay").textContent = fmtWhole(set.ebay_listing_price);

  $("#detail-stats").innerHTML = [
    ["BrickLink used", fmt(set.bl_used_avg)],
    ["BrickLink sealed", fmt(set.bl_sealed_avg)],
    ["eBay sold avg", fmt(set.ebay_sold_avg)],
    ["UK RRP", fmt(set.uk_rrp)],
    ["Rating", set.investment_rating || "—"],
  ]
    .map(([k, v]) => `<div class="detail-stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join("");

  $("#detail-listing-text").value = set.listing_text || "";
  populateDetailManageForm(set);

  $("#modal-detail").showModal();
}

$("#detail-status").addEventListener("change", (e) => {
  const status = e.target.value;
  if (status === "for_sale" && !$("#detail-listed-price-input").value) {
    $("#detail-listed-price-input").value =
      detailCurrentSet?.listed_price ??
      detailCurrentSet?.private_sale_value ??
      detailCurrentSet?.ebay_listing_price ??
      "";
  }
  if (status === "for_sale" && (!$("#detail-quantity-listed").value || $("#detail-quantity-listed").value === "0")) {
    const held = parseInt($("#detail-quantity-held").value, 10) || detailCurrentSet?.quantity_held || 1;
    $("#detail-quantity-listed").value = Math.min(held, detailCurrentSet?.quantity_listed || 1);
  }
  if (status === "collection") {
    $("#detail-quantity-listed").value = 0;
  }
  if (status === "sold" && !$("#detail-sold-price-input").value) {
    $("#detail-sold-price-input").value =
      detailCurrentSet?.sold_price ??
      detailCurrentSet?.listed_price ??
      detailCurrentSet?.private_sale_value ??
      "";
  }
  updateDetailStatusFields(status);
});

$("#detail-btn-save-status").addEventListener("click", async () => {
  if (!detailTargetId) return;

  const status = $("#detail-status").value;
  const quantity_held = parseInt($("#detail-quantity-held").value, 10);
  let quantity_listed = parseInt($("#detail-quantity-listed").value, 10);

  if (!Number.isFinite(quantity_held) || quantity_held < 1) {
    toast("Quantity held must be at least 1", "error");
    return;
  }
  if (!Number.isFinite(quantity_listed) || quantity_listed < 0) {
    toast("Quantity listed cannot be negative", "error");
    return;
  }
  if (quantity_listed > quantity_held) {
    toast("Quantity listed cannot exceed quantity held", "error");
    return;
  }

  const body = { listing_status: status, quantity_held, quantity_listed };

  if (status === "for_sale") {
    if (quantity_listed < 1) {
      toast("Quantity listed must be at least 1 when for sale", "error");
      return;
    }
    const listed_price = parseFloat($("#detail-listed-price-input").value);
    if (!Number.isFinite(listed_price) || listed_price < 0) {
      toast("Enter a valid listed price", "error");
      return;
    }
    body.listed_price = listed_price;
    body.listed_date = $("#detail-listed-date-input").value;
  } else if (status === "sold") {
    const sold_price = parseFloat($("#detail-sold-price-input").value);
    if (!Number.isFinite(sold_price) || sold_price < 0) {
      toast("Enter a valid sold price", "error");
      return;
    }
    body.sold_price = sold_price;
    body.sold_date = $("#detail-sold-date-input").value;
  }

  const btn = $("#detail-btn-save-status");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    await api(`/api/sets/${detailTargetId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    toast("Status & pricing saved");
    await refresh();

    const filter = $("#filter-status").value;
    const hidden =
      (status === "sold" && filter === "held") ||
      (status === "sold" && filter === "collection") ||
      (status === "sold" && filter === "for_sale") ||
      (status === "for_sale" && filter === "sold") ||
      (status === "collection" && filter === "sold");

    if (hidden) {
      $("#modal-detail").close();
    } else {
      await openSetDetailAsync(detailTargetId);
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save status & pricing";
  }
});

$("#btn-copy-listing").addEventListener("click", async () => {
  const text = $("#detail-listing-text").value;
  try {
    await navigator.clipboard.writeText(text);
    toast("Listing copied to clipboard");
  } catch {
    $("#detail-listing-text").select();
    document.execCommand("copy");
    toast("Listing copied to clipboard");
  }
});

$("#detail-btn-history").addEventListener("click", () => {
  $("#modal-detail").close();
  if (detailTargetId) openHistoryModal(detailTargetId);
});

$("#detail-btn-refresh").addEventListener("click", async () => {
  if (!detailTargetId) return;
  const btn = $("#detail-btn-refresh");
  btn.disabled = true;
  btn.textContent = "Refreshing…";
  try {
    const updated = await api(`/api/sets/${detailTargetId}/refresh`, { method: "POST" });
    const idx = cachedSets.findIndex((s) => String(s.id) === String(detailTargetId));
    if (idx >= 0) cachedSets[idx] = updated;
    openSetDetail(detailTargetId);
    toast("Prices updated");
    await loadStats();
    renderSets(cachedSets);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh prices";
  }
});

function openForSaleModal(id, label, edit = false) {
  openForSaleModalAsync(id, label, edit).catch((err) => toast(err.message, "error"));
}

async function openForSaleModalAsync(id, label, edit = false) {
  forSaleTargetId = id;
  forSaleEditMode = edit;
  let set = cachedSets.find((s) => String(s.id) === String(id));
  if (!set) set = await api(`/api/sets/${id}`);

  $("#for-sale-modal-title").textContent = edit ? "Edit listed price" : "List for sale";
  $("#for-sale-submit-btn").textContent = edit ? "Save changes" : "Confirm listing";
  $("#for-sale-set-label").textContent = label;

  const hint = [];
  if (set?.private_sale_value != null) hint.push(`Private: ${fmtWhole(set.private_sale_value)}`);
  if (set?.ebay_listing_price != null) hint.push(`eBay: ${fmtWhole(set.ebay_listing_price)}`);
  $("#for-sale-hint").textContent = hint.length ? `Recommended — ${hint.join(" · ")}` : "";

  if (edit) {
    $("#listed-price").value = set?.listed_price != null ? set.listed_price : "";
    $("#listed-date").value = set?.listed_date || new Date().toISOString().slice(0, 10);
    $("#listed-quantity").value = set?.quantity_listed ?? set?.quantity_held ?? 1;
  } else {
    $("#listed-price").value =
      set?.private_sale_value != null ? set.private_sale_value : set?.ebay_listing_price ?? "";
    $("#listed-date").value = new Date().toISOString().slice(0, 10);
    $("#listed-quantity").value = set?.quantity_held ?? 1;
  }

  $("#modal-for-sale").showModal();
}

$("#form-for-sale").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const listed_price = parseFloat($("#listed-price").value);
    const listed_date = $("#listed-date").value;
    const quantity_listed = parseInt($("#listed-quantity").value, 10);
    if (!Number.isFinite(quantity_listed) || quantity_listed < 1) {
      toast("Quantity listed must be at least 1", "error");
      return;
    }
    const body = forSaleEditMode
      ? { listed_price, listed_date, quantity_listed }
      : { listing_status: "for_sale", listed_price, listed_date, quantity_listed };

    await api(`/api/sets/${forSaleTargetId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    $("#modal-for-sale").close();
    toast(forSaleEditMode ? "Listed price updated" : "Listed for sale");
    await refresh();
  } catch (err) {
    toast(err.message, "error");
  }
});

function openSoldModal(id, label, edit = false) {
  openSoldModalAsync(id, label, edit).catch((err) => toast(err.message, "error"));
}

async function openSoldModalAsync(id, label, edit = false) {
  soldTargetId = id;
  soldEditMode = edit;
  let set = cachedSets.find((s) => String(s.id) === String(id));
  if (!set) set = await api(`/api/sets/${id}`);

  $("#sold-modal-title").textContent = edit ? "Edit sold price" : "Mark as sold";
  $("#sold-submit-btn").textContent = edit ? "Save changes" : "Confirm sold";
  $("#sold-set-label").textContent = label;

  if (edit) {
    $("#sold-price").value = set?.sold_price != null ? set.sold_price : "";
    $("#sold-date").value = set?.sold_date || new Date().toISOString().slice(0, 10);
  } else {
    $("#sold-price").value = set?.private_sale_value != null ? set.private_sale_value : "";
    $("#sold-date").value = new Date().toISOString().slice(0, 10);
  }

  $("#modal-sold").showModal();
}

$("#form-sold").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const sold_price = parseFloat($("#sold-price").value);
    const sold_date = $("#sold-date").value;
    const body = soldEditMode
      ? { sold_price, sold_date }
      : { listing_status: "sold", sold_price, sold_date };

    await api(`/api/sets/${soldTargetId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    $("#modal-sold").close();
    toast(soldEditMode ? "Sold price updated" : "Marked as sold");
    await refresh();
  } catch (err) {
    toast(err.message, "error");
  }
});

$("#btn-add").addEventListener("click", () => {
  $("#add-set-number").value = "";
  $("#add-quantity-held").value = "1";
  $("#modal-add").showModal();
  $("#add-set-number").focus();
});

$$("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest("dialog").close());
});

$("#form-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const set_number = $("#add-set-number").value.trim().replace(/\D/g, "");
  if (!set_number) return;

  const btn = $("#btn-add-submit");
  btn.disabled = true;
  btn.textContent = "Adding…";

  try {
    const created = await api("/api/sets", {
      method: "POST",
      body: JSON.stringify({
        set_number,
        condition: $("#add-condition").value,
        quantity_held: parseInt($("#add-quantity-held").value, 10) || 1,
      }),
    });
    $("#modal-add").close();
    toast(`Added ${created.set_number} — ${created.description}`);
    await refresh();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Add & fetch prices";
  }
});

$("#filter-search").addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadSets, 250);
});
$("#filter-status").addEventListener("change", loadSets);
$("#btn-refresh-all").addEventListener("click", refreshAll);

bindSortHeaders();
refresh().catch((err) => toast(err.message, "error"));
