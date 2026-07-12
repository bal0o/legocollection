const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "collection.json");

const STATUSES = ["collection", "for_sale", "sold"];
const STATUS_ORDER = { collection: 0, for_sale: 1, sold: 2 };

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeQuantities(set) {
  if (set.quantity_held == null || set.quantity_held < 1) set.quantity_held = 1;
  if (set.quantity_listed == null) {
    set.quantity_listed = set.listing_status === "for_sale" ? 1 : 0;
  }
  if (set.listing_status === "for_sale" && set.quantity_listed < 1) set.quantity_listed = 1;
  if (set.listing_status === "collection") set.quantity_listed = 0;
  if (set.listing_status === "sold") set.quantity_listed = 0;
  if (set.quantity_listed > set.quantity_held) set.quantity_listed = set.quantity_held;
  return set;
}

function normalizeMissingPieces(set) {
  if (!Array.isArray(set.missing_pieces)) {
    set.missing_pieces = [];
  } else {
    set.missing_pieces = sanitizeMissingPieces(set.missing_pieces);
  }
  return set;
}

function sanitizeMissingPieces(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input
    .map((p) => ({
      piece_number: String(p.piece_number || "").trim(),
      bag: String(p.bag || "").trim(),
    }))
    .filter((p) => {
      if (!p.piece_number) return false;
      const key = `${p.piece_number}|${p.bag}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function migrateSet(set) {
  if (set.listing_status && STATUSES.includes(set.listing_status)) {
    if (!Array.isArray(set.price_history)) set.price_history = [];
    if (set.listing_status === "sold" && set.sold_price != null && !set.sold_snapshot) {
      set.sold_snapshot = buildSoldSnapshot(set);
    }
    normalizeMissingPieces(set);
    return normalizeQuantities(set);
  }
  if (set.sold === 1 || set.sold === true) {
    set.listing_status = "sold";
  } else {
    set.listing_status = "collection";
  }
  delete set.sold;
  if (!Array.isArray(set.price_history)) set.price_history = [];
  normalizeMissingPieces(set);
  return normalizeQuantities(set);
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { sets: [], nextId: 1 };
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  let migrated = false;
  data.sets = data.sets.map((s) => {
    const before = `${s.listing_status}|${!!s.sold_snapshot}|${Array.isArray(s.price_history)}|${s.quantity_held}|${s.quantity_listed}`;
    const m = migrateSet({ ...s });
    const after = `${m.listing_status}|${!!m.sold_snapshot}|${Array.isArray(m.price_history)}|${m.quantity_held}|${m.quantity_listed}`;
    if (before !== after || s.sold !== undefined) migrated = true;
    return m;
  });
  if (migrated) save(data);
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function rowToSet(row) {
  if (!row) return null;
  return { ...row, listing_status: row.listing_status || "collection" };
}

function matchSearch(set, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  return (
    set.set_number.toLowerCase().includes(t) ||
    (set.description || "").toLowerCase().includes(t)
  );
}

function buildSoldSnapshot(set) {
  return {
    private_sale_value: set.private_sale_value ?? null,
    ebay_listing_price: set.ebay_listing_price ?? null,
    bl_used_avg: set.bl_used_avg ?? null,
    ebay_sold_avg: set.ebay_sold_avg ?? null,
    captured_at: new Date().toISOString(),
  };
}

function pctDiff(sold, recommended) {
  if (sold == null || recommended == null || recommended === 0) return null;
  return Math.round(((sold - recommended) / recommended) * 1000) / 10;
}

function applyStatusChange(set, status, extras = {}) {
  set.listing_status = status;
  if (status === "sold") {
    set.sold_price = extras.sold_price ?? set.sold_price ?? null;
    set.sold_date = extras.sold_date ?? set.sold_date ?? new Date().toISOString().slice(0, 10);
    if (!set.sold_snapshot) {
      set.sold_snapshot = buildSoldSnapshot(set);
    }
    set.listed_price = null;
    set.listed_date = null;
    set.quantity_listed = 0;
  } else if (status === "for_sale") {
    set.listed_price = extras.listed_price ?? set.listed_price ?? null;
    set.listed_date = extras.listed_date ?? set.listed_date ?? new Date().toISOString().slice(0, 10);
    set.quantity_listed = extras.quantity_listed ?? (set.quantity_listed > 0 ? set.quantity_listed : 1);
    set.sold_price = null;
    set.sold_date = null;
    set.sold_snapshot = null;
  } else {
    set.sold_price = null;
    set.sold_date = null;
    set.sold_snapshot = null;
    set.listed_price = null;
    set.listed_date = null;
    set.quantity_listed = 0;
  }
  normalizeQuantities(set);
}

module.exports = {
  DB_PATH,
  STATUSES,
  sanitizeMissingPieces,
  getSets({ status = "held", search = "" } = {}) {
    const data = load();
    let sets = data.sets.filter((s) => matchSearch(s, search.trim()));
    if (status === "held") {
      sets = sets.filter((s) => s.listing_status !== "sold");
    } else if (status !== "all" && STATUSES.includes(status)) {
      sets = sets.filter((s) => s.listing_status === status);
    }
    sets.sort(
      (a, b) =>
        (STATUS_ORDER[a.listing_status] ?? 0) - (STATUS_ORDER[b.listing_status] ?? 0) ||
        a.set_number.localeCompare(b.set_number)
    );
    return sets.map(rowToSet);
  },
  getSet(id) {
    const data = load();
    return rowToSet(data.sets.find((s) => s.id === id));
  },
  getSetByNumber(num) {
    const data = load();
    return rowToSet(data.sets.find((s) => s.set_number === num));
  },
  countSets() {
    return load().sets.length;
  },
  createSet(fields) {
    const data = load();
    const now = new Date().toISOString();
    const set = {
      id: data.nextId++,
      listing_status: "collection",
      sold_price: null,
      sold_date: null,
      listed_price: null,
      listed_date: null,
      quantity_held: 1,
      quantity_listed: 0,
      missing_pieces: [],
      price_history: [],
      created_at: now,
      updated_at: now,
      ...fields,
    };
    if (!Array.isArray(set.price_history)) set.price_history = [];
    if (!STATUSES.includes(set.listing_status)) set.listing_status = "collection";
    data.sets.push(set);
    save(data);
    return rowToSet(set);
  },
  updateSet(id, patch) {
    const data = load();
    const idx = data.sets.findIndex((s) => s.id === id);
    if (idx === -1) return null;

    if (patch.listing_status && STATUSES.includes(patch.listing_status)) {
      applyStatusChange(data.sets[idx], patch.listing_status, patch);
    }

    const { listing_status, missing_pieces, ...rest } = patch;
    if (missing_pieces !== undefined) {
      rest.missing_pieces = sanitizeMissingPieces(missing_pieces);
    }
    Object.assign(data.sets[idx], rest, { updated_at: new Date().toISOString() });
    normalizeMissingPieces(data.sets[idx]);
    normalizeQuantities(data.sets[idx]);
    save(data);
    return rowToSet(data.sets[idx]);
  },
  deleteSet(id) {
    const data = load();
    data.sets = data.sets.filter((s) => s.id !== id);
    save(data);
  },
  getStats() {
    const sets = load().sets;
    const byStatus = (st) => sets.filter((s) => s.listing_status === st);
    const qty = (s) => Math.max(1, s.quantity_held ?? 1);
    const qtyListed = (s) => Math.max(0, s.quantity_listed ?? 0);
    const sumPrivateQty = (list) =>
      list.reduce((sum, s) => sum + (s.private_sale_value || 0) * qty(s), 0);
    const held = [...byStatus("collection"), ...byStatus("for_sale")];

    return {
      total_sets: sets.length,
      collection_count: byStatus("collection").length,
      for_sale_count: byStatus("for_sale").length,
      sold_count: byStatus("sold").length,
      pieces_in_collection: byStatus("collection").reduce((sum, s) => sum + qty(s), 0),
      pieces_held: held.reduce((sum, s) => sum + qty(s), 0),
      pieces_listed: byStatus("for_sale").reduce((sum, s) => sum + qtyListed(s), 0),
      collection_value: sumPrivateQty(byStatus("collection")),
      for_sale_value: byStatus("for_sale").reduce(
        (sum, s) => sum + (s.listed_price ?? s.private_sale_value ?? 0) * qtyListed(s),
        0
      ),
      held_value: sumPrivateQty(held),
      sold_value: byStatus("sold").reduce((sum, s) => sum + (s.sold_price || 0), 0),
      total_rrp: sets.reduce((sum, s) => sum + (s.uk_rrp || 0) * qty(s), 0),
    };
  },
  getSoldHistory({ search = "" } = {}) {
    const sold = module.exports.getSets({ status: "sold", search });
    const items = sold
      .filter((s) => s.sold_price != null)
      .map((set) => {
        const recommended = set.sold_snapshot || {
          private_sale_value: set.private_sale_value ?? null,
          ebay_listing_price: set.ebay_listing_price ?? null,
          bl_used_avg: set.bl_used_avg ?? null,
          ebay_sold_avg: set.ebay_sold_avg ?? null,
        };
        const soldPrice = set.sold_price;
        return {
          id: set.id,
          set_number: set.set_number,
          description: set.description,
          condition: set.condition,
          sold_date: set.sold_date,
          sold_price: soldPrice,
          uk_rrp: set.uk_rrp ?? null,
          recommended,
          vs_private_pct: pctDiff(soldPrice, recommended.private_sale_value),
          vs_ebay_pct: pctDiff(soldPrice, recommended.ebay_listing_price),
        };
      });

    items.sort((a, b) => String(b.sold_date || "").localeCompare(String(a.sold_date || "")));

    const totalSold = items.reduce((sum, i) => sum + i.sold_price, 0);
    const totalPrivate = items.reduce(
      (sum, i) => sum + (i.recommended.private_sale_value || 0),
      0
    );
    const pcts = items
      .map((i) => i.vs_private_pct)
      .filter((p) => p != null);
    const avgVsPrivate =
      pcts.length > 0 ? Math.round((pcts.reduce((s, p) => s + p, 0) / pcts.length) * 10) / 10 : null;

    return {
      summary: {
        count: items.length,
        total_sold: Math.round(totalSold * 100) / 100,
        total_private_recommended: Math.round(totalPrivate * 100) / 100,
        total_vs_private_pct: pctDiff(totalSold, totalPrivate),
        avg_vs_private_pct: avgVsPrivate,
      },
      items,
    };
  },
  get db() {
    return {
      transaction(fn) {
        return (records) => fn(records);
      },
    };
  },
};
