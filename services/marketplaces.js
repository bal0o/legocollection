const { roundListing } = require("./listing");

function round(n) {
  return Math.round(n * 100) / 100;
}

function pickStockGuide(data, condition) {
  const cond = (condition || data.condition || "").toLowerCase();
  if (cond.includes("bnib")) {
    return {
      avg: data.bl_sealed_stock_avg ?? null,
      min: data.bl_sealed_stock_min ?? null,
    };
  }
  return {
    avg: data.bl_used_stock_avg ?? null,
    min: data.bl_used_stock_min ?? null,
  };
}

function competitiveAskFloor(data, condition) {
  const stock = pickStockGuide(data, condition);
  const floors = [];

  if (stock.min > 0) floors.push(round(stock.min * 0.98));
  if (stock.avg > 0) floors.push(round(stock.avg * 0.88));
  if (data.ebay_ask_min > 0) floors.push(round(data.ebay_ask_min * 0.98));
  if (data.ebay_ask_median > 0) floors.push(round(data.ebay_ask_median * 0.9));

  return floors.length ? Math.max(...floors) : null;
}

function applyCompetitiveFloor(price, floor, { cap } = {}) {
  if (price == null || Number.isNaN(price)) return floor ?? null;
  if (!floor) return price;
  let next = Math.max(price, floor);
  if (cap != null && cap > 0) next = Math.min(next, cap);
  return next;
}

function pickMarketValue(data, condition) {
  const cond = (condition || data.condition || "").toLowerCase();
  const ebay = data.ebay_sold_avg ?? data.ebay_sold_median;
  const blUsed = data.bl_used_avg;
  const blSealed = data.bl_sealed_avg;
  const stock = pickStockGuide(data, condition);
  const retail = data.uk_retail_price ?? data.uk_rrp ?? 0;
  const atRetail =
    (data.retirement_status || "").includes("Retail") ||
    (data.retirement_status || "").includes("Exclusive");

  if (cond.includes("bnib")) {
    return blSealed || stock.avg || ebay || retail || blUsed;
  }
  if (cond.includes("bagged")) {
    return blUsed || stock.avg || ebay || blSealed;
  }
  if (cond.includes("missing")) {
    return (blUsed || stock.min || ebay) * 0.85;
  }
  return blUsed || stock.avg || ebay || blSealed;
}

function suggestListingPrices(data, condition) {
  const market = pickMarketValue(data, condition);
  if (!market || market <= 0) {
    return {
      ebay_listing_price: null,
      private_sale_value: null,
      quick_sale_price: null,
      competitive_floor: null,
    };
  }

  const cond = (condition || data.condition || "").toLowerCase();
  const ebaySold = data.ebay_sold_avg ?? data.ebay_sold_median;
  const blUsed = data.bl_used_avg ?? 0;
  const blSealed = data.bl_sealed_avg ?? 0;
  const retail = data.uk_retail_price ?? data.uk_rrp ?? 0;
  const atRetail =
    (data.retirement_status || "").includes("Retail") ||
    (data.retirement_status || "").includes("Exclusive");
  const floor = competitiveAskFloor(data, condition);
  const stock = pickStockGuide(data, condition);
  const retailCap = atRetail && retail > 0 ? round(retail * 0.92) : null;

  let privateSale;
  let quickSale;

  if (cond.includes("bnib")) {
    if (atRetail && retail > 0) {
      privateSale = round(retail * 0.92);
      quickSale = round(retail * 0.87);
    } else {
      privateSale = round((blSealed || ebaySold || market) * 0.95);
      quickSale = round((blSealed || ebaySold || market) * 0.88);
    }
  } else if (cond.includes("bagged")) {
    privateSale = round((blUsed || ebaySold || market) * 1.05);
    quickSale = round((blUsed || ebaySold || market) * 0.92);
    if (blSealed > 0) privateSale = Math.min(privateSale, round(blSealed * 0.88));
  } else if (cond.includes("missing")) {
    privateSale = round((blUsed || ebaySold || market) * 0.82);
    quickSale = round((blUsed || ebaySold || market) * 0.72);
  } else {
    privateSale = round((blUsed || ebaySold || market) * 0.98);
    quickSale = round((blUsed || ebaySold || market) * 0.85);
  }

  privateSale = applyCompetitiveFloor(privateSale, floor, { cap: retailCap });
  quickSale = applyCompetitiveFloor(quickSale, floor ? round(floor * 0.9) : null, {
    cap: retailCap,
  });

  const ebayAnchor = ebaySold || blUsed || blSealed || market;
  let ebayListing = round(Math.max(ebayAnchor * 1.12, privateSale * 1.08));
  const ebayFloor = floor ? round(floor * 1.05) : null;
  if (ebayFloor) ebayListing = Math.max(ebayListing, ebayFloor);
  if (data.ebay_ask_median > 0) {
    ebayListing = Math.max(ebayListing, round(data.ebay_ask_median * 0.95));
  } else if (stock.avg > 0) {
    ebayListing = Math.max(ebayListing, round(stock.avg * 0.95));
  }

  return {
    private_sale_value: roundListing(privateSale),
    quick_sale_price: roundListing(quickSale),
    ebay_listing_price: roundListing(ebayListing),
    competitive_floor: floor,
  };
}

function buildPriceSnapshot(data) {
  return {
    date: new Date().toISOString(),
    bl_used_avg: data.bl_used_avg ?? null,
    bl_sealed_avg: data.bl_sealed_avg ?? null,
    bl_used_stock_avg: data.bl_used_stock_avg ?? null,
    bl_used_stock_min: data.bl_used_stock_min ?? null,
    ebay_sold_avg: data.ebay_sold_avg ?? null,
    ebay_sold_median: data.ebay_sold_median ?? null,
    ebay_sold_count: data.ebay_sold_count ?? 0,
    ebay_ask_min: data.ebay_ask_min ?? null,
    ebay_ask_median: data.ebay_ask_median ?? null,
    private_sale_value: data.private_sale_value ?? null,
    ebay_listing_price: data.ebay_listing_price ?? null,
    competitive_floor: data.competitive_floor ?? null,
  };
}

function appendPriceHistory(existing, snapshot, maxEntries = 20) {
  const history = Array.isArray(existing) ? [...existing] : [];
  const last = history[history.length - 1];
  if (last && last.date?.slice(0, 10) === snapshot.date.slice(0, 10)) {
    history[history.length - 1] = snapshot;
  } else {
    history.push(snapshot);
  }
  return history.slice(-maxEntries);
}

module.exports = {
  suggestListingPrices,
  buildPriceSnapshot,
  appendPriceHistory,
  competitiveAskFloor,
};
