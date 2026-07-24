import path from "path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production (Render), serve the built capture-page static files
if (process.env.NODE_ENV === "production") {
  const staticPath = path.join(process.cwd(), "artifacts", "capture-page", "dist", "public");
  app.use(express.static(staticPath));
  // SPA fallback — any unknown route serves index.html
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
}

export default app;
