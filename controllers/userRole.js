const UserRole = require("../models/userRole");
const { TryCatch, ErrorHandler } = require("../utils/error");

exports.create = TryCatch(async (req, res) => {
  const roleData = req.body;

  if (!roleData) {
    throw new ErrorHandler("Please provide all the fields", 400);
  }

  let permis = roleData?.permissions || [];
  let data = [];

  // If inventory is selected, automatically add inventory sub-modules
  if (permis?.includes("inventory")) {
    const inventoryModules = ["raw material", "part name", "compound name"];
    inventoryModules.forEach((module) => {
      if (!permis.includes(module)) {
        data.push(module);
      }
    });
  }

  // Trim whitespace from role name
  const trimmedRoleName = (roleData.role || "").trim();

  if (!trimmedRoleName) {
    throw new ErrorHandler("Role name is required", 400);
  }

  // Check if role already exists (case-insensitive)
  const existingRole = await UserRole.findOne({
    role: {
      $regex: new RegExp(
        `^${trimmedRoleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      ),
    },
  });

  if (existingRole) {
    throw new ErrorHandler(`Role "${trimmedRoleName}" already exists`, 400);
  }

  // Create role with trimmed name
  try {
    const createdRole = await UserRole.create({
      ...roleData,
      role: trimmedRoleName,
      permissions: [...data, ...permis],
    });

    res.status(200).json({
      status: 200,
      success: true,
      message: "User role has been created successfully",
      role: createdRole,
    });
  } catch (dbError) {
    // Handle MongoDB duplicate key error (E11000)
    if (dbError.code === 11000 || dbError.name === "MongoServerError") {
      throw new ErrorHandler(`Role "${trimmedRoleName}" already exists`, 400);
    }
    throw dbError;
  }
});
exports.edit = TryCatch(async (req, res) => {
  const { _id, role, description, permissions } = req.body;
  console.log(req.body);

  if (!_id) {
    throw new ErrorHandler("_id is a required field", 400);
  }

  const userRole = await UserRole.findById(_id);
  if (!userRole) {
    throw new ErrorHandler("User role not found", 400);
  }


  // Handle inventory permissions
  let finalPermissions = permissions || [];
  if (finalPermissions.includes("inventory")) {
    const inventoryModules = ["raw material", "part name", "compound name"];
    inventoryModules.forEach((module) => {
      if (!finalPermissions.includes(module)) {
        finalPermissions.push(module);
      }
    });
  }

  // Trim whitespace from role name
  const trimmedRoleName = (role || "").trim();

  if (!trimmedRoleName) {
    throw new ErrorHandler("Role name is required", 400);
  }

  // Check if role name already exists (case-insensitive, excluding current role)
  if (trimmedRoleName.toLowerCase() !== userRole.role.toLowerCase()) {
    const existingRole = await UserRole.findOne({
      role: {
        $regex: new RegExp(
          `^${trimmedRoleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i"
        ),
      },
      _id: { $ne: _id },
    });

    if (existingRole) {
      throw new ErrorHandler(`Role "${trimmedRoleName}" already exists`, 400);
    }
  }

  try {
    const roleUpdated = await UserRole.findByIdAndUpdate(
       _id ,
      {
        $set: {
          role: trimmedRoleName,
          description,
          permissions: finalPermissions,
        },
      },
      { new: true }
    );

    res.status(200).json({
      status: 200,
      success: true,
      message: "User role has been updated successfully",
      role: roleUpdated,
    });
  } catch (dbError) {
    // Handle MongoDB duplicate key error (E11000)
    if (dbError.code === 11000 || dbError.name === "MongoServerError") {
      throw new ErrorHandler(`Role "${trimmedRoleName}" already exists`, 400);
    }
    throw dbError;
  }
});
exports.remove = TryCatch(async (req, res) => {
  const { _id } = req.body;
  if (!_id) {
    throw new ErrorHandler("id is a required field", 400);
  }

  const userRole = await UserRole.findById(_id);
  if (!userRole) {
    throw new ErrorHandler("User role not found", 400);
  }
  await userRole.deleteOne();

  res.status(200).json({
    status: 200,
    success: true,
    message: "User role has been deleted successfully",
  });
});
exports.details = TryCatch(async (req, res) => {
  const { _id } = req.params;
  if (!_id) {
    throw new ErrorHandler("_id is a required field", 400);
  }

  const userRole = await UserRole.findById(_id);
  if (!userRole) {
    throw new ErrorHandler("User role not found", 400);
  }

  res.status(200).json({
    status: 200,
    success: true,
    userRole,
  });
});
exports.all = TryCatch(async (req, res) => {
  // Convert query params to numbers
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  // Calculate skip value
  const skip = (page - 1) * limit;

  // Count total documents
  const total = await UserRole.countDocuments();

  // Fetch paginated data
  const roles = await UserRole.find()
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit); // <-- must be awaited and called after skip()

  const totalPages = Math.ceil(total / limit);

  res.status(200).json({
    status: 200,
    success: true,
    currentPage: page,
    limit,
    totalPages,
    totalItems: total,
    roles,
  });
});
