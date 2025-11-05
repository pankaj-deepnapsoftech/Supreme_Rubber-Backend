const BOM = require("../models/bom");
const Product = require("../models/product");
const { TryCatch, ErrorHandler } = require("../utils/error");

exports.create = TryCatch(async (req, res) => {
  const data = req.body;

  if (!data) throw new ErrorHandler("Please provide BOM data", 400);

  const firstCompoundRow = Array.isArray(data.compoundingStandards) && data.compoundingStandards.length
    ? data.compoundingStandards[0]
    : null;
  const safeCompoundCode = data.compoundCode || firstCompoundRow?.compoundCode || undefined;
  const safeCompoundName = data.compoundName || firstCompoundRow?.compoundName || undefined;
  const safePartName = data.partName || firstCompoundRow?.partName || undefined;

  // Build bom_id prefix from compound name (first 3 letters) and increment
  const prefixBase = (safeCompoundName || "BOM").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) || "BOM";
  const prefix = `${prefixBase}-`;
  const lastWithPrefix = await BOM.find({ bom_id: { $regex: `^${prefix}\\d{3}$` } })
    .sort({ bom_id: -1 })
    .limit(1);
  const nextNum = lastWithPrefix && lastWithPrefix[0]
    ? parseInt(lastWithPrefix[0].bom_id.split("-")[1] || "0", 10) + 1
    : 1;
  const bomId = `${prefix}${String(nextNum).padStart(3, "0")}`;

  // Prepare product snapshots for compounding standards and raw materials
  const compoundIds = (Array.isArray(data.compoundingStandards) ? data.compoundingStandards : [])
    .map((r) => r.compoundId || r.compound)
    .filter(Boolean);
  const rawIds = (Array.isArray(data.rawMaterials) ? data.rawMaterials : [])
    .map((r) => r.rawMaterialId || r.raw_material)
    .filter(Boolean);
  const allIds = [...new Set([...(compoundIds || []), ...(rawIds || [])])];
  const idToProduct = new Map();
  if (allIds.length) {
    const docs = await Product.find({ _id: { $in: allIds } });
    docs.forEach((d) => idToProduct.set(String(d._id), d.toObject()));
  }

  const bom = await BOM.create({
    bom_id: bomId,
    compound: data.compoundId || firstCompoundRow?.compoundId || firstCompoundRow?.compound || undefined,
    compound_name: safeCompoundName,
    compound_code: safeCompoundCode,
    hardness: data.compoundingStandardHardness,
    part_name: safePartName,

    raw_material: data.rawMaterialId || undefined,
    raw_material_name: data.rawMaterialName,
    raw_material_code: data.rawMaterialCode,
    raw_material_uom: data.rawMaterialUom,
    raw_material_category: data.rawMaterialCategory,
    raw_material_current_stock: data.rawMaterialCurrentStock,
    raw_material_weight: data.rawMaterialWeight,
    raw_material_tolerance: data.rawMaterialTolerance,

    process1: data.process1,
    process2: data.process2,
    process3: data.process3,
    process4: data.process4,
    processes: Array.isArray(data.processes)
      ? data.processes.filter((p) => typeof p === "string" && p.trim() !== "")
      : undefined,

    compoundingStandards: Array.isArray(data.compoundingStandards)
      ? data.compoundingStandards.map((r) => {
          const pid = r.compoundId || r.compound;
          const snap = pid ? idToProduct.get(String(pid)) : undefined;
          return {
            compound: pid || undefined,
            compound_name: r.compoundName || snap?.name || undefined,
            compound_code: r.compoundCode || snap?.product_id || undefined,
            hardness: r.hardness || undefined,
            part_name: r.partName || undefined,
            product_snapshot: snap,
          };
        })
      : undefined,
    rawMaterials: Array.isArray(data.rawMaterials)
      ? data.rawMaterials.map((r) => {
          const rid = r.rawMaterialId || r.raw_material;
          const snap = rid ? idToProduct.get(String(rid)) : undefined;
          return {
            raw_material: rid || undefined,
            raw_material_name: r.rawMaterialName || snap?.name || undefined,
            raw_material_code: r.rawMaterialCode || snap?.product_id || undefined,
            uom: r.uom || snap?.uom || undefined,
            category: r.category || snap?.category || undefined,
            current_stock: typeof r.current_stock !== "undefined" ? r.current_stock : snap?.current_stock,
            weight: r.weight || r.raw_material_weight || undefined,
            tolerance: r.tolerance || r.raw_material_tolerance || undefined,
            code_no: r.code_no || undefined,
            product_snapshot: snap,
          };
        })
      : undefined,

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
      path: "rawMaterials.raw_material",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "raw_material",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "compound",
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
      path: "rawMaterials.raw_material",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "raw_material",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "compound",
      select: "uom category current_stock name product_id",
    });
  if (!bom) throw new ErrorHandler("BOM not found", 404);
  res.status(200).json({ status: 200, success: true, bom });
});

exports.update = TryCatch(async (req, res) => {
  const data = req.body;
  const { _id } = data;
  if (!_id) throw new ErrorHandler("Please provide BOM id (_id)", 400);
  const firstCompoundRow = Array.isArray(data.compoundingStandards) && data.compoundingStandards.length
    ? data.compoundingStandards[0]
    : null;
  const safeCompoundCode = data.compoundCode || firstCompoundRow?.compoundCode || undefined;
  const safeCompoundName = data.compoundName || firstCompoundRow?.compoundName || undefined;
  const safePartName = data.partName || firstCompoundRow?.partName || undefined;
  const bom = await BOM.findByIdAndUpdate(
    _id,
    {
      compound: data.compoundId || firstCompoundRow?.compoundId || firstCompoundRow?.compound || undefined,
      compound_name: safeCompoundName,
      compound_code: safeCompoundCode,
      hardness: data.compoundingStandardHardness,
      part_name: safePartName,
      raw_material: data.rawMaterialId || undefined,
      raw_material_name: data.rawMaterialName,
      raw_material_code: data.rawMaterialCode,
      raw_material_uom: data.rawMaterialUom,
      raw_material_category: data.rawMaterialCategory,
      raw_material_current_stock: data.rawMaterialCurrentStock,
      raw_material_weight: data.rawMaterialWeight,
      raw_material_tolerance: data.rawMaterialTolerance,
      process1: data.process1,
      process2: data.process2,
      process3: data.process3,
      process4: data.process4,
      processes: Array.isArray(data.processes)
        ? data.processes.filter((p) => typeof p === "string" && p.trim() !== "")
        : undefined,
      compoundingStandards: Array.isArray(data.compoundingStandards)
        ? data.compoundingStandards.map((r) => ({
            compound: r.compoundId || r.compound || undefined,
            compound_name: r.compoundName || undefined,
            compound_code: r.compoundCode || undefined,
            hardness: r.hardness || undefined,
            part_name: r.partName || undefined,
          }))
        : undefined,
      rawMaterials: Array.isArray(data.rawMaterials)
        ? data.rawMaterials.map((r) => ({
            raw_material: r.rawMaterialId || r.raw_material || undefined,
            raw_material_name: r.rawMaterialName || undefined,
            raw_material_code: r.rawMaterialCode || undefined,
            uom: r.uom || undefined,
            category: r.category || undefined,
            current_stock: typeof r.current_stock !== "undefined" ? r.current_stock : undefined,
            weight: r.weight || r.raw_material_weight || undefined,
            tolerance: r.tolerance || r.raw_material_tolerance || undefined,
          }))
        : undefined,
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

  // Try finding in embedded rawMaterials by raw_material_code first
  const bomWithRaw = await BOM.findOne({ "rawMaterials.raw_material_code": code });
  if (bomWithRaw) {
    const row = (bomWithRaw.rawMaterials || []).find((r) => r.raw_material_code === code);
    if (row) {
      return res.status(200).json({
        status: 200,
        success: true,
        source: "bom.rawMaterials",
        data: {
          uom: row.uom || row.product_snapshot?.uom,
          category: row.category || row.product_snapshot?.category,
          name: row.raw_material_name || row.product_snapshot?.name,
          product_id: row.raw_material_code,
          current_stock: row.current_stock ?? row.product_snapshot?.current_stock,
        },
      });
    }
  }

  // Try finding in compoundingStandards/compound_code or top-level compound_code
  const bomWithCompound = await BOM.findOne({
    $or: [
      { compound_code: code },
      { "compoundingStandards.compound_code": code },
    ],
  });
  if (bomWithCompound) {
    // We don't store uom/category for compound at top-level; try to resolve via snapshots if present
    const row = (bomWithCompound.compoundingStandards || []).find((r) => r.compound_code === code);
    const fromSnap = row?.product_snapshot || null;
    if (fromSnap) {
      return res.status(200).json({
        status: 200,
        success: true,
        source: "bom.compoundingStandards",
        data: {
          uom: fromSnap.uom,
          category: fromSnap.category,
          name: row.compound_name || fromSnap.name,
          product_id: row.compound_code,
          current_stock: fromSnap.current_stock,
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


