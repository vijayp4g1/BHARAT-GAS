import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, Flashlight, CheckCircle2, AlertCircle, RefreshCw, Zap, Volume2, Sparkles, Loader2 } from 'lucide-react';
import db from '../lib/db';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { scanBillWithGemini } from '../lib/gemini';

interface LiveCameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsumerScanned: (consumer: {
    consumer_number: string;
    consumer_name: string;
    address?: string;
    mobile?: string;
    found: boolean;
  }) => void;
  existingNumbers: string[];
}

const DISTRIBUTOR_BLACKLIST = new Set([
  '169624',
  '23092200',
  '23192200',
  '23192211',
  '1800224344',
  '7718012345',
  '7715012345',
  '1718012345',
  '17718012345',
  '17715012345',
  '36406262986',
  '500054',
  '271119',
  '99400',
  '94666',
  '2367',
  '19441220350',
]);

function playSuccessBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (err) {
    // Audio fallback
  }
}

function cleanAndNormalizeDigits(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/I|L|\|/g, '1')
    .replace(/O|Q/g, '0')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/T/g, '7')
    .replace(/[^0-9]/g, '');
}

function getLevenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = [];
  let i, j;
  for (i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

function areNamesSimilar(scanned: string, dbName: string): boolean {
  const s = scanned.toLowerCase().replace(/[^a-z]/g, '');
  const d = dbName.toLowerCase().replace(/[^a-z]/g, '');
  
  if (s.length === 0 || d.length === 0) return false;
  
  if (s.length <= 3 || d.length <= 3) {
    return d.includes(s) || s.includes(d);
  }
  
  if (d.includes(s) || s.includes(d)) return true;
  
  const dist = getLevenshteinDistance(s, d.substring(0, s.length));
  const maxLen = Math.max(s.length, Math.min(d.length, s.length));
  const similarity = 1 - dist / maxLen;
  return similarity >= 0.5;
}

export const LiveCameraScannerModal: React.FC<LiveCameraScannerModalProps> = ({
  isOpen,
  onClose,
  onConsumerScanned,
  existingNumbers,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [alreadyAddedNotice, setAlreadyAddedNotice] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [scannedCount, setScannedCount] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('Align Cons No: inside box...');

  const scannedSetRef = useRef<Set<string>>(new Set(existingNumbers.map((n) => n.toLowerCase())));
  const isProcessingFrameRef = useRef<boolean>(false);

  // Sync existing numbers
  useEffect(() => {
    existingNumbers.forEach((num) => scannedSetRef.current.add(num.toLowerCase()));
  }, [existingNumbers]);

  // Start video stream when modal opens
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    try {
      setStatusText('Starting HD camera feed...');
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
      setIsScanning(true);
      setStatusText('AI Vision Active — Position Cons No: in box');
    } catch (err) {
      console.error('Camera access error:', err);
      setStatusText('Camera permission denied or camera unavailable');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setIsScanning(false);
  };

  // Toggle flashlight/torch
  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track && (track.getCapabilities() as any)?.torch) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: !torchOn } as any],
        });
        setTorchOn(!torchOn);
      } catch (e) {
        console.error('Torch error:', e);
      }
    }
  };

  // Process Frame with Gemini Multimodal AI
  const processFrame = async () => {
    if (isProcessingFrameRef.current || !videoRef.current || !canvasRef.current) {
      return;
    }

    // Check if Gemini API key is configured
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('VITE_GEMINI_API_KEY');
    if (!apiKey) {
      setStatusText('API Key Missing! Set VITE_GEMINI_API_KEY');
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    isProcessingFrameRef.current = true;
    setStatusText('AI Vision Scanning receipt...');

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw active frame to canvas at slightly downscaled resolution for fast network transmission
      canvas.width = video.videoWidth / 1.5;
      canvas.height = video.videoHeight / 1.5;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imgDataUrl = canvas.toDataURL('image/png');

      const geminiRes = await scanBillWithGemini(imgDataUrl);
      if (geminiRes.found && geminiRes.consumerNumber) {
        const cleanNum = cleanAndNormalizeDigits(geminiRes.consumerNumber);

        // Look up locally
        const localMatch = await db.consumers
          .where('consumer_number')
          .equalsIgnoreCase(cleanNum)
          .first();

        if (localMatch) {
          const isNameVerified = geminiRes.consumerName
            ? areNamesSimilar(geminiRes.consumerName, localMatch.consumer_name)
            : true;

          if (isNameVerified) {
            const isAlreadyAdded = scannedSetRef.current.has(localMatch.consumer_number.toLowerCase());
            if (isAlreadyAdded) {
              setAlreadyAddedNotice(`Consumer #${localMatch.consumer_number} (${localMatch.consumer_name}) is ALREADY in your delivery list!`);
              setTimeout(() => setAlreadyAddedNotice(null), 3000);
              setStatusText('Already in list');
              return;
            }

            // Success! Verified number & name
            scannedSetRef.current.add(localMatch.consumer_number.toLowerCase());
            setAlreadyAddedNotice(null);

            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            playSuccessBeep();

            setLastScanned(`${localMatch.consumer_number} - ${localMatch.consumer_name}`);
            setScannedCount((prev) => prev + 1);

            onConsumerScanned({
              consumer_number: localMatch.consumer_number,
              consumer_name: localMatch.consumer_name,
              address: localMatch.address,
              mobile: localMatch.mobile,
              found: true,
            });
            setStatusText('Add success!');
          } else {
            console.warn(`Gemini matched number #${cleanNum}, but name check failed.`);
            setStatusText('Name mismatch');
          }
        } else {
          console.warn(`Consumer #${cleanNum} not found in database.`);
          setStatusText(`Cons #${cleanNum} not in DB`);
        }
      } else {
        setStatusText('Align Cons No: inside box...');
      }
    } catch (err) {
      console.error('Frame Gemini OCR error:', err);
      setStatusText('Scan failed, retrying...');
    } finally {
      isProcessingFrameRef.current = false;
    }
  };

  // Continuous loop running every 3 seconds
  useEffect(() => {
    if (!isOpen || !isScanning) return;
    const interval = setInterval(processFrame, 3000);
    return () => clearInterval(interval);
  }, [isOpen, isScanning, onConsumerScanned]);

  // Instant 1-Tap AI Snap Trigger using Gemini Multimodal AI
  const handleAiSnap = async () => {
    let apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('VITE_GEMINI_API_KEY');
    if (!apiKey) {
      const enteredKey = prompt('Please enter your Google Gemini API Key to enable 1-Tap AI Vision:');
      if (enteredKey && enteredKey.trim().length > 0) {
        localStorage.setItem('VITE_GEMINI_API_KEY', enteredKey.trim());
        apiKey = enteredKey.trim();
      } else {
        toast.error('Gemini API key is required for 1-Tap AI Vision.');
        return;
      }
    }

    if (!videoRef.current || !canvasRef.current) return;
    
    setIsAiProcessing(true);
    toast.loading('AI Gemini vision parsing receipt...', { id: 'ai-snap' });

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
      // Draw the current frame at full resolution for high AI accuracy
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const imgDataUrl = canvas.toDataURL('image/png');

      try {
        const geminiRes = await scanBillWithGemini(imgDataUrl);
        if (geminiRes.found && geminiRes.consumerNumber) {
          const cleanNum = cleanAndNormalizeDigits(geminiRes.consumerNumber);

          const localMatch = await db.consumers
            .where('consumer_number')
            .equalsIgnoreCase(cleanNum)
            .first();

          if (localMatch) {
            const isNameVerified = geminiRes.consumerName
              ? areNamesSimilar(geminiRes.consumerName, localMatch.consumer_name)
              : true;

            if (isNameVerified) {
              const isAlreadyAdded = scannedSetRef.current.has(localMatch.consumer_number.toLowerCase());
              if (isAlreadyAdded) {
                setAlreadyAddedNotice(`Consumer #${localMatch.consumer_number} (${localMatch.consumer_name}) is ALREADY in your delivery list!`);
                setTimeout(() => setAlreadyAddedNotice(null), 3000);
                toast.success('Found but already added.', { id: 'ai-snap' });
                setIsAiProcessing(false);
                return;
              }

              // Success! Both number and name verified
              scannedSetRef.current.add(localMatch.consumer_number.toLowerCase());
              setAlreadyAddedNotice(null);

              if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
              playSuccessBeep();

              setLastScanned(`${localMatch.consumer_number} - ${localMatch.consumer_name}`);
              setScannedCount((prev) => prev + 1);

              onConsumerScanned({
                consumer_number: localMatch.consumer_number,
                consumer_name: localMatch.consumer_name,
                address: localMatch.address,
                mobile: localMatch.mobile,
                found: true,
              });

              toast.success(`Gemini Scanned: #${localMatch.consumer_number}!`, { id: 'ai-snap' });
              setIsAiProcessing(false);
              return;
            } else {
              toast.error(`Gemini read name "${geminiRes.consumerName}" but it didn't match database for #${cleanNum}`, { id: 'ai-snap', duration: 4000 });
            }
          } else {
            toast.error(`Consumer number #${cleanNum} (${geminiRes.consumerName}) not found in database`, { id: 'ai-snap', duration: 4000 });
          }
        } else {
          toast.error('Gemini could not detect a valid Consumer Number in this frame', { id: 'ai-snap' });
        }
      } catch (err: any) {
        console.error('Gemini snap OCR failed:', err);
        toast.error(`AI snap failed: ${err.message || 'unknown error'}`, { id: 'ai-snap' });
      }
    } else {
      toast.error('Camera feed is not ready yet', { id: 'ai-snap' });
    }
    
    setIsAiProcessing(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col justify-between p-3 font-sans">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between z-10 bg-slate-900/80 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-white">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight">Real-Time AI Vision Scanner</h2>
            <p className="text-[11px] text-slate-400">Full-frame & crop 31k master database reader</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTorch}
            className={`p-2.5 rounded-xl border transition-all ${
              torchOn ? 'bg-amber-500 text-slate-900 border-amber-400' : 'bg-white/10 text-white border-white/10'
            }`}
            title="Toggle Flashlight"
          >
            <Flashlight className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewfinder Video Stream Container */}
      <div className="relative flex-1 my-3 rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black flex items-center justify-center">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {/* Target Box */}
        <div className="absolute inset-x-6 top-1/5 bottom-1/4 border-2 border-dashed border-amber-400 rounded-3xl pointer-events-none flex flex-col justify-between p-3 shadow-[0_0_60px_rgba(245,158,11,0.3)]">
          <div className="flex justify-between">
            <div className="w-5 h-5 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
            <div className="w-5 h-5 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
          </div>

          <div className="text-center bg-slate-950/80 backdrop-blur-md text-amber-300 font-extrabold text-xs py-1.5 px-4 rounded-full mx-auto border border-amber-400/40 shadow-lg">
            Position Cons No: inside box
          </div>

          <div className="flex justify-between">
            <div className="w-5 h-5 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
            <div className="w-5 h-5 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />
          </div>
        </div>

        {/* Already Added Alert Badge */}
        {alreadyAddedNotice && (
          <div className="absolute top-4 left-4 right-4 bg-amber-500 text-slate-950 p-3 rounded-2xl shadow-xl flex items-center gap-2 border border-amber-300 font-bold text-xs z-30 animate-pulse">
            <AlertCircle className="w-5 h-5 shrink-0 text-slate-950" />
            <span className="truncate">{alreadyAddedNotice}</span>
          </div>
        )}

        {/* Live Detected Badge Alert */}
        {lastScanned && !alreadyAddedNotice && (
          <div className="absolute top-4 left-4 right-4 bg-emerald-600 text-white p-3.5 rounded-2xl shadow-xl flex items-center gap-2 border border-emerald-400/40 animate-bounce z-20">
            <CheckCircle2 className="w-6 h-6 text-amber-300 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black truncate uppercase tracking-tight">ADDED: #{lastScanned}</p>
              <p className="text-[10px] text-emerald-100 font-semibold">Matched 31k master database</p>
            </div>
          </div>
        )}

        {/* 1-Tap AI Snap Trigger Button on Viewfinder */}
        <div className="absolute bottom-4 inset-x-0 flex justify-center z-20">
          <button
            type="button"
            onClick={handleAiSnap}
            disabled={isAiProcessing}
            className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-slate-950 font-black px-6 py-3 rounded-2xl shadow-2xl shadow-amber-500/40 active:scale-95 transition-all flex items-center gap-2 border border-amber-300 text-xs tracking-wide uppercase"
          >
            {isAiProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> AI Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-slate-950" /> 1-Tap AI Snap
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-white flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-slate-300 block">{statusText}</span>
          <span className="text-[10px] text-amber-400 font-semibold">
            {scannedCount} bills scanned this session
          </span>
        </div>
        <button
          onClick={onClose}
          className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
        >
          Done ({scannedCount})
        </button>
      </div>
    </div>
  );
};
