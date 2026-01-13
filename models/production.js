const { Schema, model } = require("mongoose");

const partNameSchema = new Schema(
  {
    bom: { type: Schema.Types.ObjectId, ref: "BOM", required: true },
    compound_code: String,
    compound_name: String,
    // Link to inventory product (helps QC approval update correct product)
    product_id: String, // product SKU/id from inventory
    product_name: String, // product name snapshot
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
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed"],
      default: "in_progress",
    },
  },
  { _id: false }
);

const acceleratorSchema = new Schema(
  {
    name: String,
    tolerance: String,
    quantity: String,
    est_qty: { type: Number, default: 0 },
    used_qty: { type: Number, default: 0 },
    remain_qty: { type: Number, default: 0 },
    comment: String,
  },
  { _id: false }
);

const compoundDetailSchema = new Schema(
  {
    compound_id: String,
    compound_name: String,
    compound_code: String,
    hardness: String,
    weight: { type: Number, default: 0 },
    used_qty: { type: Number, default: 0 },
    remain_qty: { type: Number, default: 0 },
  },
  { _id: false }
);

const dailyProductionSchema = new Schema(
  {
    date: { type: Date, required: true },
    quantity_produced: { type: Number, required: true, default: 0 },
    notes: { type: String, default: "" },
    shift: {
      type: String,
      enum: ["morning", "afternoon", "night"],
      default: "morning",
    },
    recorded_by: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
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
    part_names: {
      type: [partNameSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: "At least one part name must be added",
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
    accelerators: {
      type: [acceleratorSchema],
      default: [],
    },
    compound_details: {
      type: [compoundDetailSchema],
      default: [],
    },
    daily_production_records: {
      type: [dailyProductionSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed"],
      default: "in_progress",
    },
    qc_status: {
      type: String,
      enum: ["approved", "rejected", null],
      default: null,
    },
    qc_done: {
      type: Boolean,
      default: false,
    },
    ready_for_qc: {
      type: Boolean,
      default: false,
    },
    approved_qty: {
      type: Number,
      default: 0,
    },
    rejected_qty: {
      type: Number,
      default: 0,
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
    const lastProd = await ProductionModel.findOne({
      production_id: { $regex: `^${prefix}\\d{4}$` },
    })
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
