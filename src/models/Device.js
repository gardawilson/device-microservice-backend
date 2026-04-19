import mongoose from "mongoose";

const deviceSchema = new mongoose.Schema(
  {
    deviceType: {
      type: String,
      required: true,
      enum: ["PRINTER"], // Can be extended for other devices
    },
    identifier: {
      type: String,
      required: true,
      unique: true, // MAC address or unique ID
    },
    name: {
      type: String,
      required: true, // Human-readable alias for monitoring
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
