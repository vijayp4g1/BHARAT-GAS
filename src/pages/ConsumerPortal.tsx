import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { MapPin, Camera, CheckCircle, Loader2, Navigation, LogOut, ShieldCheck, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { compressImage } from '../lib/imageUtils';

export const ConsumerPortal = () => {
  const [mobile, setMobile] = useState('');
  const [consumerNumber, setConsumerNumber] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [consumer, setConsumer] = useState<any>(null);

  // Task states
  const [isCapturingGPS, setIsCapturingGPS] = useState(false);
  const [hasLocation, setHasLocation] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);

  // Refs for file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobile || !consumerNumber) {
      toast.error('Please enter both details.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const { data, error } = await supabase.rpc('portal_login', {
        p_mobile: mobile.trim(),
        p_consumer_number: consumerNumber.trim()
      });

      if (error) throw error;

      if (data && data.success) {
        setConsumer(data);
        setHasLocation(data.has_location || false);
        setHasPhoto(data.has_photo || false);
        toast.success(`Welcome, ${data.name}!`);
      } else {
        toast.error('Invalid Mobile Number or Consumer Number.');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('Failed to login. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setConsumer(null);
    setMobile('');
    setConsumerNumber('');
    setHasLocation(false);
    setHasPhoto(false);
  };

  const captureGPS = () => {
    if (!navigator.geolocation) {
      toast.error('GPS is not supported by your browser.');
      return;
    }

    setIsCapturingGPS(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (position.coords.accuracy > 2000) {
          toast.error(`GPS signal is too weak (Accuracy: ${Math.round(position.coords.accuracy)}m). Please step outside or use a mobile phone for better GPS.`, { duration: 5000 });
          setIsCapturingGPS(false);
          return;
        }

        try {
          const { error } = await supabase.rpc('portal_upload_location', {
            p_consumer_id: consumer.id,
            p_lat: position.coords.latitude,
            p_lng: position.coords.longitude,
            p_acc: position.coords.accuracy
          });

          if (error) throw error;
          
          setHasLocation(true);
          toast.success('Location saved securely!');
        } catch (err) {
          console.error(err);
          toast.error('Failed to save location.');
        } finally {
          setIsCapturingGPS(false);
        }
      },
      (err) => {
        toast.error(`GPS Error: ${err.message}`);
        setIsCapturingGPS(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !consumer) return;

    setIsCompressing(true);
    try {
      const compressedBase64 = await compressImage(file);
      const response = await fetch(compressedBase64);
      const blob = await response.blob();
      
      const fileName = `${consumer.id}/${Date.now()}-house.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('consumer-photos')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('consumer-photos')
        .getPublicUrl(fileName);

      const { error: linkError } = await supabase.rpc('portal_upload_photo', {
        p_consumer_id: consumer.id,
        p_photo_url: publicUrlData.publicUrl
      });

      if (linkError) throw linkError;

      setHasPhoto(true);
      toast.success('Photo uploaded successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to upload photo.');
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!consumer) {
    return (
      <div className="min-h-screen bg-premium-gradient flex flex-col items-center justify-center p-4">
        <div className="glass-card rounded-[2rem] shadow-2xl p-8 max-w-md w-full relative z-10 border border-white/20">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-3">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center shadow-inner">
                <ShieldCheck size={32} />
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black mb-2 text-slate-800 tracking-tight">SIDDHARTHA BHARAT GAS</h1>
            <p className="text-slate-500 font-medium text-sm sm:text-base">Official Consumer Verification Portal</p>
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-200">
              <Lock size={12} />
              Secured & Encrypted
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Registered Mobile Number</label>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="e.g. 9876543210"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Consumer Number</label>
              <input
                type="text"
                value={consumerNumber}
                onChange={(e) => setConsumerNumber(e.target.value)}
                placeholder="Enter your consumer number"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                required
              />
            </div>

            <button 
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30 transition-all mt-6"
            >
              {isLoggingIn ? <Loader2 className="animate-spin" /> : (
                <>
                  <Lock size={18} />
                  Secure Login
                </>
              )}
            </button>
          </form>
          
          <p className="text-xs text-center text-slate-400 mt-6 font-medium">
            Your data is securely encrypted and accessible only by you.
          </p>
        </div>
      </div>
    );
  }

  const isAllDone = hasLocation && hasPhoto;

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-gradient-to-br from-blue-600 to-indigo-800 text-white p-6 shadow-xl rounded-b-[2.5rem] relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-white opacity-5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-[-20%] left-[-10%] w-48 h-48 bg-blue-400 opacity-20 rounded-full blur-2xl pointer-events-none"></div>
        
        <div className="flex justify-between items-start mb-6 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-inner">
              <ShieldCheck size={24} className="text-blue-100" />
            </div>
            <div>
              <h2 className="text-xs font-black tracking-widest text-blue-200 uppercase mb-0.5">Siddhartha Bharat Gas</h2>
              <h1 className="text-2xl font-black mb-0 tracking-tight">Hello, {consumer.name}</h1>
            </div>
          </div>
          <button onClick={handleLogout} className="p-2.5 bg-white/10 backdrop-blur-md rounded-xl hover:bg-white/20 transition-colors border border-white/10 shadow-sm">
            <LogOut size={18} />
          </button>
        </div>
        
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 flex items-center gap-3 border border-white/10 relative z-10">
          <div className="bg-blue-500/50 p-2 rounded-lg">
            <Lock size={16} className="text-blue-100" />
          </div>
          <div>
            <p className="text-xs text-blue-200 font-medium mb-0.5">Consumer ID</p>
            <p className="font-bold tracking-wide">#{consumer.consumer_number}</p>
          </div>
        </div>
      </header>

      <main className="p-4 max-w-lg mx-auto space-y-6 -mt-4 relative z-10">
        
        {isAllDone && (
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-[2rem] p-8 text-center shadow-xl shadow-emerald-500/20 border border-emerald-400 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2"></div>
            
            <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner">
              <CheckCircle size={40} className="text-white" />
            </div>
            
            <h2 className="text-2xl font-black mb-3 tracking-tight">Verification Complete!</h2>
            <p className="text-emerald-50 font-medium leading-relaxed text-sm">
              Thank you for updating your location and photos. Your delivery agent will have an easier time finding you securely.
            </p>
          </div>
        )}
        
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 mt-6">
          <h2 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
            {isAllDone ? 'Update Your Details' : 'Pending Tasks'}
          </h2>
          
          <div className="space-y-4">
            {/* GPS Task */}
            <div className={`p-4 rounded-2xl border-2 transition-all ${hasLocation ? 'border-emerald-100 bg-emerald-50' : 'border-blue-100 bg-blue-50'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasLocation ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'}`}>
                    {hasLocation ? <CheckCircle size={20} /> : <MapPin size={20} />}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">GPS Location</h3>
                    <p className="text-xs text-slate-500">{hasLocation ? 'Captured successfully' : 'Required for delivery'}</p>
                  </div>
                </div>
              </div>
              <button 
                onClick={captureGPS}
                disabled={isCapturingGPS}
                className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md transition-all ${
                  hasLocation 
                    ? 'bg-white border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50' 
                    : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white shadow-blue-500/20'
                }`}
              >
                {isCapturingGPS ? <Loader2 className="animate-spin" /> : <Navigation size={18} />}
                {hasLocation ? 'Update Location' : 'Share Current Location'}
              </button>
            </div>

            {/* Photo Task */}
            <div className={`p-4 rounded-2xl border-2 transition-all ${hasPhoto ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasPhoto ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                    {hasPhoto ? <CheckCircle size={20} /> : <Camera size={20} />}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">House Photo</h3>
                    <p className="text-xs text-slate-500">{hasPhoto ? 'Uploaded successfully' : 'Please upload a photo'}</p>
                  </div>
                </div>
              </div>
              <input 
                type="file" 
                accept="image/*" 
                capture="environment" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handlePhotoCapture}
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isCompressing}
                className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md transition-all ${
                  hasPhoto 
                    ? 'bg-white border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50' 
                    : 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-400 text-white shadow-amber-500/20'
                }`}
              >
                {isCompressing ? <Loader2 className="animate-spin" /> : <Camera size={18} />}
                {hasPhoto ? 'Update Photo' : 'Take Photo'}
              </button>
            </div>
          </div>
        </div>

        <div className="text-center mt-8 mb-6">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-center gap-1.5">
            <ShieldCheck size={14} /> Secured Platform
          </p>
          <p className="text-[10px] text-slate-400">© 2026 Siddhartha Bharat Gas</p>
        </div>
      </main>
    </div>
  );
};
