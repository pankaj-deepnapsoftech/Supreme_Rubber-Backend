const express = require("express");
const { create, all, details, update, remove, lookup } = require("../controllers/bom");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isAllowed } = require("../middlewares/isAllowed");

const router = express.Router();

router.post("/", isAuthenticated, isAllowed, create);
router.get("/all", isAuthenticated, all);
router.get("/lookup", isAuthenticated, lookup);
router.get("/:id", isAuthenticated, details);
router.put("/", isAuthenticated, isAllowed, update);
router.delete("/", isAuthenticated, isAllowed, remove);

module.exports = router;


