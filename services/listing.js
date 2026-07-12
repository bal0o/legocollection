function roundListing(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.ceil(n / 5) * 5;
}

function conditionDetail(condition) {
  const c = (condition || "").toLowerCase();
  if (c.includes("bnib")) return "Brand new, sealed in box (BNIB). Never opened.";
  if (c.includes("bagged")) return "Complete with all pieces, bagged by set. Instructions included.";
  if (c.includes("missing")) return "Mostly complete — see description for any missing pieces.";
  return "Complete with all pieces and instructions. Dismantled and bagged.";
}

function generateListingText(set) {
  const num = set.set_number;
  const name = set.description || `Set ${num}`;
  const lines = [
    `LEGO ${num} — ${name}`,
    "",
    conditionDetail(set.condition),
    "",
  ];

  if (set.release_year) lines.push(`Released: ${set.release_year}`);
  if (set.uk_rrp) lines.push(`Original RRP: £${Number(set.uk_rrp).toFixed(2)}`);
  if (set.retirement_status) lines.push(`Availability: ${set.retirement_status}`);

  lines.push(
    "",
    "Prices are based on averages from various market sources (BrickLink, eBay sold, etc.). " +
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
};
