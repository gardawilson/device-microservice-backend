import Device from "../models/Device.js";
import DeviceLog from "../models/DeviceLog.js";
import DeviceMaintenance from "../models/DeviceMaintenance.js";
import DeviceSetting from "../models/DeviceSetting.js";

const DEFAULT_MAX_PRINT_COUNT = 1000;

class PrinterService {
  async createPrinter(mac, name) {
    // Check if already exists
    const existing = await Device.findOne({
      identifier: mac,
      deviceType: "PRINTER",
    });
    if (existing) {
      throw new Error("Printer already exists");
    }

    const device = new Device({
      deviceType: "PRINTER",
      identifier: mac,
      name,
      totalPrint: 0,
      lastMaintenancePrint: 0,
      lastUsedAt: new Date(),
      status: "NORMAL",
    });
    await device.save();
    return device;
  }

  async getMaxPrintCount() {
    const setting = await DeviceSetting.findOne({ key: "maxPrintCount" });
    return setting ? setting.value : DEFAULT_MAX_PRINT_COUNT;
  }

  async setMaxPrintCount(value) {
    const setting = await DeviceSetting.findOneAndUpdate(
      { key: "maxPrintCount" },
      { value },
      { upsert: true, new: true },
    );
    return setting;
  }

  async getAllPrinters() {
    const [printers, maxPrintCount] = await Promise.all([
      Device.find({ deviceType: "PRINTER" }).select(
        "identifier name totalPrint lastMaintenancePrint lastUsedAt status",
      ),
      this.getMaxPrintCount(),
    ]);
    return { printers, maxPrintCount };
  }

  async getPrinterById(id) {
    const [device, maxPrintCount] = await Promise.all([
      Device.findOne({ _id: id, deviceType: "PRINTER" }),
      this.getMaxPrintCount(),
    ]);
    if (!device) {
      throw new Error("Printer not found");
    }
    return { device, maxPrintCount };
  }

  async updatePrinterName(id, name) {
    const device = await Device.findOne({
      _id: id,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    device.name = name;
    await device.save();

    return device;
  }

  async deletePrinter(id) {
    const device = await Device.findOneAndDelete({
      _id: id,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    await Promise.all([
      DeviceLog.deleteMany({ deviceId: device._id }),
      DeviceMaintenance.deleteMany({ deviceId: device._id }),
    ]);

    return device;
  }

  async logUsage(printerId, sourceApp, printBy) {
    const totalLabel = 1;

    const device = await Device.findOne({
      identifier: printerId,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    device.totalPrint += totalLabel;
    device.lastUsedAt = new Date();

    const maxPrintCount = await this.getMaxPrintCount();
    const printsSinceMaintenance =
      device.totalPrint - device.lastMaintenancePrint;
    if (printsSinceMaintenance >= maxPrintCount) {
      device.status = "CRITICAL";
    } else if (printsSinceMaintenance >= maxPrintCount * 0.8) {
      device.status = "WARNING";
    } else {
      device.status = "NORMAL";
    }

    await device.save();

    // Log the usage
    const log = new DeviceLog({
      deviceId: device._id,
      totalLabel,
      sourceApp,
      printBy,
    });
    await log.save();

    return { device, log };
  }

  async getLogs(printerId, { page = 1, limit = 20 } = {}) {
    const device = await Device.findOne({
      identifier: printerId,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    const skip = (page - 1) * limit;
    const [logs, total, sourceAppSummary] = await Promise.all([
      DeviceLog.find({ deviceId: device._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      DeviceLog.countDocuments({ deviceId: device._id }),
      DeviceLog.aggregate([
        { $match: { deviceId: device._id } },
        { $group: { _id: "$sourceApp", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { _id: 0, sourceApp: "$_id", count: 1 } },
      ]),
    ]);

    return { device, logs, total, page, limit, sourceAppSummary };
  }

  async getResetLogs(printerId, { page = 1, limit = 20 } = {}) {
    const device = await Device.findOne({
      identifier: printerId,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    const skip = (page - 1) * limit;
    const [resetLogs, total] = await Promise.all([
      DeviceMaintenance.find({ deviceId: device._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      DeviceMaintenance.countDocuments({ deviceId: device._id }),
    ]);

    return { device, resetLogs, total, page, limit };
  }

  async performReset(printerId) {
    const device = await Device.findOne({
      identifier: printerId,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    // Reset lastMaintenancePrint to current totalPrint and status to NORMAL
    device.lastMaintenancePrint = device.totalPrint;
    device.status = "NORMAL";
    await device.save();

    // Log reset action
    const resetLog = new DeviceMaintenance({
      deviceId: device._id,
      doneBy: "SYSTEM",
    });
    await resetLog.save();

    return { device, resetLog };
  }
}

export default new PrinterService();
