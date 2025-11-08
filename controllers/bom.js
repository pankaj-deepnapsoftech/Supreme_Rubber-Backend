const BOM = require("../models/bom");
const Product = require("../models/product");
const { TryCatch, ErrorHandler } = require("../utils/error");

exports.create = TryCatch(async (req, res) => {
  const data = req.body;

  if (!data) throw new ErrorHandler("Please provide BOM data", 400);

  // Build bom_id prefix from first compound code or default
  const firstCompoundCode = Array.isArray(data.compound_codes) && data.compound_codes.length > 0
    ? data.compound_codes[0]
    : "BOM";
  const prefixBase = (firstCompoundCode || "BOM").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) || "BOM";
  const prefix = `${prefixBase}-`;
  const lastWithPrefix = await BOM.find({ bom_id: { $regex: `^${prefix}\\d{3}$` } })
    .sort({ bom_id: -1 })
    .limit(1);
  const nextNum = lastWithPrefix && lastWithPrefix[0]
    ? parseInt(lastWithPrefix[0].bom_id.split("-")[1] || "0", 10) + 1
    : 1;
  const bomId = `${prefix}${String(nextNum).padStart(3, "0")}`;

  // Collect Product ids for raw materials and part name details to create snapshots
  const rawMaterialIds = Array.isArray(data.raw_materials)
    ? data.raw_materials.map((r) => r.raw_material_id).filter(Boolean)
    : [];
  const partNameDetailIds = Array.isArray(data.part_name_details)
    ? data.part_name_details
        .map((pnd) => pnd.part_name_id || (typeof pnd.part_name_id_name === "string" ? pnd.part_name_id_name.split("-")[0] : null))
        .filter(Boolean)
    : [];
  const allProductIds = [...new Set([...
    (rawMaterialIds || []), ...(partNameDetailIds || [])
  ])];
  const idToProduct = new Map();
  if (allProductIds.length) {
    const docs = await Product.find({ _id: { $in: allProductIds } });
    docs.forEach((d) => idToProduct.set(String(d._id), d.toObject()));
  }

  // Process raw materials with names and snapshot from Product model
  const processedRawMaterials = Array.isArray(data.raw_materials)
    ? data.raw_materials.map((r) => {
        const product = r.raw_material_id ? idToProduct.get(String(r.raw_material_id)) : null;
        return {
          raw_material_id: r.raw_material_id,
          raw_material_name: r.raw_material_name || product?.name || "",
          tolerances: Array.isArray(r.tolerances) ? r.tolerances : [],
          quantities: Array.isArray(r.quantities) ? r.quantities.map(q => Number(q)).filter(q => !isNaN(q)) : [],
          comments: Array.isArray(r.comments) ? r.comments : [],
          product_snapshot: product || undefined,
        };
      })
    : [];

  const bom = await BOM.create({
    bom_id: bomId,
    compound_codes: Array.isArray(data.compound_codes) ? data.compound_codes.filter(c => c && c.trim() !== "") : [],
    compound_name: typeof data.compound_name === "string" ? data.compound_name : undefined,
    part_names: Array.isArray(data.part_names) ? data.part_names.filter(p => p && p.trim() !== "") : [],
    hardnesses: Array.isArray(data.hardnesses) ? data.hardnesses.filter(h => h && h.trim() !== "") : [],
    part_name_details: Array.isArray(data.part_name_details)
      ? data.part_name_details.map((pnd) => {
          const pndId = pnd.part_name_id || (typeof pnd.part_name_id_name === "string" ? pnd.part_name_id_name.split("-")[0] : null);
          const snap = pndId ? idToProduct.get(String(pndId)) : undefined;
          return {
            part_name_id_name: pnd.part_name_id_name || "",
            tolerances: Array.isArray(pnd.tolerances) ? pnd.tolerances : [],
            quantities: Array.isArray(pnd.quantities) ? pnd.quantities.map(q => Number(q)).filter(q => !isNaN(q)) : [],
            comments: Array.isArray(pnd.comments) ? pnd.comments : [],
            product_snapshot: snap,
          };
        })
      : [],
    raw_materials: processedRawMaterials,
    processes: Array.isArray(data.processes)
      ? data.processes.filter((p) => typeof p === "string" && p.trim() !== "")
      : [],
    accelerators: Array.isArray(data.accelerators)
      ? data.accelerators.map((acc) => ({
          name: acc.name || "",
          tolerance: acc.tolerance || "",
          quantity: acc.quantity || "",
          comment: acc.comment || "",
        }))
      : [],
    createdBy: req.user?._id,
  });

  res.status(200).json({
    status: 200,
    success: true,
    message: "BOM saved successfully",
    bom,
  });
});

exports.all = TryCatch(async (req, res) => {
  // Parse query parameters
  const page = parseInt(req.query.page, 10) || 1; // default 1
  const limit = parseInt(req.query.limit, 10) || 10; // default 10
  const skip = (page - 1) * limit;

  // Fetch paginated BOMs
  const list = await BOM.find({})
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate({
      path: "raw_materials.raw_material_id",
      select: "uom category current_stock name product_id",
    });

  // Get total count for pagination info
  const total = await BOM.countDocuments();

  res.status(200).json({
    status: 200,
    success: true,
    boms: list,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  });
});


exports.details = TryCatch(async (req, res) => {
  const { id } = req.params;
  const bom = await BOM.findById(id)
    .populate({
      path: "raw_materials.raw_material_id",
      select: "uom category current_stock name product_id",
    });
  if (!bom) throw new ErrorHandler("BOM not found", 404);
  res.status(200).json({ status: 200, success: true, bom });
});

exports.update = TryCatch(async (req, res) => {
  const data = req.body;
  const { _id } = data;
  if (!_id) throw new ErrorHandler("Please provide BOM id (_id)", 400);

  // Collect Product ids for raw materials and part name details to create snapshots
  const rawMaterialIds = Array.isArray(data.raw_materials)
    ? data.raw_materials.map((r) => r.raw_material_id).filter(Boolean)
    : [];
  const partNameDetailIds = Array.isArray(data.part_name_details)
    ? data.part_name_details
        .map((pnd) => pnd.part_name_id || (typeof pnd.part_name_id_name === "string" ? pnd.part_name_id_name.split("-")[0] : null))
        .filter(Boolean)
    : [];
  const allProductIds = [...new Set([...(rawMaterialIds || []), ...(partNameDetailIds || [])])];
  const idToProduct = new Map();
  if (allProductIds.length) {
    const docs = await Product.find({ _id: { $in: allProductIds } });
    docs.forEach((d) => idToProduct.set(String(d._id), d.toObject()));
  }

  // Process raw materials with names and snapshot from Product model
  const processedRawMaterials = Array.isArray(data.raw_materials)
    ? data.raw_materials.map((r) => {
        const product = r.raw_material_id ? idToProduct.get(String(r.raw_material_id)) : null;
        return {
          raw_material_id: r.raw_material_id,
          raw_material_name: r.raw_material_name || product?.name || "",
          tolerances: Array.isArray(r.tolerances) ? r.tolerances : [],
          quantities: Array.isArray(r.quantities) ? r.quantities.map(q => Number(q)).filter(q => !isNaN(q)) : [],
          comments: Array.isArray(r.comments) ? r.comments : [],
          product_snapshot: product || undefined,
        };
      })
    : [];

  const bom = await BOM.findByIdAndUpdate(
    _id,
    {
      compound_codes: Array.isArray(data.compound_codes) ? data.compound_codes.filter(c => c && c.trim() !== "") : [],
      compound_name: typeof data.compound_name === "string" ? data.compound_name : undefined,
      part_names: Array.isArray(data.part_names) ? data.part_names.filter(p => p && p.trim() !== "") : [],
      hardnesses: Array.isArray(data.hardnesses) ? data.hardnesses.filter(h => h && h.trim() !== "") : [],
      part_name_details: Array.isArray(data.part_name_details)
        ? data.part_name_details.map((pnd) => {
            const pndId = pnd.part_name_id || (typeof pnd.part_name_id_name === "string" ? pnd.part_name_id_name.split("-")[0] : null);
            const snap = pndId ? idToProduct.get(String(pndId)) : undefined;
            return {
              part_name_id_name: pnd.part_name_id_name || "",
              tolerances: Array.isArray(pnd.tolerances) ? pnd.tolerances : [],
              quantities: Array.isArray(pnd.quantities) ? pnd.quantities.map(q => Number(q)).filter(q => !isNaN(q)) : [],
              comments: Array.isArray(pnd.comments) ? pnd.comments : [],
              product_snapshot: snap,
            };
          })
        : [],
      raw_materials: processedRawMaterials,
      processes: Array.isArray(data.processes)
        ? data.processes.filter((p) => typeof p === "string" && p.trim() !== "")
        : [],
      accelerators: Array.isArray(data.accelerators)
        ? data.accelerators.map((acc) => ({
            name: acc.name || "",
            tolerance: acc.tolerance || "",
            quantity: acc.quantity || "",
            comment: acc.comment || "",
          }))
        : [],
    },
    { new: true }
  );
  if (!bom) throw new ErrorHandler("BOM not found", 404);
  res.status(200).json({ status: 200, success: true, message: "BOM updated", bom });
});

exports.remove = TryCatch(async (req, res) => {
  const { id } = req.body;
  if (!id) throw new ErrorHandler("Please provide BOM id", 400);
  const deleted = await BOM.findByIdAndDelete(id);
  if (!deleted) throw new ErrorHandler("BOM not found", 404);
  res.status(200).json({ status: 200, success: true, message: "BOM deleted" });
});

// Lookup BOM data by product code to auto-fill uom and category
exports.lookup = TryCatch(async (req, res) => {
  const code = (req.query.code || "").trim();
  if (!code) throw new ErrorHandler("Please provide code query param", 400);

  // Try finding in compound_codes array
  const bomWithCompound = await BOM.findOne({ compound_codes: code });
  if (bomWithCompound) {
    // Try to find product by code
    const product = await Product.findOne({ product_id: code }).select("uom category name product_id current_stock");
    if (product) {
      return res.status(200).json({
        status: 200,
        success: true,
        source: "bom.compound_codes",
        data: {
          uom: product.uom,
          category: product.category,
          name: product.name,
          product_id: product.product_id,
          current_stock: product.current_stock,
        },
      });
    }
  }

  // Fallback: resolve by Product model by product_id code
  const product = await Product.findOne({ product_id: code }).select("uom category name product_id current_stock");
  if (!product) throw new ErrorHandler("No matching BOM or Product found for code", 404);
  return res.status(200).json({
    status: 200,
    success: true,
    source: "product",
    data: {
      uom: product.uom,
      category: product.category,
      name: product.name,
      product_id: product.product_id,
      current_stock: product.current_stock,
    },
  });
});


