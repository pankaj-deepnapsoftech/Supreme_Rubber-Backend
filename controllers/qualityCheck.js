const QualityCheck = require("../models/qualityCheck");
const GateMan = require("../models/gateMan");
const { z } = require("zod");

const createQualityCheckSchema = z.object({
  gateman_entry_id: z.string().min(1, "Gateman entry ID is required"),
  item_name: z.string().min(1, "Item name is required"),
  product_type: z.string().min(2, "Product type must be at least 2 characters"),
  product_name: z.string().min(2, "Product name must be at least 2 characters"),
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
          item_name: item.item_name,
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

const getQualityChecks = async (req, res) => {
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
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit,
      },
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
    const validationResult = createQualityCheckSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Validation errors",
        errors: validationResult.error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }

    const {
      gateman_entry_id,
      item_name,
      product_type,
      product_name,
      approved_quantity,
      rejected_quantity,
    } = validationResult.data;

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
      (item) => item.item_name === item_name
    );
    if (!gatemanItem) {
      return res.status(404).json({
        success: false,
        message: "Item not found in gateman entry",
      });
    }

    const existingChecks = await QualityCheck.find({
      gateman_entry_id,
      item_name,
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
      item_name,
      product_type,
      product_name,
      approved_quantity,
      rejected_quantity,
      max_allowed_quantity: gatemanItem.item_quantity,
      created_by: req.user?.id,
    });

    const savedQualityCheck = await qualityCheck.save();

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

module.exports = {
  getQualityChecks,
  createQualityCheck,
  getAvailableProducts,
};
