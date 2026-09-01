import mongoose from "mongoose";

/// Parameter khusus printer jaringan (TCP RAW / TSPL). Hanya diisi saat
/// connectionType === "NETWORK".
const networkSchema = new mongoose.Schema(
  {
    ipAddress: { type: String, trim: true },
    port: { type: Number, default: 9100 },
    labelWidthMm: { type: Number, default: 100 },
    labelHeightMm: { type: Number, default: 150 },
  },
  { _id: false },
);

const deviceSchema = new mongoose.Schema(
  {
    deviceType: {
      type: String,
      required: true,
      enum: ["PRINTER"], // Can be extended for other devices
    },
    connectionType: {
      type: String,
      enum: ["BLUETOOTH", "NETWORK"],
      default: "BLUETOOTH",
    },
    identifier: {
      type: String,
      required: true,
      unique: true, // MAC address (BLUETOOTH) atau IP address (NETWORK)
    },
    name: {
      type: String,
      required: true, // Human-readable alias for monitoring
    },
    network: {
      type: networkSchema,
      default: undefined,
    },
    totalPrint: {
      type: Number,
      default: 0,
    },
    lastMaintenancePrint: {
      type: Number,
      default: 0,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    lastUsedBy: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ["NORMAL", "WARNING", "CRITICAL"],
      default: "NORMAL",
    },
  },
  {
    timestamps: true,
  },
);

const Device = mongoose.model("Device", deviceSchema);

export default Device;
