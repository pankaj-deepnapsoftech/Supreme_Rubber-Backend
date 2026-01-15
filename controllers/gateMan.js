const GateMan = require("../models/gateMan");
const { TryCatch, ErrorHandler } = require("../utils/error");
const PurchaseOrder = require("../models/purchaseOrder");
const Supplier = require("../models/supplier");

// CREATE ENTRY

// const BASE_URL = process.env.BASE_URL
exports.create = TryCatch(async (req, res) => {
  const BASE_URL =
    process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
  let { po_ref, po_number, invoice_number, company_name, items } = req.body;

  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch (error) {
      throw new ErrorHandler("Invalid items JSON format", 400);
    }
  }

  if (!po_ref || !po_number || !invoice_number || !company_name || !items) {
    throw new ErrorHandler("All fields including po_ref are required", 400);
  }

  const poFile = req.files?.attached_po?.[0];
  const invoiceFile = req.files?.attached_invoice?.[0];

  const attached_po = poFile
    ? `${BASE_URL}/${poFile.path.replace(/\\/g, "/")}`
    : null;

  const attached_invoice = invoiceFile
    ? `${BASE_URL}/${invoiceFile.path.replace(/\\/g, "/")}`
    : null;

  // Get PO to update remain_quantity
  const purchaseOrder = await PurchaseOrder.findById(po_ref);
  if (!purchaseOrder) {
    throw new ErrorHandler("Purchase Order not found", 404);
  }

  // Process items and update PO remain_quantity
  const processedItems = items.map((item) => {
    const poProduct = purchaseOrder.products.find(
      (p) => p.item_name === item.item_name
    );

    if (poProduct) {
      // Calculate remaining quantity
      const receivedQty = Number(item.item_quantity) || 0;
      const currentRemaining = poProduct.remain_quantity || poProduct.quantity;
      const newRemaining = currentRemaining - receivedQty;

      // Update PO product's remain_quantity
      poProduct.remain_quantity = newRemaining >= 0 ? newRemaining : 0;

      return {
        item_name: item.item_name,
        item_quantity: receivedQty,
        ordered_quantity: poProduct.quantity,
        remaining_quantity: newRemaining >= 0 ? newRemaining : 0,
      };
    }

    return {
      item_name: item.item_name,
      item_quantity: Number(item.item_quantity) || 0,
      ordered_quantity: 0,
      remaining_quantity: 0,
    };
  });

  // Save updated PO
  await purchaseOrder.save();

  const entry = await GateMan.create({
    po_ref,
    po_number,
    invoice_number,
    company_name,
    items: processedItems,
    attached_po,
    attached_invoice,
  });

  await PurchaseOrder.findByIdAndUpdate(po_ref, { status: "In Process" });

  res.status(201).json({
    status: 201,
    success: true,
    message: "GateMan entry created successfully",
    entry,
  });
});

// GET ALL ENTRIES (with pagination)
exports.all = TryCatch(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit);
  const skip = (page - 1) * limit;

  // Get total count
  const total = await GateMan.countDocuments();

  // Fetch paginated data
  const entries = await GateMan.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({
    status: 200,
    success: true,
    entries,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

// GET BY ID
exports.details = TryCatch(async (req, res) => {
  const { id } = req.params;
  const entry = await GateMan.findById(id);
  if (!entry) throw new ErrorHandler("Entry not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    entry,
  });
});

// UPDATE ENTRY
exports.update = TryCatch(async (req, res) => {
  const { _id, ...updates } = req.body;

  // Get the existing entry to compare quantities
  const existingEntry = await GateMan.findById(_id);
  if (!existingEntry) throw new ErrorHandler("Entry not found", 404);

  // If items are being updated and po_ref exists, update PO remain_quantity
  if (updates.items && existingEntry.po_ref) {
    const purchaseOrder = await PurchaseOrder.findById(existingEntry.po_ref);

    if (purchaseOrder) {
      // Process each item to update PO remain_quantity
      updates.items = updates.items.map((newItem) => {
        // Find the old item to calculate the difference
        const oldItem = existingEntry.items.find(
          (item) => item.item_name === newItem.item_name
        );

        // Find the corresponding PO product
        const poProduct = purchaseOrder.products.find(
          (p) => p.item_name === newItem.item_name
        );

        if (poProduct && oldItem) {
          // Calculate the difference in received quantity
          const oldReceivedQty = Number(oldItem.item_quantity) || 0;
          const newReceivedQty = Number(newItem.item_quantity) || 0;
          const quantityDifference = newReceivedQty - oldReceivedQty;

          // Update PO's remain_quantity by subtracting the difference
          // If user increased received qty (positive diff), decrease remaining
          // If user decreased received qty (negative diff), increase remaining
          const currentRemaining =
            poProduct.remain_quantity || poProduct.quantity;
          const newRemaining = currentRemaining - quantityDifference;
          poProduct.remain_quantity = newRemaining >= 0 ? newRemaining : 0;

          // Calculate the new remaining quantity for this item
          const itemRemaining =
            (newItem.ordered_quantity || poProduct.quantity) - newReceivedQty;

          return {
            item_name: newItem.item_name,
            item_quantity: newReceivedQty,
            ordered_quantity: newItem.ordered_quantity || poProduct.quantity,
            remaining_quantity: itemRemaining >= 0 ? itemRemaining : 0,
          };
        }

        return newItem;
      });

      // Save the updated PO
      await purchaseOrder.save();
    }
  }

  const entry = await GateMan.findByIdAndUpdate(_id, updates, { new: true });

  res.status(200).json({
    status: 200,
    success: true,
    message: "Entry updated successfully",
    entry,
  });
});

// DELETE ENTRY
exports.remove = TryCatch(async (req, res) => {
  const { _id } = req.body;
  const entry = await GateMan.findByIdAndDelete(_id);
  if (!entry) throw new ErrorHandler("Entry not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    message: "Entry deleted successfully",
  });
});
exports.prefillFromPO = TryCatch(async (req, res) => {
  const { poId } = req.params;

  const po = await PurchaseOrder.findById(poId).populate(
    "supplier",
    "name company_name supplier_id location email"
  );

  if (!po) throw new ErrorHandler("Purchase Order not found", 404);

  if (po.status !== "Accepted") {
    throw new ErrorHandler("PO not yet accepted for gate entry", 400);
  }

  const formatted = {
    po_ref: po._id,
    po_number: po.po_number,
    company_name: po.supplier.company_name || po.supplier.name,
    items: po.products.map((p) => ({
      item_name: p.item_name,
      item_quantity: p.remain_quantity,
    })),
  };

  res.status(200).json({
    status: 200,
    success: true,
    message: "PO data ready for GateMan entry",
    data: formatted,
  });
});

exports.changeStatus = TryCatch(async (req, res) => {
  const { id } = req.params;
  console.log(id);
  const entry = await GateMan.findById(id);
  if (!entry) throw new ErrorHandler("Entry not found", 404);

  if (entry.status !== "Entry Created") {
    throw new ErrorHandler("Status change not allowed from current state", 400);
  }

  entry.status = "Verified";
  await entry.save();

  res.status(200).json({
    status: 200,
    success: true,
    message: "GateMan status updated to Verified",
    entry,
  });
});

// Dashboard status stats (Verified vs Created) for current week/month/year
exports.statusStats = TryCatch(async (req, res) => {
  const { period = "weekly" } = req.query;

  const now = new Date();
  const startOfWeek = () => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday
    d.setDate(d.getDate() + diff);
    return d;
  };
  const endOfWeek = () => {
    const s = startOfWeek();
    const e = new Date(s);
    e.setDate(s.getDate() + 7);
    return e;
  };
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const endOfYear = new Date(now.getFullYear() + 1, 0, 1);

  let range;
  if (period === "weekly") range = { $gte: startOfWeek(), $lt: endOfWeek() };
  else if (period === "monthly")
    range = { $gte: startOfMonth, $lt: endOfMonth };
  else if (period === "yearly") range = { $gte: startOfYear, $lt: endOfYear };
  else
    return res
      .status(400)
      .json({ status: 400, success: false, message: "Invalid period" });

  const grouped = await GateMan.aggregate([
    { $match: { createdAt: range } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const map = Object.fromEntries(
    grouped.map((g) => [g._id || "Unknown", g.count])
  );
  const created = (map["Entry Created"] || 0) + (map["Created"] || 0);
  const verified = map["Verified"] || 0;

  return res.status(200).json({
    status: 200,
    success: true,
    period,
    data: { created, verified },
  });
});

// GET REMAINING QUANTITIES - Get all POs with remaining quantities
exports.getRemainingQuantities = TryCatch(async (req, res) => {
  // Get all accepted and in-process POs with their remaining quantities
  const purchaseOrders = await PurchaseOrder.find({
    status: { $in: ["Accepted", "In Process"] },
  })
    .populate("supplier", "supplier_id name email company_name location")
    .sort({ createdAt: -1 });

  // Format the response with remaining quantities
  // Only include POs that have at least one product with remaining quantity > 0
  const formattedPOs = purchaseOrders
    .map((po) => ({
      _id: po._id,
      po_number: po.po_number,
      supplier: po.supplier,
      status: po.status,
      createdAt: po.createdAt,
      products: po.products.map((product) => ({
        item_name: product.item_name,
        quantity: product.quantity,
        remain_quantity: product.remain_quantity !== undefined 
          ? product.remain_quantity 
          : product.quantity,
        uom: product.uom,
        category: product.category,
        product_type: product.product_type,
      })),
    }))
    .filter((po) => {
      // Only include POs that have at least one product with remain_quantity > 0
      return po.products.some(
        (product) => (product.remain_quantity || 0) > 0
      );
    });

  res.status(200).json({
    status: 200,
    success: true,
    message: "Remaining quantities fetched successfully",
    data: formattedPOs,
  });
});
