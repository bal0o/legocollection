require("dotenv").config();
const { fetchEbaySoldData } = require("../services/ebay");

const setNumber = process.argv[2] || "43227";
fetchEbaySoldData(setNumber, "Complete, dismantled")
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
