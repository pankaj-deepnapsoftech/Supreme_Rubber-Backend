const { Schema, model } = require("mongoose");

const bomSchema = new Schema(
  {
    bom_id: {
      type: String,
      unique: true,
      index: true,
    },
    
    // Arrays for compound codes, part names, and hardness
    compound_codes: [String],    // Single compound name (requested)
    compound_name: { type: String },
    part_names: [String],
    hardnesses: [String],
    quantity: { type: Number, default: 0 },
    comment: { type: String, default: "" },

    // Finished Goods array with tolerance, quantity, and comment arrays
    finished_goods: [
      new Schema(
        {
          finished_good_id_name: {
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

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

const BOM = model("BOM", bomSchema);
module.exports = BOM;


