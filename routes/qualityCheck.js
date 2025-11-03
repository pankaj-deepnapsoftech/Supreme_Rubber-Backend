const express = require("express");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");
const {
  getAllQualityChecks,
  createQualityCheck,
  getAvailableProducts,
  getQualityChecks,
  deleteQualityCheck,
} = require("../controllers/qualityCheck");
const router = express.Router();


router.route("/").get(isAuthenticated, isAllowed, getAllQualityChecks);

router.route("/").post(isAuthenticated, isAllowed, createQualityCheck);

router
  .route("/available-products")
  .get(isAuthenticated, isAllowed, getAvailableProducts);

router.route("/:id").get(isAuthenticated, isAllowed, getQualityChecks);

router.route("/:id").delete(isAuthenticated, isAllowed, deleteQualityCheck);

module.exports = router;
