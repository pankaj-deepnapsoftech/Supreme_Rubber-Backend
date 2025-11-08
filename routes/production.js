const express = require("express");
const {
  create,
  all,
  details,
  update,
  remove,
  getProductionGraphData,
  statusStats,
  qcStats,
  approve,
  reject,
  markReadyForQC,
  getQcHistory,
  deleteQcHistory,
} = require("../controllers/production");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");

const router = express.Router();

router.post("/", isAuthenticated, isAllowed, create);
router.get("/all", isAuthenticated, all);
router.get("/dashboard/graph", isAuthenticated, getProductionGraphData);
router.get("/status-stats", isAuthenticated, statusStats);
router.get("/qc-stats", isAuthenticated, qcStats);
// QC History - must be before /:id route
router.get("/qc-history", isAuthenticated, getQcHistory);
router.delete("/qc-history/:id", isAuthenticated, isAllowed, deleteQcHistory);
router.get("/:id", isAuthenticated, details);
router.put("/", isAuthenticated, isAllowed, update);
router.delete("/", isAuthenticated, isAllowed, remove);

// Approve/Reject production (QC actions)
router.patch("/:id/approve", isAuthenticated, isAllowed, approve);
router.patch("/:id/reject", isAuthenticated, isAllowed, reject);
router.patch("/:id/ready-for-qc", isAuthenticated, isAllowed, markReadyForQC);

module.exports = router;
