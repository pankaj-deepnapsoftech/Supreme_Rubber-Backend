const { Schema, model } = require("mongoose");

const finishedGoodSchema = new Schema(
  {
    bom: { type: Schema.Types.ObjectId, ref: "BOM", required: true },
    compound_code: String,
    compound_name: String,
    est_qty: { type: Number, required: true },
    uom: String,
    prod_qty: { type: Number, default: 0 },
    remain_qty: { type: Number, default: 0 },
    category: String,
    total_cost: { type: Number, default: 0 },
  },
  { _id: false }
);

const rawMaterialSchema = new Schema(
  {
    raw_material_id: { type: Schema.Types.ObjectId, ref: "Product" },
    raw_material_name: String,
    raw_material_code: String,
    est_qty: Number,
    uom: String,
    used_qty: { type: Number, default: 0 },
    remain_qty: { type: Number, default: 0 },
    category: String,
    total_cost: { type: Number, default: 0 },
    weight: String,
    tolerance: String,
    code_no: String,
  },
  { _id: false }
);

const processSchema = new Schema(
  {
    process_name: String,
    work_done: { type: Number, default: 0 },
    start: { type: Boolean, default: false },
    done: { type: Boolean, default: false },
    status: { type: String, enum: ["pending", "in_progress", "completed"], default: "pending" },
  },
  { _id: false }
);

const productionSchema = new Schema(
  {
    production_id: {
      type: String,
      unique: true,
      index: true,
    },
    bom: {
      type: Schema.Types.ObjectId,
      ref: "BOM",
      required: true,
    },
    finished_goods: {
      type: [finishedGoodSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: "At least one finished good must be added",
      },
    },
    raw_materials: {
      type: [rawMaterialSchema],
      default: [],
    },
    processes: {
      type: [processSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed"],
      default: "pending",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Pre-save middleware to generate production_id
productionSchema.pre("save", async function (next) {
  if (!this.production_id) {
    const prefix = "PROD-";
    const ProductionModel = this.constructor;
    const lastProd = await ProductionModel.findOne({ production_id: { $regex: `^${prefix}\\d{4}$` } })
      .sort({ production_id: -1 })
      .limit(1);
    const nextNum = lastProd
      ? parseInt(lastProd.production_id.split("-")[1] || "0", 10) + 1
      : 1;
    this.production_id = `${prefix}${String(nextNum).padStart(4, "0")}`;
  }
  next();
});

const Production = model("Production", productionSchema);
module.exports = Production;

