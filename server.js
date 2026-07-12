require("dotenv").config();

const express = require("express");
const path = require("path");
const store = require("./db/database");
const { searchSets, fetchPricing, lookupSetMetadata, normalizeSetNumber } = require("./services/pricing");
const { generateListingText } = require("./services/listing");
const { lookupPart, enrichMissingPieces } = require("./services/parts");
const { refreshAllSets, isRefreshInProgress } = require("./services/refresh-all");
const { startDailyRefreshScheduler } = require("./services/scheduler");
const { importCsv } = require("./scripts/import-csv");

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

if (store.countSets() === 0) {
  try {
    const result = importCsv();
    console.log(`Auto-imported ${result.imported} sets from CSV`);
  } catch (err) {
    console.warn("CSV import skipped:", err.message);
  }
}

app.get("/api/sold-history", (req, res) => {
  const { search = "" } = req.query;
  res.json(store.getSoldHistory({ search: String(search) }));
});

app.get("/api/stats", (_req, res) => {
  res.json(store.getStats());
});

app.get("/api/sets", (req, res) => {
  const status = req.query.status || req.query.sold || "held";
  const legacyMap = { unsold: "held", sold: "sold", all: "held" };
  const mapped = legacyMap[status] || status;
  const { search = "" } = req.query;
  res.json(store.getSets({ status: String(mapped), search: String(search) }));
});

app.get("/api/sets/:id", async (req, res) => {
  try {
    const set = store.getSet(Number(req.params.id));
    if (!set) return res.status(404).json({ error: "Set not found" });

    if (set.missing_pieces?.length) {
      set.missing_pieces = await enrichMissingPieces(set.missing_pieces);
    }
    set.listing_text = generateListingText(set);
    res.json(set);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/parts/:partNum", async (req, res) => {
  try {
    const part = await lookupPart(req.params.partNum);
    res.json(part);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query?.trim()) return res.status(400).json({ error: "Query required" });
    const results = await searchSets(query.trim());
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sets", async (req, res) => {
  try {
    const { condition, fetch_prices = true } = req.body;
    const set_number = normalizeSetNumber(req.body.set_number);
    if (!set_number || !/^\d{4,6}$/.test(set_number)) {
      return res.status(400).json({ error: "Valid set number required (e.g. 75355)" });
    }

    const existing = store.getSetByNumber(set_number);
    if (existing) return res.status(409).json({ error: "Set already in collection", set: existing });

    const meta = await lookupSetMetadata(set_number);
    let data = {
      set_number,
      description: meta?.name || `Set ${set_number}`,
      condition: condition || "Complete, dismantled",
      slug: meta?.slug,
      release_year: meta?.year ?? null,
      quantity_held: Math.max(1, parseInt(req.body.quantity_held, 10) || 1),
      quantity_listed: 0,
    };

    if (fetch_prices) {
      const pricing = await fetchPricing(data.set_number, data.condition, data.slug);
      data = { ...data, ...pricing };
    }

    const created = store.createSet(data);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sets/:id/refresh", async (req, res) => {
  try {
    const set = store.getSet(Number(req.params.id));
    if (!set) return res.status(404).json({ error: "Set not found" });

    const pricing = await fetchPricing(set.set_number, set.condition, set.slug, set.price_history);
    const updated = store.updateSet(set.id, pricing);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sets/refresh-names", async (_req, res) => {
  const sets = store.getSets({ status: "all" });
  const results = { updated: 0, unchanged: 0, failed: [] };

  for (const set of sets) {
    try {
      const meta = await lookupSetMetadata(set.set_number);
      if (!meta?.name) {
        results.failed.push({ set_number: set.set_number, error: "Name not found" });
        continue;
      }
      if (meta.name === set.description && meta.slug === set.slug) {
        results.unchanged++;
      } else {
        store.updateSet(set.id, {
          description: meta.name,
          slug: meta.slug,
          release_year: meta.year ?? set.release_year,
        });
        results.updated++;
      }
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      results.failed.push({ set_number: set.set_number, error: err.message });
    }
  }
  res.json(results);
});

app.post("/api/sets/refresh-all", async (req, res) => {
  if (isRefreshInProgress()) {
    return res.status(409).json({ error: "A price refresh is already running" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const results = await refreshAllSets({
      source: "manual",
      onProgress: send,
    });
    if (results.skipped) {
      send({ type: "error", error: results.reason });
    }
  } catch (err) {
    send({ type: "error", error: err.message });
  }

  res.end();
});

app.patch("/api/sets/:id", (req, res) => {
  const set = store.getSet(Number(req.params.id));
  if (!set) return res.status(404).json({ error: "Set not found" });

  const body = { ...req.body };

  if (body.listing_status === "sold" && body.sold_price == null && set.sold_price == null) {
    return res.status(400).json({ error: "sold_price required when marking as sold" });
  }

  if (body.listing_status === "for_sale" && body.listed_price == null && set.listed_price == null) {
    return res.status(400).json({ error: "listed_price required when marking for sale" });
  }

  if (body.missing_pieces !== undefined) {
    body.missing_pieces = store.sanitizeMissingPieces(body.missing_pieces);
  }

  const updated = store.updateSet(set.id, body);
  res.json(updated);
});

app.delete("/api/sets/:id", (req, res) => {
  const set = store.getSet(Number(req.params.id));
  if (!set) return res.status(404).json({ error: "Set not found" });
  store.deleteSet(set.id);
  res.json({ ok: true });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/sold", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "sold.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`LEGO Collection Manager running at http://localhost:${PORT}`);
  startDailyRefreshScheduler();
});
