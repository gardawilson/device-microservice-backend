import express from "express";
import {
  createPrinter,
  deletePrinter,
  getAllPrinters,
  getPrinterById,
  logPrinterUsage,
  getPrinterLogs,
  getPrinterLogSummary,
  getResetLogs,
  updatePrinterName,
  performPrinterReset,
  getMaxPrintCount,
  setMaxPrintCount,
} from "../controllers/printerController.js";

const router = express.Router();

/**
 * @swagger
 * /api/devices/printers:
 *   post:
 *     summary: Create a new printer
 *     tags: [Printers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *               - name
 *             properties:
 *               mac:
 *                 type: string
 *                 description: MAC address of the printer
 *               name:
 *                 type: string
 *                 description: Display name of the printer
 *     responses:
 *       201:
 *         description: Printer created successfully
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Printer already exists
 *       500:
 *         description: Internal server error
 *   get:
 *     summary: Get all printers
 *     tags: [Printers]
 *     responses:
 *       200:
 *         description: List of all printers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 printers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       identifier:
 *                         type: string
 *                       totalPrint:
 *                         type: number
 *                       lastMaintenancePrint:
 *                         type: number
 *                       lastUsedAt:
 *                         type: string
 *                         format: date-time
 *       500:
 *         description: Internal server error
 */
router.post("/", createPrinter);
router.get("/", getAllPrinters);

/**
 * @swagger
 * /api/devices/printers/log:
 *   post:
 *     summary: Log printer usage
 *     tags: [Printers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - sourceApp
 *               - printBy
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: MAC address or unique ID of the printer
 *               sourceApp:
 *                 type: string
 *                 description: Source application
 *               printBy:
 *                 type: string
 *                 description: Username/user yang melakukan print
 *     responses:
 *       201:
 *         description: Usage logged successfully
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Internal server error
 */
router.post("/log", logPrinterUsage);

/**
 * @swagger
 * /api/devices/printers/log:
 *   get:
 *     summary: Get printer usage logs
 *     tags: [Printers]
 *     parameters:
 *       - in: query
 *         name: identifier
 *         required: false
 *         schema:
 *           type: string
 *         description: MAC address or unique ID of the printer
 *       - in: query
 *         name: printerId
 *         required: false
 *         schema:
 *           type: string
 *         description: Alias for identifier
 *       - in: query
 *         name: mac
 *         required: false
 *         schema:
 *           type: string
 *         description: Alias for identifier
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Printer logs
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Printer not found
 *       500:
 *         description: Internal server error
 */
router.get("/log", getPrinterLogs);

/**
 * @swagger
 * /api/devices/printers/log/summary:
 *   get:
 *     summary: Get printer usage summary by date range
 *     tags: [Printers]
 *     parameters:
 *       - in: query
 *         name: identifier
 *         required: false
 *         schema:
 *           type: string
 *         description: MAC address or unique ID of the printer
 *       - in: query
 *         name: printerId
 *         required: false
 *         schema:
 *           type: string
 *         description: Alias for identifier
 *       - in: query
 *         name: mac
 *         required: false
 *         schema:
 *           type: string
 *         description: Alias for identifier
 *       - in: query
 *         name: from
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date in YYYY-MM-DD
 *       - in: query
 *         name: to
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: End date in YYYY-MM-DD
 *     responses:
 *       200:
 *         description: Printer summary by date range
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Printer not found
 *       500:
 *         description: Internal server error
 */
router.get("/log/summary", getPrinterLogSummary);

/**
 * @swagger
 * /api/devices/printers/status:
 *   get:
 *     summary: Get printer status
 *     tags: [Printers]
 *     parameters:
 *       - in: query
 *         name: identifier
 *         required: true
 *         schema:
  *           type: string
 *         description: MAC address or unique ID of the printer
 *     responses:
 *       200:
 *         description: Printer status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 identifier:
 *                   type: string
 *                 totalPrint:
 *                   type: number
 *                 printsSinceMaintenance:
 *                   type: number
 *                 status:
 *                   type: string
 *                   enum: [NORMAL, WARNING, CRITICAL]
 *                 lastUsedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid identifier
 *       404:
 *         description: Printer not found
 *       500:
 *         description: Internal server error
 */
/**
 * @swagger
 * /api/devices/printers/reset:
 *   post:
 *     summary: Reset printer counter
 *     tags: [Printers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: MAC address or unique ID of the printer
 *     responses:
 *       200:
 *         description: Printer reset performed successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Printer not found
 *       500:
 *         description: Internal server error
 */
router.get("/reset", getResetLogs);
router.post("/reset", performPrinterReset);

router.get("/settings/max-print-count", getMaxPrintCount);
router.put("/settings/max-print-count", setMaxPrintCount);

// Keep param route at the end so it does not shadow static routes like /log
router.get("/:id", getPrinterById);
router.patch("/:id", updatePrinterName);
router.delete("/:id", deletePrinter);

export default router;
