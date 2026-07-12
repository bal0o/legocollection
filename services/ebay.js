const GBP_USD = 0.79;

const CLONE_TITLE_PATTERNS = [
  /\blepin\b/i,
  /\blele\b/i,
  /\bdecool\b/i,
  /\bdogo\b/i,
  /\bxingbao\b/i,
  /\bxing bao\b/i,
  /\bsembo\b/i,
  /\bcogo\b/i,
  /\bbela\b/i,
  /\bkazi\b/i,
  /\bloz\b/i,
  /\bsluban\b/i,
  /\bwooma\b/i,
  /\bgego\b/i,
  /\bjiqings\b/i,
  /\bji qing\b/i,
  /\bmould king\b/i,
  /\bmold king\b/i,
  /\bmoc king\b/i,
  /\blinhi\b/i,
  /\blinhui\b/i,
  /\bquanguan\b/i,
  /\breobrix\b/i,
  /\bfake lego\b/i,
  /\bnot (?:genuine |real |original )?lego\b/i,
  /\bnon[- ]?lego\b/i,
  /\bunofficial\b/i,
  /\bclone\b/i,
  /\bknock[- ]?off\b/i,
  /\breplica\b/i,
  /\bcounterfeit\b/i,
  /\bimitation\b/i,
  /\bcompatible with lego\b/i,
  /\blego compatible\b/i,
  /\blego style\b/i,
  /\blego type\b/i,
  /\bfits lego\b/i,
  /\blike lego\b/i,
  /\bgeneric bricks?\b/i,
  /\boff[- ]brand\b/i,
  /\balternative to lego\b/i,
  /\bbuilding blocks only\b/i,
];

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

function isPartialListing(title) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (!text) return false;

  if (
    /\binstructions?\s+only\b/i.test(text) ||
    /\binstruction\s+manual\b/i.test(text) ||
    /\bmanual\s+only\b/i.test(text) ||
    /\bbox\s+only\b/i.test(text) ||
    /\bparts?\s+only\b/i.test(text) ||
    /\bminifigs?\s+only\b/i.test(text) ||
    /\bfigures?\s+only\b/i.test(text) ||
    /\bsticker/i.test(text) ||
    /\bbooklet\s+only\b/i.test(text) ||
    /\binstructions?\s*\/\s*instruction/i.test(text) ||
    /\bno\s+(?:bricks|pieces)\b/i.test(text) ||
    /\bbricks?\s+not\s+included\b/i.test(text)
  ) {
    return true;
  }

  // Minifig-only listings often mention figs without complete/built/pieces.
  if (
    /\b(?:minifig|figure|figs?)\b/i.test(text) &&
    !/\b(?:complete|built|pieces|pcs|set|ucs|\d{3,4}\s*pieces)\b/i.test(text)
  ) {
    return true;
  }

  return false;
}

function isCloneListing(title) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return CLONE_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

function filterAuthenticListings(listings, setNumber) {
  return listings.filter((listing) => {
    if (isCloneListing(listing.title)) return false;
    if (isPartialListing(listing.title)) return false;
    const title = String(listing.title || "").toLowerCase();
    if (!/\blego\b/.test(title)) return false;
    if (setNumber && title.includes(String(setNumber))) return true;
    return false;
  });
}

function ebaySearchQuery(setNumber) {
  const excludes = ["lepin", "decool", "mould", "moldking", "linhi", "compatible", "replica", "clone"];
  const negative = excludes.map((term) => `-${term}`).join(" ");
  return encodeURIComponent(`lego ${setNumber} ${negative}`);
}

function hasPriceData(html) {
  return (
    html.includes("[eBay]") ||
    html.includes("Sold Listings") ||
    html.includes("Complete Price") ||
    html.includes('id="used_price"')
  );
}

async function fetchText(url, { retries = 4, fastFailStatuses = [] } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(fastFailStatuses.length ? 10000 : 25000),
      });
      if (fastFailStatuses.includes(res.status)) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
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

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseSoldListings(html, limit = 30) {
  const sales = [];
  const rows = html.split(/<tr\b/i);

  for (const row of rows) {
    if (!row.includes("js-ebay-completed-sale")) continue;

    const date = row.match(/<td class="date">(\d{4}-\d{2}-\d{2})<\/td>/i)?.[1] || null;
    const title = decodeHtml(
      row.match(/class="js-ebay-completed-sale"[^>]*href="[^"]*"[^>]*>\s*([^<]+)<\/a>/i)?.[1] || ""
    )
      .replace(/\s+/g, " ")
      .trim();
    const priceUsd = parseFloat(row.match(/<span class="js-price"[^>]*>\s*\$([\d.]+)/i)?.[1] || "");

    if (!Number.isFinite(priceUsd) || !title) continue;
    sales.push({
      date,
      title,
      price_usd: priceUsd,
      price_gbp: toGbp(priceUsd),
    });
    if (sales.length >= limit * 3) break;
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

function buildEbayResult({ url, html }, condition, setNumber) {
  const summary = parseSummaryPrices(html);
  const allSales = parseSoldListings(html, 100);
  const sales = filterAuthenticListings(allSales, setNumber);
  const salePrices = sales.map((s) => s.price_gbp).filter((p) => p > 0);
  const condUsd = pickConditionAvg(summary, condition);
  const summaryGbp = condUsd ? toGbp(condUsd) : null;

  // PriceCharting's condition summary is more reliable than averaging raw sales,
  // which mix in instructions-only, box-only, and minifig listings.
  const filteredMedian = median(salePrices);
  let ebaySoldAvg = summaryGbp;
  let ebaySoldMedian = summaryGbp;

  if (salePrices.length >= 5 && summaryGbp && filteredMedian) {
    const ratio = filteredMedian / summaryGbp;
    // If filtered complete-set sales broadly agree with the summary, nudge toward them.
    if (ratio >= 0.75 && ratio <= 1.25) {
      ebaySoldAvg = round(filteredMedian * 0.35 + summaryGbp * 0.65);
      ebaySoldMedian = round(filteredMedian * 0.25 + summaryGbp * 0.75);
    }
  } else if (!summaryGbp && salePrices.length > 0) {
    ebaySoldAvg = salePrices.length >= 3 ? avg(salePrices) : median(salePrices);
    ebaySoldMedian = median(salePrices) ?? ebaySoldAvg;
  }

  return {
    ebay_sold_avg: ebaySoldAvg,
    ebay_sold_median: ebaySoldMedian,
    ebay_sold_count: sales.length,
    ebay_sold_recent: sales.slice(0, 10),
    ebay_source: "pricecharting",
    ebay_error: sales.length === 0 && !summaryGbp ? "No authentic LEGO eBay sales found" : null,
    ebay_url: url,
  };
}

function parseActiveListings(html) {
  const listings = [];
  const chunks = html.split(/s-item__wrapper/i).slice(1);

  for (const chunk of chunks) {
    const title =
      chunk.match(/s-item__title[\s\S]*?<(?:span|div)[^>]*>([^<]+)/i)?.[1] ||
      chunk.match(/class="[^"]*s-item__title[^"]*"[^>]*>([^<]+)/i)?.[1];
    const priceMatch =
      chunk.match(/s-item__price[^>]*>\s*£([\d,.]+)/i) ||
      chunk.match(/s-item__price[^>]*>[\s\S]*?£([\d,.]+)/i);

    if (!title || !priceMatch) continue;

    const price = parseFloat(String(priceMatch[1]).replace(/,/g, ""));
    if (!Number.isFinite(price) || price < 10 || price > 5000) continue;

    listings.push({
      title: title.replace(/\s+/g, " ").trim(),
      price,
    });
  }

  if (listings.length > 0) return listings;

  const prices = [];
  const patterns = [
    /s-item__price[^>]*>\s*£([\d,.]+)/gi,
    /"price":\s*"([\d.]+)"/gi,
    /"priceValue":\s*([\d.]+)/gi,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const n = parseFloat(String(m[1]).replace(",", ""));
      if (Number.isFinite(n) && n >= 10 && n <= 5000) prices.push(n);
    }
  }

  return [...new Set(prices)].map((price) => ({ title: "", price }));
}

function parseActiveListingPrices(html, setNumber) {
  const listings = filterAuthenticListings(parseActiveListings(html), setNumber);
  return listings.map((listing) => listing.price);
}

async function fetchEbayActiveAsks(setNumber) {
  const result = {
    ebay_ask_min: null,
    ebay_ask_median: null,
    ebay_ask_avg: null,
    ebay_ask_count: 0,
    ebay_ask_error: null,
  };

  const url = `https://www.ebay.co.uk/sch/i.html?_nkw=${ebaySearchQuery(setNumber)}&LH_BIN=1&_sop=15&rt=nc&_dcat=19006`;

  try {
    const html = await fetchText(url, { retries: 1, fastFailStatuses: [403, 503] });
    const prices = parseActiveListingPrices(html, setNumber);
    if (prices.length === 0) {
      result.ebay_ask_error = "No active eBay listings found";
      return result;
    }

    result.ebay_ask_min = Math.min(...prices);
    result.ebay_ask_median = median(prices);
    result.ebay_ask_avg = avg(prices);
    result.ebay_ask_count = prices.length;
    return result;
  } catch (err) {
    result.ebay_ask_error = err.message;
    return result;
  }
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
    return buildEbayResult(page, condition, setNumber);
  } catch (err) {
    result.ebay_error = err.message;
    return result;
  }
}

module.exports = {
  fetchEbaySoldData,
  fetchEbayActiveAsks,
  isCloneListing,
  isPartialListing,
  filterAuthenticListings,
  parseSoldListings,
  parseActiveListingPrices,
  toGbp,
  sleep,
};
