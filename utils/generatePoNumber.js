const PurchaseOrder = require("../models/purchaseOrder");

async function generatePoNumber() {
  const lastPo = await PurchaseOrder.findOne().sort({ createdAt: -1 });
  let nextNumber = 1;

  if (lastPo && lastPo.po_number) {
    const lastNumber = parseInt(lastPo.po_number.split("-")[1]);
    if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
  }

  const formatted = String(nextNumber).padStart(4, "0");
  return `PO-${formatted}`;
}

module.exports = { generatePoNumber };
