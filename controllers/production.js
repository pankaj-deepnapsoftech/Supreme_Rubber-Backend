const Production = require("../models/production");
const BOM = require("../models/bom");
const { TryCatch, ErrorHandler } = require("../utils/error");
const Product = require("../models/product");
const { default: mongoose } = require("mongoose");

exports.create = TryCatch(async (req, res) => {
  const data = req.body;

  if (!data) throw new ErrorHandler("Please provide production data", 400);
  if (!data.bom) throw new ErrorHandler("BOM is required", 400);

  const bom = await BOM.findById(data.bom)
    .populate({
      path: "raw_materials.raw_material_id",
      select: "uom category current_stock name product_id",
    })
    .populate({
      path: "compounds.compound_id",
      select: "uom category current_stock name product_id",
    });

  if (!bom) throw new ErrorHandler("BOM not found", 404);

  const partNames = Array.isArray(data.part_names)
    ? data.part_names.map((pn, idx) => {
        const firstCode = Array.isArray(bom.compound_codes)
          ? bom.compound_codes[0]
          : undefined;
        const bomPn =
          Array.isArray(bom.part_name_details) &&
          bom.part_name_details.length > 0
            ? bom.part_name_details[idx] || bom.part_name_details[0]
            : null;
        const snap = bomPn?.product_snapshot || {};
        return {
          bom: data.bom,
          compound_code: pn.compound_code || firstCode || "",
          compound_name: pn.compound_name || bom.compound_name || "",
          product_id: snap.product_id || undefined,
          product_name: snap.name || undefined,
          est_qty: pn.est_qty || 0,
          uom: pn.uom || snap.uom || "",
          prod_qty: pn.prod_qty || 0,
          remain_qty: (pn.est_qty || 0) - (pn.prod_qty || 0),
          category: pn.category || snap.category || "",
          total_cost: pn.total_cost || 0,
        };
      })
    : [];

  const rawMaterials = Array.isArray(data.raw_materials)
    ? data.raw_materials.map((rm) => ({
        raw_material_id: rm.raw_material_id || null,
        raw_material_name: rm.raw_material_name || "",
        raw_material_code: rm.raw_material_code || "",
        est_qty: rm.est_qty || 0,
        uom: rm.uom || "",
        used_qty: rm.used_qty || 0,
        remain_qty: (rm.est_qty || 0) - (rm.used_qty || 0),
        category: rm.category || "",
        total_cost: rm.total_cost || 0,
        weight: rm.weight || "",
        tolerance: rm.tolerance || "",
        code_no: rm.code_no || "",
      }))
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
            : "in_progress",
        };
      })
    : (bom.processes || [])
        .map((proc, idx) => ({
          process_name: proc || bom[`process${idx + 1}`] || "",
          work_done: 0,
          start: false,
          done: false,
          status: "in_progress",
        }))
        .filter((p) => p.process_name);

  const accelerators = Array.isArray(data.accelerators)
    ? data.accelerators.map((acc) => {
        const estQty = parseFloat(acc.est_qty || acc.quantity) || 0;
        const usedQty = parseFloat(acc.used_qty) || 0;
        return {
          name: acc.name || "",
          tolerance: acc.tolerance || "",
          quantity: acc.quantity || String(estQty),
          est_qty: estQty,
          used_qty: usedQty,
          remain_qty: estQty - usedQty,
          comment: acc.comment || "",
        };
      })
    : (bom.accelerators || []).map((acc) => {
        const estQty = parseFloat(acc.quantity) || 0;
        return {
          name: acc.name || "",
          tolerance: acc.tolerance || "",
          quantity: acc.quantity || "",
          est_qty: estQty,
          used_qty: 0,
          remain_qty: estQty,
          comment: acc.comment || "",
        };
      });

  let derivedStatus = "in_progress";
  if (Array.isArray(processes) && processes.length > 0) {
    const allDone = processes.every(
      (p) => p.done === true || p.status === "completed"
    );
    const anyStarted = processes.some(
      (p) => p.start === true || p.status === "in_progress"
    );
    // Don't auto-complete status even when all processes are done
    // Status should only be set to "completed" via Finish button
    derivedStatus = allDone
      ? "in_progress" // Changed from "completed" to "in_progress"
      : anyStarted
      ? "in_progress"
      : "in_progress";
  }

  // Start MongoDB transaction for atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate stock availability and decrease inventory
    const stockErrors = [];

    // 1. Decrease raw materials stock
    for (const rm of rawMaterials) {
      if (!rm.raw_material_id) continue;

      const rawMaterialId =
        typeof rm.raw_material_id === "object"
          ? rm.raw_material_id._id || rm.raw_material_id
          : rm.raw_material_id;

      const usedQty = parseFloat(rm.used_qty || rm.est_qty || 0);
      if (usedQty <= 0) continue;

      const product = await Product.findById(rawMaterialId).session(session);

      if (!product) {
        stockErrors.push(
          `Raw material product not found: ${
            rm.raw_material_name || rawMaterialId
          }`
        );
        continue;
      }

      const currentStock = Number(product.current_stock) || 0;
      if (currentStock < usedQty) {
        stockErrors.push(
          `Insufficient stock for ${product.name}. Available: ${currentStock}, Required: ${usedQty}`
        );
        continue;
      }

      const newStock = Math.max(currentStock - usedQty, 0);

      await Product.findByIdAndUpdate(
        product._id,
        {
          current_stock: newStock,
          updated_stock: newStock,
          change_type: "decrease",
          quantity_changed: usedQty,
          last_change: {
            changed_on: new Date(),
            change_type: "decrease",
            qty: usedQty,
            reason: `Used in production start - ${
              partNames[0]?.compound_name || "Production"
            }`,
          },
        },
        { new: true, session }
      );
    }

    // 2. Decrease compounds stock (if BOM has compounds)
    if (
      bom.compounds &&
      Array.isArray(bom.compounds) &&
      bom.compounds.length > 0
    ) {
      // Calculate compound quantity from part_names production quantity
      let compoundQty = 0;
      if (partNames && partNames.length > 0) {
        // Use prod_qty if available, otherwise use est_qty
        const firstPart = partNames[0];
        compoundQty = parseFloat(firstPart.prod_qty || firstPart.est_qty || 0);
      }

      // If no part qty, use first raw material's used_qty as fallback
      if (compoundQty <= 0 && rawMaterials.length > 0) {
        compoundQty = parseFloat(
          rawMaterials[0].used_qty || rawMaterials[0].est_qty || 0
        );
      }

      for (const compound of bom.compounds) {
        if (!compound.compound_id || compoundQty <= 0) continue;

        const compoundId =
          typeof compound.compound_id === "object"
            ? compound.compound_id._id || compound.compound_id
            : compound.compound_id;

        const usedQty = compoundQty;

        const product = await Product.findById(compoundId).session(session);

        if (!product) {
          stockErrors.push(
            `Compound product not found: ${
              compound.compound_name || compoundId
            }`
          );
          continue;
        }

        const currentStock = Number(product.current_stock) || 0;
        // Stock validation removed for compound details - allow production even if stock is insufficient
        // if (currentStock < usedQty) {
        //   stockErrors.push(
        //     `Insufficient stock for compound ${product.name}. Available: ${currentStock}, Required: ${usedQty}`
        //   );
        //   continue;
        // }

        const newStock = Math.max(currentStock - usedQty, 0);

        await Product.findByIdAndUpdate(
          product._id,
          {
            current_stock: newStock,
            updated_stock: newStock,
            change_type: "decrease",
            quantity_changed: usedQty,
            last_change: {
              changed_on: new Date(),
              change_type: "decrease",
              qty: usedQty,
              reason: `Used in production start - ${
                partNames[0]?.compound_name || "Production"
              }`,
            },
          },
          { new: true, session }
        );
      }
    }

    // If there are stock errors, abort transaction
    if (stockErrors.length > 0) {
      await session.abortTransaction();
      session.endSession();
      throw new ErrorHandler(
        `Failed to create production. ${stockErrors.join("; ")}`,
        400
      );
    }

    // Process compound_details
    const compoundDetails = Array.isArray(data.compound_details)
      ? data.compound_details.map((comp) => ({
          compound_id: comp.compound_id || "",
          compound_name: comp.compound_name || "",
          compound_code: comp.compound_code || "",
          hardness: comp.hardness || "",
          weight: parseFloat(comp.weight) || 0,
          used_qty: parseFloat(comp.used_qty) || 0,
          remain_qty: parseFloat(comp.remain_qty) || 0,
        }))
      : [];

    // Create production within transaction
    const production = await Production.create(
      [
        {
          bom: data.bom,
          part_names: partNames,
          raw_materials: rawMaterials,
          processes: processes,
          accelerators: accelerators,
          compound_details: compoundDetails,
          status: data.status || derivedStatus,
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    const createdProduction = production[0];
    const productionId = createdProduction.production_id;

    // Update last_change with production_id for raw materials
    for (const rm of rawMaterials) {
      if (!rm.raw_material_id) continue;

      const rawMaterialId =
        typeof rm.raw_material_id === "object"
          ? rm.raw_material_id._id || rm.raw_material_id
          : rm.raw_material_id;

      const usedQty = parseFloat(rm.used_qty || rm.est_qty || 0);
      if (usedQty <= 0) continue;

      await Product.findByIdAndUpdate(
        rawMaterialId,
        {
          "last_change.production_id": productionId,
        },
        { session }
      );
    }

    // Update last_change with production_id for compounds
    if (
      bom.compounds &&
      Array.isArray(bom.compounds) &&
      bom.compounds.length > 0
    ) {
      for (const compound of bom.compounds) {
        if (!compound.compound_id) continue;

        const compoundId =
          typeof compound.compound_id === "object"
            ? compound.compound_id._id || compound.compound_id
            : compound.compound_id;

        await Product.findByIdAndUpdate(
          compoundId,
          {
            "last_change.production_id": productionId,
          },
          { session }
        );
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: 200,
      success: true,
      message: "Production created successfully and inventory updated",
      production: createdProduction,
    });
  } catch (err) {
    // Rollback transaction on error
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
});

exports.all = TryCatch(async (req, res) => {
  // Parse pagination query parameters
  const page = parseInt(req.query.page, 10) || 1; // Default page = 1
  const limit = parseInt(req.query.limit, 10) || 10; // Default limit = 10
  const skip = (page - 1) * limit;

  // Fetch paginated data
  const list = await Production.find({})
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate({
      path: "bom",
      select: "bom_id bom_type compound_name compound_code",
    })
    .populate({
      path: "raw_materials.raw_material_id",
      select: "name product_id uom category",
    })
    .populate({
      path: "createdBy",
      select: "name email",
    });

  // Count total documents for pagination info
  const total = await Production.countDocuments();

  // Respond with paginated results
  res.status(200).json({
    status: 200,
    success: true,
    productions: list,
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
  const production = await Production.findById(id)
    .populate({
      path: "bom",
      select:
        "bom_id bom_type compound_name compound_code compound_codes compound_weight compounds raw_materials part_names part_name_details hardnesses processes accelerators rawMaterials compoundingStandards",
    })
    .populate({
      path: "raw_materials.raw_material_id",
      select: "name product_id uom category current_stock",
    })
    .populate({
      path: "createdBy",
      select: "name email",
    });

  // Populate nested fields in BOM after BOM is populated
  if (production && production.bom) {
    await production.populate({
      path: "bom.compounds.compound_id",
      select: "name product_id",
    });
    await production.populate({
      path: "bom.raw_materials.raw_material_id",
      select: "name product_id uom category current_stock",
    });
  }

  if (!production) throw new ErrorHandler("Production not found", 404);
  res.status(200).json({ status: 200, success: true, production });
});

exports.update = TryCatch(async (req, res) => {
  const data = req.body;
  const { _id } = data;
  if (!_id) throw new ErrorHandler("Please provide production id (_id)", 400);

  // Get the existing production to compare quantities
  const existingProduction = await Production.findById(_id);
  if (!existingProduction) throw new ErrorHandler("Production not found", 404);

  let quantityChanged = false;
  let oldQuantity = 0;
  let newQuantity = 0;

  if (Array.isArray(data.part_names)) {
    data.part_names = data.part_names.map((pn) => ({
      ...pn,
      remain_qty: (pn.est_qty || 0) - (pn.prod_qty || 0),
    }));

    // Check if production quantity changed
    if (
      existingProduction.part_names &&
      existingProduction.part_names.length > 0
    ) {
      oldQuantity = existingProduction.part_names[0].prod_qty || 0;
      newQuantity = data.part_names[0]?.prod_qty || 0;

      if (oldQuantity !== newQuantity) {
        quantityChanged = true;
      }
    }
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
      status: proc.done
        ? "completed"
        : proc.start
        ? "in_progress"
        : "in_progress",
    }));

    // Don't update production status based on processes
    // Status should only be changed via Finish button (finishProduction endpoint)
    // Always exclude status from update to preserve existing status
    delete data.status;
  }

  if (Array.isArray(data.accelerators)) {
    data.accelerators = data.accelerators.map((acc) => {
      const estQty = parseFloat(acc.est_qty || acc.quantity) || 0;
      const usedQty = parseFloat(acc.used_qty) || 0;
      return {
        name: acc.name || "",
        tolerance: acc.tolerance || "",
        quantity: acc.quantity || String(estQty),
        est_qty: estQty,
        used_qty: usedQty,
        remain_qty: estQty - usedQty,
        comment: acc.comment || "",
      };
    });
  }

  if (Array.isArray(data.compound_details)) {
    data.compound_details = data.compound_details.map((comp) => ({
      compound_id: comp.compound_id || "",
      compound_name: comp.compound_name || "",
      compound_code: comp.compound_code || "",
      hardness: comp.hardness || "",
      weight: parseFloat(comp.weight) || 0,
      used_qty: parseFloat(comp.used_qty) || 0,
      remain_qty: parseFloat(comp.remain_qty) || 0,
    }));
  }

  // If quantity changed, create a daily production record
  if (quantityChanged && newQuantity > oldQuantity) {
    const quantityProduced = newQuantity - oldQuantity;

    // Check if a record already exists for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingTodayRecord =
      existingProduction.daily_production_records?.find((record) => {
        const recordDate = new Date(record.date);
        recordDate.setHours(0, 0, 0, 0);
        return recordDate.getTime() === today.getTime();
      });

    if (existingTodayRecord) {
      // Update existing today's record
      existingTodayRecord.quantity_produced += quantityProduced;
      existingTodayRecord.notes = `Updated: Quantity increased by ${quantityProduced}`;
    } else {
      // Create new daily record
      if (!data.daily_production_records) {
        data.daily_production_records =
          existingProduction.daily_production_records || [];
      }

      data.daily_production_records.push({
        date: today,
        quantity_produced: quantityProduced,
        notes: `Auto-recorded: Production quantity updated from ${oldQuantity} to ${newQuantity}`,
        shift: getCurrentShift(),
        recorded_by: req.user?._id,
      });
    }
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
  res.status(200).json({
    status: 200,
    success: true,
    message: "Production updated",
    production,
  });
});

// Helper function to determine current shift based on time
function getCurrentShift() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return "morning";
  if (hour >= 14 && hour < 22) return "afternoon";
  return "night";
}

exports.remove = TryCatch(async (req, res) => {
  const { id } = req.body;
  if (!id) throw new ErrorHandler("Please provide production id", 400);
  const deleted = await Production.findByIdAndDelete(id);
  if (!deleted) throw new ErrorHandler("Production not found", 404);
  res
    .status(200)
    .json({ status: 200, success: true, message: "Production deleted" });
});

exports.getProductionGraphData = TryCatch(async (req, res) => {
  const { period = "weekly", year = new Date().getFullYear() } = req.query;

  let groupBy, dateFormat, periodStart, periodEnd;
  const currentDate = new Date();

  switch (period.toLowerCase()) {
    case "weekly":
      periodStart = new Date(currentDate);
      periodStart.setDate(currentDate.getDate() - 6);
      periodEnd = new Date(currentDate);
      periodEnd.setHours(23, 59, 59, 999);

      groupBy = {
        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
      };
      break;

    case "monthly":
      periodStart = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      periodEnd = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
      );
      periodEnd.setHours(23, 59, 59, 999);

      groupBy = {
        $dayOfMonth: "$createdAt",
      };
      break;

    case "yearly":
      periodStart = new Date(year, 0, 1);
      periodEnd = new Date(year, 11, 31, 23, 59, 59, 999);

      groupBy = {
        $month: "$createdAt",
      };
      break;

    default:
      throw new ErrorHandler(
        "Invalid period. Use 'weekly', 'monthly', or 'yearly'",
        400
      );
  }

  const productionData = await Production.aggregate([
    {
      $match: {
        createdAt: {
          $gte: periodStart,
          $lte: periodEnd,
        },
      },
    },
    {
      $group: {
        _id: groupBy,
        count: { $sum: 1 },
        totalEstQty: {
          $sum: {
            $sum: "$part_names.est_qty",
          },
        },
        totalProdQty: {
          $sum: {
            $sum: "$part_names.prod_qty",
          },
        },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  let formattedData = [];

  if (period.toLowerCase() === "weekly") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 0; i < 7; i++) {
      const date = new Date(periodStart);
      date.setDate(periodStart.getDate() + i);
      const dateString = date.toISOString().split("T")[0];

      const dayData = productionData.find((d) => d._id === dateString);

      formattedData.push({
        day: days[date.getDay()],
        date: dateString,
        productions: dayData ? dayData.count : 0,
        totalEstQty: dayData ? dayData.totalEstQty : 0,
        totalProdQty: dayData ? dayData.totalProdQty : 0,
      });
    }
  } else if (period.toLowerCase() === "monthly") {
    const daysInMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0
    ).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dayData = productionData.find((d) => d._id === day);

      formattedData.push({
        date: day.toString(),
        productions: dayData ? dayData.count : 0,
        totalEstQty: dayData ? dayData.totalEstQty : 0,
        totalProdQty: dayData ? dayData.totalProdQty : 0,
      });
    }
  } else if (period.toLowerCase() === "yearly") {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    for (let month = 1; month <= 12; month++) {
      const monthData = productionData.find((d) => d._id === month);

      formattedData.push({
        month: months[month - 1],
        monthNumber: month,
        productions: monthData ? monthData.count : 0,
        totalEstQty: monthData ? monthData.totalEstQty : 0,
        totalProdQty: monthData ? monthData.totalProdQty : 0,
      });
    }
  }

  res.status(200).json({
    status: 200,
    success: true,
    message: "Production graph data retrieved successfully",
    data: {
      period: period.toLowerCase(),
      year:
        period.toLowerCase() === "yearly" ? year : currentDate.getFullYear(),
      graphData: formattedData,
      summary: {
        totalProductions: productionData.reduce(
          (sum, item) => sum + item.count,
          0
        ),
        totalEstQty: productionData.reduce(
          (sum, item) => sum + item.totalEstQty,
          0
        ),
        totalProdQty: productionData.reduce(
          (sum, item) => sum + item.totalProdQty,
          0
        ),
      },
    },
  });
});

// Production status stats over a period (pending, in_progress, completed)
exports.statusStats = TryCatch(async (req, res) => {
  const { period = "weekly", year = new Date().getFullYear() } = req.query;

  const now = new Date();
  let periodStart;
  let periodEnd;

  switch ((period || "").toString().toLowerCase()) {
    case "weekly": {
      periodStart = new Date(now);
      periodStart.setDate(now.getDate() - 6);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(now);
      periodEnd.setHours(23, 59, 59, 999);
      break;
    }
    case "monthly": {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      periodEnd.setHours(23, 59, 59, 999);
      break;
    }
    case "yearly": {
      const y = Number(year) || now.getFullYear();
      periodStart = new Date(y, 0, 1);
      periodEnd = new Date(y, 11, 31, 23, 59, 59, 999);
      break;
    }
    default:
      throw new ErrorHandler(
        "Invalid period. Use 'weekly', 'monthly', or 'yearly'",
        400
      );
  }

  const grouped = await Production.aggregate([
    { $match: { createdAt: { $gte: periodStart, $lte: periodEnd } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const map = Object.fromEntries(
    grouped.map((g) => [g._id || "pending", g.count])
  );
  return res.status(200).json({
    status: 200,
    success: true,
    message: "Production status stats retrieved successfully",
    data: {
      pending: map["pending"] || 0,
      in_progress: map["in_progress"] || 0,
      completed: map["completed"] || 0,
    },
  });
});

// QC stats over a period (approved vs rejected)
exports.qcStats = TryCatch(async (req, res) => {
  const { period = "weekly", year = new Date().getFullYear() } = req.query;

  const now = new Date();
  let periodStart;
  let periodEnd;

  switch ((period || "").toString().toLowerCase()) {
    case "weekly": {
      periodStart = new Date(now);
      periodStart.setDate(now.getDate() - 6);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(now);
      periodEnd.setHours(23, 59, 59, 999);
      break;
    }
    case "monthly": {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      periodEnd.setHours(23, 59, 59, 999);
      break;
    }
    case "yearly": {
      const y = Number(year) || now.getFullYear();
      periodStart = new Date(y, 0, 1);
      periodEnd = new Date(y, 11, 31, 23, 59, 59, 999);
      break;
    }
    default:
      throw new ErrorHandler(
        "Invalid period. Use 'weekly', 'monthly', or 'yearly'",
        400
      );
  }

  const grouped = await Production.aggregate([
    { $match: { createdAt: { $gte: periodStart, $lte: periodEnd } } },
    { $group: { _id: "$qc_status", count: { $sum: 1 } } },
  ]);

  const map = Object.fromEntries(
    grouped.map((g) => [g._id || "unknown", g.count])
  );
  return res.status(200).json({
    status: 200,
    success: true,
    message: "Production QC stats retrieved successfully",
    data: {
      approved: map["approved"] || 0,
      rejected: map["rejected"] || 0,
    },
  });
});

// Mark a production as approved by QC
exports.approve = TryCatch(async (req, res) => {
  const { id } = req.params;
  const { approved_qty = 0, rejected_qty = 0 } = req.body;

  // Find production record with BOM populated
  const production = await Production.findById(id).populate({
    path: "bom",
    select: "part_name_details compound_name compound_codes",
  });

  if (!production) {
    return res
      .status(404)
      .json({ success: false, message: "Production not found" });
  }

  // === Update QC Status ===
  const updatedProduction = await Production.findByIdAndUpdate(
    id,
    {
      qc_status: "approved",
      qc_done: true,
      approved_qty: parseFloat(approved_qty) || 0,
      rejected_qty: parseFloat(rejected_qty) || 0,
    },
    { new: true }
  );

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Update part names inventory
    for (const pn of production.part_names) {
      const lookupCode = (pn.product_id || pn.compound_code || "").trim();
      const lookupName = (pn.product_name || pn.compound_name || "").trim();
      let product = null;

      // Try to get product reference from BOM's part_name_details
      let bomPartName = null;
      if (production.bom && Array.isArray(production.bom.part_name_details)) {
        bomPartName = production.bom.part_name_details.find(
          (bomPn) =>
            (bomPn.part_name_id_name &&
              (bomPn.part_name_id_name.includes(pn.compound_code) ||
                bomPn.part_name_id_name.includes(pn.compound_name) ||
                bomPn.part_name_id_name.includes(lookupCode) ||
                bomPn.part_name_id_name.includes(lookupName))) ||
            (bomPn.product_snapshot &&
              (bomPn.product_snapshot.product_id === lookupCode ||
                bomPn.product_snapshot.name === lookupName))
        );

        // If found, try to extract product ID from part_name_id_name (format: "productId-productName")
        if (bomPartName && bomPartName.part_name_id_name) {
          const pnIdName = bomPartName.part_name_id_name;
          // Check if it's in "id-name" format
          if (pnIdName.includes("-")) {
            const possibleId = pnIdName.split("-")[0].trim();
            // Try as ObjectId first
            if (mongoose.Types.ObjectId.isValid(possibleId)) {
              product = await Product.findById(possibleId).session(session);
            }
            // If not found, try as product_id
            if (!product) {
              product = await Product.findOne({
                product_id: possibleId,
              }).session(session);
            }
          }
          // Also try the whole string as product_id
          if (!product) {
            product = await Product.findOne({ product_id: pnIdName }).session(
              session
            );
          }
        }

        // Also try product_snapshot from BOM
        if (!product && bomPartName && bomPartName.product_snapshot) {
          const snap = bomPartName.product_snapshot;
          if (snap.product_id) {
            product = await Product.findOne({
              product_id: snap.product_id,
            }).session(session);
          }
          if (
            !product &&
            snap._id &&
            mongoose.Types.ObjectId.isValid(snap._id)
          ) {
            product = await Product.findById(snap._id).session(session);
          }
        }
      }

      // Try multiple lookup strategies if product not found from BOM
      if (!product && lookupCode) {
        // Try by product_id (exact match)
        product = await Product.findOne({ product_id: lookupCode }).session(
          session
        );

        // If not found and lookupCode might be an ObjectId, try by _id
        if (!product && mongoose.Types.ObjectId.isValid(lookupCode)) {
          product = await Product.findById(lookupCode).session(session);
        }
      }

      // Try by name (case-insensitive partial match)
      if (!product && lookupName) {
        // Exact match first
        product = await Product.findOne({
          name: {
            $regex: new RegExp(
              `^${lookupName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i"
            ),
          },
        }).session(session);

        // If exact match fails, try partial match
        if (!product) {
          product = await Product.findOne({
            name: {
              $regex: new RegExp(
                lookupName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "i"
              ),
            },
          }).session(session);
        }
      }

      // Try by compound_code if it exists in product (some products might have compound_code field)
      if (!product && lookupCode) {
        product = await Product.findOne({
          $or: [
            { compound_code: lookupCode },
            { name: { $regex: new RegExp(lookupCode, "i") } },
          ],
        }).session(session);
      }

      if (!product) {
        const errorMsg = `Product not found for part name - Code: ${lookupCode}, Name: ${lookupName}, Production ID: ${production.production_id}. Cannot update inventory.`;
        console.error(errorMsg);
        // Don't abort here - let catch block handle it
        throw new ErrorHandler(errorMsg, 404);
      }

      // Use approved_qty if provided, otherwise use prod_qty
      const approvedQty = parseFloat(approved_qty) || 0;
      const rejectedQty = parseFloat(rejected_qty) || 0;
      const delta = approvedQty > 0 ? approvedQty : Number(pn.prod_qty) || 0;

      // Update approved quantity to current_stock
      if (delta > 0) {
        const currentStock = Number(product.current_stock) || 0;
        const newStock = currentStock + delta;

        console.log(
          `Updating part name inventory - Product: ${product.name}, Current: ${currentStock}, Adding: ${delta}, New: ${newStock}`
        );

        await Product.findByIdAndUpdate(
          product._id,
          {
            current_stock: newStock,
            updated_stock: newStock,
            change_type: "increase",
            quantity_changed: delta,
            last_change: {
              production_id: production.production_id,
              changed_on: new Date(),
              change_type: "increase",
              qty: delta,
              reason: `Production approval for ${
                lookupName || lookupCode
              } (Approved: ${approvedQty}, Rejected: ${rejectedQty})`,
            },
          },
          { new: true, session }
        );

        console.log(
          `Part name inventory updated successfully for ${product.name}`
        );
      }

      // Update rejected quantity to reject_stock
      if (rejectedQty > 0) {
        const currentRejectStock = Number(product.reject_stock) || 0;
        const newRejectStock = currentRejectStock + rejectedQty;

        console.log(
          `Updating part name reject inventory - Product: ${product.name}, Current Reject Stock: ${currentRejectStock}, Adding: ${rejectedQty}, New Reject Stock: ${newRejectStock}`
        );

        await Product.findByIdAndUpdate(
          product._id,
          {
            reject_stock: newRejectStock,
            // Do NOT update last_change here - only approved quantity should update last_change
          },
          { new: true, session }
        );

        console.log(
          `Part name reject inventory updated successfully for ${product.name}`
        );
      }

      if (delta <= 0 && rejectedQty <= 0) {
        console.log(
          `Skipping part name update - approved_qty/prod_qty and rejected_qty are 0 or invalid for ${
            lookupName || lookupCode
          }`
        );
        continue;
      }
    }

    // === Update Compound Inventory for Compound-type Productions ===
    // If this is a compound production (bomType = "compound"), increase compound inventory
    if (
      production.bom &&
      production.part_names &&
      production.part_names.length > 0
    ) {
      const firstPartName = production.part_names[0];
      const compoundCode = firstPartName.compound_code;
      const compoundName = firstPartName.compound_name;

      // Check if this is a compound-type production by looking at BOM type or compound existence
      const isCompoundProduction =
        production.bom.bom_type === "compound" ||
        (production.bom.compounds && production.bom.compounds.length > 0);

      if (isCompoundProduction && (compoundCode || compoundName)) {
        const approvedQty = parseFloat(approved_qty) || 0;
        const rejectedQty = parseFloat(rejected_qty) || 0;
        const delta =
          approvedQty > 0 ? approvedQty : Number(firstPartName.prod_qty) || 0;

        // Find the compound product in inventory
        let compoundProduct = null;

        // Try to find by product_id (compound_code)
        if (compoundCode) {
          compoundProduct = await Product.findOne({
            product_id: compoundCode,
          }).session(session);
        }

        // Try to find by name if not found by code
        if (!compoundProduct && compoundName) {
          compoundProduct = await Product.findOne({
            name: {
              $regex: new RegExp(
                `^${compoundName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                "i"
              ),
            },
            category: { $regex: /compound/i },
          }).session(session);
        }

        if (compoundProduct && delta > 0) {
          const currentStock = Number(compoundProduct.current_stock) || 0;
          const newStock = currentStock + delta;

          console.log(
            `Updating compound inventory - Product: ${compoundProduct.name}, Current: ${currentStock}, Adding: ${delta}, New: ${newStock}`
          );

          await Product.findByIdAndUpdate(
            compoundProduct._id,
            {
              current_stock: newStock,
              updated_stock: newStock,
              change_type: "increase",
              quantity_changed: delta,
              last_change: {
                production_id: production.production_id,
                changed_on: new Date(),
                change_type: "increase",
                qty: delta,
                reason: `Compound production approved - ${
                  compoundName || compoundCode
                } (Approved: ${approvedQty}, Rejected: ${rejectedQty})`,
              },
            },
            { new: true, session }
          );

          console.log(
            `Compound inventory updated successfully for ${compoundProduct.name}`
          );
        }

        // Update rejected quantity to reject_stock for compound (separate update)
        if (compoundProduct && rejectedQty > 0) {
          const currentRejectStock = Number(compoundProduct.reject_stock) || 0;
          const newRejectStock = currentRejectStock + rejectedQty;

          console.log(
            `Updating compound reject inventory - Product: ${compoundProduct.name}, Current Reject Stock: ${currentRejectStock}, Adding: ${rejectedQty}, New Reject Stock: ${newRejectStock}`
          );

          await Product.findByIdAndUpdate(
            compoundProduct._id,
            {
              reject_stock: newRejectStock,
              // Do NOT update last_change here - only approved quantity should update last_change
            },
            { new: true, session }
          );

          console.log(
            `Compound reject inventory updated successfully for ${compoundProduct.name}`
          );
        }

        if (!compoundProduct) {
          console.log(
            `Compound product not found in inventory: ${
              compoundName || compoundCode
            }`
          );
        }
      }
    }

    // console.log("hey", production)

    // Raw materials are already decreased when production starts (in create function)
    // No need to decrease again on approval
    // for (const rm of production.raw_materials) {
    //   const rawMaterialId =
    //     typeof rm.raw_material_id === "object"
    //       ? rm.raw_material_id
    //       : rm.raw_material_id;
    //       const usedQty = rm.used_qty || rm.est_qty || 0;
    //       const product = await Product.findById(rawMaterialId ).session(session);
    //   console.log("product", product )

    //   if (product) {
    //     const newStock = Math.max(product.current_stock - usedQty, 0);

    //     await Product.findByIdAndUpdate(
    //       product._id,
    //       {
    //         current_stock: newStock,
    //         updated_stock: newStock,
    //         change_type: "decrease",
    //         quantity_changed: usedQty,
    //         last_change: {
    //           production_id: production.production_id,
    //           changed_on: new Date(),
    //           change_type: "decrease",
    //           qty: usedQty,
    //           reason: `Used in production of ${production.part_names[0].compound_name}`,
    //         },
    //       },
    //       { new: true, session }
    //     );
    //   }
    // }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Production approved and inventory updated",
      production: updatedProduction,
    });
  } catch (err) {
    // Only abort if transaction is still in progress
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
});

// Mark a production as rejected by QC
exports.reject = TryCatch(async (req, res) => {
  const { id } = req.params;
  const { reason, approved_qty = 0, rejected_qty = 0 } = req.body || {};

  // Find production record with BOM populated
  const production = await Production.findById(id).populate({
    path: "bom",
    select: "part_name_details compound_name compound_codes",
  });

  if (!production) {
    return res
      .status(404)
      .json({ success: false, message: "Production not found" });
  }

  // === Update QC Status ===
  const updatedProduction = await Production.findByIdAndUpdate(
    id,
    {
      qc_status: "rejected",
      qc_done: true,
      qc_reject_reason: reason,
      approved_qty: parseFloat(approved_qty) || 0,
      rejected_qty: parseFloat(rejected_qty) || 0,
    },
    { new: true }
  );

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Update part names inventory with rejected quantity
    for (const pn of production.part_names) {
      const lookupCode = (pn.product_id || pn.compound_code || "").trim();
      const lookupName = (pn.product_name || pn.compound_name || "").trim();
      let product = null;

      // Try to get product reference from BOM's part_name_details
      let bomPartName = null;
      if (production.bom && Array.isArray(production.bom.part_name_details)) {
        bomPartName = production.bom.part_name_details.find(
          (bomPn) =>
            (bomPn.part_name_id_name &&
              (bomPn.part_name_id_name.includes(pn.compound_code) ||
                bomPn.part_name_id_name.includes(pn.compound_name) ||
                bomPn.part_name_id_name.includes(lookupCode) ||
                bomPn.part_name_id_name.includes(lookupName))) ||
            (bomPn.product_snapshot &&
              (bomPn.product_snapshot.product_id === lookupCode ||
                bomPn.product_snapshot.name === lookupName))
        );

        // If found, try to extract product ID from part_name_id_name (format: "productId-productName")
        if (bomPartName && bomPartName.part_name_id_name) {
          const pnIdName = bomPartName.part_name_id_name;
          // Check if it's in "id-name" format
          if (pnIdName.includes("-")) {
            const possibleId = pnIdName.split("-")[0].trim();
            // Try as ObjectId first
            if (mongoose.Types.ObjectId.isValid(possibleId)) {
              product = await Product.findById(possibleId).session(session);
            }
            // If not found, try as product_id
            if (!product) {
              product = await Product.findOne({
                product_id: possibleId,
              }).session(session);
            }
          }
          // Also try the whole string as product_id
          if (!product) {
            product = await Product.findOne({ product_id: pnIdName }).session(
              session
            );
          }
        }

        // Also try product_snapshot from BOM
        if (!product && bomPartName && bomPartName.product_snapshot) {
          const snap = bomPartName.product_snapshot;
          if (snap.product_id) {
            product = await Product.findOne({
              product_id: snap.product_id,
            }).session(session);
          }
          if (
            !product &&
            snap._id &&
            mongoose.Types.ObjectId.isValid(snap._id)
          ) {
            product = await Product.findById(snap._id).session(session);
          }
        }
      }

      // Try multiple lookup strategies if product not found from BOM
      if (!product && lookupCode) {
        // Try by product_id (exact match)
        product = await Product.findOne({ product_id: lookupCode }).session(
          session
        );

        // If not found and lookupCode might be an ObjectId, try by _id
        if (!product && mongoose.Types.ObjectId.isValid(lookupCode)) {
          product = await Product.findById(lookupCode).session(session);
        }
      }

      // Try by name (case-insensitive partial match)
      if (!product && lookupName) {
        // Exact match first
        product = await Product.findOne({
          name: {
            $regex: new RegExp(
              `^${lookupName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i"
            ),
          },
        }).session(session);

        // If exact match fails, try partial match
        if (!product) {
          product = await Product.findOne({
            name: {
              $regex: new RegExp(
                lookupName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "i"
              ),
            },
          }).session(session);
        }
      }

      // Try by compound_code if it exists in product (some products might have compound_code field)
      if (!product && lookupCode) {
        product = await Product.findOne({
          $or: [
            { compound_code: lookupCode },
            { name: { $regex: new RegExp(lookupCode, "i") } },
          ],
        }).session(session);
      }

      if (!product) {
        const errorMsg = `Product not found for part name - Code: ${lookupCode}, Name: ${lookupName}, Production ID: ${production.production_id}. Cannot update inventory.`;
        console.error(errorMsg);
        // Don't abort here - let catch block handle it
        throw new ErrorHandler(errorMsg, 404);
      }

      // Use rejected_qty to add to reject_stock
      const rejectedQty = parseFloat(rejected_qty) || 0;

      if (rejectedQty > 0) {
        const currentRejectStock = Number(product.reject_stock) || 0;
        const newRejectStock = currentRejectStock + rejectedQty;

        console.log(
          `Updating rejected inventory - Product: ${product.name}, Current Reject Stock: ${currentRejectStock}, Adding: ${rejectedQty}, New Reject Stock: ${newRejectStock}`
        );

        await Product.findByIdAndUpdate(
          product._id,
          {
            reject_stock: newRejectStock,
            last_change: {
              production_id: production.production_id,
              changed_on: new Date(),
              change_type: "increase",
              qty: rejectedQty,
              reason: `Production rejection for ${
                lookupName || lookupCode
              } (Rejected: ${rejectedQty})`,
            },
          },
          { new: true, session }
        );

        console.log(
          `Rejected inventory updated successfully for ${product.name}`
        );
      }
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: 200,
      success: true,
      message: "Production rejected and inventory updated",
      production: updatedProduction,
    });
  } catch (err) {
    // Only abort if transaction is still in progress
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
});

// Mark a production as ready for QC
exports.markReadyForQC = TryCatch(async (req, res) => {
  const { id } = req.params;
  const updated = await Production.findByIdAndUpdate(
    id,
    { ready_for_qc: true },
    { new: true }
  );
  if (!updated) throw new ErrorHandler("Production not found", 404);
  return res.status(200).json({
    status: 200,
    success: true,
    message: "Production marked ready for QC",
    production: updated,
  });
});

// Finish production - mark as completed
exports.finishProduction = TryCatch(async (req, res) => {
  const { id } = req.params;
  const updated = await Production.findByIdAndUpdate(
    id,
    { status: "completed" },
    { new: true }
  )
    .populate({
      path: "bom",
      select: "bom_id compound_name compound_code",
    })
    .populate({
      path: "raw_materials.raw_material_id",
      select: "name product_id uom category",
    });
  if (!updated) throw new ErrorHandler("Production not found", 404);
  return res.status(200).json({
    status: 200,
    success: true,
    message: "Production marked as completed",
    production: updated,
  });
});

// Get QC History - all productions with qc_done: true and gateman quality checks
exports.getQcHistory = TryCatch(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const QualityCheck = require("../models/qualityCheck");

  // Fetch Production QC history
  const productionHistory = await Production.find({ qc_done: true })
    .populate({
      path: "bom",
      select: "compound_name compound_codes",
    })
    .sort({ updatedAt: -1 })
    .lean();

  // Fetch Gateman Quality Check history
  const gatemanHistory = await QualityCheck.find({})
    .populate({
      path: "gateman_entry_id",
      select: "po_number company_name invoice_number",
    })
    .sort({ updatedAt: -1 })
    .lean();

  // Combine and format both histories
  const combinedHistory = [
    ...productionHistory.map((item) => ({
      ...item,
      qc_type: "production",
      id: item._id,
    })),
    ...gatemanHistory.map((item) => ({
      ...item,
      qc_type: "gateman",
      id: item._id,
      approved_qty: item.approved_quantity,
      rejected_qty: item.rejected_quantity,
    })),
  ];

  // Sort by updatedAt descending
  combinedHistory.sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAt);
    const dateB = new Date(b.updatedAt || b.createdAt);
    return dateB - dateA;
  });

  // Paginate
  const total = combinedHistory.length;
  const paginatedHistory = combinedHistory.slice(skip, skip + limit);

  return res.status(200).json({
    status: 200,
    success: true,
    message: "QC history retrieved successfully",
    history: paginatedHistory,
    page,
    limit,
    total,
  });
});

// Delete QC History entry
exports.deleteQcHistory = TryCatch(async (req, res) => {
  const { id } = req.params;
  const { type } = req.query; // 'production' or 'gateman'

  if (type === "gateman") {
    const QualityCheck = require("../models/qualityCheck");
    const qualityCheck = await QualityCheck.findById(id);

    if (!qualityCheck) {
      throw new ErrorHandler("Quality check not found", 404);
    }

    await QualityCheck.findByIdAndDelete(id);

    return res.status(200).json({
      status: 200,
      success: true,
      message: "Gateman QC history entry deleted successfully",
    });
  } else {
    // Production QC
    const production = await Production.findById(id);
    if (!production) {
      throw new ErrorHandler("Production not found", 404);
    }

    if (!production.qc_done) {
      throw new ErrorHandler("This production is not in QC history", 400);
    }

    // Remove QC status but keep the production record
    const updated = await Production.findByIdAndUpdate(
      id,
      {
        qc_done: false,
        qc_status: null,
        approved_qty: 0,
        rejected_qty: 0,
        qc_reject_reason: null,
      },
      { new: true }
    );

    return res.status(200).json({
      status: 200,
      success: true,
      message: "Production QC history entry deleted successfully",
      production: updated,
    });
  }
});

// Daily Production Records Management

// Add daily production record
exports.addDailyProductionRecord = TryCatch(async (req, res) => {
  const { productionId } = req.params;
  const { date, quantity_produced, notes, shift } = req.body;

  if (!date || quantity_produced === undefined) {
    throw new ErrorHandler("Date and quantity_produced are required", 400);
  }

  const production = await Production.findById(productionId);
  if (!production) {
    throw new ErrorHandler("Production not found", 404);
  }

  const newRecord = {
    date: new Date(date),
    quantity_produced: Number(quantity_produced),
    notes: notes || "",
    shift: shift || "morning",
    recorded_by: req.user?._id,
  };

  production.daily_production_records.push(newRecord);
  await production.save();

  return res.status(200).json({
    status: 200,
    success: true,
    message: "Daily production record added successfully",
    production,
  });
});

// Update daily production record
exports.updateDailyProductionRecord = TryCatch(async (req, res) => {
  const { productionId, recordId } = req.params;
  const { date, quantity_produced, notes, shift } = req.body;

  const production = await Production.findById(productionId);
  if (!production) {
    throw new ErrorHandler("Production not found", 404);
  }

  const record = production.daily_production_records.id(recordId);
  if (!record) {
    throw new ErrorHandler("Daily production record not found", 404);
  }

  if (date) record.date = new Date(date);
  if (quantity_produced !== undefined)
    record.quantity_produced = Number(quantity_produced);
  if (notes !== undefined) record.notes = notes;
  if (shift) record.shift = shift;

  await production.save();

  return res.status(200).json({
    status: 200,
    success: true,
    message: "Daily production record updated successfully",
    production,
  });
});

// Delete daily production record
exports.deleteDailyProductionRecord = TryCatch(async (req, res) => {
  const { productionId, recordId } = req.params;

  const production = await Production.findById(productionId);
  if (!production) {
    throw new ErrorHandler("Production not found", 404);
  }

  const record = production.daily_production_records.id(recordId);
  if (!record) {
    throw new ErrorHandler("Daily production record not found", 404);
  }

  record.deleteOne();
  await production.save();

  return res.status(200).json({
    status: 200,
    success: true,
    message: "Daily production record deleted successfully",
    production,
  });
});

// Get all daily production records for a production
exports.getDailyProductionRecords = TryCatch(async (req, res) => {
  const { productionId } = req.params;

  const production = await Production.findById(productionId)
    .select("production_id daily_production_records part_names")
    .populate("daily_production_records.recorded_by", "name email");

  if (!production) {
    throw new ErrorHandler("Production not found", 404);
  }

  return res.status(200).json({
    status: 200,
    success: true,
    production_id: production.production_id,
    records: production.daily_production_records,
    total_produced: production.daily_production_records.reduce(
      (sum, record) => sum + (record.quantity_produced || 0),
      0
    ),
  });
});
