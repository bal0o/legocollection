require("dotenv").config();

async function main() {
  const html = await (
    await fetch("https://www.pricecharting.com/search-products?q=43227&type=prices", {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
  ).text();

  for (const needle of ["68.33", "87.50", "162.38"]) {
    const i = html.indexOf(needle);
    console.log(needle, html.slice(i - 150, i + 80));
    console.log("---");
  }
}

main();
