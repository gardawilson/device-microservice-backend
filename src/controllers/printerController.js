import mongoose from "mongoose";
import printerService from "../services/printerService.js";

const MAC_ADDRESS_REGEX = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const normalizeIdentifier = (value) => value.trim().toUpperCase();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

export const createPrinter = async (req, res) => {
  try {
    const { mac, name } = req.body;

    // Simple validation
    if (!mac || typeof mac !== "string") {
      return res.status(400).json({ error: "Invalid mac" });
    }
    if (!MAC_ADDRESS_REGEX.test(mac.trim())) {
      return res.status(400).json({ error: "Invalid mac format" });
    }
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Invalid name" });
    }

    const normalizedMac = mac.trim().toUpperCase();
    const device = await printerService.createPrinter(
      normalizedMac,
      name.trim(),
    );
    res.status(201).json({
      message: "Printer created successfully",
      device: {
        id: device._id,
        identifier: device.identifier,
        name: device.name,
        deviceType: device.deviceType,
        status: device.status,
      },
    });
  } catch (error) {
    if (error.message === "Printer already exists") {
      return res.status(409).json({ error: "Printer already exists" });
    }
    console.error("Error creating printer:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllPrinters = async (req, res) => {
  try {
    const { printers, maxPrintCount } = await printerService.getAllPrinters();
    res.json({
      maxPrintCount,
      printers: printers.map((p) => {
        const printsSinceMaintenance = p.totalPrint - p.lastMaintenancePrint;
        return {
          id: p._id,
          identifier: p.identifier,
          name: p.name ?? null,
          printUsage: `${printsSinceMaintenance}/${maxPrintCount}`,
          lastUsedAt: p.lastUsedAt,
          lastUsedBy: p.lastUsedBy ?? null,
          status: p.status,
        };
      }),
    });
  } catch (error) {
    console.error("Error getting all printers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getMaxPrintCount = async (req, res) => {
  try {
    const maxPrintCount = await printerService.getMaxPrintCount();
    res.json({ maxPrintCount });
  } catch (error) {
    console.error("Error getting max print count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const setMaxPrintCount = async (req, res) => {
  try {
    const { maxPrintCount } = req.body;

    if (
      !maxPrintCount ||
      typeof maxPrintCount !== "number" ||
      maxPrintCount <= 0
    ) {
      return res.status(400).json({ error: "Invalid maxPrintCount" });
    }

    const setting = await printerService.setMaxPrintCount(maxPrintCount);
    res.json({ maxPrintCount: setting.value });
  } catch (error) {
    console.error("Error setting max print count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const logPrinterUsage = async (req, res) => {
  try {
    const {
      identifier: identifierInput,
      printerId,
      mac,
      sourceApp,
      printBy: printByInput,
      user,
    } = req.body;
    const identifier = identifierInput ?? printerId ?? mac;
    const printBy = printByInput ?? user;

    // Simple validation
    if (!identifier || typeof identifier !== "string") {
      return res.status(400).json({ error: "Invalid identifier" });
    }
    if (!sourceApp || typeof sourceApp !== "string") {
      return res.status(400).json({ error: "Invalid sourceApp" });
    }
    if (!printBy || typeof printBy !== "string") {
      return res.status(400).json({ error: "Invalid printBy" });
    }

    const result = await printerService.logUsage(
      normalizeIdentifier(identifier),
      sourceApp,
      printBy,
    );
    res.status(201).json({
      message: "Printer usage logged successfully",
      device: {
        id: result.device._id,
        identifier: result.device.identifier,
        totalPrint: result.device.totalPrint,
      },
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error logging printer usage:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPrinterById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== "string" || !isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const { device, maxPrintCount } = await printerService.getPrinterById(id);
    const printsSinceMaintenance =
      device.totalPrint - device.lastMaintenancePrint;

    res.json({
      id: device._id,
      identifier: device.identifier,
      name: device.name ?? null,
      printUsage: `${printsSinceMaintenance}/${maxPrintCount}`,
      lastUsedAt: device.lastUsedAt,
      lastUsedBy: device.lastUsedBy ?? null,
      status: device.status,
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error getting printer:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updatePrinterName = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!id || typeof id !== "string" || !isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Invalid name" });
    }

    const device = await printerService.updatePrinterName(id, name.trim());

    res.json({
      message: "Printer name updated successfully",
      device: {
        id: device._id,
        identifier: device.identifier,
        name: device.name,
      },
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error updating printer name:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deletePrinter = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== "string" || !isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const deletedDevice = await printerService.deletePrinter(id);

    res.json({
      message: "Printer deleted successfully",
      device: {
        id: deletedDevice._id,
        identifier: deletedDevice.identifier,
        name: deletedDevice.name,
      },
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error deleting printer:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPrinterLogs = async (req, res) => {
  try {
    const { identifier, printerId, mac, page, limit } = req.query;
    const resolvedIdentifier = identifier ?? printerId ?? mac;

    if (!resolvedIdentifier || typeof resolvedIdentifier !== "string") {
      return res.status(400).json({ error: "Invalid identifier" });
    }

    const parsedPage = parseInt(page) || 1;
    const parsedLimit = parseInt(limit) || 20;

    if (parsedPage < 1) return res.status(400).json({ error: "Invalid page" });
    if (parsedLimit < 1 || parsedLimit > 100)
      return res.status(400).json({ error: "Invalid limit (1-100)" });

    const {
      device,
      logs,
      total,
      page: currentPage,
      limit: currentLimit,
    } = await printerService.getLogs(normalizeIdentifier(resolvedIdentifier), {
      page: parsedPage,
      limit: parsedLimit,
    });

    res.json({
      printer: {
        id: device._id,
        identifier: device.identifier,
        name: device.name ?? null,
      },
      pagination: {
        page: currentPage,
        limit: currentLimit,
        total,
        totalPages: Math.ceil(total / currentLimit),
      },
      logs: logs.map((l) => ({
        id: l._id,
        sourceApp: l.sourceApp,
        printBy: l.printBy,
        totalLabel: l.totalLabel,
        printedAt: l.createdAt,
      })),
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error getting printer logs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPrinterLogSummary = async (req, res) => {
  try {
    const { identifier, printerId, mac, from, to } = req.query;
    const resolvedIdentifier = identifier ?? printerId ?? mac;

    if (!resolvedIdentifier || typeof resolvedIdentifier !== "string") {
      return res.status(400).json({ error: "Invalid identifier" });
    }
    if (from != null && typeof from !== "string") {
      return res.status(400).json({ error: "Invalid from date" });
    }
    if (to != null && typeof to !== "string") {
      return res.status(400).json({ error: "Invalid to date" });
    }

    const summary = await printerService.getLogSummary(
      normalizeIdentifier(resolvedIdentifier),
      {
        from,
        to,
      },
    );

    res.json({
      printer: {
        id: summary.printer._id,
        identifier: summary.printer.identifier,
        name: summary.printer.name ?? null,
      },
      range: summary.range,
      scope: summary.scope,
      totalPrintCount: summary.totalPrintCount,
      totalLogEntries: summary.totalLogEntries,
      sourceAppSummary: summary.sourceAppSummary,
      dailySummary: summary.dailySummary,
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    if (error.message === "Invalid date range") {
      return res.status(400).json({
        error: "Invalid date range",
        message: "from must be less than or equal to to and must be in YYYY-MM-DD format",
      });
    }
    console.error("Error getting printer log summary:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getResetLogs = async (req, res) => {
  try {
    const { identifier, printerId, mac, page, limit } = req.query;
    const resolvedIdentifier = identifier ?? printerId ?? mac;

    if (!resolvedIdentifier || typeof resolvedIdentifier !== "string") {
      return res.status(400).json({ error: "Invalid identifier" });
    }

    const parsedPage = parseInt(page) || 1;
    const parsedLimit = parseInt(limit) || 20;

    if (parsedPage < 1) return res.status(400).json({ error: "Invalid page" });
    if (parsedLimit < 1 || parsedLimit > 100)
      return res.status(400).json({ error: "Invalid limit (1-100)" });

    const {
      device,
      resetLogs,
      total,
      page: currentPage,
      limit: currentLimit,
    } = await printerService.getResetLogs(
      normalizeIdentifier(resolvedIdentifier),
      { page: parsedPage, limit: parsedLimit },
    );

    res.json({
      printer: {
        id: device._id,
        identifier: device.identifier,
        name: device.name ?? null,
      },
      pagination: {
        page: currentPage,
        limit: currentLimit,
        total,
        totalPages: Math.ceil(total / currentLimit),
      },
      resetLogs: resetLogs.map((m) => ({
        id: m._id,
        doneBy: m.doneBy,
        doneAt: m.doneAt,
      })),
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error getting reset logs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const performPrinterReset = async (req, res) => {
  try {
    const { identifier, printerId, mac } = req.body;
    const resolvedIdentifier = identifier ?? printerId ?? mac;

    // Simple validation
    if (!resolvedIdentifier || typeof resolvedIdentifier !== "string") {
      return res.status(400).json({ error: "Invalid identifier" });
    }
    const result = await printerService.performReset(
      normalizeIdentifier(resolvedIdentifier),
    );
    res.json({
      message: "Printer reset performed successfully",
      device: {
        id: result.device._id,
        identifier: result.device.identifier,
        totalPrint: result.device.totalPrint,
        lastMaintenancePrint: result.device.lastMaintenancePrint,
      },
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error performing printer reset:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
