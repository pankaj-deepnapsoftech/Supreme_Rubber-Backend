const express = require("express");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");
const {
  getQualityChecks,
  createQualityCheck,
  updateQualityCheck,
  getQualityCheckById,
  getAvailableProducts,
  getAllQualityChecks,
  deleteQualityCheck,
} = require("../controllers/qualityCheck");
const router = express.Router();

router.route("/").get(isAuthenticated, isAllowed, getAllQualityChecks);

router.route("/").post(isAuthenticated, isAllowed, createQualityCheck);

router.route("/:id").get(isAuthenticated, isAllowed, getQualityCheckById);

router.route("/:id").put(isAuthenticated, isAllowed, updateQualityCheck);

router.route("/:id").delete(isAuthenticated, isAllowed, deleteQualityCheck);

router
  .route("/available-products")
  .get(isAuthenticated, isAllowed, getAvailableProducts);

module.exports = router;
