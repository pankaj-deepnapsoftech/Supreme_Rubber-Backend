const express = require("express");

const cors = require("cors");
const { connectDB } = require("./utils/connectDB");
const authRoutes = require("./routes/user");
const userRoleRoutes = require("./routes/userRole");
const productRoutes = require("./routes/product");
const supplierRoutes = require("./routes/supplier");
const purchaseOrderRoutes = require("./routes/purchaseOrder");
const gateManRoutes = require("./routes/gateMan");
const QualityCheckRoutes = require("./routes/qualityCheck");
const bomRoutes = require("./routes/bom");
const productionRoutes = require("./routes/production");


const app = express();
// require('dotenv').config({ path: `.env.${process.env.NODE_ENV}` })

// DEVELOPMENT ENVIRONMENT
require("dotenv").config({ path: `.env.development` });

// PRODUCTION ENVIRONMENT
// require('dotenv').config();


const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:5174",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  }, 
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: "Authorization,Content-Type",
  preflightContinue: false,
  optionsSuccessStatus: 204,
  exposedHeaders: ["Content-Disposition"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use("/uploads", express.static("uploads"));



app.use("/api/auth", authRoutes); 
app.use("/api/role", userRoleRoutes);
app.use("/api/product", productRoutes);
app.use("/api/supplier", supplierRoutes);
app.use("/api/purchase-order", purchaseOrderRoutes);
// app.use("/api/quality-check", qualityCheckRoutes);
app.use("/api/gateman", gateManRoutes);
app.use("/api/quality-check", QualityCheckRoutes);
app.use("/api/bom", bomRoutes);
app.use("/api/production", productionRoutes);


app.listen(process.env.PORT, () => {
  console.log(`Server is listening on Port: ${process.env.PORT}`);
  connectDB();
});
