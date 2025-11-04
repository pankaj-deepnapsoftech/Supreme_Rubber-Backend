const { Schema, model } = require("mongoose");

const bomSchema = new Schema(
  {
    bom_id: {
      type: String,
      unique: true,
      index: true,
    },
    compound: {
      type: Schema.Types.ObjectId,
      ref: "Product",
    },
    compound_name: String,
    compound_code: String,
    hardness: String,
    part_name: String,

    raw_material: {
      type: Schema.Types.ObjectId,
      ref: "Product",
    },
    raw_material_name: String,
    raw_material_code: String,
    raw_material_uom: String,
    raw_material_category: String,
    raw_material_current_stock: Number,
    raw_material_weight: String,
    raw_material_tolerance: String,

    process1: String,
    process2: String,
    process3: String,
    process4: String,
    processes: [String],

    compoundingStandards: [
      new Schema(
        {
          compound: { type: Schema.Types.ObjectId, ref: "Product" },
          compound_name: String,
          compound_code: String,
          hardness: String,
          part_name: String,
          product_snapshot: { type: Schema.Types.Mixed },
        },
        { _id: false }
      ),
    ],
    rawMaterials: [
      new Schema(
        {
          raw_material: { type: Schema.Types.ObjectId, ref: "Product" },
          raw_material_name: String,
          raw_material_code: String,
          uom: String,
          category: String,
          current_stock: Number,
          weight: String,
          tolerance: String,
          code_no: String,
          product_snapshot: { type: Schema.Types.Mixed },
        },
        { _id: false }
      ),
    ],

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

const BOM = model("BOM", bomSchema);
module.exports = BOM;


