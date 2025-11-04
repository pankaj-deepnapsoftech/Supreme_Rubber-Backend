const Production = require("../models/production");
const BOM = require("../models/bom");
const { TryCatch, ErrorHandler } = require("../utils/error");

exports.create = TryCatch(async (req, res) => {
  const data = req.body;

  if (!data) throw new ErrorHandler("Please provide production data", 400);
  if (!data.bom) throw new ErrorHandler("BOM is required", 400);

  // Fetch BOM to get all related data
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

  // Prepare finished goods from BOM data
  const finishedGoods = Array.isArray(data.finished_goods)
    ? data.finished_goods.map((fg) => {
        const compound =
          bom.compoundingStandards?.find((cs) => cs.compound_code === fg.compound_code) ||
          bom.compoundingStandards?.[0] ||
          bom;

        return {
          bom: data.bom,
          compound_code: fg.compound_code || compound.compound_code || bom.compound_code,
          compound_name: fg.compound_name || compound.compound_name || bom.compound_name,
          est_qty: fg.est_qty || 0,
          uom: fg.uom || compound.product_snapshot?.uom || bom.compound?.uom || "",
          prod_qty: fg.prod_qty || 0,
          remain_qty: (fg.est_qty || 0) - (fg.prod_qty || 0),
          category: fg.category || compound.product_snapshot?.category || bom.compound?.category || "",
          total_cost: fg.total_cost || 0,
        };
      })
    : [];

  // Prepare raw materials from BOM data
  const rawMaterials = Array.isArray(data.raw_materials)
    ? data.raw_materials.map((rm) => {
        const bomRm = bom.rawMaterials?.find(
          (r) => r.raw_material_code === rm.raw_material_code || r.raw_material_name === rm.raw_material_name
        );

        return {
          raw_material_id: rm.raw_material_id || bomRm?.raw_material || null,
          raw_material_name: rm.raw_material_name || bomRm?.raw_material_name || "",
          raw_material_code: rm.raw_material_code || bomRm?.raw_material_code || "",
          est_qty: rm.est_qty || bomRm?.current_stock || 0,
          uom: rm.uom || bomRm?.uom || bomRm?.product_snapshot?.uom || "",
          used_qty: rm.used_qty || 0,
          remain_qty: (rm.est_qty || bomRm?.current_stock || 0) - (rm.used_qty || 0),
          category: rm.category || bomRm?.category || bomRm?.product_snapshot?.category || "",
          total_cost: rm.total_cost || 0,
          weight: rm.weight || bomRm?.weight || "",
          tolerance: rm.tolerance || bomRm?.tolerance || "",
          code_no: rm.code_no || bomRm?.code_no || "",
        };
      })
    : [];

  // Prepare processes from BOM data
  const processes = Array.isArray(data.processes)
    ? data.processes.map((proc, idx) => {
        const bomProcess = bom.processes?.[idx] || bom[`process${idx + 1}`] || "";
        return {
          process_name: proc.process_name || bomProcess || "",
          work_done: proc.work_done || 0,
          start: proc.start || false,
          done: proc.done || false,
          status: proc.done ? "completed" : proc.start ? "in_progress" : "pending",
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

  // Derive overall production status from processes if not explicitly provided
  let derivedStatus = "pending";
  if (Array.isArray(processes) && processes.length > 0) {
    const allDone = processes.every((p) => p.done === true || p.status === "completed");
    const anyStarted = processes.some((p) => p.start === true || p.status === "in_progress");
    derivedStatus = allDone ? "completed" : anyStarted ? "in_progress" : "pending";
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
      select: "bom_id compound_name compound_code rawMaterials compoundingStandards processes",
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

  // Recalculate remain_qty for finished goods
  if (Array.isArray(data.finished_goods)) {
    data.finished_goods = data.finished_goods.map((fg) => ({
      ...fg,
      remain_qty: (fg.est_qty || 0) - (fg.prod_qty || 0),
    }));
  }

  // Recalculate remain_qty for raw materials
  if (Array.isArray(data.raw_materials)) {
    data.raw_materials = data.raw_materials.map((rm) => ({
      ...rm,
      remain_qty: (rm.est_qty || 0) - (rm.used_qty || 0),
    }));
  }

  // Update process status based on start/done flags
  if (Array.isArray(data.processes)) {
    data.processes = data.processes.map((proc) => ({
      ...proc,
      status: proc.done ? "completed" : proc.start ? "in_progress" : "pending",
    }));

    // Derive overall production status from updated processes
    const allDone = data.processes.every((p) => p.done === true || p.status === "completed");
    const anyStarted = data.processes.some((p) => p.start === true || p.status === "in_progress");
    data.status = allDone ? "completed" : anyStarted ? "in_progress" : "pending";
  }

  const production = await Production.findByIdAndUpdate(_id, data, { new: true })
    .populate({
      path: "bom",
      select: "bom_id compound_name compound_code",
    })
    .populate({
      path: "raw_materials.raw_material_id",
      select: "name product_id uom category",
    });

  if (!production) throw new ErrorHandler("Production not found", 404);
  res.status(200).json({ status: 200, success: true, message: "Production updated", production });
});

exports.remove = TryCatch(async (req, res) => {
  const { id } = req.body;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const deleted = await Production.findByIdAndDelete(id);
  if (!deleted) throw new ErrorHandler("Production not found", 404);
  res.status(200).json({ status: 200, success: true, message: "Production deleted" });
});

