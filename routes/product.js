const express = require("express");
const {
  create,
  update,
  remove,
  bulkDelete,
  details,
  all,
  unapproved,
  bulkUploadHandler,
  bulkUploadHandlerIndirect,
  workInProgressProducts,
  exportToExcel,
  downloadSampleTemplate,
  exportToExcelIndirect,
  downloadSampleTemplateIndirect,
  rawMaterials,
  updateInventory,
  updatePrice,
  updateStock,
  clearUpdatedPrice,
  clearUpdatedStock,
  removeFromInventoryShortages,
  inventoryStats,
} = require("../controllers/product");
const { isAuthenticated } = require("../middlewares/isAuthenticated");
const { isSuper } = require("../middlewares/isSuper");
const { isAllowed } = require("../middlewares/isAllowed");
// const { upload } = require("../utils/upload");
// const { roundAllPrices } = require("../utils/roundPrices");
const router = express.Router();

// CRUD operations
router
  .route("/")
  .post(isAuthenticated, isAllowed, create)
  .put(isAuthenticated, isAllowed, update)
  .delete(isAuthenticated, isAllowed, remove);

// Bulk delete operation
// router.delete("/bulk-delete", isAuthenticated, isAllowed, bulkDelete);

// Get operations
router.get("/all", isAuthenticated, all);
router.get("/inventory-stats", isAuthenticated, inventoryStats);
// router.get("/unapproved", isAuthenticated, isSuper, unapproved);
// router.get("/raw-materials", isAuthenticated, rawMaterials);
router.get("/:id", isAuthenticated, isAllowed, details);

// Bulk operations
// router.post(
//   "/bulk",
//   isAuthenticated,
//   isAllowed,
//   upload.single("excel"),
//   bulkUploadHandler
// );
// router.post(
//   "/bulkindrect",
//   isAuthenticated,
//   isAllowed,
//   upload.single("excel"),
//   bulkUploadHandlerIndirect
// );

// // Inventory update
// router.post("/update-inventory", isAuthenticated, isAllowed, updateInventory);
// router.put("/update-price", isAuthenticated, isAllowed, updatePrice);
// router.put("/update-stock", isAuthenticated, isAllowed, updateStock);
// router.put(
//   "/clear-updated-price",
//   isAuthenticated,
//   isAllowed,
//   clearUpdatedPrice
// );
// router.put(
//   "/clear-updated-stock",
//   isAuthenticated,
//   isAllowed,
//   clearUpdatedStock
// );
// router.put(
//   "/remove-from-shortages",
//   isAuthenticated,
//   isAllowed,
//   removeFromInventoryShortages
// );

// // Utility route to round all existing prices to whole numbers
// router.post("/round-prices", isAuthenticated, isSuper, async (req, res) => {
//   try {
//     await roundAllPrices();
//     res.status(200).json({
//       status: 200,
//       success: true,
//       message: "All prices have been rounded to whole numbers successfully",
//     });
//   } catch (error) {
//     res.status(500).json({
//       status: 500,
//       success: false,
//       message: "Failed to round prices",
//       error: error.message,
//     });
//   }
// });

// // Export operations - Updated for direct products

// router.get("/export/excel", isAuthenticated, exportToExcel);
// router.get("/export/sample", downloadSampleTemplate);

// router.get("/exports/inexcel", isAuthenticated, exportToExcelIndirect);
// router.get("/exports/insample", downloadSampleTemplateIndirect);

module.exports = router;
