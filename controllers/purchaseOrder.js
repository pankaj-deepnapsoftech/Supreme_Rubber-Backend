const PurchaseOrder = require("../models/purchaseOrder");
const Supplier = require("../models/supplier");

const Product = require("../models/product");
const { TryCatch, ErrorHandler } = require("../utils/error");
const { generatePoNumber } = require("../utils/generatePoNumber");

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

  // ✅ Fetch product details for each product
  const finalProducts = [];
  for (const item of products) {
    // item.item_name is actually product _id
    const productData = await Product.findById(item.item_name);
    if (!productData) {
      throw new ErrorHandler(`Invalid Product ID: ${item.item_name}`, 404);
    }

    finalProducts.push({
      item_name: productData.name, // fetched product name
      category: productData.category, // fetched product category
      quantity: item.quantity,
      produce_quantity: item.produce_quantity || 0,
      remain_quantity: item.remain_quantity || item.quantity,
      uom:item.uom ,
      product_type: item.product_type
    });
  }


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

// GET all POs (with supplier details)
exports.all = TryCatch(async (req, res) => {
  const pos = await PurchaseOrder.find()
    .populate("supplier", "supplier_id name email company_name location")
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
    po.products = products;
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
