import mongoose from "mongoose";
import printerService from "../services/printerService.js";

const MAC_ADDRESS_REGEX = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const IPV4_REGEX =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const normalizeIdentifier = (value) => value.trim().toUpperCase();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const serializePrinter = (p, maxPrintCount) => {
  const printsSinceMaintenance =
    (p.totalPrint ?? 0) - (p.lastMaintenancePrint ?? 0);
  const isNetwork = p.connectionType === "NETWORK";
  const st = isNetwork ? printerService.getNetworkStatus(p._id) : null;
  return {
    id: p._id,
    identifier: p.identifier,
    name: p.name ?? null,
    connectionType: p.connectionType ?? "BLUETOOTH",
    network:
      isNetwork && p.network
        ? {
            ipAddress: p.network.ipAddress ?? p.identifier,
            port: p.network.port ?? 9100,
            labelWidthMm: p.network.labelWidthMm ?? 100,
            labelHeightMm: p.network.labelHeightMm ?? 150,
          }
        : null,
    // Status printer jaringan (null = belum pernah dicek poller).
    // via: "icmp" (ping balas) atau "tcp" (port cetak terbuka).
    online: isNetwork ? (st ? st.online : null) : null,
    latencyMs: st?.latencyMs ?? null,
    onlineVia: st?.via ?? null,
    lastCheckedAt: st?.checkedAt ?? null,
    printUsage: `${printsSinceMaintenance}/${maxPrintCount}`,
    lastUsedAt: p.lastUsedAt,
    lastUsedBy: p.lastUsedBy ?? null,
    status: p.status,
  };
};

export const createPrinter = async (req, res) => {
  try {
    const {
      mac,
      ipAddress,
      name,
      connectionType,
      port,
      labelWidthMm,
      labelHeightMm,
    } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Invalid name" });
    }

    const type = (
      connectionType || (ipAddress ? "NETWORK" : "BLUETOOTH")
    ).toUpperCase();

    let device;
    if (type === "NETWORK") {
      if (!ipAddress || typeof ipAddress !== "string") {
        return res.status(400).json({ error: "Invalid ipAddress" });
      }
      const ip = ipAddress.trim();
      if (!IPV4_REGEX.test(ip)) {
        return res.status(400).json({ error: "Invalid ipAddress format" });
      }
      device = await printerService.createPrinter({
        identifier: ip,
        name: name.trim(),
        connectionType: "NETWORK",
        network: {
          ipAddress: ip,
          port: toNumber(port, 9100),
          labelWidthMm: toNumber(labelWidthMm, 100),
          labelHeightMm: toNumber(labelHeightMm, 150),
        },
      });
      printerService.refreshNetworkStatusSoon();
    } else {
      if (!mac || typeof mac !== "string") {
        return res.status(400).json({ error: "Invalid mac" });
      }
      if (!MAC_ADDRESS_REGEX.test(mac.trim())) {
        return res.status(400).json({ error: "Invalid mac format" });
      }
      device = await printerService.createPrinter({
        identifier: mac.trim().toUpperCase(),
        name: name.trim(),
        connectionType: "BLUETOOTH",
      });
    }

    res.status(201).json({
      message: "Printer created successfully",
      device: {
        id: device._id,
        identifier: device.identifier,
        name: device.name,
        deviceType: device.deviceType,
        connectionType: device.connectionType,
        network: device.network ?? null,
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
      printers: printers.map((p) => serializePrinter(p, maxPrintCount)),
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
    const recheckResult = await printerService.recalculatePrinterStatuses(
      setting.value,
    );
    res.json({
      maxPrintCount: setting.value,
      recheck: {
        matchedCount: recheckResult.matchedCount,
        modifiedCount: recheckResult.modifiedCount,
      },
    });
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
    res.json(serializePrinter(device, maxPrintCount));
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
    const { name, ipAddress, port, labelWidthMm, labelHeightMm } = req.body;

    if (!id || typeof id !== "string" || !isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const hasNetwork =
      ipAddress !== undefined ||
      port !== undefined ||
      labelWidthMm !== undefined ||
      labelHeightMm !== undefined;

    if ((!name || typeof name !== "string" || !name.trim()) && !hasNetwork) {
      return res.status(400).json({ error: "Nothing to update" });
    }
    if (ipAddress !== undefined && !IPV4_REGEX.test(String(ipAddress).trim())) {
      return res.status(400).json({ error: "Invalid ipAddress format" });
    }

    const device = await printerService.updatePrinter(id, {
      name: typeof name === "string" ? name : undefined,
      network: hasNetwork
        ? {
            ipAddress:
              ipAddress !== undefined ? String(ipAddress).trim() : undefined,
            port: port !== undefined ? toNumber(port, undefined) : undefined,
            labelWidthMm:
              labelWidthMm !== undefined
                ? toNumber(labelWidthMm, undefined)
                : undefined,
            labelHeightMm:
              labelHeightMm !== undefined
                ? toNumber(labelHeightMm, undefined)
                : undefined,
          }
        : undefined,
    });

    if (device.connectionType === "NETWORK") {
      printerService.refreshNetworkStatusSoon();
    }

    res.json({
      message: "Printer updated successfully",
      device: {
        id: device._id,
        identifier: device.identifier,
        name: device.name,
        connectionType: device.connectionType,
        network: device.network ?? null,
      },
    });
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error updating printer:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const pingPrinter = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== "string" || !isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const result = await printerService.pingPrinter(id);
    res.json(result);
  } catch (error) {
    if (error.message === "Printer not found") {
      return res.status(404).json({ error: "Printer not found" });
    }
    console.error("Error pinging printer:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const pingNetworkAdhoc = async (req, res) => {
  try {
    const target = String(req.body.ipAddress ?? req.body.host ?? "").trim();
    if (!IPV4_REGEX.test(target)) {
      return res.status(400).json({ error: "Invalid ipAddress" });
    }
    const result = await printerService.pingHostPort(target, req.body.port);
    res.json(result);
  } catch (error) {
    console.error("Error pinging host:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const pingAllNetworkPrinters = async (req, res) => {
  try {
    const result = await printerService.pingAllNetwork();
    res.json(result);
  } catch (error) {
    console.error("Error pinging network printers:", error);
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
        message:
          "from must be less than or equal to to and must be in YYYY-MM-DD format",
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
      avgPrintCountAtReset,
    } = await printerService.getResetLogs(
      normalizeIdentifier(resolvedIdentifier),
      { page: parsedPage, limit: parsedLimit },
    );

    res.json({
      printer: {
        id: device._id,
        identifier: device.identifier,
        name: device.name ?? null,
        avgPrintCountAtReset,
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
        remark: m.remark ?? null,
        printCountAtReset: m.printCountAtReset ?? null,
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
    const { identifier, printerId, mac, remark } = req.body;
    const resolvedIdentifier = identifier ?? printerId ?? mac;

    // Simple validation
    if (!resolvedIdentifier || typeof resolvedIdentifier !== "string") {
      return res.status(400).json({ error: "Invalid identifier" });
    }
    if (!remark || typeof remark !== "string") {
      return res.status(400).json({ error: "Remark is required" });
    }
    const result = await printerService.performReset(
      normalizeIdentifier(resolvedIdentifier),
      remark,
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
