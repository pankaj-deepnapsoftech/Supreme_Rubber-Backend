const { Schema, model } = require("mongoose");

const gateManSchema = new Schema(
  {
    po_ref: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      // required: [true, "PO reference is required"],
    },
    po_number: {
      type: String,
      required: [true, "PO Number is required"],
    },
    invoice_number: {
      type: String,
      required: [true, "Invoice Number is required"],
    },
    company_name: {
      type: String,
      required: [true, "Company Name is required"],
    },
    items: [
      {
        item_name: { type: String, required: true },
        item_quantity: { type: Number, required: true }, // received quantity
        ordered_quantity: { type: Number, default: 0 }, // original ordered quantity
        remaining_quantity: { type: Number, default: 0 }, // quantity yet to receive
      },
    ],
    attached_po: { type: String },
    attached_invoice: { type: String },
    status: {
      type: String,
      enum: ["Entry Created", "Verified", "Completed"],
      default: "Entry Created",
    },
  },
  { timestamps: true }
);

const GateMan = model("GateMan", gateManSchema);
module.exports = GateMan;
