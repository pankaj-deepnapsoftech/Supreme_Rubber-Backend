const { Schema, model } = require("mongoose");

const purchaseOrderSchema = new Schema(
  {
    po_number: {
      type: String,
      required: true,
      unique: true,
    },
    supplier: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: [true, "Supplier is required"],
    },
    item_name: {
      type: String,
      required: [true, "Item name is required"],
    },
    est_quantity: {
      type: Number,
      required: [true, "Estimated quantity is required"],
    },
    produce_quantity: {
      type: Number,
      default: 0,
    },
    remain_quantity: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
    },
    status: {
      type: String,
      enum: ["PO Created", "Accepted", "In Process", "Completed"],
      default: "PO Created",
    },
  },
  { timestamps: true }
);

const PurchaseOrder = model("PurchaseOrder", purchaseOrderSchema);
module.exports = PurchaseOrder;
