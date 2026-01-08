const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { TryCatch, ErrorHandler } = require("../utils/error");
const User = require("../models/user");
const OTP = require("../models/otp");
const { generateOTP } = require("../utils/generateOTP");
const { sendEmail } = require("../utils/sendEmail");

exports.create = TryCatch(async (req, res) => {
  const userDetails = req.body;
  const totalUsers = await User.find().countDocuments();
  
  // Ensure only first user can be admin
  const existingSuperAdmin = await User.findOne({ isSuper: true });
  if (existingSuperAdmin) {
    throw new ErrorHandler("Only one admin is allowed. New registrations are disabled. Please contact the admin.", 403);
  }

  const nonSuperUserCount = await User.countDocuments({ isSuper: false });

  let isSuper = false;
  let employeeId = null;
  // If it is the first user then make it the super admin
  if (totalUsers === 0) {
    isSuper = true;
  } else {
    const prefix =
      userDetails.first_name?.substring(0, 3).toUpperCase() || "EMP";
    const idNumber = String(nonSuperUserCount + 1).padStart(4, "0");
    employeeId = `${prefix}${idNumber}`;
  }
  // If the non-super user count exceeds 100, throw an error
  if (nonSuperUserCount >= 100) {
    throw new ErrorHandler("Maximum limit of 100 employees reached", 403);
  }

  const user = await User.create({ ...userDetails, isSuper, employeeId, isVerified: false }); //remove this isverfied after otp setup 
await user.save();

  let otp = generateOTP(4);
  await OTP.create({ email: user?.email, otp });

  sendEmail(
    "Account Verification",
    `
      <strong>Dear ${user.first_name}</strong>,
  
      <p>Thank you for registering with us! To complete your registration and verify your account, please use the following One-Time Password (OTP): <strong>${otp}</strong></p>

      <p>This OTP is valid for 5 minutes. Do not share your OTP with anyone.</p>
      `,
    user?.email
  );

  res.status(200).json({
    status: 200,
    success: true,
    message: "User created successfully. OTP sent to your email.",
    user,
  });
});
exports.verifyUser = TryCatch(async (req, res) => {
  const { email } = req.body;
  await OTP.findOneAndDelete({ email });
  await User.findOneAndUpdate({ email }, { isVerified: true });
  res.status(200).json({
    status: 200,
    success: true,
    message: "Your account has been verified successfully",
  });
});
exports.update = TryCatch(async (req, res) => {
  const { id, role } = req.body;

  if (!id || !role) {
    throw new ErrorHandler("Please provide all the fields", 400);
  }

  const user = await User.findByIdAndUpdate(
    id,
    { role, isSuper: false },
    { new: true }
  );
  if (!user) {
    throw new ErrorHandler("User doesn't exist", 400);
  }
  user.password = undefined;

  res.status(200).json({
    status: 200,
    success: true,
    message: "User has been updated successfully",
    user,
  });
});
exports.remove = TryCatch(async (req, res) => {
  const { _id } = req.body; // user id to delete (sent by admin)

  if (!_id) {
    throw new ErrorHandler("User ID is required to delete the user", 400);
  }

  // Ensure the logged-in user is super admin
  if (!req.user?.isSuper) {
    throw new ErrorHandler("Only admin users can delete employees", 403);
  }

  // Find and delete the target user
  const user = await User.findById(_id);
  if (!user) {
    throw new ErrorHandler("User doesn't exist", 404);
  }

  // Prevent deleting super admin account accidentally
  if (user.isSuper) {
    throw new ErrorHandler("You cannot delete a super admin account", 403);
  }

  await user.deleteOne();

  res.status(200).json({
    status: 200,
    success: true,
    message: `User ${user.first_name} ${user.last_name || ""} has been deleted successfully`,
  });
});


exports.details = TryCatch(async (req, res) => {
  const userId = req.user._id;

  const user = await User.findById(userId).populate("role");
  if (!user) {
    throw new ErrorHandler("User doesn't exist", 400);
  }

  res.status(200).json({
    status: 200,
    success: true,
    user,
  });
});
exports.employeeDetails = TryCatch(async (req, res) => {
  const userId = req.params._id;

  if (!userId) {
    throw new ErrorHandler("User id not found", 400);
  }

  const user = await User.findById(userId).populate("role");
  if (!user) {
    throw new ErrorHandler("User doesn't exist", 400);
  }

  res.status(200).json({
    status: 200,
    success: true,
    user,
  });
});
exports.loginWithPassword = TryCatch(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email })
    .select("first_name last_name email phone role isSuper password")
    .populate("role");
  if (!user) {
    throw new Error("User doesn't exist", 400);
  }

  const isMatched = await bcrypt.compare(password, user.password);
  if (!isMatched) {
    throw new ErrorHandler(
      "Make sure you have entered correct Email Id and Password",
      401
    );
  }

  // CREATING JWT TOKEN
  const token = jwt.sign(
    {
      email: user.email,
      iat: Math.floor(Date.now() / 1000) - 30,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  user.password = undefined;

  res.status(200).json({
    status: 200,
    success: false,
    message: "Logged in successfully",
    user,
    token,
  });
});
exports.loginWithToken = TryCatch(async (req, res) => {
  const token = req.headers?.authorization?.split(" ")[1];

  if (!token) {
    throw new ErrorHandler("Authorization token not provided", 401);
  }

  const verified = jwt.verify(token, process.env.JWT_SECRET);
  const currentTimeInSeconds = Math.floor(Date.now() / 1000);

  if (
    verified &&
    verified.iat < currentTimeInSeconds &&
    verified.exp > currentTimeInSeconds
  ) {
    const user = await User.findOne({ email: verified?.email }).populate(
      "role"
    );
    if (!user) {
      throw new ErrorHandler("User doesn't exist", 401);
    }

    const newToken = jwt.sign(
      {
        email: user.email,
        iat: Math.floor(Date.now() / 1000) - 30,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      status: 200,
      success: true,
      message: "Logged in successfully",
      user,
      token: newToken,
    });
  }
  throw new ErrorHandler("Session expired, login again", 401);
});
exports.resetPasswordRequest = TryCatch(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    throw new ErrorHandler("Email Id not provided", 400);
  }
  const user = await User.findOne({ email });
  if (!user) {
    throw new ErrorHandler("User doesn't exist", 400);
  }

  let isExistingOTP = await OTP.findOne({ email: user.email });
  if (isExistingOTP) {
    sendEmail(
      "Reset Password Verification",
      `
        <strong>Dear ${user.first_name}</strong>,
    
        <p>We received a request to reset the password for your account associated with this email address.</p>
        <br>
        <p>To reset your password, please use the following One-Time Password (OTP): <strong>${isExistingOTP.otp}</strong></p>
    
        <p>This OTP is valid for 5 minutes. Do not share your OTP with anyone.</p>
        `,
      user?.email
    );
    return res.status(200).json({
      status: 200,
      success: false,
      message: "OTP has been successfully sent to your email id",
    });
  }

  let otp = generateOTP(4);
  await OTP.create({ email: user?.email, otp });

  sendEmail(
    "Reset Password Verification",
    `
    <strong>Dear ${user?.first_name}</strong>,

    <p>We received a request to reset the password for your account associated with this email address.</p>
    <br>
    <p>To reset your password, please use the following One-Time Password (OTP): <strong>${otp}</strong></p>

    <p>This OTP is valid for 5 minutes. Do not share your OTP with anyone.</p>
    `,
    user?.email
  );

  res.status(200).json({
    status: 200,
    success: false,
    message: "OTP has been successfully sent to your email id",
  });
});
exports.resetPassword = TryCatch(async (req, res) => {
  const { email, password } = req.body;

  if (!password) {
    throw new ErrorHandler("Password is a required field", 400);
  }

  await OTP.findOneAndDelete({ email });
  await User.findOneAndUpdate({ email }, { password });

  res.status(200).json({
    success: true,
    status: 200,
    message: "Your password has been updated successfully",
  });
});
exports.resendOtp = TryCatch(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    throw new ErrorHandler("Email Id not provided", 400);
  }
  const user = await User.findOne({ email });
  if (!user) {
    throw new ErrorHandler("User doesn't exist", 400);
  }
  let isExistingOTP = await OTP.findOne({ email: user.email });
  if (isExistingOTP) {
    sendEmail(
      "Reset Password Verification",
      `
        <strong>Dear ${user.first_name}</strong>,
    
        <p>We received a request to reset the password for your account associated with this email address.</p>
        <br>
        <p>To reset your password, please use the following One-Time Password (OTP): <strong>${isExistingOTP.otp}</strong></p>
    
        <p>This OTP is valid for 5 minutes. Do not share your OTP with anyone.</p>
        `,
      user?.email
    );
    return res.status(200).json({
      status: 200,
      success: false,
      message: "OTP has been successfully sent to your email id",
    });
  }

  let otp = generateOTP(4);
  await OTP.create({ email: user?.email, otp });

  sendEmail(
    "Reset Password Verification",
    `
    <strong>Dear ${user?.first_name}</strong>,

    <p>We received a request to reset the password for your account associated with this email address.</p>
    <br>
    <p>To reset your password, please use the following One-Time Password (OTP): <strong>${otp}</strong></p>

    <p>This OTP is valid for 5 minutes. Do not share your OTP with anyone.</p>
    `,
    user?.email
  );

  return res.status(200).json({
    status: 200,
    success: false,
    message: "OTP has been successfully sent to your email id",
  });
});
exports.all = TryCatch(async (req, res) => {
  
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const totalUsers = await User.countDocuments();


  const users = await User.find({})
    .populate("role")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  
  const hasNextPage = skip + users.length < totalUsers;

  res.status(200).json({
    status: 200,
    success: true,
    page,
    limit,
    totalUsers,
    hasNextPage,
    users,
  });
});

// Check if admin exists
exports.checkAdminExists = TryCatch(async (req, res) => {
  const existingSuperAdmin = await User.findOne({ isSuper: true });
  
  res.status(200).json({
    status: 200,
    success: true,
    adminExists: !!existingSuperAdmin,
  });
});

// Create employee from employee module - automatically verified
exports.createEmployee = TryCatch(async (req, res) => {
  const userDetails = req.body;

  // Ensure only one admin exists - this route is protected by isSuper middleware
  // but we ensure we never create another super admin from here
  const existingSuperAdmin = await User.findOne({ isSuper: true });
  if (existingSuperAdmin && existingSuperAdmin._id.toString() !== req.user?._id?.toString()) {
    // This should not happen since route is protected, but extra safety
    throw new ErrorHandler("Only one admin is allowed.", 403);
  }

  // Count non-super users for employee ID generation
  const nonSuperUserCount = await User.countDocuments({ isSuper: false });

  // If the non-super user count exceeds 100, throw an error
  if (nonSuperUserCount >= 100) {
    throw new ErrorHandler("Maximum limit of 100 employees reached", 403);
  }

  // Generate employee ID
  const prefix = userDetails.first_name?.substring(0, 3).toUpperCase() || "EMP";
  const idNumber = String(nonSuperUserCount + 1).padStart(4, "0");
  const employeeId = `${prefix}${idNumber}`;

  // Create employee - always verified and never super admin
  const user = await User.create({
    ...userDetails,
    isSuper: false,
    employeeId,
    isVerified: true, // Employees created from module are automatically verified
  });
  await user.save();

  // Send welcome email
  sendEmail(
    "Welcome to Supreme Rubber",
    `
      <strong>Dear ${user.first_name}</strong>,
  
      <p>Your employee account has been created successfully!</p>
      <p><strong>Employee ID:</strong> ${employeeId}</p>
      <p>You can now login to your account using your email and password.</p>
      `,
    user?.email
  );

  user.password = undefined;

  res.status(200).json({
    status: 200,
    success: true,
    message: "Employee created successfully and is verified.",
    user,
  });
});




