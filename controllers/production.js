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
    });

  if (!bom) throw new ErrorHandler("BOM not found", 404);

  const finishedGoods = Array.isArray(data.finished_goods)
    ? data.finished_goods.map((fg, idx) => {
        const firstCode = Array.isArray(bom.compound_codes) ? bom.compound_codes[0] : undefined;
        const bomFg = Array.isArray(bom.finished_goods) && bom.finished_goods.length > 0
          ? (bom.finished_goods[idx] || bom.finished_goods[0])
          : null;
        const snap = bomFg?.product_snapshot || {};
        return {
          bom: data.bom,
          compound_code: fg.compound_code || firstCode || "",
          compound_name: fg.compound_name || bom.compound_name || "",
          product_id: snap.product_id || undefined,
          product_name: snap.name || undefined,
          est_qty: fg.est_qty || 0,
          uom: fg.uom || snap.uom || "",
          prod_qty: fg.prod_qty || 0,
          remain_qty: (fg.est_qty || 0) - (fg.prod_qty || 0),
          category: fg.category || snap.category || "",
          total_cost: fg.total_cost || 0,
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
            $sum: "$finished_goods.est_qty",
          },
        },
        totalProdQty: {
          $sum: {
            $sum: "$finished_goods.prod_qty",
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
      throw new ErrorHandler("Invalid period. Use 'weekly', 'monthly', or 'yearly'", 400);
  }

  const grouped = await Production.aggregate([
    { $match: { createdAt: { $gte: periodStart, $lte: periodEnd } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const map = Object.fromEntries(grouped.map((g) => [g._id || "pending", g.count]));
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
      throw new ErrorHandler("Invalid period. Use 'weekly', 'monthly', or 'yearly'", 400);
  }

  const grouped = await Production.aggregate([
    { $match: { createdAt: { $gte: periodStart, $lte: periodEnd } } },
    { $group: { _id: "$qc_status", count: { $sum: 1 } } },
  ]);

  const map = Object.fromEntries(grouped.map((g) => [g._id || "unknown", g.count]));
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

  // Find production record
  const production = await Production.findById(id);

  if (!production) {
    return res.status(404).json({ success: false, message: "Production not found" });
  }

  // === Update QC Status ===
  const updatedProduction = await Production.findByIdAndUpdate(
    id,
    { qc_status: "approved", qc_done: true },
    { new: true }
  );

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
   
    for (const fg of production.finished_goods) {
      const lookupCode = (fg.product_id || fg.compound_code || "").trim();
      const lookupName = (fg.product_name || fg.compound_name || "").trim();
      let product = null;
      if (lookupCode) {
        product = await Product.findOne({ product_id: lookupCode }).session(session);
      }
      if (!product && lookupName) {
        product = await Product.findOne({ name: lookupName }).session(session);
      }
      if (!product) {
        continue; // skip if no matching inventory product
      }
      const delta = Number(fg.prod_qty) || 0;
      const newStock = Math.max(0, (Number(product.current_stock) || 0) + delta);
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
            reason: `Production approval for ${lookupName || lookupCode}`,
          },
        },
        { new: true, session }
      );
    }

    // console.log("hey", production)
 
    for (const rm of production.raw_materials) {
      const rawMaterialId =
        typeof rm.raw_material_id === "object"
          ? rm.raw_material_id
          : rm.raw_material_id;
          const usedQty = rm.used_qty || rm.est_qty || 0;
          const product = await Product.findById(rawMaterialId ).session(session);
      console.log("product", product )

      if (product) {
        const newStock = Math.max(product.current_stock - usedQty, 0);

        await Product.findByIdAndUpdate(
          product._id,
          {
            current_stock: newStock,
            updated_stock: newStock,
            change_type: "decrease",
            quantity_changed: usedQty,
            last_change: {
              production_id: production.production_id,
              changed_on: new Date(),
              change_type: "decrease",
              qty: usedQty,
              reason: `Used in production of ${production.finished_goods[0].compound_name}`,
            },
          },
          { new: true, session }
        );
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Production approved and inventory updated",
      production: updatedProduction,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
});



// Mark a production as rejected by QC
exports.reject = TryCatch(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const updated = await Production.findByIdAndUpdate(
    id,
    { qc_status: "rejected", qc_done: true, qc_reject_reason: reason },
    { new: true }
  );
  if (!updated) throw new ErrorHandler("Production not found", 404);
  return res.status(200).json({
    status: 200,
    success: true,
    message: "Production rejected",
    production: updated,
  });
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