require("dotenv").config();

const app = require("./api");

const { connectDB, client } = require("./config/db");

const PORT = Number(process.env.PORT) || 5000;

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`School Reunion Server is running on port ${PORT}`);
    });

    // ========================================================
    // GRACEFUL SHUTDOWN
    // ========================================================

    const shutdown = async (signal) => {
      console.log(`${signal} received. Shutting down server...`);

      server.close(async () => {
        try {
          await client.close();

          console.log("MongoDB connection closed.");

          console.log("Server shut down successfully.");

          process.exit(0);
        } catch (error) {
          console.error("Error during server shutdown:", error.message);

          process.exit(1);
        }
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("Failed to start School Reunion Server:", error.message);

    process.exit(1);
  }
}

startServer();
