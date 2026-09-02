import { execFile } from "child_process";
import net from "net";

import Device from "../models/Device.js";
import DeviceLog from "../models/DeviceLog.js";
import DeviceMaintenance from "../models/DeviceMaintenance.js";
import DeviceSetting from "../models/DeviceSetting.js";

const DEFAULT_MAX_PRINT_COUNT = 1000;
const STATUS_POLL_INTERVAL_MS = 30_000;
const IS_WINDOWS = process.platform === "win32";

// (1) Kirim beberapa paket ICMP per pengecekan; online kalau minimal 1 balas.
//     Ini menyerap RTO/packet-loss sesaat tanpa nunggu siklus berikutnya.
const PING_PACKETS = 3;
const PING_PER_REPLY_MS = 1000;

// (2) Hysteresis: baru dianggap offline setelah gagal beberapa siklus berturut.
//     Sukses langsung balik online.
const OFFLINE_FAIL_THRESHOLD = 3;

const TCP_TIMEOUT_MS = 2000;
const RELAY_TIMEOUT_MS = 20000; // job cetak raster besar bisa lambat
const DEFAULT_PRINT_PORT = 9100;

// Set PRINTER_STATUS_DEBUG=1 untuk log detail tiap probe di docker logs.
const STATUS_DEBUG = process.env.PRINTER_STATUS_DEBUG === "1";
const slog = (...a) => console.log("[printer-status]", ...a);
const rlog = (...a) => console.log("[printer-relay]", ...a);

/// ICMP ping ke IP printer (spawn `ping` OS, tanpa raw socket).
/// Mengirim [PING_PACKETS] paket. Return { ok, latencyMs }.
/// Catatan: di dalam container Docker, binary `ping` sering tidak ada atau
/// ICMP diblok (butuh CAP_NET_RAW) → fungsi ini akan selalu { ok:false }.
/// Itu sebabnya [probe] jatuh ke TCP.
const icmpPing = (host) =>
  new Promise((resolve) => {
    const args = IS_WINDOWS
      ? ["-n", String(PING_PACKETS), "-w", String(PING_PER_REPLY_MS), host]
      : [
          "-c",
          String(PING_PACKETS),
          "-W",
          String(Math.max(1, Math.ceil(PING_PER_REPLY_MS / 1000))),
          host,
        ];

    const hardTimeoutMs = PING_PACKETS * PING_PER_REPLY_MS + 3000;

    execFile(
      "ping",
      args,
      { timeout: hardTimeoutMs, windowsHide: true },
      (err, stdout = "", stderr = "") => {
        const ok = !err;
        let latencyMs = null;
        const m = /time[=<]\s*([\d.]+)\s*ms/i.exec(stdout);
        if (ok && m) latencyMs = Math.round(parseFloat(m[1]));
        const detail = ok
          ? null
          : err.code === "ENOENT"
            ? "no-ping-binary"
            : (err.code ||
              (stderr || err.message || "").toString().trim().slice(0, 120) ||
              "failed");
        resolve({ ok, latencyMs, detail });
      },
    );
  });

/// TCP connect ke port cetak (RAW/JetDirect). Selalu jalan di container,
/// tanpa binary/privilege. Return { ok, latencyMs, detail }.
const tcpProbe = (host, port = DEFAULT_PRINT_PORT, timeoutMs = TCP_TIMEOUT_MS) =>
  new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok, detail = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: ok ? Date.now() - start : null, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (e) => finish(false, e.code || e.message));
    socket.connect(Number(port) || DEFAULT_PRINT_PORT, host);
  });

/// Pengecekan status gabungan: online kalau ICMP balas ATAU port cetak
/// bisa di-connect. `via` menandai metode yang berhasil.
const probe = async (host, port) => {
  const p = Number(port) || DEFAULT_PRINT_PORT;
  const [icmp, tcp] = await Promise.all([icmpPing(host), tcpProbe(host, p)]);
  const online = icmp.ok || tcp.ok;
  const via = icmp.ok ? "icmp" : tcp.ok ? "tcp" : null;

  if (STATUS_DEBUG || !online) {
    slog(
      `${host}: icmp=${icmp.ok ? `ok ${icmp.latencyMs}ms` : `FAIL(${icmp.detail})`}` +
        ` tcp:${p}=${tcp.ok ? `ok ${tcp.latencyMs}ms` : `FAIL(${tcp.detail})`}` +
        ` => online=${online}${via ? ` via ${via}` : ""}`,
    );
  }

  return {
    online,
    latencyMs: icmp.ok ? icmp.latencyMs : tcp.ok ? tcp.latencyMs : null,
    via,
  };
};

/// Cache status per printerId: { online, latencyMs, checkedAt, failCount }.
const statusCache = new Map();

/// Gabungkan hasil probe baru dengan status sebelumnya menerapkan hysteresis:
///  - sukses  → online:true, failCount:0
///  - gagal   → failCount++; tetap pakai status lama sampai failCount mencapai
///              [OFFLINE_FAIL_THRESHOLD], baru online:false. Kalau belum pernah
///              sukses, status = null (belum pasti) sampai ambang tercapai.
const mergeStatus = (prev, result, checkedAt) => {
  if (result.online) {
    return {
      online: true,
      latencyMs: result.latencyMs,
      via: result.via,
      checkedAt,
      failCount: 0,
    };
  }
  const failCount = (prev?.failCount ?? 0) + 1;
  const online =
    failCount >= OFFLINE_FAIL_THRESHOLD ? false : (prev?.online ?? null);
  return {
    online,
    latencyMs: online === true ? (prev?.latencyMs ?? null) : null,
    via: online === true ? (prev?.via ?? null) : null,
    checkedAt,
    failCount,
  };
};

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
  const start = from
    ? parseDateOnly(from)
    : fallbackStart
      ? startOfLocalDay(fallbackStart)
      : null;
  const end = to ? parseDateOnly(to) : new Date();

  if (!start || !end) {
    return null;
  }

  if (start > end) {
    return null;
  }

  const endExclusive = new Date(end.getTime() + DAY_MS);
  const dates = [];
  for (
    let cursor = new Date(start.getTime());
    cursor < endExclusive;
    cursor = new Date(cursor.getTime() + DAY_MS)
  ) {
    dates.push(formatDateInTimeZone(cursor));
  }

  return {
    start,
    end,
    endExclusive,
    dates,
  };
};

const PRINTER_FIELDS =
  "identifier name connectionType network totalPrint lastMaintenancePrint lastUsedAt lastUsedBy status";

class PrinterService {
  async createPrinter({
    identifier,
    name,
    connectionType = "BLUETOOTH",
    network,
  }) {
    // Check if already exists
    const existing = await Device.findOne({
      identifier,
      deviceType: "PRINTER",
    });
    if (existing) {
      throw new Error("Printer already exists");
    }

    const device = new Device({
      deviceType: "PRINTER",
      connectionType,
      identifier,
      name,
      network: connectionType === "NETWORK" ? network : undefined,
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

  async recalculatePrinterStatuses(maxPrintCount) {
    const printers = await Device.find({ deviceType: "PRINTER" }).select(
      "_id totalPrint lastMaintenancePrint",
    );

    if (!printers.length) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const ops = printers.map((printer) => {
      const printsSinceMaintenance =
        printer.totalPrint - printer.lastMaintenancePrint;
      let status = "NORMAL";

      if (printsSinceMaintenance >= maxPrintCount) {
        status = "CRITICAL";
      } else if (printsSinceMaintenance >= maxPrintCount * 0.8) {
        status = "WARNING";
      }

      return {
        updateOne: {
          filter: { _id: printer._id },
          update: { $set: { status } },
        },
      };
    });

    const result = await Device.bulkWrite(ops, { ordered: false });
    return {
      matchedCount: result.matchedCount ?? printers.length,
      modifiedCount: result.modifiedCount ?? 0,
    };
  }

  async getAllPrinters() {
    const [printers, maxPrintCount] = await Promise.all([
      Device.find({ deviceType: "PRINTER" }).select(PRINTER_FIELDS),
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

  async updatePrinter(id, { name, network } = {}) {
    const device = await Device.findOne({
      _id: id,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    if (typeof name === "string" && name.trim()) {
      device.name = name.trim();
    }

    if (network && device.connectionType === "NETWORK") {
      device.network = {
        ipAddress: network.ipAddress ?? device.network?.ipAddress,
        port: network.port ?? device.network?.port ?? 9100,
        labelWidthMm:
          network.labelWidthMm ?? device.network?.labelWidthMm ?? 100,
        labelHeightMm:
          network.labelHeightMm ?? device.network?.labelHeightMm ?? 150,
      };
      // identifier mengikuti IP untuk printer jaringan
      if (network.ipAddress) device.identifier = network.ipAddress;
    }

    await device.save();
    return device;
  }

  // Kompat lama
  async updatePrinterName(id, name) {
    return this.updatePrinter(id, { name });
  }

  // ==========================================
  //  PING / STATUS PRINTER JARINGAN
  //  Poller latar belakang cek tiap printer NETWORK: ICMP ping ATAU TCP connect
  //  ke port cetak. Hasil di-cache & disisipkan ke response daftar printer.
  // ==========================================

  /// Status terakhir untuk sebuah printerId, atau null kalau belum pernah dicek.
  /// Bentuk: { online, latencyMs, via, checkedAt, failCount }.
  getNetworkStatus(id) {
    return statusCache.get(String(id)) || null;
  }

  /// Cek ad-hoc ke host (tanpa perlu terdaftar) — dipakai form admin.
  /// Sekali cek (tanpa hysteresis) karena belum ada riwayat.
  async pingHostPort(host, port) {
    const result = await probe(host, port);
    return { ipAddress: host, ...result, checkedAt: new Date() };
  }

  /// Cek satu printer terdaftar + update cache (dengan hysteresis).
  async pingPrinter(id) {
    const device = await Device.findOne({ _id: id, deviceType: "PRINTER" });
    if (!device) {
      throw new Error("Printer not found");
    }
    const host = device.network?.ipAddress || device.identifier;
    const port = device.network?.port;
    const key = String(device._id);
    const result = await probe(host, port);
    const entry = mergeStatus(statusCache.get(key), result, new Date());
    statusCache.set(key, entry);
    return {
      id: device._id,
      name: device.name,
      connectionType: device.connectionType,
      ipAddress: host,
      online: entry.online,
      latencyMs: entry.latencyMs,
      via: entry.via,
      checkedAt: entry.checkedAt,
      failCount: entry.failCount,
    };
  }

  /// Cek semua printer NETWORK sekaligus + refresh seluruh cache (hysteresis).
  async pingAllNetwork() {
    const devices = await Device.find({
      deviceType: "PRINTER",
      connectionType: "NETWORK",
    }).select("identifier name network");

    const checkedAt = new Date();
    const printers = await Promise.all(
      devices.map(async (d) => {
        const host = d.network?.ipAddress || d.identifier;
        const key = String(d._id);
        const result = await probe(host, d.network?.port);
        const entry = mergeStatus(statusCache.get(key), result, checkedAt);
        statusCache.set(key, entry);
        return {
          id: d._id,
          name: d.name,
          ipAddress: host,
          online: entry.online,
          latencyMs: entry.latencyMs,
          via: entry.via,
          failCount: entry.failCount,
        };
      }),
    );

    // Buang entri cache untuk printer yang sudah dihapus.
    const alive = new Set(devices.map((d) => String(d._id)));
    for (const key of statusCache.keys()) {
      if (!alive.has(key)) statusCache.delete(key);
    }

    const up = printers.filter((p) => p.online === true).length;
    slog(
      `poll selesai: ${up}/${printers.length} online` +
        (printers.length
          ? ` [${printers.map((p) => `${p.ipAddress}:${p.online}`).join(", ")}]`
          : ""),
    );

    return { checkedAt, printers };
  }

  /// Relay job cetak: terima payload TSPL mentah dari tablet, teruskan ke
  /// printer jaringan lewat TCP (port cetak). Hanya untuk IP yang sudah
  /// terdaftar sebagai printer NETWORK. Return { bytesSent, latencyMs }.
  async relayPrint(ip, buffer) {
    const device = await Device.findOne({
      "network.ipAddress": ip,
      deviceType: "PRINTER",
      connectionType: "NETWORK",
    });
    if (!device) {
      throw new Error("Printer not found");
    }
    const port = device.network?.port || DEFAULT_PRINT_PORT;
    const key = String(device._id);

    const latencyMs = await new Promise((resolve, reject) => {
      const start = Date.now();
      const socket = new net.Socket();
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn(arg);
      };
      socket.setTimeout(RELAY_TIMEOUT_MS);
      socket.once("timeout", () => done(reject, new Error("relay-timeout")));
      socket.once("error", (e) => {
        e.code = e.code || e.message;
        done(reject, e);
      });
      socket.once("close", () => done(resolve, Date.now() - start));
      socket.connect(port, ip, () => {
        socket.write(buffer, () => socket.end());
      });
    });

    // Cetak berhasil = bukti printer online.
    statusCache.set(key, {
      online: true,
      latencyMs,
      via: "relay",
      checkedAt: new Date(),
      failCount: 0,
    });
    rlog(`${ip}:${port} ok — ${buffer.length} bytes, ${latencyMs}ms`);

    return { bytesSent: buffer.length, latencyMs };
  }

  /// Refresh cache tanpa menunggu (fire-and-forget) — dipanggil setelah
  /// printer NETWORK dibuat/diubah.
  refreshNetworkStatusSoon() {
    this.pingAllNetwork().catch((e) =>
      console.error("refreshNetworkStatusSoon failed:", e.message),
    );
  }

  /// Mulai poller latar belakang. Dipanggil sekali saat server boot.
  startStatusMonitor() {
    slog(
      `monitor start — platform=${process.platform}, interval=${STATUS_POLL_INTERVAL_MS}ms, debug=${STATUS_DEBUG}`,
    );
    this.pingAllNetwork().catch((e) =>
      console.error("Initial printer status poll failed:", e.message),
    );
    const timer = setInterval(() => {
      this.pingAllNetwork().catch((e) =>
        console.error("Printer status poll failed:", e.message),
      );
    }, STATUS_POLL_INTERVAL_MS);
    timer.unref?.();
    return timer;
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
          (a, b) =>
            b.printCount - a.printCount || a.printBy.localeCompare(b.printBy),
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
    const [resetLogs, total, avgResult] = await Promise.all([
      DeviceMaintenance.find({ deviceId: device._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      DeviceMaintenance.countDocuments({ deviceId: device._id }),
      DeviceMaintenance.aggregate([
        { $match: { deviceId: device._id, printCountAtReset: { $ne: null } } },
        { $group: { _id: null, avg: { $avg: "$printCountAtReset" } } },
      ]),
    ]);

    const avgPrintCountAtReset =
      avgResult.length > 0 ? Math.round(avgResult[0].avg) : null;

    return { device, resetLogs, total, page, limit, avgPrintCountAtReset };
  }

  async performReset(printerId, remark = null) {
    const device = await Device.findOne({
      identifier: printerId,
      deviceType: "PRINTER",
    });
    if (!device) {
      throw new Error("Printer not found");
    }

    // Reset lastMaintenancePrint to current totalPrint and status to NORMAL
    const printCountAtReset = device.totalPrint - device.lastMaintenancePrint;
    device.lastMaintenancePrint = device.totalPrint;
    device.status = "NORMAL";
    await device.save();

    // Log reset action
    const resetLog = new DeviceMaintenance({
      deviceId: device._id,
      doneBy: "SYSTEM",
      remark,
      printCountAtReset,
    });
    await resetLog.save();

    return { device, resetLog };
  }
}

export default new PrinterService();
