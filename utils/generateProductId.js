const Product = require("../models/product");

// const CATEGORY_PREFIX_MAP = {
//   "finished goods": "FG",
//   "raw materials": "RM",
//   "semi finished goods": "SFG",
//   "consumables": "CON",
//   "bought out parts": "BOP",
//   "trading goods": "TG",
//   "service": "SRV",
// };

// Generate fallback prefix from custom category
function generateDynamicPrefix(category) {
  try {
    if (!category || typeof category !== "string") {
      throw new Error(`Invalid category "${category}" for ID generation`);
    }

    return category
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .substring(0, 3);
  } catch (error) {
    throw new Error(`Invalid category "${category}" for ID generation`);
  }
}

async function generateProductId(category) {
  try {
    if (!category) throw new Error("Category is required for ID generation");

    const normalized = category.toLowerCase();
    const prefix = generateDynamicPrefix(normalized);

    const regex = new RegExp(`^${prefix}(\\d{3})$`, "i");

    const lastProduct = await Product.findOne({
      product_id: { $regex: regex },
    }).sort({ createdAt: -1 });

    let nextSeq = 1;
    if (lastProduct) {
      const match = lastProduct.product_id.match(regex);
      if (match && match[1]) {
        nextSeq = parseInt(match[1]) + 1;
      }
    }

    const padded = String(nextSeq).padStart(3, "0");
    return `${prefix}${padded}`;
  } catch (error) {
    console.error("Error in generateProductId:", error.message);
    throw error;
  }
}

module.exports = { generateProductId };
