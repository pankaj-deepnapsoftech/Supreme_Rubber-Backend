const Production = require("../models/production");
const BOM = require("../models/bom");
const Product = require("../models/product");
const { TryCatch, ErrorHandler } = require("../utils/error");

exports.create = TryCatch(async (req, res) => {
  const data = req.body;

  if (!data) throw new ErrorHandler("Please provide production data", 400);
  if (!data.bom) throw new ErrorHandler("BOM is required", 400);

  const bom = await BOM.findById(data.bom)
    .populate({
      path: "rawMaterials.raw_material",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "compound",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "compoundingStandards.compound",
      select: "uom category current_stock name product_id",
    });

  if (!bom) throw new ErrorHandler("BOM not found", 404);

  // Fetch minimal product pricing info to compute total cost if needed
  const products = await Product.find({}, "product_id name price latest_price updated_price").lean();

  // Prepare finished goods from BOM data
  const finishedGoods = Array.isArray(data.finished_goods)
    ? data.finished_goods.map((fg) => {
        const compound =
          bom.compoundingStandards?.find(
            (cs) => cs.compound_code === fg.compound_code
          ) ||
          bom.compoundingStandards?.[0] ||
          bom;

        const estQty = fg.est_qty || 0;
        const productMatch = products.find(
          (p) => p.product_id === (fg.compound_code || compound.compound_code || bom.compound_code) || p.name === (fg.compound_name || compound.compound_name || bom.compound_name)
        );
        const unitPrice =
          (typeof productMatch?.updated_price === "number" ? productMatch.updated_price : undefined) ??
          (typeof productMatch?.latest_price === "number" ? productMatch.latest_price : undefined) ??
          (typeof productMatch?.price === "number" ? productMatch.price : 0);

        return {
          bom: data.bom,
          compound_code: fg.compound_code || compound.compound_code || bom.compound_code,
          compound_name: fg.compound_name || compound.compound_name || bom.compound_name,
          est_qty: estQty,
          uom: fg.uom || compound.product_snapshot?.uom || bom.compound?.uom || "",
          prod_qty: fg.prod_qty || 0,
          remain_qty: estQty - (fg.prod_qty || 0),
          category: fg.category || compound.product_snapshot?.category || bom.compound?.category || "",
          total_cost: typeof fg.total_cost === "number" ? fg.total_cost : estQty * (unitPrice || 0),
        };
      })
    : [];

  // Compound estimated qty to scale raw materials, if available
  const compoundEstQty = Array.isArray(finishedGoods) && finishedGoods.length > 0
    ? (finishedGoods[0]?.est_qty || 0)
    : 0;

  // Prepare raw materials from BOM data
  const rawMaterials = Array.isArray(data.raw_materials)
    ? data.raw_materials.map((rm) => {
        const bomRm = bom.rawMaterials?.find(
          (r) =>
            r.raw_material_code === rm.raw_material_code ||
            r.raw_material_name === rm.raw_material_name
        );

      // Match product to get price (by code, name, or id)
      const productMatch = (products || []).find(
        (p) =>
          p.product_id === (rm.raw_material_code || bomRm?.raw_material_code) ||
          p.name === (rm.raw_material_name || bomRm?.raw_material_name) ||
          String(p._id) === String(rm.raw_material_id || bomRm?.raw_material || "")
      );
      const unitPrice =
        (typeof productMatch?.updated_price === "number" ? productMatch.updated_price : undefined) ??
        (typeof productMatch?.latest_price === "number" ? productMatch.latest_price : undefined) ??
        (typeof productMatch?.price === "number" ? productMatch.price : 0);

        return {
          raw_material_id: rm.raw_material_id || bomRm?.raw_material || null,
          raw_material_name: rm.raw_material_name || bomRm?.raw_material_name || "",
          raw_material_code: rm.raw_material_code || bomRm?.raw_material_code || "",
        // Default estimated qty from BOM weight × compound est qty if not provided
        est_qty: (typeof rm.est_qty !== "undefined" && rm.est_qty !== null && rm.est_qty !== "")
          ? rm.est_qty
          : ((bomRm?.weight ? (parseFloat(bomRm.weight) || 0) : 0) * (compoundEstQty || 0)),
          uom: rm.uom || bomRm?.uom || bomRm?.product_snapshot?.uom || "",
          used_qty: rm.used_qty || 0,
        remain_qty: (
          (typeof rm.est_qty !== "undefined" && rm.est_qty !== null && rm.est_qty !== "")
            ? rm.est_qty
            : ((bomRm?.weight ? (parseFloat(bomRm.weight) || 0) : 0) * (compoundEstQty || 0))
        ) - (rm.used_qty || 0),
          category: rm.category || bomRm?.category || bomRm?.product_snapshot?.category || "",
        total_cost: (typeof rm.total_cost === "number" ? rm.total_cost : undefined) ?? (
          ((typeof rm.est_qty !== "undefined" && rm.est_qty !== null && rm.est_qty !== "") ? rm.est_qty : ((bomRm?.weight ? (parseFloat(bomRm.weight) || 0) : 0) * (compoundEstQty || 0)))
          * (unitPrice || 0)
        ),
          weight: rm.weight || bomRm?.weight || "",
          tolerance: rm.tolerance || bomRm?.tolerance || "",
          code_no: rm.code_no || bomRm?.code_no || "",
        };
      })
    : [];

  const processes = Array.isArray(data.processes)
    ? data.processes.map((proc, idx) => {
        const bomProcess =
          bom.processes?.[idx] || bom[`process${idx + 1}`] || "";
        return {
          process_name: proc.process_name || bomProcess || "",
          work_done: proc.work_done || 0,
          start: proc.start || false,
          done: proc.done || false,
          status: proc.done
            ? "completed"
            : proc.start
            ? "in_progress"
            : "pending",
        };
      })
    : (bom.processes || [])
        .map((proc, idx) => ({
          process_name: proc || bom[`process${idx + 1}`] || "",
          work_done: 0,
          start: false,
          done: false,
          status: "pending",
        }))
        .filter((p) => p.process_name);

  let derivedStatus = "pending";
  if (Array.isArray(processes) && processes.length > 0) {
    const allDone = processes.every(
      (p) => p.done === true || p.status === "completed"
    );
    const anyStarted = processes.some(
      (p) => p.start === true || p.status === "in_progress"
    );
    derivedStatus = allDone
      ? "completed"
      : anyStarted
      ? "in_progress"
      : "pending";
  }

  const production = await Production.create({
    bom: data.bom,
    finished_goods: finishedGoods,
    raw_materials: rawMaterials,
    processes: processes,
    status: data.status || derivedStatus,
    createdBy: req.user?._id,
  });

  res.status(200).json({
    status: 200,
    success: true,
    message: "Production created successfully",
    production,
  });
});

exports.all = TryCatch(async (req, res) => {
  const list = await Production.find({})
    .sort({ createdAt: -1 })
    .populate({
      path: "bom",
      select: "bom_id compound_name compound_code",
    })
    .populate({
      path: "raw_materials.raw_material_id",
      select: "name product_id uom category",
    })
    .populate({
      path: "createdBy",
      select: "name email",
    });

  res.status(200).json({ status: 200, success: true, productions: list });
});

exports.details = TryCatch(async (req, res) => {
  const { id } = req.params;
  const production = await Production.findById(id)
    .populate({
      path: "bom",
      select:
        "bom_id compound_name compound_code rawMaterials compoundingStandards processes",
    })
    .populate({
      path: "raw_materials.raw_material_id",
      select: "name product_id uom category current_stock",
    })
    .populate({
      path: "createdBy",
      select: "name email",
    });

  if (!production) throw new ErrorHandler("Production not found", 404);
  res.status(200).json({ status: 200, success: true, production });
});

exports.update = TryCatch(async (req, res) => {
  const data = req.body;
  const { _id } = data;
  if (!_id) throw new ErrorHandler("Please provide production id (_id)", 400);

  if (Array.isArray(data.finished_goods)) {
    data.finished_goods = data.finished_goods.map((fg) => ({
      ...fg,
      remain_qty: (fg.est_qty || 0) - (fg.prod_qty || 0),
    }));
  }

  if (Array.isArray(data.raw_materials)) {
    data.raw_materials = data.raw_materials.map((rm) => ({
      ...rm,
      remain_qty: (rm.est_qty || 0) - (rm.used_qty || 0),
    }));
  }

  if (Array.isArray(data.processes)) {
    data.processes = data.processes.map((proc) => ({
      ...proc,
      status: proc.done ? "completed" : proc.start ? "in_progress" : "pending",
    }));

    const allDone = data.processes.every(
      (p) => p.done === true || p.status === "completed"
    );
    const anyStarted = data.processes.some(
      (p) => p.start === true || p.status === "in_progress"
    );
    data.status = allDone
      ? "completed"
      : anyStarted
      ? "in_progress"
      : "pending";
  }

  const production = await Production.findByIdAndUpdate(_id, data, {
    new: true,
  })
    .populate({
      path: "bom",
      select: "bom_id compound_name compound_code",
    })
    .populate({
      path: "raw_materials.raw_material_id",
      select: "name product_id uom category",
    });

  if (!production) throw new ErrorHandler("Production not found", 404);
  res
    .status(200)
    .json({
      status: 200,
      success: true,
      message: "Production updated",
      production,
    });
});

exports.remove = TryCatch(async (req, res) => {
  const { id } = req.body;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const deleted = await Production.findByIdAndDelete(id);
  if (!deleted) throw new ErrorHandler("Production not found", 404);
  res
    .status(200)
    .json({ status: 200, success: true, message: "Production deleted" });
});

// Mark production ready for QC (explicit send from UI)
exports.markReadyForQC = TryCatch(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const updated = await Production.findByIdAndUpdate(
    id,
    { ready_for_qc: true },
    { new: true }
  );
  if (!updated) throw new ErrorHandler("Production not found", 404);
  res.status(200).json({ status: 200, success: true, message: "Marked ready for Quality Check", production: updated });
});

  // Approve a completed production: decrement raw materials, increment finished goods in inventory
exports.approve = TryCatch(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const production = await Production.findById(id);
  if (!production) throw new ErrorHandler("Production not found", 404);

  // Process raw materials: prefer used_qty else est_qty
  const rawMaterials = Array.isArray(production.raw_materials) ? production.raw_materials : [];
  for (const rm of rawMaterials) {
    const qtyToConsume = (typeof rm.used_qty === "number" && rm.used_qty > 0) ? rm.used_qty : (rm.est_qty || 0);
    if (qtyToConsume > 0) {
      // Try by ObjectId first
      let product = rm.raw_material_id ? await Product.findById(rm.raw_material_id) : null;
      if (!product && (rm.raw_material_code || rm.raw_material_name)) {
        // Fallback by code or name
        product = await Product.findOne({
          $or: [
            { product_id: rm.raw_material_code || "__none__" },
            { name: rm.raw_material_name || "__none__" },
          ],
        });
      }
      if (product) {
        const nextStock = Math.max(0, (product.current_stock || 0) - qtyToConsume);
        await Product.findByIdAndUpdate(product._id, {
          current_stock: nextStock,
          updated_stock: nextStock,
          change_type: "decrease",
          quantity_changed: qtyToConsume,
        });
      }
    }
  }

  // Process finished goods: prefer prod_qty else est_qty (use first finished good)
  const fg = (Array.isArray(production.finished_goods) ? production.finished_goods : [])[0] || {};
  const fgQty = (typeof fg.prod_qty === "number" && fg.prod_qty > 0) ? fg.prod_qty : (fg.est_qty || 0);
  if (fgQty > 0) {
    let fgProduct = null;
    if (production.bom) {
      // Try to find by compound code/name from finished good
      fgProduct = await Product.findOne({
        $or: [
          { product_id: fg.compound_code || "__none__" },
          { name: fg.compound_name || "__none__" },
        ],
      });
    }
    if (fgProduct) {
      const nextStock = (fgProduct.current_stock || 0) + fgQty;
      await Product.findByIdAndUpdate(fgProduct._id, {
        current_stock: nextStock,
        updated_stock: nextStock,
        change_type: "increase",
        quantity_changed: fgQty,
      });
    }
  }

  // Mark QC done and approved
  await Production.findByIdAndUpdate(id, { qc_status: "approved", qc_done: true });
  return res.status(200).json({ status: 200, success: true, message: "Production approved and inventory updated" });
});

// Reject a production: for now just acknowledge; frontend can reflect status locally
exports.reject = TryCatch(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const production = await Production.findById(id);
  if (!production) throw new ErrorHandler("Production not found", 404);
  await Production.findByIdAndUpdate(id, { qc_status: "rejected", qc_done: true });
  return res.status(200).json({ status: 200, success: true, message: "Production rejected" });
});

// Basic graph data endpoint: counts by status and recent creations timeline
exports.getProductionGraphData = TryCatch(async (req, res) => {
  // Counts by status
  const byStatus = await Production.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  // Last 14 days creations per day
  const since = new Date();
  since.setDate(since.getDate() - 13);
  const timeline = await Production.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          y: { $year: "$createdAt" },
          m: { $month: "$createdAt" },
          d: { $dayOfMonth: "$createdAt" },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } },
  ]);

  res.status(200).json({ status: 200, success: true, data: { byStatus, timeline } });
});

// Mark production ready for QC (explicit send from UI)
exports.markReadyForQC = TryCatch(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const updated = await Production.findByIdAndUpdate(
    id,
    { ready_for_qc: true },
    { new: true }
  );
  if (!updated) throw new ErrorHandler("Production not found", 404);
  res.status(200).json({ status: 200, success: true, message: "Marked ready for Quality Check", production: updated });
});

  // Approve a completed production: decrement raw materials, increment finished goods in inventory
exports.approve = TryCatch(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const production = await Production.findById(id);
  if (!production) throw new ErrorHandler("Production not found", 404);

  // Process raw materials: prefer used_qty else est_qty
  const rawMaterials = Array.isArray(production.raw_materials) ? production.raw_materials : [];
  for (const rm of rawMaterials) {
    const qtyToConsume = (typeof rm.used_qty === "number" && rm.used_qty > 0) ? rm.used_qty : (rm.est_qty || 0);
    if (qtyToConsume > 0) {
      // Try by ObjectId first
      let product = rm.raw_material_id ? await Product.findById(rm.raw_material_id) : null;
      if (!product && (rm.raw_material_code || rm.raw_material_name)) {
        // Fallback by code or name
        product = await Product.findOne({
          $or: [
            { product_id: rm.raw_material_code || "__none__" },
            { name: rm.raw_material_name || "__none__" },
          ],
        });
      }
      if (product) {
        const nextStock = Math.max(0, (product.current_stock || 0) - qtyToConsume);
        await Product.findByIdAndUpdate(product._id, {
          current_stock: nextStock,
          updated_stock: nextStock,
          change_type: "decrease",
          quantity_changed: qtyToConsume,
        });
      }
    }
  }

  // Process finished goods: prefer prod_qty else est_qty (use first finished good)
  const fg = (Array.isArray(production.finished_goods) ? production.finished_goods : [])[0] || {};
  const fgQty = (typeof fg.prod_qty === "number" && fg.prod_qty > 0) ? fg.prod_qty : (fg.est_qty || 0);
  if (fgQty > 0) {
    let fgProduct = null;
    if (production.bom) {
      // Try to find by compound code/name from finished good
      fgProduct = await Product.findOne({
        $or: [
          { product_id: fg.compound_code || "__none__" },
          { name: fg.compound_name || "__none__" },
        ],
      });
    }
    if (fgProduct) {
      const nextStock = (fgProduct.current_stock || 0) + fgQty;
      await Product.findByIdAndUpdate(fgProduct._id, {
        current_stock: nextStock,
        updated_stock: nextStock,
        change_type: "increase",
        quantity_changed: fgQty,
      });
    }
  }

  // Mark QC done and approved
  await Production.findByIdAndUpdate(id, { qc_status: "approved", qc_done: true });
  return res.status(200).json({ status: 200, success: true, message: "Production approved and inventory updated" });
});

// Reject a production: for now just acknowledge; frontend can reflect status locally
exports.reject = TryCatch(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const production = await Production.findById(id);
  if (!production) throw new ErrorHandler("Production not found", 404);
  await Production.findByIdAndUpdate(id, { qc_status: "rejected", qc_done: true });
  return res.status(200).json({ status: 200, success: true, message: "Production rejected" });
});

exports.getProductionGraphData = TryCatch(async (req, res) => {
  // Counts by status
  const byStatus = await Production.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  // Last 14 days creations per day
  const since = new Date();
  since.setDate(since.getDate() - 13);
  const timeline = await Production.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          y: { $year: "$createdAt" },
          m: { $month: "$createdAt" },
          d: { $dayOfMonth: "$createdAt" },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } },
  ]);

  res.status(200).json({ status: 200, success: true, data: { byStatus, timeline } });
});