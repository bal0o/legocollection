const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const store = require("../db/database");

const CSV_PATH =
  process.env.IMPORT_CSV_PATH ||
  path.join(__dirname, "..", "..", "lego_collection_valuation.csv");

function parseGbp(val) {
  if (!val || val === "GWP" || val.startsWith("N/A")) return null;
  return parseFloat(String(val).replace(/[£,\s]/g, "")) || null;
}

function parsePct(val) {
  if (!val || val.startsWith("N/A")) return null;
  return parseFloat(String(val).replace(/%/g, ""));
}

function importCsv(filePath = CSV_PATH) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const rows = parse(content, { columns: true, skip_empty_lines: true, bom: true });
  let imported = 0;
  let skipped = 0;

  const insertMany = store.db.transaction((records) => {
    for (const row of records) {
      const setNumber = row["Set Number"]?.trim();
      if (!setNumber) continue;

      if (store.getSetByNumber(setNumber)) {
        skipped++;
        continue;
      }

      const rrpRaw = row["Original UK RRP"];
      store.createSet({
        set_number: setNumber,
        description: row["Description"] || "",
        uk_rrp: rrpRaw === "GWP" ? null : parseGbp(rrpRaw),
        release_year: parseInt(row["Release Year"], 10) || null,
        retirement_status: row["Retirement Status"] || null,
        retirement_date: row["Retirement Date (if available)"] || null,
        condition: row["Condition"] || "Complete, dismantled",
        bl_used_avg: parseGbp(row["BrickLink 6 Month Used Average"]),
        bl_sealed_avg: parseGbp(row["BrickLink New/Sealed Average"]),
        uk_retail_price: parseGbp(row["Current UK Retail Price"]),
        private_sale_value: parseGbp(row["Estimated Private Sale Value"]),
        ebay_listing_price: parseGbp(row["Recommended eBay Listing Price"]),
        quick_sale_price: parseGbp(row["Estimated Quick Sale Price"]),
        investment_rating: row["Investment Rating (Poor/Average/Good/Excellent)"] || null,
        notes: row["Notes"] || null,
        prices_refreshed_at: new Date().toISOString(),
      });
      imported++;
    }
  });

  insertMany(rows);
  return { imported, skipped, total: rows.length };
}

if (require.main === module) {
  const result = importCsv();
  console.log(`Imported ${result.imported}, skipped ${result.skipped} (of ${result.total})`);
}

module.exports = { importCsv };
