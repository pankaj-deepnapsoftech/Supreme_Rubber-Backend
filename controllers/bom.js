const BOM = require("../models/bom");
const Product = require("../models/product");
const { TryCatch, ErrorHandler } = require("../utils/error");
const { generateProductId } = require("../utils/generateProductId");

// Utility function to capitalize first letter of each word
const capitalizeWords = (str) => {
  if (!str) return str;
  return str.replace(/\b\w/g, (char) => char.toUpperCase());
};

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

  // Filter out empty part_name_details entries (where part_name_id_name is empty)
  const filteredPartNameDetails = Array.isArray(data.part_name_details)
    ? data.part_name_details
        .filter((pnd) => pnd.part_name_id_name && typeof pnd.part_name_id_name === "string" && pnd.part_name_id_name.trim() !== "")
        .map((pnd) => {
          const pndId = pnd.part_name_id || (typeof pnd.part_name_id_name === "string" ? pnd.part_name_id_name.split("-")[0] : null);
          const snap = pndId ? idToProduct.get(String(pndId)) : undefined;
          return {
            part_name_id_name: pnd.part_name_id_name.trim(),
            tolerances: Array.isArray(pnd.tolerances) ? pnd.tolerances : [],
            quantities: Array.isArray(pnd.quantities) ? pnd.quantities.map(q => Number(q)).filter(q => !isNaN(q)) : [],
            comments: Array.isArray(pnd.comments) ? pnd.comments : [],
            product_snapshot: snap,
          };
        })
    : [];

  // Filter out empty raw_materials entries (where raw_material_id is empty)
  const filteredRawMaterials = processedRawMaterials.filter((rm) => rm.raw_material_id);

  // Process compounds array
  const processedCompounds = Array.isArray(data.compounds)
    ? data.compounds
        .filter((c) => (c.compound_id || c.compound_name) && (c.compound_id?.trim() !== "" || c.compound_name?.trim() !== ""))
        .map((c) => ({
          compound_id: c.compound_id || undefined,
          compound_name: c.compound_name || "",
          compound_code: c.compound_code || (Array.isArray(c.compound_codes) && c.compound_codes.length > 0 ? c.compound_codes[0] : ""),
          hardness: c.hardness || (Array.isArray(c.hardnesses) && c.hardnesses.length > 0 ? c.hardnesses[0] : ""),
          weight: c.weight || "",
        }))
    : [];

  const bom = await BOM.create({
    bom_id: bomId,
    bom_type: data.bom_type && (data.bom_type === "compound" || data.bom_type === "part-name") ? data.bom_type : undefined,
    compound_codes: Array.isArray(data.compound_codes) ? data.compound_codes.filter(c => c && c.trim() !== "") : [],
    compound_name: typeof data.compound_name === "string" ? data.compound_name : undefined,
    compound_weight: typeof data.compound_weight === "string" ? data.compound_weight : undefined,
    compounds: processedCompounds,
    part_names: Array.isArray(data.part_names) ? data.part_names.filter(p => p && p.trim() !== "") : [],
    hardnesses: Array.isArray(data.hardnesses) ? data.hardnesses.filter(h => h && h.trim() !== "") : [],
    part_name_details: filteredPartNameDetails,
    raw_materials: filteredRawMaterials,
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

  // If bom_type is "compound" and compound_name exists, create a compound product
  if (data.bom_type === "compound" && data.compound_name && typeof data.compound_name === "string" && data.compound_name.trim() !== "") {
    try {
      const compoundCategory = "Compound Name";
      const generatedId = await generateProductId(compoundCategory);
      
      // Check if compound with same name already exists
      const existingCompound = await Product.findOne({ 
        name: capitalizeWords(data.compound_name.trim()),
        category: compoundCategory 
      });

      if (!existingCompound) {
        const hardnessValue = Array.isArray(data.hardnesses) && data.hardnesses.length > 0 
          ? data.hardnesses[0].trim() 
          : (typeof data.hardness === "string" ? data.hardness.trim() : undefined);
        
        await Product.create({
          name: capitalizeWords(data.compound_name.trim()),
          category: compoundCategory,
          product_id: generatedId,
          uom: "Kg",
          current_stock: 0,
          price: 0,
          item_type: "Buy",
          weight: typeof data.compound_weight === "string" ? data.compound_weight.trim() : undefined,
          hardness: hardnessValue,
          approved: req.user?.isSuper || false,
        });
      } else {
        // Update existing compound with hardness if provided
        const hardnessValue = Array.isArray(data.hardnesses) && data.hardnesses.length > 0 
          ? data.hardnesses[0].trim() 
          : (typeof data.hardness === "string" ? data.hardness.trim() : undefined);
        
        if (hardnessValue) {
          await Product.findByIdAndUpdate(existingCompound._id, {
            hardness: hardnessValue,
          });
        }
      }
    } catch (error) {
      console.error("Error creating compound product:", error);
      // Don't throw error, just log it - BOM is already created
    }
  }



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
  const bom_type = req.query.bom_type; // Filter by BOM type: "compound" or "part-name"

  // Build query filter
  const queryFilter = {};
  if (bom_type && (bom_type === "compound" || bom_type === "part-name")) {
    queryFilter.bom_type = bom_type;
  }

  // Fetch paginated BOMs
  const list = await BOM.find(queryFilter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate({
      path: "raw_materials.raw_material_id",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "compounds.compound_id",
      select: "name product_id",
    });

  // Get total count for pagination info
  const total = await BOM.countDocuments(queryFilter);

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
    })
    .populate({
      path: "compounds.compound_id",
      select: "name product_id",
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

  // Filter out empty part_name_details entries (where part_name_id_name is empty)
  const filteredPartNameDetails = Array.isArray(data.part_name_details)
    ? data.part_name_details
        .filter((pnd) => pnd.part_name_id_name && typeof pnd.part_name_id_name === "string" && pnd.part_name_id_name.trim() !== "")
        .map((pnd) => {
          const pndId = pnd.part_name_id || (typeof pnd.part_name_id_name === "string" ? pnd.part_name_id_name.split("-")[0] : null);
          const snap = pndId ? idToProduct.get(String(pndId)) : undefined;
          return {
            part_name_id_name: pnd.part_name_id_name.trim(),
            tolerances: Array.isArray(pnd.tolerances) ? pnd.tolerances : [],
            quantities: Array.isArray(pnd.quantities) ? pnd.quantities.map(q => Number(q)).filter(q => !isNaN(q)) : [],
            comments: Array.isArray(pnd.comments) ? pnd.comments : [],
            product_snapshot: snap,
          };
        })
    : [];

  // Filter out empty raw_materials entries (where raw_material_id is empty)
  const filteredRawMaterials = processedRawMaterials.filter((rm) => rm.raw_material_id);

  // Process compounds array
  const processedCompounds = Array.isArray(data.compounds)
    ? data.compounds
        .filter((c) => (c.compound_id || c.compound_name) && (c.compound_id?.trim() !== "" || c.compound_name?.trim() !== ""))
        .map((c) => ({
          compound_id: c.compound_id || undefined,
          compound_name: c.compound_name || "",
          compound_code: c.compound_code || (Array.isArray(c.compound_codes) && c.compound_codes.length > 0 ? c.compound_codes[0] : ""),
          hardness: c.hardness || (Array.isArray(c.hardnesses) && c.hardnesses.length > 0 ? c.hardnesses[0] : ""),
          weight: c.weight || "",
        }))
    : [];

  const bom = await BOM.findByIdAndUpdate(
    _id,
    {
      bom_type: data.bom_type && (data.bom_type === "compound" || data.bom_type === "part-name") ? data.bom_type : undefined,
      compound_codes: Array.isArray(data.compound_codes) ? data.compound_codes.filter(c => c && c.trim() !== "") : [],
      compound_name: typeof data.compound_name === "string" ? data.compound_name : undefined,
      compound_weight: typeof data.compound_weight === "string" ? data.compound_weight : undefined,
      compounds: processedCompounds,
      part_names: Array.isArray(data.part_names) ? data.part_names.filter(p => p && p.trim() !== "") : [],
      hardnesses: Array.isArray(data.hardnesses) ? data.hardnesses.filter(h => h && h.trim() !== "") : [],
      part_name_details: filteredPartNameDetails,
      raw_materials: filteredRawMaterials,
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

  // If bom_type is "compound" and compound_name exists, update compound product hardness
  if (data.bom_type === "compound" && data.compound_name && typeof data.compound_name === "string" && data.compound_name.trim() !== "") {
    try {
      const compoundCategory = "Compound Name";
      const existingCompound = await Product.findOne({ 
        name: capitalizeWords(data.compound_name.trim()),
        category: compoundCategory 
      });

      if (existingCompound) {
        const hardnessValue = Array.isArray(data.hardnesses) && data.hardnesses.length > 0 
          ? data.hardnesses[0].trim() 
          : (typeof data.hardness === "string" ? data.hardness.trim() : undefined);
        
        const updateData = {};
        if (typeof data.compound_weight === "string" && data.compound_weight.trim()) {
          updateData.weight = data.compound_weight.trim();
        }
        if (hardnessValue) {
          updateData.hardness = hardnessValue;
        }
        
        if (Object.keys(updateData).length > 0) {
          await Product.findByIdAndUpdate(existingCompound._id, updateData);
        }
      }
    } catch (error) {
      console.error("Error updating compound product:", error);
      // Don't throw error, just log it - BOM is already updated
    }
  }
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

// Get compound-wise part names count
exports.compoundPartNames = TryCatch(async (req, res) => {
  // Get all BOMs with part names
  const boms = await BOM.find({
    $or: [
      { part_names: { $exists: true, $ne: [], $not: { $size: 0 } } },
      { part_name_details: { $exists: true, $ne: [], $not: { $size: 0 } } },
    ],
  })
    .populate({
      path: "compounds.compound_id",
      select: "name product_id",
    })
    .select("bom_type compound_name compounds part_names part_name_details");

  // Map to store compound -> part names
  const compoundPartNamesMap = {};

  boms.forEach((bom) => {
    // Extract part names from BOM
    const partNames = new Set();

    // Get part names from part_name_details first
    if (bom.part_name_details && Array.isArray(bom.part_name_details)) {
      bom.part_name_details.forEach((detail) => {
        if (detail.product_snapshot && detail.product_snapshot.name) {
          partNames.add(detail.product_snapshot.name.trim());
        } else if (detail.part_name_id_name) {
          const parts = detail.part_name_id_name.split("-");
          if (parts.length > 1) {
            partNames.add(parts.slice(1).join("-").trim());
          } else {
            partNames.add(detail.part_name_id_name.trim());
          }
        }
      });
    }

    // Fallback to part_names array
    if (partNames.size === 0 && bom.part_names && Array.isArray(bom.part_names)) {
      bom.part_names.forEach((pn) => {
        if (pn && pn.trim()) {
          partNames.add(pn.trim());
        }
      });
    }

    // For compound BOMs - use compound_name
    if (bom.bom_type === "compound" && bom.compound_name) {
      const compoundName = bom.compound_name.trim();
      if (!compoundPartNamesMap[compoundName]) {
        compoundPartNamesMap[compoundName] = {
          count: 0,
          partNames: [],
        };
      }
      partNames.forEach((pn) => {
        if (!compoundPartNamesMap[compoundName].partNames.includes(pn)) {
          compoundPartNamesMap[compoundName].partNames.push(pn);
          compoundPartNamesMap[compoundName].count++;
        }
      });
    }

    // For part-name BOMs - use compounds array
    if (bom.bom_type === "part-name" && bom.compounds && Array.isArray(bom.compounds)) {
      bom.compounds.forEach((compound) => {
        const compoundName =
          (compound.compound_id && compound.compound_id.name
            ? compound.compound_id.name
            : compound.compound_name) || "";
        
        if (compoundName.trim()) {
          const trimmedName = compoundName.trim();
          if (!compoundPartNamesMap[trimmedName]) {
            compoundPartNamesMap[trimmedName] = {
              count: 0,
              partNames: [],
            };
          }
          partNames.forEach((pn) => {
            if (!compoundPartNamesMap[trimmedName].partNames.includes(pn)) {
              compoundPartNamesMap[trimmedName].partNames.push(pn);
              compoundPartNamesMap[trimmedName].count++;
            }
          });
        }
      });
    }
  });

  // Convert to array format for easier frontend consumption
  const result = Object.keys(compoundPartNamesMap).map((compoundName) => ({
    compoundName,
    count: compoundPartNamesMap[compoundName].count,
    partNames: compoundPartNamesMap[compoundName].partNames,
  }));

  // Create a normalized map (lowercase keys) for case-insensitive matching
  const normalizedMap = {};
  Object.keys(compoundPartNamesMap).forEach((key) => {
    normalizedMap[key.toLowerCase()] = compoundPartNamesMap[key];
  });

  res.status(200).json({
    status: 200,
    success: true,
    data: result,
    map: compoundPartNamesMap, // Original map with original case
    normalizedMap: normalizedMap, // Normalized map for case-insensitive matching
  });
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

// Get all unique part names from BOM table
exports.getPartNames = TryCatch(async (req, res) => {
  // Get all BOMs with part names
  const boms = await BOM.find({
    $or: [
      { part_names: { $exists: true, $ne: [], $not: { $size: 0 } } },
      { part_name_details: { $exists: true, $ne: [], $not: { $size: 0 } } },
    ],
  })
    .select("part_names part_name_details");

  // Collect all unique part names
  const partNameSet = new Set();

  boms.forEach((bom) => {
    // Get part names from part_name_details first (preferred source)
    if (bom.part_name_details && Array.isArray(bom.part_name_details)) {
      bom.part_name_details.forEach((detail) => {
        if (detail.product_snapshot && detail.product_snapshot.name) {
          partNameSet.add(detail.product_snapshot.name.trim());
        } else if (detail.part_name_id_name) {
          const parts = detail.part_name_id_name.split("-");
          if (parts.length > 1) {
            // Remove the ID prefix and keep the name
            partNameSet.add(parts.slice(1).join("-").trim());
          } else {
            partNameSet.add(detail.part_name_id_name.trim());
          }
        }
      });
    }

    // Fallback to part_names array
    if (bom.part_names && Array.isArray(bom.part_names)) {
      bom.part_names.forEach((pn) => {
        if (pn && pn.trim()) {
          partNameSet.add(pn.trim());
        }
      });
    }
  });

  // Convert to sorted array
  const partNames = Array.from(partNameSet).sort();

  res.status(200).json({
    status: 200,
    success: true,
    partNames,
    count: partNames.length,
  });
});

// Get BOM details by part name for auto-filling production form
exports.getBomByPartName = TryCatch(async (req, res) => {
  const partName = (req.query.part_name || "").trim();
  if (!partName) throw new ErrorHandler("Please provide part_name query param", 400);

  // Find BOM that contains this part name
  const bom = await BOM.findOne({
    $or: [
      { part_names: { $regex: partName, $options: "i" } },
      { "part_name_details.part_name_id_name": { $regex: partName, $options: "i" } },
      { "part_name_details.product_snapshot.name": { $regex: partName, $options: "i" } },
    ],
  })
    .populate({
      path: "raw_materials.raw_material_id",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "compounds.compound_id",
      select: "name product_id",
    });

  if (!bom) throw new ErrorHandler("BOM not found for this part name", 404);

  // Find the matching part name detail
  let matchingPartDetail = null;
  if (bom.part_name_details && Array.isArray(bom.part_name_details)) {
    matchingPartDetail = bom.part_name_details.find((detail) => {
      if (detail.product_snapshot && detail.product_snapshot.name) {
        return detail.product_snapshot.name.toLowerCase() === partName.toLowerCase();
      }
      if (detail.part_name_id_name) {
        const parts = detail.part_name_id_name.split("-");
        const name = parts.length > 1 ? parts.slice(1).join("-") : detail.part_name_id_name;
        return name.toLowerCase() === partName.toLowerCase();
      }
      return false;
    });
  }

  // If not found in details, check part_names array
  if (!matchingPartDetail && bom.part_names && Array.isArray(bom.part_names)) {
    const foundPartName = bom.part_names.find(
      (pn) => pn && pn.toLowerCase() === partName.toLowerCase()
    );
    if (foundPartName) {
      // Create a basic part detail structure
      matchingPartDetail = {
        part_name_id_name: foundPartName,
        quantities: [],
        tolerances: [],
        comments: [],
      };
    }
  }

  res.status(200).json({
    status: 200,
    success: true,
    bom,
    partDetail: matchingPartDetail,
  });
});


