require("dotenv").config();
const { fetchPricing } = require("../services/pricing");

fetchPricing("43227", "Complete, dismantled", null, [])
  .then((r) => {
    console.log({
      bl_used: r.bl_used_avg,
      bl_sealed: r.bl_sealed_avg,
      ebay_sold: r.ebay_sold_avg,
      ebay_list: r.ebay_listing_price,
      vinted: r.vinted_listing_price,
      facebook: r.facebook_listing_price,
      history_len: r.price_history?.length,
      notes: r.notes,
    });
  })
  .catch(console.error);
