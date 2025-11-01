const GateMan = require("../models/gateMan");
const { TryCatch, ErrorHandler } = require("../utils/error");
const PurchaseOrder = require("../models/purchaseOrder");
const Supplier = require("../models/supplier");

// CREATE ENTRY
exports.create = TryCatch(async (req, res) => {
  let { po_ref, po_number, invoice_number, company_name, items } = req.body;

  // 🔹 Handle case where items is sent as string in form-data
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch (error) {
      throw new ErrorHandler("Invalid items JSON format", 400);
    }
  }

  // 🔹 Validate required fields
  if (!po_ref || !po_number || !invoice_number || !company_name || !items) {
    throw new ErrorHandler("All fields including po_ref are required", 400);
  }

  // 🔹 File URLs
  const poFile = req.files?.attached_po?.[0];
  const invoiceFile = req.files?.attached_invoice?.[0];

  const attached_po = poFile
    ? `${req.protocol}://${req.get("host")}/${poFile.path.replace(/\\/g, "/")}`
    : null;

  const attached_invoice = invoiceFile
    ? `${req.protocol}://${req.get("host")}/${invoiceFile.path.replace(/\\/g, "/")}`
    : null;

  // 🔹 Create entry
  const entry = await GateMan.create({
    po_ref,
    po_number,
    invoice_number,
    company_name,
    items,
    attached_po,
    attached_invoice,
  });

  // 🔹 Optional: update PO status to In Process
  await PurchaseOrder.findByIdAndUpdate(po_ref, { status: "In Process" });

  res.status(201).json({
    status: 201,
    success: true,
    message: "GateMan entry created successfully",
    entry,
  });
});


// GET ALL ENTRIES
exports.all = TryCatch(async (req, res) => {
  const entries = await GateMan.find().sort({ createdAt: -1 });
  res.status(200).json({
    status: 200,
    success: true,
    entries,
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
  const entry = await GateMan.findByIdAndUpdate(_id, updates, { new: true });

  if (!entry) throw new ErrorHandler("Entry not found", 404);

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

  const po = await PurchaseOrder.findById(poId)
    .populate("supplier", "name company_name supplier_id location email");

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