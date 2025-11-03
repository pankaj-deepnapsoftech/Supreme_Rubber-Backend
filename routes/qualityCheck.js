const express = require("express");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");
const {
  getQualityChecks,
  createQualityCheck,
  getAvailableProducts,
} = require("../controllers/qualityCheck");
const router = express.Router();


router.route("/").get(isAuthenticated, isAllowed, getQualityChecks);

router.route("/").post(isAuthenticated, isAllowed, createQualityCheck);

router
  .route("/available-products")
  .get(isAuthenticated, isAllowed, getAvailableProducts);

module.exports = router;
