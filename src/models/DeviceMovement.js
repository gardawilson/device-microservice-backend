import mongoose from "mongoose";

const deviceMovementSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },
    fromFactory: {
      type: String,
      required: true,
    },
    toFactory: {
      type: String,
      required: true,
    },
    movedBy: {
      type: String,
      required: true,
    },
    movedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

const DeviceMovement = mongoose.model("DeviceMovement", deviceMovementSchema);

export default DeviceMovement;
