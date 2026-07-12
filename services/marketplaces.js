const { roundListing } = require("./listing");

function round(n) {
  return Math.round(n * 100) / 100;
}

function pickMarketValue(data, condition) {
  const cond = (condition || data.condition || "").toLowerCase();
  const ebay = data.ebay_sold_avg ?? data.ebay_sold_median;
  const blUsed = data.bl_used_avg;
  const blSealed = data.bl_sealed_avg;
  const retail = data.uk_retail_price ?? data.uk_rrp ?? 0;
  const atRetail =
    (data.retirement_status || "").includes("Retail") ||
    (data.retirement_status || "").includes("Exclusive");

  if (cond.includes("bnib")) {
    return blSealed || ebay || retail || blUsed;
  }
  if (cond.includes("bagged")) {
    return blUsed || ebay || blSealed;
  }
  if (cond.includes("missing")) {
    return (blUsed || ebay) * 0.85;
  }
  return blUsed || ebay || blSealed;
}

function suggestListingPrices(data, condition) {
  const market = pickMarketValue(data, condition);
  if (!market || market <= 0) {
    return {
      ebay_listing_price: null,
      private_sale_value: null,
      quick_sale_price: null,
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

  const ebayAnchor = ebaySold || blUsed || blSealed || market;
  const ebayListing = round(Math.max(ebayAnchor * 1.12, privateSale * 1.08));

  return {
    private_sale_value: roundListing(privateSale),
    quick_sale_price: roundListing(quickSale),
    ebay_listing_price: roundListing(ebayListing),
  };
}

function buildPriceSnapshot(data) {
  return {
    date: new Date().toISOString(),
    bl_used_avg: data.bl_used_avg ?? null,
    bl_sealed_avg: data.bl_sealed_avg ?? null,
    ebay_sold_avg: data.ebay_sold_avg ?? null,
    ebay_sold_median: data.ebay_sold_median ?? null,
    ebay_sold_count: data.ebay_sold_count ?? 0,
    private_sale_value: data.private_sale_value ?? null,
    ebay_listing_price: data.ebay_listing_price ?? null,
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
};
