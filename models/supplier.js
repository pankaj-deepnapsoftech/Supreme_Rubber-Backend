const { Schema, model } = require("mongoose");

const supplierSchema = new Schema(
  {
    supplier_id: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Supplier name is required"],
      minlength: [2, "Name should be at least 2 characters long"],
    },
    company_name: {
      type: String,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
    },
    address: {
      type: String,
    },
    gst_number: {
      type: String,
    },
    // contact_person: {
    //   type: String,
    // },
    // status: {
    //   type: String,
    //   enum: ["active", "inactive"],
    //   default: "active",
    // },
  },
  {
    timestamps: true,
  }
);

const Supplier = model("Supplier", supplierSchema);
module.exports = Supplier;

