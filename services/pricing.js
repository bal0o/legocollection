const { getSetPrices } = require("./bricklink");
const { fetchEbaySoldData } = require("./ebay");
const {
  suggestListingPrices,
  buildPriceSnapshot,
  appendPriceHistory,
} = require("./marketplaces");
const { generateListingText } = require("./listing");
const GBP_USD = 0.79;
const GBP_EUR = 0.86;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function toGbp(amount, currency = "USD") {
  if (amount == null || Number.isNaN(amount)) return null;
  if (currency === "GBP") return round(amount);
  if (currency === "EUR") return round(amount * GBP_EUR);
  return round(amount * GBP_USD);
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function parseMoney(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/[£$€,\s]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSetNumber(input) {
  const s = String(input || "").trim();
  const match = s.match(/(\d{4,6})/);
  return match ? match[1] : s;
}

async function fetchRebrickableSet(setNumber, apiKey) {
  if (!apiKey) return null;
  const variants = [`${setNumber}-1`, `${setNumber}-2`, setNumber];
  for (const setNum of variants) {
    try {
      const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`, {
        headers: { Authorization: `key ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return {
        set_number: data.set_num.split("-")[0],
        set_num: data.set_num,
        name: data.name,
        year: data.year,
        num_parts: data.num_parts,
        image_url: data.set_img_url || null,
        slug: slugify(data.name),
        source: "rebrickable",
      };
    } catch {
      /* try next variant */
    }
  }
  return null;
}

async function lookupSetMetadata(setNumber) {
  const num = normalizeSetNumber(setNumber);
  const apiKey = process.env.REBRICKABLE_API_KEY;

  const [rb, be] = await Promise.allSettled([
    fetchRebrickableSet(num, apiKey),
    searchBrickEconomy(num),
  ]);

  const rbData = rb.status === "fulfilled" ? rb.value : null;
  const beResults = be.status === "fulfilled" ? be.value : [];
  const beHit = beResults.find((r) => r.set_number === num);

  if (!rbData && !beHit) return null;

  return {
    set_number: num,
    set_num: rbData?.set_num || beHit?.set_num || `${num}-1`,
    name: rbData?.name || beHit?.name || `Set ${num}`,
    description: rbData?.name || beHit?.name || `Set ${num}`,
    year: rbData?.year || beHit?.year || null,
    num_parts: rbData?.num_parts || null,
    image_url: rbData?.image_url || null,
    slug: beHit?.slug || rbData?.slug || slugify(rbData?.name || beHit?.name || num),
    source: rbData ? "rebrickable" : "brickeconomy",
  };
}

async function searchRebrickable(query, apiKey) {
  if (!apiKey) return [];
  const url = `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(query)}&page_size=10`;
  const res = await fetch(url, {
    headers: { Authorization: `key ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((s) => ({
    set_number: s.set_num.split("-")[0],
    set_num: s.set_num,
    name: s.name,
    year: s.year,
    num_parts: s.num_parts,
    theme: s.theme_id,
    source: "rebrickable",
  }));
}

async function searchBrickEconomy(query) {
  const html = await fetchText(`https://www.brickeconomy.com/search?q=${encodeURIComponent(query)}`);
  const results = [];
  const linkRe = /href="\/set\/(\d+)-1\/([^"]+)"[^>]*>[\s\S]*?<[^>]+>([^<]+)</gi;
  let m;
  const seen = new Set();
  while ((m = linkRe.exec(html)) !== null && results.length < 10) {
    const num = m[1];
    if (seen.has(num)) continue;
    seen.add(num);
    results.push({
      set_number: num,
      set_num: `${num}-1`,
      name: m[3].trim(),
      slug: m[2],
      source: "brickeconomy",
    });
  }

  if (results.length === 0) {
    const numMatch = query.match(/\d{4,5}/);
    if (numMatch) {
      results.push({
        set_number: numMatch[0],
        set_num: `${numMatch[0]}-1`,
        name: `Set ${numMatch[0]}`,
        source: "manual",
      });
    }
  }
  return results;
}

async function searchSets(query) {
  const apiKey = process.env.REBRICKABLE_API_KEY;
  const [rb, be] = await Promise.allSettled([
    searchRebrickable(query, apiKey),
    searchBrickEconomy(query),
  ]);

  const rbResults = rb.status === "fulfilled" ? rb.value : [];
  const beResults = be.status === "fulfilled" ? be.value : [];
  const merged = new Map();

  for (const r of [...rbResults, ...beResults]) {
    const key = r.set_number;
    if (!merged.has(key)) {
      merged.set(key, r);
    } else {
      const existing = merged.get(key);
      merged.set(key, {
        ...existing,
        name: existing.name || r.name,
        year: existing.year || r.year,
        slug: existing.slug || r.slug,
      });
    }
  }
  return [...merged.values()];
}

async function fetchBrickLinkPrices(setNumber) {
  try {
    return await getSetPrices(setNumber);
  } catch (err) {
    return { bl_used_avg: null, bl_sealed_avg: null, source_bl: false, bl_error: err.message };
  }
}

async function fetchBrickEconomyDetails(setNumber, slugHint) {
  let slug = slugHint;
  if (!slug) {
    const results = await searchBrickEconomy(setNumber);
    slug = results.find((r) => r.set_number === setNumber)?.slug;
  }
  if (!slug) {
    slug = `lego-set-${setNumber}`;
  }

  const urls = [
    `https://www.brickeconomy.com/set/${setNumber}-1/${slug}`,
  ];

  let html = null;
  for (const url of urls) {
    try {
      html = await fetchText(url);
      if (html.includes("Set Details") || html.includes("Set Pricing")) break;
    } catch {
      /* try next */
    }
  }

  if (!html) {
    const searchResults = await searchBrickEconomy(setNumber);
    const hit = searchResults.find((r) => r.set_number === setNumber);
    if (hit?.slug) {
      html = await fetchText(`https://www.brickeconomy.com/set/${setNumber}-1/${hit.slug}`);
    }
  }

  if (!html) return null;

  const ukRrp = html.match(/United Kingdom[\s\S]*?£([\d.]+)/i);
  const year = html.match(/Year[\s\S]*?(\d{4})/i);
  const usedUsd = html.match(/Used[\s\S]*?Value[\s\S]*?\$([\d,.]+)/i);
  const sealedUsd = html.match(/New\/Sealed[\s\S]*?Value[\s\S]*?\$([\d,.]+)/i);
  const marketUsd = html.match(/Market price[\s\S]*?\$([\d,.]+)/i);
  const retailUsd = html.match(/Retail price[\s\S]*?\$([\d,.]+)/i);

  let retirement_status = null;
  if (/Availability[\s\S]*?Retired/i.test(html)) retirement_status = "Retired";
  else if (/Available at retail/i.test(html)) retirement_status = "Available at Retail";
  else if (/Exclusive/i.test(html)) retirement_status = "Exclusive (Retail)";

  const retiredDate = html.match(/Retired[\s\S]*?(\w+ \d{4})/i);

  const nameMatch = html.match(/<title>LEGO \d+[^|]*\| BrickEconomy<\/title>/i);
  let name = `Set ${setNumber}`;
  const h1 = html.match(/Name[\s\S]*?>([^<]+)</i);
  if (h1) name = h1[1].trim();

  const stillAtRetail = retirement_status === "Available at Retail" || retirement_status === "Exclusive (Retail)";

  return {
    description: name,
    uk_rrp: ukRrp ? parseFloat(ukRrp[1]) : null,
    release_year: year ? parseInt(year[1], 10) : null,
    retirement_status,
    retirement_date: retiredDate?.[1] || null,
    bl_used_avg: usedUsd ? toGbp(parseMoney(usedUsd[1])) : null,
    bl_sealed_avg: sealedUsd ? toGbp(parseMoney(sealedUsd[1])) : marketUsd ? toGbp(parseMoney(marketUsd[1])) : null,
    uk_retail_price: stillAtRetail && ukRrp ? parseFloat(ukRrp[1]) : null,
    prices_refreshed_at: new Date().toISOString(),
    source_be: true,
  };
}

function estimateValues(data, condition) {
  return suggestListingPrices(data, condition);
}

function ratingFromData(data) {
  const rrp = data.uk_rrp;
  const sealed = data.bl_sealed_avg;
  const used = data.bl_used_avg;
  if (!rrp || rrp <= 0) {
    if (sealed && sealed > 50) return "Excellent";
    return "Good";
  }
  const sealedGrowth = sealed ? (sealed - rrp) / rrp : 0;
  const usedGrowth = used ? (used - rrp) / rrp : 0;
  const growth = Math.max(sealedGrowth, usedGrowth);
  if (growth >= 0.5) return "Excellent";
  if (growth >= 0.15) return "Good";
  if (growth >= -0.1) return "Average";
  return "Poor";
}

async function fetchPricing(setNumber, condition, slugHint, existingHistory = []) {
  const num = normalizeSetNumber(setNumber);
  const [meta, be, bl, ebay] = await Promise.allSettled([
    lookupSetMetadata(num),
    fetchBrickEconomyDetails(num, slugHint),
    fetchBrickLinkPrices(num),
    fetchEbaySoldData(num, condition),
  ]);

  const metaData = meta.status === "fulfilled" ? meta.value : null;
  const beData = be.status === "fulfilled" ? be.value : {};
  const blData = bl.status === "fulfilled" ? bl.value : {};
  const ebayData = ebay.status === "fulfilled" ? ebay.value : {};
  const slug = slugHint || metaData?.slug || beData?.slug;

  const merged = {
    set_number: num,
    condition: condition || "Complete, dismantled",
    description: metaData?.name || beData?.description || `Set ${num}`,
    release_year: metaData?.year || beData?.release_year || null,
    slug,
    ...beData,
    description: metaData?.name || beData?.description || `Set ${num}`,
    bl_used_avg: blData.bl_used_avg ?? beData?.bl_used_avg ?? null,
    bl_sealed_avg: blData.bl_sealed_avg ?? beData?.bl_sealed_avg ?? null,
    image_url: metaData?.image_url || null,
    num_parts: metaData?.num_parts || null,
    ...ebayData,
    prices_refreshed_at: new Date().toISOString(),
    notes: [
      metaData?.source === "rebrickable" ? "Rebrickable" : null,
      blData?.source_bl ? "BrickLink API (6mo sold, GBP)" : blData?.bl_error ? `BrickLink: ${blData.bl_error}` : null,
      ebayData?.ebay_source ? `eBay sold via ${ebayData.ebay_source}` : ebayData?.ebay_error ? `eBay: ${ebayData.ebay_error}` : null,
      beData?.source_be ? "BrickEconomy metadata" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Auto-fetched",
  };

  const estimates = suggestListingPrices(merged, condition);
  merged.investment_rating = ratingFromData(merged);
  const snapshot = buildPriceSnapshot({ ...merged, ...estimates });
  merged.price_history = appendPriceHistory(existingHistory, snapshot);
  const withEstimates = { ...merged, ...estimates };
  withEstimates.listing_text = generateListingText(withEstimates);

  return withEstimates;
}

module.exports = {
  searchSets,
  lookupSetMetadata,
  normalizeSetNumber,
  fetchPricing,
  estimateValues,
  toGbp,
};
