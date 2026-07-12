const {
  getCredentials,
  getCatalogItem,
  getItemImage,
  getColor,
  getElementMapping,
} = require("./bricklink");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePartInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (/bricklink\.com/i.test(raw)) {
    try {
      const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      const q = url.searchParams.get("q");
      if (q?.trim()) return q.trim();
      const part = url.searchParams.get("P") || url.searchParams.get("p");
      if (part?.trim()) return part.trim();
    } catch {
      // Fall through to raw value.
    }
  }

  return raw;
}

function pickMappingEntry(mapping) {
  if (!mapping) return null;
  if (Array.isArray(mapping)) return mapping[0] || null;
  return mapping;
}

function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function brickLinkPartUrl(partNo, colorId) {
  const base = `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(partNo)}`;
  return colorId != null ? `${base}#T=C&C=${colorId}` : base;
}

function shouldTryElementLookup(partNum) {
  return /^\d{6,}$/.test(partNum);
}

async function buildPartResult({ pieceNumber, partNo, colorId, elementId = null }) {
  const item = await getCatalogItem("PART", partNo);
  let colorName = null;
  let imageUrl = null;

  if (colorId != null) {
    try {
      const color = await getColor(colorId);
      colorName = color.color_name || null;
    } catch {
      colorName = null;
    }
    try {
      const image = await getItemImage("PART", partNo, colorId);
      imageUrl = normalizeImageUrl(image.thumbnail_url || image.image_url);
    } catch {
      imageUrl = null;
    }
  }

  if (!imageUrl) {
    imageUrl = normalizeImageUrl(item.thumbnail_url || item.image_url);
  }

  const name = colorName ? `${colorName} ${item.name}` : item.name;

  return {
    piece_number: pieceNumber,
    bl_part_no: partNo,
    element_id: elementId,
    color_id: colorId,
    color_name: colorName,
    name,
    image_url: imageUrl,
    part_url: brickLinkPartUrl(partNo, colorId),
    error: null,
  };
}

async function lookupPartByElementId(elementId) {
  const mapping = pickMappingEntry(await getElementMapping(elementId));
  if (!mapping?.item?.no) {
    return null;
  }

  return buildPartResult({
    pieceNumber: elementId,
    partNo: mapping.item.no,
    colorId: mapping.color_id ?? null,
    elementId,
  });
}

async function lookupPartByNumber(partNo) {
  return buildPartResult({
    pieceNumber: partNo,
    partNo,
    colorId: null,
    elementId: null,
  });
}

async function lookupPart(pieceNumber) {
  const partNum = parsePartInput(pieceNumber);
  if (!partNum) {
    return {
      piece_number: "",
      name: null,
      image_url: null,
      part_url: null,
      error: "Part number required",
    };
  }

  if (!getCredentials()) {
    return {
      piece_number: partNum,
      name: null,
      image_url: null,
      part_url: null,
      error: "BrickLink API credentials not configured",
    };
  }

  try {
    if (shouldTryElementLookup(partNum)) {
      const byElement = await lookupPartByElementId(partNum);
      if (byElement) return byElement;
    }

    return await lookupPartByNumber(partNum);
  } catch (err) {
    const msg = err.message || "Lookup failed";
    const notFound = /not found|RESOURCE_NOT_FOUND|INVALID|no item/i.test(msg);
    return {
      piece_number: partNum,
      name: null,
      image_url: null,
      part_url: null,
      error: notFound ? "Part not found on BrickLink" : msg,
    };
  }
}

async function enrichMissingPieces(pieces) {
  if (!Array.isArray(pieces) || pieces.length === 0) return [];

  const enriched = [];
  for (const piece of pieces) {
    const details = await lookupPart(piece.piece_number);
    enriched.push({
      piece_number: piece.piece_number,
      bag: piece.bag || "",
      quantity: Math.max(1, parseInt(piece.quantity, 10) || 1),
      bl_part_no: details.bl_part_no || null,
      element_id: details.element_id || null,
      color_id: details.color_id ?? null,
      color_name: details.color_name || null,
      name: details.name,
      image_url: details.image_url,
      part_url: details.part_url,
      lookup_error: details.error,
    });
    await sleep(120);
  }
  return enriched;
}

module.exports = {
  lookupPart,
  enrichMissingPieces,
  parsePartInput,
};
