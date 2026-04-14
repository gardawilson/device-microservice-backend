import mongoose from "mongoose";

const deviceSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    value: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

const DeviceSetting = mongoose.model("DeviceSetting", deviceSettingSchema);

export default DeviceSetting;
