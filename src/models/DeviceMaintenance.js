import mongoose from "mongoose";

const deviceMaintenanceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },
    doneBy: {
      type: String,
      required: true,
    },
    doneAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

const DeviceMaintenance = mongoose.model(
  "DeviceMaintenance",
  deviceMaintenanceSchema,
);

export default DeviceMaintenance;
