const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmt = (n) => (n == null ? "—" : `£${Number(n).toFixed(2)}`);
const fmtWhole = (n) => (n == null ? "—" : `£${Number(n)}`);

function recommendedPrice(set) {
  if (!set) return null;
  return set.recommended_price ?? set.private_sale_value ?? set.ebay_listing_price ?? null;
}

const CONDITION_HINTS = {
  BNIB: "Unbuilt — still factory sealed as received from LEGO.",
  "Complete, bagged":
    "All pieces present, repacked into the original numbered bags for re-assembly.",
  "Complete, dismantled": "All pieces present, stored in non-numbered bags.",
  "Missing piece": "Add missing parts below — they are included in the listing description.",
};

function updateConditionHint(selectEl, hintEl) {
  if (!selectEl || !hintEl) return;
  hintEl.textContent = CONDITION_HINTS[selectEl.value] || "";
}

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
    if (sortColumn === "sold_price") {
      av = a.listing_status === "sold" ? (a.sold_price ?? 0) : -1;
      bv = b.listing_status === "sold" ? (b.sold_price ?? 0) : -1;
      return (av - bv) * dir;
    }
    if (["bl_used_avg", "bl_sealed_avg", "ebay_sold_avg", "recommended_price", "listed_price", "sold_price", "quantity_held", "quantity_listed", "uk_rrp"].includes(sortColumn)) {
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

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML.replace(/"/g, "&quot;");
}

function actionButtons(id) {
  return `
    <button type="button" class="btn btn-sm btn-ghost btn-action" data-history="${id}" title="Price history" aria-label="Price history">📈</button>
    <button type="button" class="btn btn-sm btn-ghost btn-action" data-refresh="${id}" title="Refresh prices" aria-label="Refresh prices">↻</button>`;
}

function bindSetInteractions(root) {
  root.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", () => onStatusChange(sel));
  });
  root.querySelectorAll("[data-refresh]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      refreshSet(btn.dataset.refresh, btn);
    });
  });
  root.querySelectorAll("[data-history]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openHistoryModal(btn.dataset.history);
    });
  });
  root.querySelectorAll("[data-edit-listed]").forEach((cell) => {
    if (!cell.dataset.editListed) return;
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = cell.closest("tr, .set-card");
      const label = `${row.querySelector("strong").textContent} ${row.querySelector(".name").textContent}`;
      openForSaleModal(cell.dataset.editListed, label, true);
    });
  });
  root.querySelectorAll("[data-edit-sold]").forEach((cell) => {
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = cell.closest("tr, .set-card");
      const label = `${row.querySelector("strong").textContent} ${row.querySelector(".name").textContent}`;
      openSoldModal(cell.dataset.editSold, label, true);
    });
  });
  root.querySelectorAll(".row-clickable").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button, select, a")) return;
      openSetDetail(row.dataset.id);
    });
  });
}

function renderSetCards(sets, { showSoldCol, showListedCol }) {
  const cards = $("#sets-cards");
  cards.innerHTML = sets
    .map((s) => {
      const listedCell =
        showListedCol && s.listing_status === "for_sale"
          ? `<button type="button" class="set-card-listed listed-price-edit" data-edit-listed="${s.id}">Listed ${fmtWhole(s.listed_price)}</button>`
          : "";
      const soldCell = showSoldCol
        ? `<button type="button" class="set-card-listed sold-price-edit" data-edit-sold="${s.id}">Sold ${fmt(s.sold_price)}</button>`
        : "";
      const qty =
        s.listing_status === "for_sale"
          ? `${s.quantity_held ?? 1} held · ${s.quantity_listed ?? 0} listed`
          : `${s.quantity_held ?? 1} held`;
      return `
    <article class="set-card row-${s.listing_status} row-clickable" data-id="${s.id}">
      <div class="set-card-top">
        <div class="set-card-title">
          <strong>${s.set_number}</strong>
          <span class="name">${esc(s.description)}</span>
          ${(s.missing_pieces?.length ?? 0) > 0 ? `<span class="missing-badge">${missingPiecesCount(s.missing_pieces)} missing</span>` : ""}
        </div>
      </div>
      <p class="set-card-condition">${esc(s.condition)} · ${qty}</p>
      <div class="set-card-status">${statusSelect(s.id, s.listing_status)}</div>
      <div class="set-card-prices">
        <div><span class="set-card-price-label">List at</span><strong>${fmtWhole(recommendedPrice(s))}</strong></div>
        ${listedCell}
        ${soldCell}
      </div>
      <div class="set-card-actions actions">${actionButtons(s.id)}</div>
    </article>`;
    })
    .join("");
  bindSetInteractions(cards);
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
    $("#sets-cards").innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  tbody.innerHTML = sorted
    .map(
      (s) => `
    <tr class="row-${s.listing_status} row-clickable" data-id="${s.id}">
      <td class="col-set"><strong>${s.set_number}</strong></td>
      <td class="name">${esc(s.description)}${(s.missing_pieces?.length ?? 0) > 0 ? ` <span class="missing-badge" title="${missingPiecesCount(s.missing_pieces)} missing piece(s)">${missingPiecesCount(s.missing_pieces)} missing</span>` : ""}</td>
      <td class="hide-mobile">${esc(s.condition)}</td>
      <td class="col-status">${statusSelect(s.id, s.listing_status)}</td>
      <td class="num hide-mobile">${s.quantity_held ?? 1}</td>
      <td class="num hide-mobile">${s.listing_status === "for_sale" ? (s.quantity_listed ?? 0) : "—"}</td>
      <td class="num hide-mobile">${fmt(s.uk_rrp)}</td>
      <td class="num hide-mobile">${fmt(s.bl_used_avg)}</td>
      <td class="num hide-mobile">${fmt(s.bl_sealed_avg)}</td>
      <td class="num hide-mobile">${fmt(s.ebay_sold_avg)}</td>
      <td class="num col-price">${fmtWhole(recommendedPrice(s))}</td>
      <td class="num listed-col hide-mobile${s.listing_status === "for_sale" ? " listed-price-edit" : ""}${showListedCol ? "" : " hidden"}" data-edit-listed="${s.listing_status === "for_sale" ? s.id : ""}" title="${s.listing_status === "for_sale" ? "Click to edit listed price" : ""}">${s.listing_status === "for_sale" ? fmtWhole(s.listed_price) : "—"}</td>
      <td class="num sold-col${showSoldCol ? " sold-price-edit" : " hidden"}" data-edit-sold="${s.id}" title="Click to edit sold price">${fmt(s.sold_price)}</td>
      <td class="col-actions"><div class="actions">${actionButtons(s.id)}</div></td>
    </tr>`
    )
    .join("");

  bindSetInteractions(tbody);
  renderSetCards(sorted, { showSoldCol, showListedCol });
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
  const row = sel.closest("tr, .set-card");
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
        <td class="num">${fmtWhole(h.recommended_price ?? h.private_sale_value)}</td>
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

function applyRefreshProgress(data, { fill, label, detail }) {
  if (!data) return null;

  const total = data.total ?? 0;
  const current = data.current ?? 0;
  const isLive =
    data.type === "start" ||
    data.type === "progress" ||
    data.type === "complete" ||
    data.active;

  if (!isLive) return null;

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  fill.style.width = `${pct}%`;
  label.textContent = total > 0 ? `${current} / ${total}` : "Starting…";

  if (data.set_number) {
    const statusIcon =
      data.status === "done" ? "✓" : data.status === "failed" ? "✗" : data.status === "ebay_retry" ? "eBay" : "…";
    detail.textContent = `${statusIcon} ${data.set_number} ${data.description || ""}`.trim();
  } else if (data.phase === "ebay_retry") {
    detail.textContent = "Retrying missing eBay prices…";
  } else if (data.phase === "starting") {
    detail.textContent = "Starting refresh…";
  }

  if (data.type === "complete" || data.phase === "complete") return data;
  return null;
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
  detail.textContent = "Connecting…";

  let pollTimer = null;
  let finalResult = null;

  const ui = { fill, label, detail };
  const stopPoll = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  pollTimer = setInterval(async () => {
    try {
      const status = await api("/api/sets/refresh-status");
      const done = applyRefreshProgress(status, ui);
      if (done) finalResult = done;
      if (!status.active && status.phase === "complete") stopPoll();
    } catch {
      /* ignore poll errors */
    }
  }, 1000);

  try {
    const res = await fetch("/api/sets/refresh-all", {
      method: "POST",
      headers: { Accept: "text/event-stream" },
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Refresh failed (${res.status})`);
    }
    if (!res.body) throw new Error("Refresh stream unavailable in this browser");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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

        if (data.type === "error") {
          throw new Error(data.error || "Refresh failed");
        }

        const doneResult = applyRefreshProgress(data, ui);
        if (doneResult) finalResult = doneResult;
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
    detail.textContent = err.message;
  } finally {
    stopPoll();
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
        set.listed_price ?? recommendedPrice(set) ?? "";
    }
    if (!$("#detail-listed-date-input").value) {
      $("#detail-listed-date-input").value =
        set?.listed_date || new Date().toISOString().slice(0, 10);
    }
  }
  if (status === "sold") {
    if (!$("#detail-sold-price-input").value && set) {
      $("#detail-sold-price-input").value =
        set.sold_price ?? set.listed_price ?? recommendedPrice(set) ?? "";
    }
    if (!$("#detail-sold-date-input").value) {
      $("#detail-sold-date-input").value =
        set?.sold_date || new Date().toISOString().slice(0, 10);
    }
  }
}

function isMissingCondition(condition) {
  return (condition || "").toLowerCase().includes("missing");
}

function missingPiecesCount(pieces = []) {
  if (!Array.isArray(pieces) || pieces.length === 0) return 0;
  return pieces.reduce((sum, piece) => sum + Math.max(1, parseInt(piece.quantity, 10) || 1), 0);
}

function storedMissingPieces(pieces = []) {
  return (pieces || []).map((p) => {
    const piece = {
      piece_number: p.piece_number,
      bag: p.bag || "",
      quantity: Math.max(1, parseInt(p.quantity, 10) || 1),
    };
    for (const field of ["name", "image_url", "part_url", "bl_part_no", "element_id", "color_id", "color_name", "lookup_error"]) {
      if (p[field] != null && p[field] !== "") piece[field] = p[field];
    }
    return piece;
  });
}

function updateMissingSectionVisibility(condition, pieces = []) {
  const show = isMissingCondition(condition) || (pieces && pieces.length > 0);
  $("#detail-missing-section").classList.toggle("hidden", !show);
}

function renderMissingPiecesList(pieces) {
  const list = $("#detail-missing-list");
  if (!pieces || pieces.length === 0) {
    list.innerHTML = '<li class="missing-empty">No missing pieces recorded yet.</li>';
    return;
  }

  list.innerHTML = pieces
    .map(
      (piece, index) => `
    <li class="missing-piece-item">
      <div class="missing-piece-thumb">
        ${
          piece.image_url
            ? `<img src="${esc(piece.image_url)}" alt="" loading="lazy" />`
            : '<span class="missing-piece-no-img">?</span>'
        }
      </div>
      <div class="missing-piece-info">
        <strong>${esc(piece.piece_number)}</strong>
        <span>${esc(piece.name || piece.lookup_error || "Unknown part")}</span>
        ${(piece.quantity ?? 1) > 1 ? `<span class="missing-piece-qty">×${piece.quantity}</span>` : ""}
        ${piece.bag ? `<span class="missing-piece-bag">Bag ${esc(piece.bag)}</span>` : ""}
      </div>
      <button type="button" class="btn btn-sm btn-ghost missing-btn-remove" data-index="${index}" title="Remove" aria-label="Remove">×</button>
    </li>`
    )
    .join("");

  list.querySelectorAll(".missing-btn-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeMissingPiece(parseInt(btn.dataset.index, 10));
    });
  });
}

async function saveMissingPieces(pieces) {
  if (!detailTargetId) return null;
  const payload = storedMissingPieces(pieces);
  const updated = await api(`/api/sets/${detailTargetId}`, {
    method: "PATCH",
    body: JSON.stringify({ missing_pieces: payload }),
  });
  if (detailCurrentSet) {
    detailCurrentSet.missing_pieces = updated.missing_pieces || payload;
  }
  return updated;
}

async function removeMissingPiece(index) {
  if (!detailCurrentSet) return;
  const pieces = storedMissingPieces(detailCurrentSet.missing_pieces);
  pieces.splice(index, 1);
  try {
    await saveMissingPieces(pieces);
    toast("Missing piece removed");
    await openSetDetailAsync(detailTargetId);
    await refresh();
  } catch (err) {
    toast(err.message, "error");
  }
}

let missingPreviewTimer = null;
let missingPreviewPart = null;

async function previewMissingPiece() {
  const partNum = $("#missing-piece-number").value.trim();
  const preview = $("#missing-piece-preview");
  if (!partNum) {
    missingPreviewPart = null;
    preview.classList.add("hidden");
    preview.innerHTML = "";
    return;
  }

  preview.classList.remove("hidden");
  preview.innerHTML = '<span class="missing-preview-loading">Looking up part…</span>';

  try {
    const part = await api(`/api/parts/${encodeURIComponent(partNum)}`);
    missingPreviewPart = part.error && !part.name ? null : part;
    if (part.error && !part.name) {
      preview.innerHTML = `<span class="missing-preview-error">${esc(part.error)}</span>`;
      return;
    }
    preview.innerHTML = `
      <div class="missing-preview-card">
        ${part.image_url ? `<img src="${esc(part.image_url)}" alt="" />` : ""}
        <div>
          <strong>${esc(part.piece_number)}</strong>
          <span>${esc(part.name || "Unknown part")}</span>
          ${part.bl_part_no && part.bl_part_no !== part.piece_number ? `<span class="missing-preview-meta">BL ${esc(part.bl_part_no)}</span>` : ""}
        </div>
      </div>`;
  } catch (err) {
    preview.innerHTML = `<span class="missing-preview-error">${esc(err.message)}</span>`;
  }
}

function populateDetailManageForm(set) {
  detailCurrentSet = set;
  $("#detail-condition").value = set.condition || "Complete, dismantled";
  updateConditionHint($("#detail-condition"), $("#detail-condition-hint"));
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
  updateMissingSectionVisibility(set.condition, set.missing_pieces);
  renderMissingPiecesList(set.missing_pieces || []);
  $("#missing-piece-number").value = "";
  $("#missing-piece-bag").value = "";
  $("#missing-piece-quantity").value = "1";
  $("#missing-piece-preview").classList.add("hidden");
  $("#missing-piece-preview").innerHTML = "";
  missingPreviewPart = null;
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

  $("#detail-recommended").textContent = fmtWhole(recommendedPrice(set));

  const isBnib = (set.condition || "").toLowerCase().includes("bnib");
  const stockAvg = isBnib ? set.bl_sealed_stock_avg : set.bl_used_stock_avg;
  const stockMin = isBnib ? set.bl_sealed_stock_min : set.bl_used_stock_min;

  $("#detail-stats").innerHTML = [
    ["BrickLink used (sold)", fmt(set.bl_used_avg)],
    ["BrickLink sealed (sold)", fmt(set.bl_sealed_avg)],
    ["BL listings avg", fmt(stockAvg)],
    ["BL listings from", fmt(stockMin)],
    ["eBay sold avg", fmt(set.ebay_sold_avg)],
    ["eBay asks from", fmt(set.ebay_ask_min)],
    ["UK RRP", fmt(set.uk_rrp)],
  ]
    .map(([k, v]) => `<div class="detail-stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join("");

  $("#detail-listing-text").value = set.listing_text || "";
  populateDetailManageForm(set);

  $("#modal-detail").showModal();
}

$("#detail-condition").addEventListener("change", (e) => {
  updateConditionHint(e.target, $("#detail-condition-hint"));
  updateMissingSectionVisibility(e.target.value, detailCurrentSet?.missing_pieces || []);
});

$("#missing-piece-number").addEventListener("input", () => {
  clearTimeout(missingPreviewTimer);
  missingPreviewTimer = setTimeout(() => previewMissingPiece(), 350);
});

$("#missing-btn-add").addEventListener("click", async () => {
  if (!detailTargetId) return;
  const piece_number = $("#missing-piece-number").value.trim();
  const bag = $("#missing-piece-bag").value.trim();
  const quantity = Math.max(1, parseInt($("#missing-piece-quantity").value, 10) || 1);
  if (!piece_number) {
    toast("Enter a part number", "error");
    return;
  }

  const pieces = storedMissingPieces(detailCurrentSet?.missing_pieces || []);
  const existing = pieces.find((p) => p.piece_number === piece_number && p.bag === bag);
  const lookupFields = missingPreviewPart?.piece_number === piece_number
    ? {
        name: missingPreviewPart.name,
        image_url: missingPreviewPart.image_url,
        part_url: missingPreviewPart.part_url,
        bl_part_no: missingPreviewPart.bl_part_no,
        element_id: missingPreviewPart.element_id,
        color_id: missingPreviewPart.color_id,
        color_name: missingPreviewPart.color_name,
        lookup_error: missingPreviewPart.error,
      }
    : {};

  if (existing) {
    existing.quantity += quantity;
  } else {
    pieces.push({ piece_number, bag, quantity, ...lookupFields });
  }

  const btn = $("#missing-btn-add");
  btn.disabled = true;
  btn.textContent = "Adding…";
  try {
    const updated = await saveMissingPieces(pieces);
    if (!isMissingCondition($("#detail-condition").value)) {
      await api(`/api/sets/${detailTargetId}`, {
        method: "PATCH",
        body: JSON.stringify({ condition: "Missing piece" }),
      });
    }
    toast("Missing piece added");
    await openSetDetailAsync(detailTargetId);
    await refresh();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Add";
  }
});

$("#detail-status").addEventListener("change", (e) => {
  const status = e.target.value;
  if (status === "for_sale" && !$("#detail-listed-price-input").value) {
    $("#detail-listed-price-input").value =
      detailCurrentSet?.listed_price ?? recommendedPrice(detailCurrentSet) ?? "";
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
      recommendedPrice(detailCurrentSet) ??
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

  const body = { listing_status: status, quantity_held, quantity_listed, condition: $("#detail-condition").value };

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

  const rec = recommendedPrice(set);
  $("#for-sale-hint").textContent =
    rec != null ? `Recommended listing price: ${fmtWhole(rec)}` : "";

  if (edit) {
    $("#listed-price").value = set?.listed_price != null ? set.listed_price : "";
    $("#listed-date").value = set?.listed_date || new Date().toISOString().slice(0, 10);
    $("#listed-quantity").value = set?.quantity_listed ?? set?.quantity_held ?? 1;
  } else {
    $("#listed-price").value = recommendedPrice(set) ?? "";
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
    $("#sold-price").value = recommendedPrice(set) ?? "";
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
  updateConditionHint($("#add-condition"), $("#add-condition-hint"));
  $("#modal-add").showModal();
  $("#add-set-number").focus();
});

$("#add-condition").addEventListener("change", (e) => {
  updateConditionHint(e.target, $("#add-condition-hint"));
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
