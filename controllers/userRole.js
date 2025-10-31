const UserRole = require("../models/userRole");
const { TryCatch, ErrorHandler } = require("../utils/error");

exports.create = TryCatch(async (req, res) => {
  const role = req.body;
  if (!role) {
    throw new ErrorHandler("Please provide all the fields", 400);
  }
  const createdRole = await UserRole.create({ ...role });
  res.status(200).json({
    status: 200,
    success: true,
    message: "User role has been created successfully",
    role: createdRole,
  });
});
exports.edit = TryCatch(async (req, res) => {
  const { _id, role, description, permissions } = req.body;

  if (!_id) {
    throw new ErrorHandler("_id is a required field", 400);
  }

  const userRole = await UserRole.findById(_id);
  if (!userRole) {
    throw new ErrorHandler("User role not found", 400);
  }

  const roleUpdated = await UserRole.findByIdAndUpdate(
    { _id },
    { $set: { role, description, permissions } },
    { new: true }
  );

  res.status(200).json({
    status: 200,
    success: true,
    message: "User role has been updated successfully",
    role: roleUpdated,
  });
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



