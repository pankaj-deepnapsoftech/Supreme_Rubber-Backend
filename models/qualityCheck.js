const { Schema, model } = require("mongoose");

const qualityCheckSchema = new Schema(
  {
    gateman_entry_id: {
      type: Schema.Types.ObjectId,
      ref: "GateMan",
      required: [true, "Gateman entry reference is required"],
    },
    item_id: {
      type: Schema.Types.ObjectId,
      required: [true, "Item ID from gateman entry is required"],
    },
    approved_quantity: {
      type: Number,
      required: [true, "Approved quantity is required"],
      min: [0, "Approved quantity cannot be negative"],
    },
    rejected_quantity: {
      type: Number,
      required: [true, "Rejected quantity is required"],
      min: [0, "Rejected quantity cannot be negative"],
    },
    total_quantity: {
      type: Number,
    },
    max_allowed_quantity: {
      type: Number,
      required: [true, "Maximum allowed quantity is required"],
    },
    status: {
      type: String,
      enum: ["pending", "completed", "reviewed"],
      default: "pending",
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

qualityCheckSchema.pre("save", function (next) {
  this.total_quantity = this.approved_quantity + this.rejected_quantity;

  if (this.total_quantity > this.max_allowed_quantity) {
    const error = new Error(
      `Total quantity (${this.total_quantity}) cannot exceed maximum allowed quantity (${this.max_allowed_quantity})`
    );
    error.name = "ValidationError";
    return next(error);
  }

  next();
});

const QualityCheck = model("QualityCheck", qualityCheckSchema);

module.exports = QualityCheck;
