const Supplier = require("../models/supplier");
const { TryCatch, ErrorHandler } = require("../utils/error");
const { generateSupplierId } = require("../utils/generateSupplierId");

// CREATE Supplier
exports.create = TryCatch(async (req, res) => {
  const supplierDetails = req.body;
  if (!supplierDetails.name || !supplierDetails.phone) {
    throw new ErrorHandler("Name and phone number are required", 400);
  }

  const generatedId = await generateSupplierId();

  const supplier = await Supplier.create({
    ...supplierDetails,
    supplier_id: generatedId,
  });

  res.status(200).json({
    status: 200,
    success: true,
    message: "Supplier created successfully",
    supplier,
  });
});

// READ - Get all suppliers
exports.all = TryCatch(async (req, res) => {
  const suppliers = await Supplier.find().sort({ createdAt: -1 });
  res.status(200).json({
    status: 200,
    success: true,
    suppliers,
  });
});

// READ - Get one supplier by ID
exports.details = TryCatch(async (req, res) => {
  const { id } = req.params;
  const supplier = await Supplier.findById(id);
  if (!supplier) throw new ErrorHandler("Supplier not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    supplier,
  });
});

// UPDATE Supplier
exports.update = TryCatch(async (req, res) => {
  const { _id, ...updates } = req.body;
  const supplier = await Supplier.findByIdAndUpdate(_id, updates, { new: true });

  if (!supplier) throw new ErrorHandler("Supplier not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    message: "Supplier updated successfully",
    supplier,
  });
});

// DELETE Supplier
exports.remove = TryCatch(async (req, res) => {
  const { _id } = req.body;
  const supplier = await Supplier.findByIdAndDelete(_id);
  if (!supplier) throw new ErrorHandler("Supplier not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    message: "Supplier deleted successfully",
  });
});
