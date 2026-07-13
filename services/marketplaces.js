const { roundListing } = require("./listing");

function round(n) {
  return Math.round(n * 100) / 100;
}

function resolveRecommendedPrice(set) {
  if (!set) return null;
  if (set.recommended_price != null) return set.recommended_price;
  const p = set.private_sale_value;
  const e = set.ebay_listing_price;
  if (p != null && e != null) return Math.max(p, e);
  return p ?? e ?? null;
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

function median(nums) {
  const sorted = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

function soldSignal(data, condition) {
  const cond = (condition || data.condition || "").toLowerCase();
  const bl = cond.includes("bnib") ? data.bl_sealed_avg : data.bl_used_avg;
  const ebay = data.ebay_sold_avg ?? data.ebay_sold_median;
  if (bl && ebay) return round(bl * 0.55 + ebay * 0.45);
  return bl || ebay || null;
}

function realisticUsedPrice(data, condition) {
  const cond = (condition || data.condition || "").toLowerCase();
  const sold = soldSignal(data, condition);
  const ebay = data.ebay_sold_avg ?? data.ebay_sold_median;

  if (cond.includes("missing")) {
    return sold ? round(sold * 0.88) : null;
  }

  let price = sold || ebay;
  if (ebay && price) {
    price = Math.min(price, round(ebay * 1.05));
  }
  return price;
}

function realisticBnibPrice(data) {
  const sold = soldSignal(data, "BNIB");
  const asks = askSignal(data, "BNIB");
  if (!sold && !asks) return null;

  if (sold && asks) {
    const spread = asks / sold;
    const askWeight = spread > 1.12 ? 0.38 : 0.28;
    return round(sold * (1 - askWeight) + asks * askWeight);
  }

  return sold || asks;
}

function askSignal(data, condition) {
  const stock = pickStockGuide(data, condition);
  return median([stock.avg, stock.min, data.ebay_ask_median, data.ebay_ask_min].filter(Boolean));
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


function suggestListingPrices(data, condition) {
  const cond = (condition || data.condition || "").toLowerCase();
  const sold = soldSignal(data, condition);
  const asks = askSignal(data, condition);
  const listingFloor = competitiveAskFloor(data, condition);

  if (!sold && !asks && !listingFloor) {
    return {
      recommended_price: null,
      private_sale_value: null,
      ebay_listing_price: null,
      competitive_floor: null,
    };
  }

  let price;
  let competitiveFloor = null;

  if (cond.includes("bnib")) {
    price = realisticBnibPrice(data);
    competitiveFloor = listingFloor;
    if (listingFloor && price && listingFloor > price && listingFloor <= price * 1.05) {
      price = listingFloor;
    }
  } else {
    price = realisticUsedPrice(data, condition) || sold || asks;
  }

  const recommended = price != null && price > 0 ? roundListing(price) : null;

  return {
    recommended_price: recommended,
    private_sale_value: recommended,
    ebay_listing_price: recommended,
    competitive_floor: competitiveFloor,
  };
}

function buildPriceSnapshot(data) {
  const recommended = data.recommended_price ?? resolveRecommendedPrice(data);
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
    recommended_price: recommended,
    private_sale_value: recommended,
    ebay_listing_price: recommended,
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
  resolveRecommendedPrice,
  soldSignal,
  realisticUsedPrice,
  realisticBnibPrice,
};
