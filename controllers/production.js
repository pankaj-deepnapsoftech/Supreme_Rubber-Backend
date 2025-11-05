const Production = require("../models/production");
const BOM = require("../models/bom");
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

  const finishedGoods = Array.isArray(data.finished_goods)
    ? data.finished_goods.map((fg) => {
        const compound =
          bom.compoundingStandards?.find(
            (cs) => cs.compound_code === fg.compound_code
          ) ||
          bom.compoundingStandards?.[0] ||
          bom;

        return {
          bom: data.bom,
          compound_code:
            fg.compound_code || compound.compound_code || bom.compound_code,
          compound_name:
            fg.compound_name || compound.compound_name || bom.compound_name,
          est_qty: fg.est_qty || 0,
          uom:
            fg.uom || compound.product_snapshot?.uom || bom.compound?.uom || "",
          prod_qty: fg.prod_qty || 0,
          remain_qty: (fg.est_qty || 0) - (fg.prod_qty || 0),
          category:
            fg.category ||
            compound.product_snapshot?.category ||
            bom.compound?.category ||
            "",
          total_cost: fg.total_cost || 0,
        };
      })
    : [];

  const rawMaterials = Array.isArray(data.raw_materials)
    ? data.raw_materials.map((rm) => {
        const bomRm = bom.rawMaterials?.find(
          (r) =>
            r.raw_material_code === rm.raw_material_code ||
            r.raw_material_name === rm.raw_material_name
        );

        return {
          raw_material_id: rm.raw_material_id || bomRm?.raw_material || null,
          raw_material_name:
            rm.raw_material_name || bomRm?.raw_material_name || "",
          raw_material_code:
            rm.raw_material_code || bomRm?.raw_material_code || "",
          est_qty: rm.est_qty || bomRm?.current_stock || 0,
          uom: rm.uom || bomRm?.uom || bomRm?.product_snapshot?.uom || "",
          used_qty: rm.used_qty || 0,
          remain_qty:
            (rm.est_qty || bomRm?.current_stock || 0) - (rm.used_qty || 0),
          category:
            rm.category ||
            bomRm?.category ||
            bomRm?.product_snapshot?.category ||
            "",
          total_cost: rm.total_cost || 0,
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
  const updated = await Production.findByIdAndUpdate(
    id,
    { qc_status: "approved", qc_done: true },
    { new: true }
  );
  if (!updated) throw new ErrorHandler("Production not found", 404);
  return res.status(200).json({
    status: 200,
    success: true,
    message: "Production approved",
    production: updated,
  });
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