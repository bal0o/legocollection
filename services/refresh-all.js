const fs = require("fs");
const path = require("path");
const store = require("../db/database");
const { fetchPricing } = require("./pricing");
const { fetchEbaySoldData, sleep } = require("./ebay");
const {
  suggestListingPrices,
  buildPriceSnapshot,
  appendPriceHistory,
} = require("./marketplaces");

const LOCK_PATH = path.join(__dirname, "..", "data", ".refresh-lock");
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

let refreshInProgress = false;
let refreshStatus = null;

function readLock() {
  if (!fs.existsSync(LOCK_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function acquireLock(source) {
  const existing = readLock();
  if (existing) {
    const age = Date.now() - new Date(existing.started_at).getTime();
    if (age < LOCK_STALE_MS) return false;
  }
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(
    LOCK_PATH,
    JSON.stringify({ pid: process.pid, source, started_at: new Date().toISOString() }),
    "utf-8"
  );
  return true;
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
}

function isLockActive() {
  const existing = readLock();
  if (!existing) return false;
  const age = Date.now() - new Date(existing.started_at).getTime();
  if (age >= LOCK_STALE_MS) {
    releaseLock();
    return false;
  }
  return true;
}

function updateRefreshStatus(patch) {
  refreshStatus = {
    active: true,
    current: 0,
    total: 0,
    set_number: null,
    description: null,
    status: null,
    phase: "starting",
    ...refreshStatus,
    ...patch,
    updated_at: Date.now(),
  };
}

function clearRefreshStatus() {
  refreshStatus = null;
}

function getRefreshStatus() {
  if (refreshInProgress || refreshStatus?.active) {
    return refreshStatus || { active: true, phase: "starting", current: 0, total: 0 };
  }
  if (isLockActive()) {
    const lock = readLock();
    return {
      active: true,
      phase: "running",
      current: 0,
      total: 0,
      source: lock?.source || null,
      started_at: lock?.started_at || null,
      updated_at: Date.now(),
    };
  }
  return { active: false };
}

function getHeldSets() {
  const collection = store.getSets({ status: "collection" });
  const forSale = store.getSets({ status: "for_sale" });
  return [...collection, ...forSale];
}

async function retryMissingEbay(sets, { onProgress, ebayRetryDelay = 2500 } = {}) {
  const missingEbay = sets
    .map((set) => store.getSet(set.id))
    .filter((set) => set && set.listing_status !== "sold" && set.ebay_sold_avg == null);

  const results = { ebay_retried: 0, failed: [] };

  if (missingEbay.length === 0) return results;

  onProgress?.({ type: "ebay_retry", total: missingEbay.length });

  for (const set of missingEbay) {
    onProgress?.({
      type: "progress",
      set_number: set.set_number,
      description: set.description,
      status: "ebay_retry",
    });
    try {
      await sleep(ebayRetryDelay);
      const ebayData = await fetchEbaySoldData(set.set_number, set.condition);
      if (ebayData.ebay_sold_avg == null) continue;
      const merged = { ...set, ...ebayData };
      const estimates = suggestListingPrices(merged, set.condition);
      const snapshot = buildPriceSnapshot({ ...merged, ...estimates });
      store.updateSet(set.id, {
        ...ebayData,
        ...estimates,
        price_history: appendPriceHistory(set.price_history, snapshot),
        prices_refreshed_at: new Date().toISOString(),
      });
      results.ebay_retried++;
    } catch (err) {
      results.failed.push({ set_number: set.set_number, error: `eBay retry: ${err.message}` });
    }
  }

  return results;
}

function wrapProgress(onProgress) {
  return (data) => {
    if (data.type === "start") {
      updateRefreshStatus({
        phase: "refreshing",
        current: 0,
        total: data.total,
        status: "starting",
      });
    } else if (data.type === "progress") {
      updateRefreshStatus({
        phase: data.status === "ebay_retry" ? "ebay_retry" : "refreshing",
        current: data.current ?? refreshStatus?.current ?? 0,
        total: data.total ?? refreshStatus?.total ?? 0,
        set_number: data.set_number ?? null,
        description: data.description ?? null,
        status: data.status ?? null,
      });
    } else if (data.type === "ebay_retry") {
      updateRefreshStatus({ phase: "ebay_retry", total: data.total, status: "ebay_retry" });
    } else if (data.type === "complete") {
      updateRefreshStatus({
        phase: "complete",
        current: data.total ?? refreshStatus?.total ?? 0,
        total: data.total ?? refreshStatus?.total ?? 0,
        status: "complete",
        refreshed: data.refreshed,
        failed_count: data.failed?.length ?? 0,
      });
    } else if (data.type === "error") {
      updateRefreshStatus({ phase: "error", status: "error", error: data.error });
    }
    onProgress?.(data);
  };
}

async function refreshAllSets({
  onProgress,
  delayBetween = 350,
  source = "manual",
} = {}) {
  if (refreshInProgress || isLockActive()) {
    return { skipped: true, reason: "refresh already in progress", source };
  }
  if (!acquireLock(source)) {
    return { skipped: true, reason: "refresh already in progress", source };
  }

  refreshInProgress = true;
  const startedAt = new Date().toISOString();
  const sets = getHeldSets();
  const progress = wrapProgress(onProgress);
  const results = {
    source,
    started_at: startedAt,
    refreshed: 0,
    failed: [],
    total: sets.length,
    ebay_retried: 0,
  };

  updateRefreshStatus({
    active: true,
    phase: "starting",
    current: 0,
    total: sets.length,
    source,
    started_at: startedAt,
  });

  try {
    progress({ type: "start", total: sets.length, source });

    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      progress({
        type: "progress",
        current: i + 1,
        total: sets.length,
        set_number: set.set_number,
        description: set.description,
        status: "refreshing",
      });

      try {
        const pricing = await fetchPricing(
          set.set_number,
          set.condition,
          set.slug,
          set.price_history,
          set,
          { refresh: true }
        );
        store.updateSet(set.id, pricing);
        results.refreshed++;
        progress({
          type: "progress",
          current: i + 1,
          total: sets.length,
          set_number: set.set_number,
          description: pricing.description || set.description,
          status: "done",
        });
        await sleep(delayBetween);
      } catch (err) {
        results.failed.push({ set_number: set.set_number, error: err.message });
        progress({
          type: "progress",
          current: i + 1,
          total: sets.length,
          set_number: set.set_number,
          description: set.description,
          status: "failed",
          error: err.message,
        });
      }
    }

    results.finished_at = new Date().toISOString();
    results.ok = results.failed.length === 0;

    progress({ type: "complete", ...results });
    return results;
  } finally {
    refreshInProgress = false;
    releaseLock();
    setTimeout(clearRefreshStatus, 5000);
  }
}

function isRefreshInProgress() {
  return refreshInProgress || isLockActive();
}

module.exports = {
  getHeldSets,
  refreshAllSets,
  isRefreshInProgress,
  getRefreshStatus,
};
