const { Schema, model } = require("mongoose");

const capitalizeFirstLetter = (str) =>
  typeof str === "string" && str.length > 0
    ? str.charAt(0).toUpperCase() + str.slice(1)
    : str;

const userRoleSchema = new Schema(
  {
    role: {
      type: String,
      required: [true, "Role is a required field"],
      unique: true,
      minlength: [2, "Role must be at least 2 characters long"],
      maxlength: [20, "Role cannot exceed 20 characters"],
    },
    permissions: {
      type: [String],
      enum: {
        values: [
          "dashboard",
          "user role",
          "employee",
          "inventory",
          "quality check",
          "production",
          "bom",
          "gateman",
          "supplier",
          "purchase order",
          "production start"
        ],
        message:
          "Permissions should be one of the following: product, store, approval, agent, bom",
      },
    },
    description: {
      type: String,
      maxlength: [100, "Description cannot exceed 100 characters"],
    },
  },
  {
    timestamps: true,
  }
);

userRoleSchema.set("toJSON", {
  transform: function (doc, ret) {
    for (let key in ret) {
      if (key === "permissions") {
        continue;
      }
      if (typeof ret[key] === "string") {
        ret[key] = capitalizeFirstLetter(ret[key]);
      } else if (Array.isArray(ret[key])) {
        ret[key] = ret[key].map((item) => capitalizeFirstLetter(item));
      }
    }
    return ret;
  },
});

const UserRole = model("User-Role", userRoleSchema);
module.exports = UserRole;
