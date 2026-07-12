function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePartNumber(input) {
  return String(input || "").trim();
}

async function lookupPart(pieceNumber) {
  const partNum = normalizePartNumber(pieceNumber);
  if (!partNum) {
    return { piece_number: "", name: null, image_url: null, part_url: null, error: "Part number required" };
  }

  const apiKey = process.env.REBRICKABLE_API_KEY;
  if (!apiKey) {
    return {
      piece_number: partNum,
      name: null,
      image_url: null,
      part_url: null,
      error: "Rebrickable API key not configured",
    };
  }

  try {
    const res = await fetch(
      `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(partNum)}/`,
      {
        headers: { Authorization: `key ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) {
      return {
        piece_number: partNum,
        name: null,
        image_url: null,
        part_url: null,
        error: res.status === 404 ? "Part not found" : `Lookup failed (${res.status})`,
      };
    }
    const data = await res.json();
    return {
      piece_number: data.part_num || partNum,
      name: data.name || null,
      image_url: data.part_img_url || null,
      part_url: data.part_url || null,
      error: null,
    };
  } catch (err) {
    return {
      piece_number: partNum,
      name: null,
      image_url: null,
      part_url: null,
      error: err.message,
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
  normalizePartNumber,
};
