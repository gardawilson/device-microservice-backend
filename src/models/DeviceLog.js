import mongoose from "mongoose";

const deviceLogSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },
    totalLabel: {
      type: Number,
      required: true,
    },
    sourceApp: {
      type: String,
      required: true,
    },
    printBy: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

const DeviceLog = mongoose.model("DeviceLog", deviceLogSchema);

export default DeviceLog;
