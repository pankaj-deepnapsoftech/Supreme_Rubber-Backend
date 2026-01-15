const express = require("express");
const { create, all, details, update, remove, prefillFromPO, statusStats, getRemainingQuantities } = require("../controllers/gateMan");
const { upload } = require("../utils/uploadGateman");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");

const router = express.Router();

// CRUD routes
router
  .route("/")
  .post(
    isAuthenticated,
    isAllowed,
    upload.fields([
      { name: "attached_po", maxCount: 1 },
      { name: "attached_invoice", maxCount: 1 },
    ]),
    create
  )
  .put(isAuthenticated, isAllowed, update)
  .delete(isAuthenticated, isAllowed, remove);

router.get("/all", isAuthenticated, isAllowed, all);
router.get("/status-stats", isAuthenticated, isAllowed, statusStats);
router.get("/remaining-quantities", isAuthenticated, isAllowed, getRemainingQuantities);
router.get("/:id", isAuthenticated, isAllowed, details);
router.get("/from-po/:poId", isAuthenticated, isAllowed, prefillFromPO);
router.patch("/change-status/:id", isAuthenticated, isAllowed, require("../controllers/gateMan").changeStatus);


module.exports = router;
