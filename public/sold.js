const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmt = (n) => (n == null ? "—" : `£${Number(n).toFixed(2)}`);
const fmtWhole = (n) => (n == null ? "—" : `£${Number(n)}`);

let cachedItems = [];
let cachedSummary = null;
let sortColumn = "sold_date";
let sortDir = "desc";
let searchDebounce = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, type = "success") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.className = "toast hidden";
  }, 3200);
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function fmtPct(pct) {
  if (pct == null) return '<span class="pct pct-na">—</span>';
  const sign = pct > 0 ? "+" : "";
  const cls = pct > 0 ? "pct-above" : pct < 0 ? "pct-below" : "pct-even";
  return `<span class="pct ${cls}">${sign}${pct.toFixed(1)}%</span>`;
}

function fmtPctPlain(pct) {
  if (pct == null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function sortItems(items) {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    let av = a[sortColumn];
    let bv = b[sortColumn];

    if (sortColumn === "set_number") {
      av = parseInt(av, 10) || 0;
      bv = parseInt(bv, 10) || 0;
      return (av - bv) * dir;
    }
    if (sortColumn === "sold_date") {
      return String(av || "").localeCompare(String(bv || "")) * dir;
    }
    if (
      sortColumn.startsWith("vs_") ||
      sortColumn === "recommended_price" ||
      sortColumn === "sold_price" ||
      sortColumn === "uk_rrp"
    ) {
      av = av ?? -9999;
      bv = bv ?? -9999;
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
        sortDir =
          col === "sold_date" || col.startsWith("vs_") || col === "sold_price" || col === "uk_rrp"
            ? "desc"
            : "asc";
      }
      updateSortHeaders();
      renderItems(cachedItems);
    });
  });
  updateSortHeaders();
}

function renderSummary(summary) {
  $("#stat-count").textContent = summary.count;
  $("#stat-revenue").textContent = fmt(summary.total_sold);
  $("#stat-recommended").textContent = fmt(summary.total_recommended);
  $("#stat-avg-pct").innerHTML = fmtPct(summary.avg_vs_recommended_pct).replace("pct ", "pct stat-pct ");
  $("#stat-total-pct").innerHTML = fmtPct(summary.total_vs_recommended_pct).replace("pct ", "pct stat-pct ");
}

function renderItems(items) {
  const sorted = sortItems(items);
  const tbody = $("#sold-body");
  const tfoot = $("#sold-foot");
  const empty = $("#empty-state");

  if (sorted.length === 0) {
    tbody.innerHTML = "";
    tfoot.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  tbody.innerHTML = sorted
    .map(
      (item) => `
    <tr>
      <td>${item.sold_date ? new Date(item.sold_date).toLocaleDateString("en-GB") : "—"}</td>
      <td><strong>${esc(item.set_number)}</strong></td>
      <td class="name">${esc(item.description)}</td>
      <td class="hide-mobile">${esc(item.condition)}</td>
      <td class="num hide-mobile">${fmt(item.uk_rrp)}</td>
      <td class="num sold-price">${fmt(item.sold_price)}</td>
      <td class="num hide-mobile">${fmtWhole(item.recommended_price)}</td>
      <td class="num">${fmtPct(item.vs_recommended_pct)}</td>
      <td class="col-actions">
        <button type="button" class="btn btn-sm btn-ghost btn-action btn-action-remove" data-remove="${item.id}" title="Remove from collection" aria-label="Remove from collection">×</button>
      </td>
    </tr>`
    )
    .join("");

  if (cachedSummary) {
    tfoot.innerHTML = `
    <tr class="totals-row">
      <td colspan="4"><strong>Totals / average</strong></td>
      <td class="num hide-mobile"></td>
      <td class="num"><strong>${fmt(cachedSummary.total_sold)}</strong></td>
      <td class="num hide-mobile"><strong>${fmtWhole(cachedSummary.total_recommended)}</strong></td>
      <td class="num"><strong>${fmtPctPlain(cachedSummary.avg_vs_recommended_pct)}</strong></td>
      <td></td>
    </tr>`;
  }

  tbody.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = sorted.find((entry) => String(entry.id) === btn.dataset.remove);
      const label = item ? `${item.set_number} — ${item.description}` : `set ${btn.dataset.remove}`;
      if (!confirm(`Remove ${label} from sold history? This cannot be undone.`)) return;
      try {
        await api(`/api/sets/${btn.dataset.remove}`, { method: "DELETE" });
        toast("Removed from collection");
        await loadSoldHistory();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}

async function loadSoldHistory() {
  const search = $("#filter-search").value;
  const data = await api(`/api/sold-history?search=${encodeURIComponent(search)}`);
  cachedItems = data.items;
  cachedSummary = data.summary;
  renderSummary(data.summary);
  renderItems(data.items);
}

$("#filter-search").addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    loadSoldHistory().catch((err) => toast(err.message, "error"));
  }, 250);
});

bindSortHeaders();
loadSoldHistory().catch((err) => toast(err.message, "error"));
