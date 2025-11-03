// const { body } = require("express-validator");

// // Quality Check validation rules
// const validateQualityCheck = [
//   body("product_type")
//     .notEmpty()
//     .withMessage("Product type is required")
//     .isString()
//     .withMessage("Product type must be a string")
//     .trim()
//     .isLength({ min: 2, max: 100 })
//     .withMessage("Product type must be between 2 and 100 characters"),

//   body("product_name")
//     .notEmpty()
//     .withMessage("Product name is required")
//     .isString()
//     .withMessage("Product name must be a string")
//     .trim()
//     .isLength({ min: 2, max: 100 })
//     .withMessage("Product name must be between 2 and 100 characters"),

//   body("approved_quantity")
//     .notEmpty()
//     .withMessage("Approved quantity is required")
//     .isNumeric()
//     .withMessage("Approved quantity must be a number")
//     .isFloat({ min: 0 })
//     .withMessage("Approved quantity cannot be negative"),

//   body("rejected_quantity")
//     .notEmpty()
//     .withMessage("Rejected quantity is required")
//     .isNumeric()
//     .withMessage("Rejected quantity must be a number")
//     .isFloat({ min: 0 })
//     .withMessage("Rejected quantity cannot be negative"),
// ];

// module.exports = {
//   validateQualityCheck,
// };

// // exports.Validater = (schema) => {
// //     return async (req, res, next) => {
// //       try {
// //         const data = req.body;
// //         await schema.validateSync(data, { abortEarly: false });
// //         next();
// //       } catch (err) {
// //         if (err.inner) {
// //           const errors = err.inner.map((e) => ({
// //             path: e.path,
// //             message: e.message,
// //           }));
// //           return res.status(400).json({ errors });
// //         } else {
// //           console.error('Unexpected error:', err);
// //         }
// //       }
// //     };
// //   };
