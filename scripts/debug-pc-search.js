require("dotenv").config();

async function tryUrl(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const hasSales = html.includes("[eBay]") || html.includes("Sold Listings");
  const title = html.match(/<title>([^<]+)/)?.[1];
  return { url, status: res.status, hasSales, title: title?.slice(0, 80) };
}

async function main() {
  const n = process.argv[2] || "43227";
  const urls = [
    `https://www.pricecharting.com/search-products?q=${n}&type=prices`,
    `https://www.pricecharting.com/search-products?q=lego+${n}&type=prices`,
    `https://www.pricecharting.com/game/lego-disney/villain-icons-${n}`,
    `https://www.pricecharting.com/console/lego-disney`,
  ];
  for (const u of urls) {
    console.log(await tryUrl(u));
  }
}

main().catch(console.error);
