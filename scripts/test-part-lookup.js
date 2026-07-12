require("dotenv").config();
const { lookupPart } = require("../services/parts");

async function main() {
  const id = process.argv[2] || "4113917";
  const part = await lookupPart(id);
  console.log(JSON.stringify(part, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
