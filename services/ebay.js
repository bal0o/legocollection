const GBP_USD = 0.79;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function round(n) {
  return Math.round(n * 100) / 100;
}

function toGbp(usd) {
  if (usd == null || Number.isNaN(usd)) return null;
  return round(usd * GBP_USD);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPriceData(html) {
  return (
    html.includes("[eBay]") ||
    html.includes("Sold Listings") ||
    html.includes("Complete Price") ||
    html.includes('id="used_price"')
  );
}

async function fetchText(url, { retries = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await sleep(1200 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function findPriceChartingPage(setNumber) {
  const primaryUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(setNumber)}&type=prices`;
  const html = await fetchText(primaryUrl);
  if (hasPriceData(html)) {
    return { url: primaryUrl, html };
  }

  const fallbackUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(`lego ${setNumber}`)}&type=prices`;
  const fallbackHtml = await fetchText(fallbackUrl);
  if (hasPriceData(fallbackHtml)) {
    return { url: fallbackUrl, html: fallbackHtml };
  }

  return null;
}

function median(nums) {
  const sorted = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

function avg(nums) {
  const valid = nums.filter((n) => n > 0);
  if (valid.length === 0) return null;
  return round(valid.reduce((s, n) => s + n, 0) / valid.length);
}

function parseSummaryPrices(html) {
  const loose = html.match(/id="used_price"[\s\S]*?\$([\d.]+)/i);
  const complete = html.match(/id="complete_price"[\s\S]*?\$([\d.]+)/i);
  const sealed = html.match(/id="new_price"[\s\S]*?\$([\d.]+)/i);
  return {
    loose_usd: loose ? parseFloat(loose[1]) : null,
    complete_usd: complete ? parseFloat(complete[1]) : null,
    sealed_usd: sealed ? parseFloat(sealed[1]) : null,
  };
}

function parseSoldListings(html, limit = 30) {
  const sales = [];
  const rowRe =
    /(\d{4}-\d{2}-\d{2})[\s\S]*?\[eBay\][\s\S]*?<span class="js-price"[^>]*>\$([\d.]+)<\/span>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null && sales.length < limit) {
    const date = m[1];
    const priceUsd = parseFloat(m[2]);
    if (!Number.isFinite(priceUsd)) continue;
    const block = m[0];
    const titleMatch = block.match(/>\s*([^<]{10,200})\s*<\/a>\s*[\s\S]*?\[eBay\]/i);
    sales.push({
      date,
      title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "",
      price_usd: priceUsd,
      price_gbp: toGbp(priceUsd),
    });
  }
  return sales;
}

function pickConditionAvg(summary, condition) {
  const cond = (condition || "").toLowerCase();
  if (cond.includes("bnib")) return summary.sealed_usd;
  if (cond.includes("bagged")) return summary.complete_usd || summary.loose_usd;
  if (cond.includes("missing")) return summary.loose_usd;
  return summary.complete_usd || summary.loose_usd;
}

function buildEbayResult({ url, html }, condition) {
  const summary = parseSummaryPrices(html);
  const sales = parseSoldListings(html);
  const condUsd = pickConditionAvg(summary, condition);
  const salePrices = sales.map((s) => s.price_gbp);

  return {
    ebay_sold_avg: condUsd ? toGbp(condUsd) : avg(salePrices),
    ebay_sold_median: median(salePrices),
    ebay_sold_count: sales.length,
    ebay_sold_recent: sales.slice(0, 10),
    ebay_source: "pricecharting",
    ebay_error: null,
    ebay_url: url,
  };
}

async function fetchEbaySoldData(setNumber, condition) {
  const result = {
    ebay_sold_avg: null,
    ebay_sold_median: null,
    ebay_sold_count: 0,
    ebay_sold_recent: [],
    ebay_source: null,
    ebay_error: null,
    ebay_url: null,
  };

  try {
    const page = await findPriceChartingPage(setNumber);
    if (!page) {
      result.ebay_error = "No PriceCharting listing found";
      return result;
    }
    return buildEbayResult(page, condition);
  } catch (err) {
    result.ebay_error = err.message;
    return result;
  }
}

module.exports = {
  fetchEbaySoldData,
  toGbp,
  parseSoldListings,
  sleep,
};
