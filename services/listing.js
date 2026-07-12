function roundListing(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.ceil(n / 5) * 5;
}

const CONDITION_DESCRIPTIONS = {
  BNIB: "BNIB — unbuilt, still factory sealed as received from LEGO.",
  "Complete, bagged":
    "Complete, bagged — all pieces present, repacked into the original numbered bags for re-assembly. Instructions included.",
  "Complete, dismantled":
    "Complete, dismantled — all pieces present, stored in non-numbered bags. Instructions included.",
  "Missing piece": "Incomplete set — missing pieces are listed below and are not included in the sale.",
};

function conditionDetail(condition, missingPieces = []) {
  const c = (condition || "").toLowerCase();
  const missing = Array.isArray(missingPieces) ? missingPieces : [];

  if (c.includes("bnib")) return CONDITION_DESCRIPTIONS.BNIB;
  if (c.includes("bagged")) return CONDITION_DESCRIPTIONS["Complete, bagged"];
  if (c.includes("missing") || missing.length > 0) {
    if (missing.length > 0) {
      const count = missingPiecesCount(missing);
      return `Incomplete — ${count} missing piece${count === 1 ? "" : "s"} (not included), listed below.`;
    }
    return "Incomplete set — missing pieces not included.";
  }
  return CONDITION_DESCRIPTIONS["Complete, dismantled"];
}

function missingPiecesCount(pieces = []) {
  if (!Array.isArray(pieces) || pieces.length === 0) return 0;
  return pieces.reduce((sum, piece) => sum + Math.max(1, parseInt(piece.quantity, 10) || 1), 0);
}

function formatMissingPieceLine(piece) {
  const label = piece.name || piece.piece_number;
  const qty = Math.max(1, parseInt(piece.quantity, 10) || 1);
  const qtyLabel = qty > 1 ? ` ×${qty}` : "";
  const bag = piece.bag ? ` (Bag ${piece.bag})` : "";
  return `- Part ${piece.piece_number}: ${label}${qtyLabel}${bag}`;
}

function generateListingText(set) {
  const num = set.set_number;
  const name = set.description || `Set ${num}`;
  const missing = Array.isArray(set.missing_pieces) ? set.missing_pieces : [];
  const lines = [
    `LEGO ${num} — ${name}`,
    "",
    conditionDetail(set.condition, missing),
    "",
  ];

  if (missing.length > 0) {
    lines.push("Missing pieces (not included):");
    for (const piece of missing) {
      lines.push(formatMissingPieceLine(piece));
    }
    lines.push("");
  }

  if (set.release_year) lines.push(`Released: ${set.release_year}`);
  if (set.uk_rrp) lines.push(`Original RRP: £${Number(set.uk_rrp).toFixed(2)}`);
  if (set.retirement_status) lines.push(`Availability: ${set.retirement_status}`);

  lines.push(
    "",
    "Prices are based on BrickLink sold and listing data, eBay sold prices, and UK RRP where relevant. " +
      "Only offers very close to the asking price will be considered — the price is already fair.",
    "",
    "From a smoke-free, adult-owned collection.",
    "Happy to send more photos on request.",
    "",
    `#LEGO #LEGO${num} #LEGOforsale`
  );

  return lines.filter((l) => l !== "").join("\n");
}

function setImageUrl(set) {
  if (set.image_url) return set.image_url;
  return `https://images.brickset.com/sets/images/${set.set_number}-1.jpg`;
}

module.exports = {
  roundListing,
  generateListingText,
  setImageUrl,
  conditionDetail,
  CONDITION_DESCRIPTIONS,
  missingPiecesCount,
};
