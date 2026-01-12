const { Schema, model } = require("mongoose");

const bomSchema = new Schema(
  {
    bom_id: {
      type: String,
      unique: true,
      index: true,
    },
    
    bom_type: {
      type: String,
      enum: ["compound", "part-name"],
      default: null,
    },
    
    // Arrays for compound codes, part names, and hardness
    compound_codes: [String],    // Single compound name (requested)
    compound_name: { type: String },
    compound_weight: { type: String },
    compounds: [
      new Schema(
        {
          compound_id: { type: Schema.Types.ObjectId, ref: "Product" },
          compound_name: { type: String },
          compound_code: { type: String },
          hardness: { type: String },
          weight: { type: String },
        },
        { _id: false }
      ),
    ],
    part_names: [String],
    hardnesses: [String],

    // Part Name Details array with tolerance, quantity, and comment arrays
    part_name_details: [
      new Schema(
        {
          part_name_id_name: {
            type: String,
            required: true,
          },
          tolerances: [String],
          quantities: [Number],
          comments: [String],
          product_snapshot: { type: Schema.Types.Mixed },
        },
        { _id: false }
      ),
    ],

    // Raw Materials array with tolerance, quantity, and comment arrays
    raw_materials: [
      new Schema(
        {
          raw_material_id: {
            type: Schema.Types.ObjectId,
            ref: "Product",
            required: true,
          },
          raw_material_name: String,
          tolerances: [String],
          quantities: [Number],
          comments: [String],
          product_snapshot: { type: Schema.Types.Mixed },
        },
        { _id: false }
      ),
    ],

    processes: [String],

    accelerators: [
      new Schema(
        {
          name: String,
          tolerance: String,
          quantity: String,
          comment: String,
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


