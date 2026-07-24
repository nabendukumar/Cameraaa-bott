import { Router, type IRouter } from "express";
import { bot } from "../lib/telegram";

const router: IRouter = Router();

// Telegram webhook endpoint — only active when APP_URL is set (production/Render)
router.post("/telegram-webhook", (req, res) => {
  try {
    bot.processUpdate(req.body);
  } catch (err) {
    // Ignore malformed updates
  }
  res.sendStatus(200);
});

export default router;
