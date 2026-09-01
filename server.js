import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./src/configs/database.js";
import printerService from "./src/services/printerService.js";

dotenv.config();

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();
    // Poller latar belakang: ping ICMP tiap printer jaringan secara berkala.
    printerService.startStatusMonitor();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(
        `Swagger docs available at http://localhost:${PORT}/api-docs`,
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
