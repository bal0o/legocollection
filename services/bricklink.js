const crypto = require("crypto");

const BASE_URL = "https://api.bricklink.com/api/store/v1";

function getCredentials() {
  const consumerKey = process.env.BRICKLINK_CONSUMER_KEY;
  const consumerSecret = process.env.BRICKLINK_CONSUMER_SECRET;
  const token = process.env.BRICKLINK_TOKEN;
  const tokenSecret = process.env.BRICKLINK_TOKEN_SECRET;
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) return null;
  return { consumerKey, consumerSecret, token, tokenSecret };
}

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildAuthHeader(method, url, creds) {
  const parsed = new URL(url);
  const oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.token,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_version: "1.0",
  };

  const params = { ...oauth };
  for (const [key, val] of parsed.searchParams.entries()) {
    params[key] = val;
  }

  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(`${parsed.origin}${parsed.pathname}`),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.tokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  oauth.oauth_signature = signature;

  const header =
    'OAuth realm="", ' +
    Object.entries(oauth)
      .map(([k, v]) => `${k}="${percentEncode(v)}"`)
      .join(", ");

  return header;
}

async function brickLinkRequest(path, query = {}) {
  const creds = getCredentials();
  if (!creds) throw new Error("BrickLink API credentials not configured");

  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;
  const auth = buildAuthHeader("GET", url, creds);

  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });

  const body = await res.json();
  if (!res.ok || body.meta?.code >= 400) {
    const msg = body.meta?.message || `BrickLink API error ${res.status}`;
    const detail = body.meta?.description ? `: ${body.meta.description}` : "";
    throw new Error(`${msg}${detail}`);
  }
  return body.data;
}

function normalizeSetNo(setNumber) {
  const num = String(setNumber).trim();
  return num.includes("-") ? num : `${num}-1`;
}

async function getPriceGuide(setNumber, { newOrUsed = "U", guideType = "sold", countryCode, currencyCode = "GBP", region } = {}) {
  const itemNo = normalizeSetNo(setNumber);
  const query = {
    guide_type: guideType,
    new_or_used: newOrUsed,
    currency_code: currencyCode,
  };
  if (countryCode) query.country_code = countryCode;
  if (region) query.region = region;

  const data = await brickLinkRequest(`/items/SET/${itemNo}/price`, query);

  const avg = parseFloat(data.avg_price);
  const qtyAvg = parseFloat(data.qty_avg_price);
  const raw = Number.isFinite(qtyAvg) && qtyAvg > 0 ? qtyAvg : Number.isFinite(avg) && avg > 0 ? avg : null;
  const price = raw != null ? Math.round(raw * 100) / 100 : null;

  return {
    price,
    min_price: parseFloat(data.min_price) || null,
    max_price: parseFloat(data.max_price) || null,
    unit_quantity: data.unit_quantity ?? null,
    currency_code: data.currency_code || currencyCode,
  };
}

const validPrice = (p) => p != null && p > 0;

async function getSetPrices(setNumber) {
  // Prefer UK sales; fall back to Europe then global if sparse
  const attempts = [{ countryCode: "GB" }, { region: "europe" }, {}];

  let usedSold = null;
  let sealedSold = null;
  let usedStock = null;
  let sealedStock = null;

  const needsMore = () =>
    !validPrice(usedSold?.price) ||
    !validPrice(sealedSold?.price) ||
    !validPrice(usedStock?.price) ||
    !validPrice(sealedStock?.price);

  for (const opts of attempts) {
    const fetches = [];
    if (!validPrice(usedSold?.price)) {
      fetches.push(
        getPriceGuide(setNumber, { newOrUsed: "U", guideType: "sold", ...opts }).then((r) => {
          usedSold = r;
        })
      );
    }
    if (!validPrice(sealedSold?.price)) {
      fetches.push(
        getPriceGuide(setNumber, { newOrUsed: "N", guideType: "sold", ...opts }).then((r) => {
          sealedSold = r;
        })
      );
    }
    if (!validPrice(usedStock?.price)) {
      fetches.push(
        getPriceGuide(setNumber, { newOrUsed: "U", guideType: "stock", ...opts }).then((r) => {
          usedStock = r;
        })
      );
    }
    if (!validPrice(sealedStock?.price)) {
      fetches.push(
        getPriceGuide(setNumber, { newOrUsed: "N", guideType: "stock", ...opts }).then((r) => {
          sealedStock = r;
        })
      );
    }
    if (fetches.length) await Promise.all(fetches);
    if (!needsMore()) break;
  }

  const stockMin = (guide) =>
    guide?.min_price > 0 ? Math.round(guide.min_price * 100) / 100 : null;

  return {
    bl_used_avg: validPrice(usedSold?.price) ? usedSold.price : null,
    bl_sealed_avg: validPrice(sealedSold?.price) ? sealedSold.price : null,
    bl_used_stock_avg: validPrice(usedStock?.price) ? usedStock.price : null,
    bl_used_stock_min: stockMin(usedStock),
    bl_sealed_stock_avg: validPrice(sealedStock?.price) ? sealedStock.price : null,
    bl_sealed_stock_min: stockMin(sealedStock),
    bl_used_detail: usedSold,
    bl_sealed_detail: sealedSold,
    bl_used_stock_detail: usedStock,
    bl_sealed_stock_detail: sealedStock,
    source_bl:
      validPrice(usedSold?.price) ||
      validPrice(sealedSold?.price) ||
      validPrice(usedStock?.price) ||
      validPrice(sealedStock?.price),
  };
}

async function getCatalogItem(type, itemNo) {
  return brickLinkRequest(`/items/${type}/${encodeURIComponent(itemNo)}`);
}

async function getItemImage(type, itemNo, colorId) {
  return brickLinkRequest(`/items/${type}/${encodeURIComponent(itemNo)}/images/${colorId}`);
}

async function getColor(colorId) {
  return brickLinkRequest(`/colors/${colorId}`);
}

async function getElementMapping(elementId) {
  return brickLinkRequest(`/item_mapping/${encodeURIComponent(elementId)}`);
}

module.exports = {
  getCredentials,
  getSetPrices,
  getPriceGuide,
  getCatalogItem,
  getItemImage,
  getColor,
  getElementMapping,
};
