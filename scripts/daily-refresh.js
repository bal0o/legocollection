require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { refreshAllSets } = require("../services/refresh-all");

const LOG_PATH = path.join(__dirname, "..", "data", "refresh-log.json");

function writeLog(entry) {
  let log = { runs: [] };
  if (fs.existsSync(LOG_PATH)) {
    try {
      log = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
    } catch {
      log = { runs: [] };
    }
  }
  log.runs = [entry, ...(log.runs || [])].slice(0, 30);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), "utf-8");
}

async function main() {
  console.log(`[daily-refresh] Starting at ${new Date().toISOString()}`);

  const results = await refreshAllSets({
    source: "daily",
    onProgress: (event) => {
      if (event.type === "progress" && event.status === "done") {
        console.log(`[daily-refresh] ${event.set_number} ${event.description || ""}`);
      } else if (event.type === "progress" && event.status === "failed") {
        console.warn(`[daily-refresh] FAILED ${event.set_number}: ${event.error}`);
      }
    },
  });

  if (results.skipped) {
    console.warn(`[daily-refresh] Skipped: ${results.reason}`);
    process.exit(0);
  }

  writeLog(results);
  console.log(
    `[daily-refresh] Done — refreshed ${results.refreshed}/${results.total}` +
      `${results.ebay_retried ? `, eBay retried ${results.ebay_retried}` : ""}` +
      `${results.failed.length ? `, ${results.failed.length} failed` : ""}`
  );

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[daily-refresh] Fatal:", err);
  process.exit(1);
});
