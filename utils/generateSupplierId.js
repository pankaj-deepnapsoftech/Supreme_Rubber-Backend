const Supplier = require("../models/supplier");

async function generateSupplierId() {
  const lastSupplier = await Supplier.findOne().sort({ createdAt: -1 });
  let nextNumber = 1;

  if (lastSupplier && lastSupplier.supplier_id) {
    const lastNumber = parseInt(lastSupplier.supplier_id.split("-")[1]);
    if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
  }

  const formatted = String(nextNumber).padStart(3, "0");
  return `SUP-${formatted}`;
}

module.exports = { generateSupplierId };

