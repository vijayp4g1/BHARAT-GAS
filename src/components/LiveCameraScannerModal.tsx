import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, Flashlight, CheckCircle2, AlertCircle, RefreshCw, Zap, Volume2, Sparkles, Loader2 } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import db from '../lib/db';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

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

// Play crisp audio beep feedback
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

/**
 * Normalizes thermal dot-matrix print OCR character misreads
 * e.g. "2872I38I" -> "28721381"
 */
function normalizeThermalDigits(rawText: string): string {
  return rawText
    .replace(/c0ns/gi, 'cons')
    .replace(/n0/gi, 'no')
    .replace(/;/g, ':')
    .replace(/I|l|i|\|/g, '1')
    .replace(/O|o|Q/g, '0')
    .replace(/B/g, '8')
    .replace(/Z|z/g, '2')
    .replace(/S|s/g, '5')
    .replace(/G|g/g, '6')
    .replace(/T|t/g, '7');
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
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [scannedCount, setScannedCount] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('Align Cons No: inside box...');

  const scannedSetRef = useRef<Set<string>>(new Set(existingNumbers.map((n) => n.toLowerCase())));
  const isProcessingFrameRef = useRef<boolean>(false);
  const workerRef = useRef<any>(null);

  // Initialize Tesseract worker
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const worker = await createWorker('eng');
        if (active) workerRef.current = worker;
      } catch (err) {
        console.error('Failed to init worker:', err);
      }
    })();

    return () => {
      active = false;
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

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

  // Process frame with Center Crop & Dot-Matrix AI Fuzzy Matching
  const processFrame = async () => {
    if (isProcessingFrameRef.current || !workerRef.current || !videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    isProcessingFrameRef.current = true;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // CROP ONLY THE CENTER BOX AREA (removes 80% background noise like keyboard keys)
      const cropX = video.videoWidth * 0.15;
      const cropY = video.videoHeight * 0.20;
      const cropW = video.videoWidth * 0.70;
      const cropH = video.videoHeight * 0.55;

      canvas.width = cropW;
      canvas.height = cropH;

      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // Contrast boost for thermal dot-matrix print
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const contrast = 55;
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const color = factor * (avg - 128) + 128;
        const finalColor = color < 115 ? 0 : 255;
        data[i] = finalColor;
        data[i + 1] = finalColor;
        data[i + 2] = finalColor;
      }

      ctx.putImageData(imgData, 0, 0);

      // Run OCR on cropped box area
      const { data: { text } } = await workerRef.current.recognize(canvas);

      // 1. Raw text candidates
      const rawNormalized = text.replace(/c0ns/gi, 'cons').replace(/n0/gi, 'no').replace(/;/g, ':');

      // 2. Fuzzy normalized thermal digits
      const thermalNormalized = normalizeThermalDigits(text);

      const combinedTexts = [rawNormalized, thermalNormalized];
      let candidates: string[] = [];

      for (const t of combinedTexts) {
        const patterns = [
          /(?:Cons\s*No|Consumer\s*No|ConsNo|Cons\s*No\s*:)[:.\s]*([0-9]{5,12})/i,
          /Cons\s*No\s*[:.\s]*([0-9]{5,12})/i,
          /(?:Cons|Consumer|Refill)[:.\s]*#?([0-9]{5,12})/i,
        ];

        for (const pat of patterns) {
          const match = t.match(pat);
          if (match && match[1]) {
            const num = match[1].trim();
            if (!DISTRIBUTOR_BLACKLIST.has(num) && !candidates.includes(num)) {
              candidates.push(num);
            }
          }
        }

        const allDigits = t.match(/\b([0-9]{6,10})\b/g) || [];
        allDigits.forEach((num: string) => {
          if (!DISTRIBUTOR_BLACKLIST.has(num) && !candidates.includes(num)) {
            candidates.push(num);
          }
        });
      }

      // Database lookup by Consumer Number against 31k IndexedDB master consumers
      for (const candidate of candidates) {
        if (scannedSetRef.current.has(candidate.toLowerCase())) {
          continue; // Skip already added numbers
        }

        const localMatch = await db.consumers
          .where('consumer_number')
          .equalsIgnoreCase(candidate)
          .first();

        if (localMatch) {
          // MATCH FOUND BY NUMBER!
          scannedSetRef.current.add(localMatch.consumer_number.toLowerCase());

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

          return;
        }
      }

      // Secondary AI Search: Database lookup by Consumer Name (e.g. PRAKASH)
      const nameMatch = rawNormalized.match(/(?:Cons\s*No|ConsNo|Consumer\s*No)[^\n]*\n\s*([A-Z\s]{3,25})/i);
      let nameCandidate = nameMatch && nameMatch[1] ? nameMatch[1].trim() : '';

      if (!nameCandidate) {
        const uppercaseWords = rawNormalized.match(/\b(PRAKASH|BANDIKA|[A-Z]{4,15})\b/g) || [];
        const filteredWords = uppercaseWords.filter(
          (w: string) => !['DETAILS', 'RECEIVER', 'INVOICE', 'BHARATGAS', 'BASE', 'RATE', 'CGST', 'SGST', 'SUB', 'CYL', 'AUTH', 'SIGN', 'DUE'].includes(w)
        );
        if (filteredWords.length > 0) nameCandidate = filteredWords[0];
      }

      if (nameCandidate && nameCandidate.length >= 3) {
        const nameMatches = await db.consumers
          .filter((c) => !!(c.consumer_name && c.consumer_name.toLowerCase().includes(nameCandidate.toLowerCase())))
          .limit(3)
          .toArray();

        if (nameMatches.length > 0) {
          const topMatch = nameMatches[0];
          if (!scannedSetRef.current.has(topMatch.consumer_number.toLowerCase())) {
            // MATCH FOUND BY NAME!
            scannedSetRef.current.add(topMatch.consumer_number.toLowerCase());

            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            playSuccessBeep();

            setLastScanned(`${topMatch.consumer_number} - ${topMatch.consumer_name}`);
            setScannedCount((prev) => prev + 1);

            onConsumerScanned({
              consumer_number: topMatch.consumer_number,
              consumer_name: topMatch.consumer_name,
              address: topMatch.address,
              mobile: topMatch.mobile,
              found: true,
            });
          }
        }
      }
    } catch (err) {
      console.error('Frame OCR error:', err);
    } finally {
      isProcessingFrameRef.current = false;
    }
  };

  // Continuous loop
  useEffect(() => {
    if (!isOpen || !isScanning) return;
    const interval = setInterval(processFrame, 400);
    return () => clearInterval(interval);
  }, [isOpen, isScanning, onConsumerScanned]);

  // Instant 1-Tap AI Snap Trigger
  const handleAiSnap = async () => {
    setIsAiProcessing(true);
    toast.loading('AI Vision analyzing receipt...', { id: 'ai-snap' });
    await processFrame();
    setTimeout(() => {
      setIsAiProcessing(false);
      toast.dismiss('ai-snap');
    }, 600);
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
            <p className="text-[11px] text-slate-400">Center-cropped dot-matrix receipt reader</p>
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

        {/* Target Box: Center Cropped Area */}
        <div className="absolute inset-x-6 top-1/5 bottom-1/4 border-2 border-dashed border-amber-400 rounded-3xl pointer-events-none flex flex-col justify-between p-3 shadow-[0_0_60px_rgba(245,158,11,0.3)]">
          <div className="flex justify-between">
            <div className="w-5 h-5 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
            <div className="w-5 h-5 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
          </div>

          <div className="text-center bg-slate-950/80 backdrop-blur-md text-amber-300 font-extrabold text-xs py-1.5 px-4 rounded-full mx-auto border border-amber-400/40 shadow-lg">
            Position Cons No: inside yellow box
          </div>

          <div className="flex justify-between">
            <div className="w-5 h-5 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
            <div className="w-5 h-5 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />
          </div>
        </div>

        {/* Live Detected Badge Alert */}
        {lastScanned && (
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
