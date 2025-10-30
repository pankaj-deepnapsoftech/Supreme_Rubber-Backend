// const { AssinedModel } = require("../models/Assined-to.model");
// // const { Notification } = require("../models/notification");
// const { TryCatch } = require("../utils/error");

// const assinedTask = TryCatch(async (req, res) => {
//   const data = req.body;
//   const find = await AssinedModel.findOne({ sale_id: data.sale_id, assined_process: data.assined_process.toLowerCase().trim() })
//   if (find) {
//     return res.status(400).json({
//       message: "task is already assined"
//     })
//   }
//   console.log('assign task data', data);
//   console.log('assign task data =', req?.user._id);
//   const value = await AssinedModel.create({ ...data, assined_by: req?.user._id });

//   // await Notification.create({
//   //   reciever_id: value?.assined_to, 
//   //   message: `New task assigned -  ${value?.assined_process}.`,
//   // });

//   return res.status(201).json({
//     message: "Task assined Successful",
//   });
// });
// const getAssinedTask = TryCatch(async (req, res) => {
//   const { _id } = req.user;
//   const page = parseInt(req.query.page) || 1;
//   const limit = parseInt(req.query.limit) || 5;
//   const skip = (page - 1) * limit;
//   const totalData = await AssinedModel.find().countDocuments();

//   const data = await AssinedModel.aggregate([
//     {
//       $match: { assined_to: _id },
//     },
//     {
//       $lookup: {
//         from: "users",
//         foreignField: "_id",
//         localField: "assined_by",
//         as: "assined_by",
//         pipeline: [
//           {
//             $lookup: {
//               from: "user-roles",
//               foreignField: "_id",
//               localField: "role",
//               as: "role",
//             }
//           }
//         ]
//       }
//     },
//     {
//       $lookup: {
//         from: "purchases",
//         localField: "sale_id",
//         foreignField: "_id",
//         as: "sale_id",
//         pipeline: [
//           {
//             $lookup: {
//               from: "products",
//               localField: "product_id",
//               foreignField: "_id",
//               as: "product_id",
//             }
//           },
//           {
//             $lookup: {
//               from: "boms",
//               localField: "_id",
//               foreignField: "sale_id",
//               as: "bom"
//             }
//           },
//           {
//             $lookup: {
//               from: "parties",
//               localField: "party",
//               foreignField: "_id",
//               as: "party_id",
//             }
//           },
//           {
//             $lookup: {
//               from: "users",
//               localField: "user_id",
//               foreignField: "_id",
//               as: "user_id",
//               pipeline: [
//                 {
//                   $project: {
//                     first_name: 1
//                   }
//                 }
//               ]
//             }
//           }
//         ]
//       }
//     }
//   ]).sort({ _id: -1 }).skip(skip)
//     .limit(limit)
//     .exec();
//   return res.status(200).json({ message: "data found", data, totalData });
// });

// const updateAssinedTask = TryCatch(async (req, res) => {
//   const { id } = req.params;
//   const value = req.body;
//   const data = await AssinedModel.findById(id);
//   if (!data) {
//     return res.status(404).json({
//       message: "data not found",
//     });
//   }

//   const updatedValue = {
//     ...value,
//     isCompleted: "Pending"
//   }
//   await AssinedModel.findByIdAndUpdate(id, updatedValue);

//   // await Notification.create({
//   //   reciever_id: value?.assined_to, 
//   //   message: `Your ${value?.assined_process} task has been updated.`,
//   // });


//   return res.status(201).json({
//     message: "Task Assined Updated",
//   });
// });

// const DeleteAssinedTask = TryCatch(async (req, res) => {
//   const { id } = req.params;
//   const data = await AssinedModel.findById(id);
//   if (!data) {
//     return res.status(404).json({
//       message: "data not found",
//     });
//   }
//   await AssinedModel.findByIdAndDelete(id);
//   return res.status(201).json({
//     message: "Task Deleted successful",
//   });
// });

// const UpdateDesignStatus = TryCatch(async (req, res) => {
//   const { id } = req.params;
//   const { isCompleted } = req.body;

//   const data = await AssinedModel.findById(id).exec();
//   if (!data) {
//     return res.status(400).json({
//       message: "Wrong id"
//     })
//   }
//   await AssinedModel.findByIdAndUpdate(id, { isCompleted })
//   return res.status(200).json({
//     message: "Status changed :)"
//   })

// });

// const CountTotal = TryCatch(async (req, res) => {
//   const { _id } = req.user;
//   try {
//     const count = await AssinedModel.aggregate([

//       {
//         $match: {
//           $or: [
//             { assined_to: _id },
//             { assined_by: _id }
//           ]
//         }
//       },
//       {
//         $group: {
//           _id: "$isCompleted",
//           count: { $sum: 1 }
//         }
//       },
//       {
//         $project: {
//           _id: 0,
//           status: "$_id",
//           count: 1
//         }
//       }
//     ]);

//     res.json(count);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Server Error' });
//   }
// });




// module.exports = {
//   assinedTask,
//   getAssinedTask,
//   updateAssinedTask,
//   DeleteAssinedTask,
//   UpdateDesignStatus,
//   CountTotal
// };
