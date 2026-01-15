const QualityCheck = require("../models/qualityCheck");
const GateMan = require("../models/gateMan");
const Product = require("../models/product");
const PurchaseOrder = require("../models/purchaseOrder");
const { z } = require("zod");

const createQualityCheckSchema = z.object({
  gateman_entry_id: z.string().min(1, "Gateman entry ID is required"),
  item_id: z.string().min(1, "Item ID is required"),
  approved_quantity: z.number().min(0, "Approved quantity cannot be negative"),
  rejected_quantity: z.number().min(0, "Rejected quantity cannot be negative"),
});

const getAvailableProducts = async (req, res) => {
  try {
    const verifiedEntries = await GateMan.find({
      status: "Verified",
    }).populate("po_ref", "po_number");

    const availableProducts = [];

    for (const entry of verifiedEntries) {
      for (const item of entry.items) {
        const existingChecks = await QualityCheck.find({
          gateman_entry_id: entry._id,
          item_id: item._id,
        });

        const totalCheckedQuantity = existingChecks.reduce(
          (sum, check) =>
            sum + check.approved_quantity + check.rejected_quantity,
          0
        );

        const remainingQuantity = item.item_quantity - totalCheckedQuantity;

        if (remainingQuantity > 0) {
          availableProducts.push({
            gateman_entry_id: entry._id,
            po_number: entry.po_number,
            company_name: entry.company_name,
            item_id: item._id,
            item_name: item.item_name,
            total_quantity: item.item_quantity,
            already_checked: totalCheckedQuantity,
            remaining_quantity: remainingQuantity,
            invoice_number: entry.invoice_number,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Available products for quality check retrieved successfully",
      data: availableProducts,
    });
  } catch (error) {
    console.error("Error getting available products:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getAllQualityChecks = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const qualityChecks = await QualityCheck.find()
      .populate("created_by", "name email")
      .populate({
        path: "gateman_entry_id",
        select: "po_number company_name invoice_number items",
        populate: {
          path: "po_ref",
          select: "po_number",
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await QualityCheck.countDocuments();

    res.status(200).json({
      success: true,
      message: "Quality checks retrieved successfully",
      data: qualityChecks,
      page,
      limit,
      total,
    });
  } catch (error) {
    console.error("Error getting quality checks:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const createQualityCheck = async (req, res) => {
  try {
    const BASE_URL =
      process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

    // Handle file upload if present
    const reportFile = req.files?.attached_report?.[0];
    const attached_report = reportFile
      ? `${BASE_URL}/${reportFile.path.replace(/\\/g, "/")}`
      : null;

    // Parse body data - handle form-data (numbers come as strings from multer)
    let bodyData = { ...req.body };
    // Convert string numbers to actual numbers for validation
    if (bodyData.approved_quantity !== undefined) {
      bodyData.approved_quantity = parseInt(bodyData.approved_quantity) || 0;
    }
    if (bodyData.rejected_quantity !== undefined) {
      bodyData.rejected_quantity = parseInt(bodyData.rejected_quantity) || 0;
    }

    const validationResult = createQualityCheckSchema.safeParse(bodyData);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Validation errors",
        errors:
          validationResult.error?.issues?.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })) || [],
      });
    }

    const { gateman_entry_id, item_id, approved_quantity, rejected_quantity } =
      validationResult.data;

    const gatemanEntry = await GateMan.findById(gateman_entry_id);
    if (!gatemanEntry) {
      return res.status(404).json({
        success: false,
        message: "Gateman entry not found",
      });
    }

    if (gatemanEntry.status !== "Verified") {
      return res.status(400).json({
        success: false,
        message: "Gateman entry must be verified before quality check",
      });
    }

    const gatemanItem = gatemanEntry.items.find(
      (item) => item._id.toString() === item_id
    );
    if (!gatemanItem) {
      return res.status(404).json({
        success: false,
        message: "Item not found in gateman entry",
      });
    }

    const existingChecks = await QualityCheck.find({
      gateman_entry_id,
      item_id,
    });

    const totalExistingQuantity = existingChecks.reduce(
      (sum, check) => sum + check.approved_quantity + check.rejected_quantity,
      0
    );

    const requestedTotalQuantity = approved_quantity + rejected_quantity;
    const newTotalQuantity = totalExistingQuantity + requestedTotalQuantity;

    if (newTotalQuantity > gatemanItem.item_quantity) {
      return res.status(400).json({
        success: false,
        message: `Total quantity cannot exceed available quantity. Available: ${gatemanItem.item_quantity}, Already checked: ${totalExistingQuantity}, Requested: ${requestedTotalQuantity}`,
        details: {
          available_quantity: gatemanItem.item_quantity,
          already_checked: totalExistingQuantity,
          remaining_quantity: gatemanItem.item_quantity - totalExistingQuantity,
          requested_quantity: requestedTotalQuantity,
        },
      });
    }

    const qualityCheck = new QualityCheck({
      gateman_entry_id,
      item_id,
      item_name: gatemanItem.item_name,
      approved_quantity,
      rejected_quantity,
      max_allowed_quantity: gatemanItem.item_quantity,
      status: "completed",
      created_by: req.user?.id,
      attached_report,
    });

    const savedQualityCheck = await qualityCheck.save();

    // IMPORTANT: Quality check should NEVER update PurchaseOrder's remain_quantity
    // PO's remain_quantity is only updated when GateMan entry is created/updated
    // Quality check only affects Product inventory (current_stock and reject_stock)
    
    // Explicit safeguard: Verify PO's remain_quantity is NOT being updated
    if (gatemanEntry.po_ref) {
      const purchaseOrder = await PurchaseOrder.findById(gatemanEntry.po_ref);
      if (purchaseOrder) {
        const poProduct = purchaseOrder.products.find(
          (p) => p.item_name === gatemanItem.item_name
        );
        if (poProduct) {
          const originalRemainQty = poProduct.remain_quantity;
          // Log to verify PO is not being modified
          console.log(
            `[Quality Check] PO remain_quantity for ${gatemanItem.item_name}: ${originalRemainQty} (should NOT change)`
          );
          // Explicitly ensure PO is not saved/modified
          // This is a safeguard - quality check should never touch PO
        }
      }
    }

    if (approved_quantity > 0) {
      // Always try to update inventory for both approved and rejected quantities
      // NOTE: This updates Product inventory, NOT PurchaseOrder remain_quantity
      try {
        const inventoryProduct = await Product.findOne({
          name: gatemanItem.item_name,
        });

        if (inventoryProduct) {
          // Compute new stock values
          const newStock = inventoryProduct.current_stock + approved_quantity;
          const newRejectStock =
            inventoryProduct.reject_stock + rejected_quantity;

          // Update product document with last_change tracking
          await Product.findByIdAndUpdate(inventoryProduct._id, {
            current_stock: newStock,
            updated_stock: newStock,
            reject_stock: newRejectStock,
            change_type: approved_quantity > 0 ? "increase" : "no_change",
            quantity_changed: approved_quantity,
            last_change: {
              changed_on: new Date(),
              change_type: "increase",
              qty: approved_quantity,
              reason: `Quality check approved - ${gatemanItem.item_name} from ${gatemanEntry.po_number}`,
            },
          });

          console.log(
            `Inventory updated: ${gatemanItem.item_name} - Approved: +${approved_quantity}, Rejected: +${rejected_quantity}, New stock: ${newStock}, Reject stock: ${newRejectStock}`
          );
        } else {
          console.log(
            `Product not found in inventory: ${gatemanItem.item_name}`
          );
        }
      } catch (inventoryError) {
        console.error("Error updating inventory:", inventoryError);
        // Continue execution even if inventory update fails
      }
    }

    const populatedQualityCheck = await QualityCheck.findById(
      savedQualityCheck._id
    )
      .populate("gateman_entry_id", "po_number company_name invoice_number")
      .populate("created_by", "name email");

    res.status(201).json({
      success: true,
      message: "Quality check record created successfully",
      data: populatedQualityCheck,
    });
  } catch (error) {
    console.error("Error creating quality check:", error);

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }));

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getQualityChecks = async (req, res) => {
  try {
    const { gateman_entry_id } = req.query;

    let query = {};
    if (gateman_entry_id) {
      query.gateman_entry_id = gateman_entry_id;
    }

    const qualityChecks = await QualityCheck.find(query)
      .populate("created_by", "name email")
      .populate({
        path: "gateman_entry_id",
        select: "po_number company_name invoice_number items",
        populate: {
          path: "po_ref",
          select: "po_number",
        },
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      message: "Quality checks retrieved successfully",
      data: qualityChecks,
    });
  } catch (error) {
    console.error("Error getting quality checks:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getQualityCheckById = async (req, res) => {
  try {
    const { id } = req.params;

    const qualityCheck = await QualityCheck.findById(id)
      .populate("created_by", "name email")
      .populate({
        path: "gateman_entry_id",
        select: "po_number company_name invoice_number items",
        populate: {
          path: "po_ref",
          select: "po_number",
        },
      });

    if (!qualityCheck) {
      return res.status(404).json({
        success: false,
        message: "Quality check record not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Quality check retrieved successfully",
      data: qualityCheck,
    });
  } catch (error) {
    console.error("Error getting quality check by ID:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const deleteQualityCheck = async (req, res) => {
  try {
    const { id } = req.params;

    // Get the quality check record before deletion to adjust inventory
    const qualityCheck = await QualityCheck.findById(id);

    if (!qualityCheck) {
      return res.status(404).json({
        success: false,
        message: "Quality check record not found",
      });
    }

    // If there was approved quantity, reduce it from inventory
    if (qualityCheck.approved_quantity > 0) {
      try {
        const inventoryProduct = await Product.findOne({
          name: qualityCheck.item_name,
        });

        if (inventoryProduct) {
          const newStock = Math.max(
            0,
            inventoryProduct.current_stock - qualityCheck.approved_quantity
          );

          await Product.findByIdAndUpdate(inventoryProduct._id, {
            current_stock: newStock,
            updated_stock: newStock,
            change_type: "decrease",
            quantity_changed: qualityCheck.approved_quantity,
            last_change: {
              changed_on: new Date(),
              change_type: "decrease",
              qty: qualityCheck.approved_quantity,
              reason: `Quality check deleted - ${qualityCheck.item_name} (removed ${qualityCheck.approved_quantity} units)`,
            },
          });

          console.log(
            `Inventory updated on deletion: ${qualityCheck.item_name} - Reduced ${qualityCheck.approved_quantity} units. New stock: ${newStock}`
          );
        }
      } catch (inventoryError) {
        console.error("Error updating inventory on deletion:", inventoryError);
      }
    }

    await QualityCheck.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Quality check record deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting quality check:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const updateQualityCheck = async (req, res) => {
  try {
    const { id } = req.params;
    const BASE_URL =
      process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

    // Handle file upload if present
    const reportFile = req.files?.attached_report?.[0];
    const attached_report = reportFile
      ? `${BASE_URL}/${reportFile.path.replace(/\\/g, "/")}`
      : undefined;

    // Parse body data - handle form-data (numbers come as strings from multer)
    let bodyData = { ...req.body };
    // Convert string numbers to actual numbers for validation
    if (bodyData.approved_quantity !== undefined) {
      bodyData.approved_quantity = parseInt(bodyData.approved_quantity) || 0;
    }
    if (bodyData.rejected_quantity !== undefined) {
      bodyData.rejected_quantity = parseInt(bodyData.rejected_quantity) || 0;
    }

    const validationResult = createQualityCheckSchema.safeParse(bodyData);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Validation errors",
        errors:
          validationResult.error?.issues?.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })) || [],
      });
    }

    const { gateman_entry_id, item_id, approved_quantity, rejected_quantity } =
      validationResult.data;

    // Get the existing quality check
    const existingQualityCheck = await QualityCheck.findById(id);
    if (!existingQualityCheck) {
      return res.status(404).json({
        success: false,
        message: "Quality check record not found",
      });
    }

    const gatemanEntry = await GateMan.findById(gateman_entry_id);
    if (!gatemanEntry) {
      return res.status(404).json({
        success: false,
        message: "Gateman entry not found",
      });
    }

    const gatemanItem = gatemanEntry.items.find(
      (item) => item._id.toString() === item_id
    );
    if (!gatemanItem) {
      return res.status(404).json({
        success: false,
        message: "Item not found in gateman entry",
      });
    }

    // Calculate the difference in approved quantity
    const approvedQuantityDifference =
      approved_quantity - existingQualityCheck.approved_quantity;

    // Update the quality check
    const updateData = {
      approved_quantity,
      rejected_quantity,
      total_quantity: approved_quantity + rejected_quantity,
    };

    // Only update attached_report if a new file was uploaded
    if (attached_report !== undefined) {
      updateData.attached_report = attached_report;
    }

    const updatedQualityCheck = await QualityCheck.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    )
      .populate("gateman_entry_id", "po_number company_name invoice_number")
      .populate("created_by", "name email");

    // IMPORTANT: Quality check should NEVER update PurchaseOrder's remain_quantity
    // PO's remain_quantity is only updated when GateMan entry is created/updated
    // Quality check only affects Product inventory (current_stock and reject_stock)

    // Update inventory if there's a change in approved quantity
    // NOTE: This updates Product inventory, NOT PurchaseOrder remain_quantity
    if (approvedQuantityDifference !== 0) {
      try {
        const inventoryProduct = await Product.findOne({
          name: gatemanItem.item_name,
        });

        if (inventoryProduct) {
          const newStock =
            inventoryProduct.current_stock + approvedQuantityDifference;

          await Product.findByIdAndUpdate(inventoryProduct._id, {
            current_stock: Math.max(0, newStock),
            updated_stock: Math.max(0, newStock),
            change_type:
              approvedQuantityDifference > 0 ? "increase" : "decrease",
            quantity_changed: Math.abs(approvedQuantityDifference),
            last_change: {
              changed_on: new Date(),
              change_type:
                approvedQuantityDifference > 0 ? "increase" : "decrease",
              qty: Math.abs(approvedQuantityDifference),
              reason: `Quality check updated - ${gatemanItem.item_name} from ${
                gatemanEntry.po_number
              } (${
                approvedQuantityDifference > 0 ? "increased" : "decreased"
              } by ${Math.abs(approvedQuantityDifference)})`,
            },
          });

          console.log(
            `Inventory updated: ${gatemanItem.item_name} - ${
              approvedQuantityDifference > 0 ? "Added" : "Reduced"
            } ${Math.abs(
              approvedQuantityDifference
            )} units. New stock: ${Math.max(0, newStock)}`
          );
        }
      } catch (inventoryError) {
        console.error("Error updating inventory:", inventoryError);
      }
    }

    res.status(200).json({
      success: true,
      message: "Quality check record updated successfully",
      data: updatedQualityCheck,
    });
  } catch (error) {
    console.error("Error updating quality check:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  getAllQualityChecks,
  createQualityCheck,
  updateQualityCheck,
  getQualityCheckById,
  getAvailableProducts,
  getQualityChecks,
  deleteQualityCheck,
};
