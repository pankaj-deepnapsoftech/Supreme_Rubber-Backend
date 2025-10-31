const PurchaseOrder = require("../models/purchaseOrder");
const Supplier = require("../models/supplier");
const { TryCatch, ErrorHandler } = require("../utils/error");
const { generatePoNumber } = require("../utils/generatePoNumber");

// CREATE PO
exports.create = TryCatch(async (req, res) => {
  const { supplier, item_name, est_quantity, category, produce_quantity, remain_quantity } = req.body;

  if (!supplier || !item_name || !est_quantity || !category) {
    throw new ErrorHandler("Please fill all mandatory fields", 400);
  }

  // Validate supplier existence
  const existingSupplier = await Supplier.findById(supplier);
  if (!existingSupplier) {
    throw new ErrorHandler("Invalid supplier ID", 404);
  }

  const poNumber = await generatePoNumber();

  const po = await PurchaseOrder.create({
    po_number: poNumber,
    supplier,
    item_name,
    est_quantity,
    produce_quantity,
    remain_quantity,
    category,
  });

  res.status(201).json({
    status: 201,
    success: true,
    message: "Purchase Order created successfully",
    po,
  });
});

// GET all POs (with supplier details)
exports.all = TryCatch(async (req, res) => {
  const pos = await PurchaseOrder.find()
    .populate("supplier", "supplier_id name company_name email location")
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 200,
    success: true,
    pos,
  });
});

// GET PO by ID (with supplier details)
exports.details = TryCatch(async (req, res) => {
  const { id } = req.params;
  const po = await PurchaseOrder.findById(id).populate("supplier", "supplier_id name email company_name location");
  if (!po) throw new ErrorHandler("Purchase Order not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    po,
  });
});

// UPDATE PO
exports.update = TryCatch(async (req, res) => {
  const { _id, ...updates } = req.body;

  if (updates.supplier) {
    const supplierExists = await Supplier.findById(updates.supplier);
    if (!supplierExists) throw new ErrorHandler("Invalid supplier ID", 404);
  }

  const po = await PurchaseOrder.findByIdAndUpdate(_id, updates, { new: true }).populate(
    "supplier",
    "supplier_id name company_name email"
  );

  if (!po) throw new ErrorHandler("Purchase Order not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    message: "Purchase Order updated successfully",
    po,
  });
});

// DELETE PO
exports.remove = TryCatch(async (req, res) => {
  const { _id } = req.body;
  const po = await PurchaseOrder.findByIdAndDelete(_id);
  if (!po) throw new ErrorHandler("Purchase Order not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    message: "Purchase Order deleted successfully",
  });
});


// GET all POs that are pending for Gate Man (status = "PO Created")
exports.pendingForGateMan = TryCatch(async (req, res) => {
  const pendingPOs = await PurchaseOrder.find({ status: "PO Created" })
    .populate("supplier", "supplier_id name email company_name location")
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 200,
    success: true,
    message: "Pending POs for Gate Man fetched successfully",
    pendingPOs,
  });
});

// ACCEPT a PO (Gate Man accepts delivery)
exports.acceptByGateMan = TryCatch(async (req, res) => {
  const { id } = req.params;

  const po = await PurchaseOrder.findById(id);
  if (!po) throw new ErrorHandler("Purchase Order not found", 404);

  if (po.status !== "PO Created") {
    throw new ErrorHandler(`PO already ${po.status}`, 400);
  }

  po.status = "Accepted";
  await po.save();

  res.status(200).json({
    status: 200,
    success: true,
    message: "Purchase Order accepted successfully",
    po,
  });
});
