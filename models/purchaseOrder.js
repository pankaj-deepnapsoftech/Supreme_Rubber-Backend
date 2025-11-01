const { Schema, model } = require("mongoose");

const productItemSchema = new Schema(
  {
    item_name: { type: String, required: true }, // product name fetched from Product
    est_quantity: { type: Number, required: true },
    produce_quantity: { type: Number, default: 0 },
    remain_quantity: { type: Number, default: 0 },
    category: { type: String },
    uom:{type:String, required:true} ,
    product_type:{type:String, required:true}
  },
  { _id: false }
);

const purchaseOrderSchema = new Schema(
  {
    po_number: { type: String, required: true, unique: true },
    supplier: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
    products: {
      type: [productItemSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: "At least one product must be added",
      },
    },
    status: {
      type: String,
      enum: ["PO Created", "Accepted", "In Process", "Completed"],
      default: "PO Created",
    },
  },
  { timestamps: true }
);

 module.exports = model("PurchaseOrder", purchaseOrderSchema);
