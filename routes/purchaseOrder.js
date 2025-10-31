const express = require("express");
const { create, all, details, update, remove, pendingForGateMan, acceptByGateMan } = require("../controllers/purchaseOrder");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");

const router = express.Router();

router.route("/")
  .post(isAuthenticated, isAllowed, create)
  .put(isAuthenticated, isAllowed, update)
  .delete(isAuthenticated, isAllowed, remove);

router.get("/all", isAuthenticated, isAllowed, all);
router.get("/:id", isAuthenticated, isAllowed, details);

// Gate Man routes
router.get("/pending/gate-man", isAuthenticated, isAllowed, pendingForGateMan);
router.put("/accept/:id", isAuthenticated, isAllowed, acceptByGateMan);


module.exports = router;

