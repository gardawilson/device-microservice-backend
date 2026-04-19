import Device from "../models/Device.js";
import DeviceLog from "../models/DeviceLog.js";
import DeviceMaintenance from "../models/DeviceMaintenance.js";
import DeviceSetting from "../models/DeviceSetting.js";

const DEFAULT_MAX_PRINT_COUNT = 1000;
const REPORT_TIME_ZONE = "Asia/Jakarta";
const DAY_MS = 24 * 60 * 60 * 1000;

const formatDateInTimeZone = (date, timeZone = REPORT_TIME_ZONE) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const parseDateOnly = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfLocalDay = (date) =>
  new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date) + "T00:00:00+07:00",
  );

const buildDateRange = ({ from, to, fallbackStart } = {}) => {
  const start = from ? parseDateOnly(from) : fallbackStart ? startOfLocalDay(fallbackStart) : null;
  const end = to ? parseDateOnly(to) : new Date();

  if (!start || !end) {
    return null;
  }

  if (start > end) {
    return null;
  }

  const endExclusive = new Date(end.getTime() + DAY_MS);
  const dates = [];
  for (let cursor = new Date(start.getTime()); cursor < endExclusive; cursor = new Date(cursor.getTime() + DAY_MS)) {
    dates.push(formatDateInTimeZone(cursor));
  }

  return {
    start,
    end,
    endExclusive,
    dates,
  };
};

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
      lastUsedBy: null,
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
        "identifier name totalPrint lastMaintenancePrint lastUsedAt lastUsedBy status",
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
    device.lastUsedBy = printBy;

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

  async getLogSummary(printerId, { from, to }) {
    const device = await Device.findOne({
      identifier: printerId,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    const range = buildDateRange({
      from,
      to,
      fallbackStart: device.createdAt,
    });
    if (!range) {
      throw new Error("Invalid date range");
    }

    const [summary] = await DeviceLog.aggregate([
      {
        $match: {
          deviceId: device._id,
          createdAt: {
            $gte: range.start,
            $lt: range.endExclusive,
          },
        },
      },
      {
        $project: {
          dateKey: {
            $dateToString: {
              date: "$createdAt",
              format: "%Y-%m-%d",
              timezone: REPORT_TIME_ZONE,
            },
          },
          sourceApp: 1,
          printBy: 1,
          totalLabel: 1,
        },
      },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalPrintCount: { $sum: "$totalLabel" },
                totalLogEntries: { $sum: 1 },
              },
            },
          ],
          sourceAppSummary: [
            {
              $group: {
                _id: "$sourceApp",
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1, _id: 1 } },
            {
              $project: {
                _id: 0,
                sourceApp: "$_id",
                count: 1,
              },
            },
          ],
          dailySummary: [
            {
              $group: {
                _id: {
                  date: "$dateKey",
                  printBy: "$printBy",
                },
                printCount: { $sum: "$totalLabel" },
                logCount: { $sum: 1 },
              },
            },
            {
              $group: {
                _id: "$_id.date",
                totalPrintCount: { $sum: "$printCount" },
                totalLogEntries: { $sum: "$logCount" },
                users: {
                  $push: {
                    printBy: "$_id.printBy",
                    printCount: "$printCount",
                    logCount: "$logCount",
                  },
                },
              },
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                _id: 0,
                date: "$_id",
                totalPrintCount: 1,
                totalLogEntries: 1,
                users: 1,
              },
            },
          ],
        },
      },
      {
        $project: {
          totals: { $ifNull: ["$totals", []] },
          sourceAppSummary: { $ifNull: ["$sourceAppSummary", []] },
          dailySummary: { $ifNull: ["$dailySummary", []] },
        },
      },
    ]);

    const totals = summary?.totals?.[0] ?? {
      totalPrintCount: 0,
      totalLogEntries: 0,
    };
    const sourceAppSummary = summary?.sourceAppSummary ?? [];
    const dailySummaryByDate = new Map(
      (summary?.dailySummary ?? []).map((item) => [item.date, item]),
    );

    const dailySummary = range.dates.map((date) => {
      const item = dailySummaryByDate.get(date);
      if (!item) {
        return {
          date,
          totalPrintCount: 0,
          totalLogEntries: 0,
          users: [],
        };
      }

      return {
        date: item.date,
        totalPrintCount: item.totalPrintCount,
        totalLogEntries: item.totalLogEntries,
        users: item.users.sort(
          (a, b) => b.printCount - a.printCount || a.printBy.localeCompare(b.printBy),
        ),
      };
    });

    return {
      printer: device,
      scope: from || to ? "custom" : "since-registered",
      range: {
        from: from ?? formatDateInTimeZone(device.createdAt),
        to: to ?? formatDateInTimeZone(new Date()),
      },
      totalPrintCount: totals.totalPrintCount,
      totalLogEntries: totals.totalLogEntries,
      sourceAppSummary,
      dailySummary,
    };
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
