const mongoose = require("mongoose");

const PurchaseOrder = require("../models/purchaseOrder");
const Supplier = require("../models/supplier");

const Product = require("../models/product");
const { TryCatch, ErrorHandler } = require("../utils/error");
const { generatePoNumber } = require("../utils/generatePoNumber");

const resolveProductReference = async (item) => {
  if (!item || !item.item_name) {
    throw new ErrorHandler("Each product must include an item reference", 400);
  }

  let productDoc = null;

  // Accept either an ObjectId or a product name as the reference
  if (mongoose.Types.ObjectId.isValid(item.item_name)) {
    productDoc = await Product.findById(item.item_name);
  }

  if (!productDoc) {
    productDoc = await Product.findOne({ name: item.item_name });
  }

  if (!productDoc) {
    throw new ErrorHandler(`Invalid product reference: ${item.item_name}`, 404);
  }

  const quantity = Number(item.quantity) || 0;
  const produceQuantity = Number(item.produce_quantity) || 0;
  const remainQuantity =
    Number(item.remain_quantity) || (quantity ? quantity - produceQuantity : 0);

  const productType =
    item.product_type ||
    productDoc.product_or_service ||
    productDoc.item_type;

  if (!productType) {
    throw new ErrorHandler(
      `Unable to resolve product type for ${productDoc.name}. Please provide product_type`,
      400
    );
  }

  return {
    item_name: productDoc.name,
    category: productDoc.category,
    quantity,
    produce_quantity: produceQuantity,
    remain_quantity: remainQuantity,
    uom: item.uom || productDoc.uom,
    product_type: productType,
  };
};

const normalizeProductsPayload = async (products = []) => {
  if (!Array.isArray(products) || products.length === 0) {
    throw new ErrorHandler("At least one product must be added", 400);
  }

  const resolvedProducts = [];

  for (const item of products) {
    const resolved = await resolveProductReference(item);
    resolvedProducts.push(resolved);
  }

  return resolvedProducts;
};

// CREATE PO
exports.create = TryCatch(async (req, res) => {
  const { supplier, products } = req.body;


  // ✅ Validate supplier and product array
  if (!supplier || !Array.isArray(products) || products.length === 0) {
    throw new ErrorHandler("Supplier and at least one product are required", 400);
  }

  // ✅ Check if supplier exists
  const existingSupplier = await Supplier.findById(supplier);
  if (!existingSupplier) {
    throw new ErrorHandler("Invalid supplier ID", 404);
  }

  // ✅ Generate PO number
  const poNumber = await generatePoNumber();

  const finalProducts = await normalizeProductsPayload(products);


  const po = await PurchaseOrder.create({
    po_number: poNumber,
    supplier,
    products: finalProducts,
  });

  res.status(201).json({
    status: 201,
    success: true,
    message: "Purchase Order created successfully",
    po,
  });
});

exports.all = TryCatch(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;


  const skip = (page - 1) * limit;

  const total = await PurchaseOrder.countDocuments();

  const pos = await PurchaseOrder.find()
    .populate("supplier", "supplier_id name email company_name location")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({
    status: 200,
    success: true,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    pos,
  });
});



// GET PO by ID (with supplier details)
exports.details = TryCatch(async (req, res) => {
  const { id } = req.params;
  const po = await PurchaseOrder.findById(id).populate(
    "supplier",
    "supplier_id name email company_name location",

  );

  if (!po) throw new ErrorHandler("Purchase Order not found", 404);

  res.status(200).json({
    status: 200,
    success: true,
    po,
  });
});  



// UPDATE PO
exports.update = TryCatch(async (req, res) => {
  const { _id, supplier, products, status } = req.body;

  const po = await PurchaseOrder.findById(_id);
  if (!po) throw new ErrorHandler("Purchase Order not found", 404);

  if (supplier) {
    const exists = await Supplier.findById(supplier);
    if (!exists) throw new ErrorHandler("Invalid supplier ID", 404);
    po.supplier = supplier;
  }

  if (products && Array.isArray(products)) {
    po.products = await normalizeProductsPayload(products);
  }

  if (status) {
    po.status = status;
  }

  await po.save();

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

  console.log(req.body)
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
