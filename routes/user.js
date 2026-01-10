const express = require("express");
const {
    create,
    createEmployee,
    update,
    remove,
    details,
    loginWithToken,
    loginWithPassword,
    resetPasswordRequest,
    resetPassword,
    verifyUser,
    resendOtp,
    all,
    employeeDetails,
    checkAdminExists,
} = require("../controllers/user");
const { verifyOTP } = require("../middlewares/verifyOTP");
const { isUserVerified } = require("../middlewares/isVerified");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isSuper } = require("../middlewares/isSuper");
const { isAllowed } = require("../middlewares/isAllowed");
const router = express.Router();

router.get("/check-admin", checkAdminExists);
router.post("/", create);
router.post("/employee", isAuthenticated, isSuper, createEmployee);
router.get("/all", isAuthenticated, all);
// router.get("/all", isAuthenticated, isSuper, all);
router.post("/verify", verifyOTP, verifyUser);
router.post("/resend-otp", resendOtp);
router
    .route("/login")
    .get(isUserVerified, loginWithToken)
    .post(isUserVerified, loginWithPassword);
// .post(loginWithPassword);

router
    .route("/user")
    .get(isAuthenticated, details) // Removed isAllowed - users should always access their own data
    .put(isAuthenticated, isSuper, update)
    .delete(isAuthenticated, isSuper, remove);
router.post("/reset-password-request", isUserVerified, resetPasswordRequest);
router.post("/reset-password", isUserVerified, verifyOTP, resetPassword);
router.get('/user/:_id', isAuthenticated, employeeDetails);

module.exports = router;    





