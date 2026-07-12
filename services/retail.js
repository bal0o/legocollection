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

function parseGbp(value) {
  if (value == null) return null;
  const n = parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function mapBricksetAvailability(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (t === "retired") return "Retired";
  if (t.includes("promotional")) return "Promotional";
  if (t.includes("exclusive")) return "Exclusive (Retail)";
  if (t.includes("retail")) return "Available at Retail";
  return text.trim();
}

function isAtRetail(status) {
  return (status || "").includes("Retail");
}

async function fetchBricksetRetail(setNumber) {
  const num = String(setNumber).trim();
  const html = await fetchText(`https://brickset.com/sets/${num}-1`);

  const rrp = html.match(/<dt>RRP<\/dt>\s*<dd>\s*£\s*([\d,.]+)/i);
  const year = html.match(/<dt>Year released<\/dt>\s*<dd>[\s\S]*?(\d{4})/i);
  const avail = html.match(/<dt>Availability<\/dt>\s*<dd>([^<]+)/i);
  const retired = html.match(/<dt>Date retired<\/dt>\s*<dd>([^<]+)/i);

  const uk_rrp = parseGbp(rrp?.[1]);
  const retirement_status = mapBricksetAvailability(avail?.[1]);

  return {
    uk_rrp,
    release_year: year ? parseInt(year[1], 10) : null,
    retirement_status,
    retirement_date: retired?.[1]?.trim() || null,
    uk_retail_price: uk_rrp && isAtRetail(retirement_status) ? uk_rrp : null,
    source_retail: "brickset",
  };
}

function parseBrickEconomyRetail(html) {
  if (!html) return {};

  const ukRrp =
    html.match(/<dt>\s*United Kingdom\s*<\/dt>\s*<dd>\s*£\s*([\d,.]+)/i) ||
    html.match(/United Kingdom[\s\S]{0,120}?£\s*([\d,.]+)/i) ||
    html.match(/UK RRP[\s\S]{0,80}?£\s*([\d,.]+)/i);

  const year = html.match(/Year[\s\S]*?(\d{4})/i);
  let retirement_status = null;
  if (/Availability[\s\S]*?Retired/i.test(html)) retirement_status = "Retired";
  else if (/Available at retail/i.test(html)) retirement_status = "Available at Retail";
  else if (/Exclusive/i.test(html)) retirement_status = "Exclusive (Retail)";

  const retiredDate = html.match(/Retired[\s\S]*?(\w+ \d{4})/i);
  const h1 = html.match(/Name[\s\S]*?>([^<]+)</i);
  const uk_rrp = parseGbp(ukRrp?.[1]);
  const stillAtRetail = isAtRetail(retirement_status);

  return {
    description: h1?.[1]?.trim() || null,
    uk_rrp,
    release_year: year ? parseInt(year[1], 10) : null,
    retirement_status,
    retirement_date: retiredDate?.[1] || null,
    uk_retail_price: stillAtRetail && uk_rrp ? uk_rrp : null,
    source_be: true,
  };
}

async function fetchRetailDetails(setNumber, brickEconomyHtml = null) {
  const fromBe = brickEconomyHtml ? parseBrickEconomyRetail(brickEconomyHtml) : {};

  if (fromBe.uk_rrp) {
    return { ...fromBe, source_retail: "brickeconomy" };
  }

  try {
    const fromBrickset = await fetchBricksetRetail(setNumber);
    return {
      ...fromBe,
      uk_rrp: fromBe.uk_rrp ?? fromBrickset.uk_rrp,
      release_year: fromBe.release_year ?? fromBrickset.release_year,
      retirement_status: fromBe.retirement_status ?? fromBrickset.retirement_status,
      retirement_date: fromBe.retirement_date ?? fromBrickset.retirement_date,
      uk_retail_price: fromBe.uk_retail_price ?? fromBrickset.uk_retail_price,
      source_retail: fromBrickset.uk_rrp ? "brickset" : fromBe.source_be ? "brickeconomy" : null,
    };
  } catch {
    return { ...fromBe, source_retail: fromBe.source_be ? "brickeconomy" : null };
  }
}

function preserveRetailFields(merged, existing = {}) {
  if (!merged.uk_rrp && existing.uk_rrp) merged.uk_rrp = existing.uk_rrp;
  if (!merged.uk_retail_price && existing.uk_retail_price) merged.uk_retail_price = existing.uk_retail_price;
  if (!merged.release_year && existing.release_year) merged.release_year = existing.release_year;
  if (!merged.retirement_status && existing.retirement_status) {
    merged.retirement_status = existing.retirement_status;
  }
  if (!merged.retirement_date && existing.retirement_date) {
    merged.retirement_date = existing.retirement_date;
  }
  return merged;
}

module.exports = {
  fetchBricksetRetail,
  fetchRetailDetails,
  preserveRetailFields,
  parseBrickEconomyRetail,
  parseGbp,
};
