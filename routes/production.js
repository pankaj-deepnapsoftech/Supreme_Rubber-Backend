const express = require("express");
const {
  create,
  all,
  details,
  update,
  remove,
  getProductionGraphData,
} = require("../controllers/production");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");

const router = express.Router();

router.post("/", isAuthenticated, isAllowed, create);
router.get("/all", isAuthenticated, all);
router.get("/dashboard/graph", isAuthenticated, getProductionGraphData);
router.get("/:id", isAuthenticated, details);
router.put("/", isAuthenticated, isAllowed, update);
router.delete("/", isAuthenticated, isAllowed, remove);

module.exports = router;
