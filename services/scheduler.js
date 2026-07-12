const { refreshAllSets } = require("./refresh-all");

function parseHour(value, fallback) {
  const hour = parseInt(value, 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return fallback;
  return hour;
}

function msUntilNextRun(hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function startDailyRefreshScheduler() {
  const enabled = process.env.DAILY_REFRESH_ENABLED !== "false";
  if (!enabled) {
    console.log("Daily price refresh scheduler disabled (DAILY_REFRESH_ENABLED=false)");
    return;
  }

  const hour = parseHour(process.env.DAILY_REFRESH_HOUR, 3);
  const minute = parseHour(process.env.DAILY_REFRESH_MINUTE, 0);

  async function runScheduledRefresh() {
    console.log(`[scheduler] Daily price refresh starting at ${new Date().toISOString()}`);
    try {
      const results = await refreshAllSets({ source: "scheduler" });
      if (results.skipped) {
        console.warn(`[scheduler] Skipped: ${results.reason}`);
      } else {
        console.log(
          `[scheduler] Daily refresh done — ${results.refreshed}/${results.total} sets` +
            `${results.failed.length ? `, ${results.failed.length} failed` : ""}`
        );
      }
    } catch (err) {
      console.error("[scheduler] Daily refresh failed:", err.message);
    }
  }

  function scheduleNext() {
    const delay = msUntilNextRun(hour, minute);
    const nextAt = new Date(Date.now() + delay);
    console.log(
      `[scheduler] Next daily price refresh at ${nextAt.toLocaleString("en-GB")} (${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")} local)`
    );
    setTimeout(async () => {
      await runScheduledRefresh();
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

module.exports = { startDailyRefreshScheduler };
