require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { getPriceGuide } = require("../services/bricklink");

async function main() {
  const setNumber = process.argv[2] || "43227";
  try {
    const used = await getPriceGuide(setNumber, { newOrUsed: "U" });
    const sealed = await getPriceGuide(setNumber, { newOrUsed: "N" });
    console.log("Used:", used);
    console.log("Sealed:", sealed);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
