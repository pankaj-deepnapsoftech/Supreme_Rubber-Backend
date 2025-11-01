const express = require("express");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");
const { getQualityChecks, createQualityCheck, changeStatus } = require("../controllers/qualityCheck");
const router = express.Router();

router.route("/").get(isAuthenticated, isAllowed, getQualityChecks);
router.route("/").post(isAuthenticated, isAllowed, createQualityCheck);
router.route("/change-staus").put(isAuthenticated, isAllowed, changeStatus);

module.exports = router;