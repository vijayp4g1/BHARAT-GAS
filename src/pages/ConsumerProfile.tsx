import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, MapPin, Camera, Navigation, CheckCircle, AlertTriangle, Loader2, Trash2, X, Edit2, FileText, Plus } from 'lucide-react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import db from '../lib/db';
import { compressImage } from '../lib/imageUtils';
import toast from 'react-hot-toast';
import { ConsumerModal } from '../components/ConsumerModal';
import { syncOfflineData } from '../lib/sync';
import { supabase } from '../lib/supabase';

// Fix Leaflet default marker
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export const ConsumerProfile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [isCapturingGPS, setIsCapturingGPS] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<GeolocationPosition | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  const consumer = useLiveQuery(() => 
    id ? db.consumers.get(id) : undefined
  , [id]);

  const location = useLiveQuery(() => 
    id ? db.consumer_locations.where({ consumer_id: id }).filter(l => !l.isDeleted).first() : undefined
  , [id]);

  const photos = useLiveQuery(() => 
    id ? db.consumer_photos.where({ consumer_id: id }).filter(p => !p.isDeleted).toArray() : []
  , [id]) || [];

  const notes = useLiveQuery(() => 
    id ? db.delivery_notes.where({ consumer_id: id }).filter(n => !n.isDeleted).toArray() : []
  , [id]) || [];

  // Fetch latest data for this specific consumer from the cloud when online
  React.useEffect(() => {
    const fetchLatestData = async () => {
      if (!id || !navigator.onLine) return;
      
      try {
        // Fetch locations
        const { data: locations } = await supabase.from('consumer_locations').select('*').eq('consumer_id', id);
        if (locations && locations.length > 0) {
          const formattedLocations = locations.map(l => ({ ...l, synced: true }));
          await db.consumer_locations.bulkPut(formattedLocations);
          await db.consumers.update(id, { has_location: true });
        }

        // Fetch photos
        const { data: photosData } = await supabase.from('consumer_photos').select('*').eq('consumer_id', id);
        if (photosData && photosData.length > 0) {
          const formattedPhotos = photosData.map(p => ({ ...p, synced: true }));
          await db.consumer_photos.bulkPut(formattedPhotos);
          await db.consumers.update(id, { has_photos: true });
        }

        // Fetch notes
        const { data: notesData } = await supabase.from('delivery_notes').select('*').eq('consumer_id', id);
        if (notesData && notesData.length > 0) {
          const formattedNotes = notesData.map(n => ({ ...n, synced: true }));
          await db.delivery_notes.bulkPut(formattedNotes);
        }
        
      } catch (err) {
        console.error('Failed to fetch latest consumer data from cloud:', err);
      }
    };
    
    fetchLatestData();
  }, [id]);

  if (consumer === undefined) {
    return <div className="p-8 text-center text-slate-500">Loading...</div>;
  }

  if (consumer === null) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500 mb-4">Consumer not found.</p>
        <button onClick={() => navigate(-1)} className="text-blue-600 font-semibold">Go Back</button>
      </div>
    );
  }

  const handleCaptureGPS = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }

    setIsCapturingGPS(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Remove accuracy strict block so agents are not blocked
        // Instead of saving immediately, set as pending for user confirmation
        setPendingLocation(position);
        setIsCapturingGPS(false);
      },
      (error) => {
        setGpsError(`Error capturing GPS: ${error.message}`);
        setIsCapturingGPS(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const confirmAndSaveLocation = async () => {
    if (!pendingLocation || !id) return;
    
    setIsCapturingGPS(true);
    try {
      await db.consumer_locations.add({
        consumer_id: id,
        latitude: pendingLocation.coords.latitude,
        longitude: pendingLocation.coords.longitude,
        accuracy: pendingLocation.coords.accuracy,
        uploaded_by: 'agent-1', // Mock agent ID for now
        uploaded_at: new Date().toISOString(),
        synced: false 
      });
      
      // Update consumer status locally
      await db.consumers.update(id, { 
        verification_status: 'Pending', 
        has_location: true,
        synced: false 
      });
      
      setPendingLocation(null);
      syncOfflineData().catch(console.error);
    } catch (error) {
      console.error('Failed to save location', error);
      setGpsError('Failed to save location locally.');
    } finally {
      setIsCapturingGPS(false);
    }
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    
    // Custom Toast for Photo Type Selection
    toast((t) => (
      <div className="flex flex-col gap-3">
        <p className="font-bold text-slate-800">What type of photo is this?</p>
        <div className="flex gap-2">
          <button 
            onClick={() => {
              toast.dismiss(t.id);
              processPhoto(file, 'house');
            }} 
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            House
          </button>
          <button 
            onClick={() => {
              toast.dismiss(t.id);
              processPhoto(file, 'document');
            }} 
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Document / ID
          </button>
        </div>
      </div>
    ), { duration: Infinity, position: 'top-center' });
    
    e.target.value = ''; // Reset input immediately
  };

  const processPhoto = async (file: File, typeStr: string) => {
    if (!id) return;
    try {
      setIsCompressing(true);
      const compressedBase64 = await compressImage(file, 1280, 1280, 0.7);
      
      await db.consumer_photos.add({
        consumer_id: id,
        photo_data_url: compressedBase64,
        photo_type: typeStr, 
        status: 'Pending',
        uploaded_by: 'agent-1',
        uploaded_at: new Date().toISOString(),
        synced: false
      });
      
      // Update consumer status locally
      await db.consumers.update(id, { 
        verification_status: 'Pending', 
        has_photos: true,
        synced: false 
      });
      
      toast.success('Photo saved!', { duration: 3000 });
      syncOfflineData().catch(console.error);
    } catch (error) {
      console.error('Failed to save compressed photo locally', error);
      toast.error('Failed to process image. Please try again.', { duration: 3000 });
    } finally {
      setIsCompressing(false);
    }
  };

  const handleDeletePhoto = (photoId: number) => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <p className="font-bold text-slate-800">Delete this photo?</p>
        <p className="text-sm text-slate-500">This action cannot be undone.</p>
        <div className="flex gap-2 mt-1">
          <button 
            onClick={() => {
              toast.dismiss(t.id);
              executeDelete(photoId);
            }} 
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Delete
          </button>
          <button 
            onClick={() => toast.dismiss(t.id)} 
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };
  
  const executeDelete = async (photoId: number) => {
    try {
      await db.consumer_photos.update(photoId, { isDeleted: true, synced: false });
      
      const remainingPhotos = await db.consumer_photos.where({ consumer_id: id }).filter(p => !p.isDeleted).count();
      if (remainingPhotos === 0) {
        await db.consumers.update(id, { has_photos: false });
      }
      
      toast.success('Photo deleted', { duration: 3000 });
      syncOfflineData().catch(console.error);
    } catch (error) {
      console.error("Failed to delete photo", error);
      toast.error("Failed to delete photo");
    }
  };

  const handleDeleteLocation = (locationId: number) => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <p className="font-bold text-slate-800">Delete this GPS location?</p>
        <p className="text-sm text-slate-500">This action cannot be undone.</p>
        <div className="flex gap-2 mt-1">
          <button 
            onClick={() => {
              toast.dismiss(t.id);
              executeDeleteLocation(locationId);
            }} 
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Delete
          </button>
          <button 
            onClick={() => toast.dismiss(t.id)} 
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };
  
  const executeDeleteLocation = async (locationId: number) => {
    try {
      await db.consumer_locations.update(locationId, { isDeleted: true, synced: false });
      
      const remainingLocations = await db.consumer_locations.where({ consumer_id: id }).filter(l => !l.isDeleted).count();
      if (remainingLocations === 0) {
        await db.consumers.update(id, { has_location: false });
      }
      
      toast.success('Location deleted', { duration: 3000 });
      syncOfflineData().catch(console.error);
    } catch (error) {
      console.error("Failed to delete location", error);
      toast.error("Failed to delete location");
    }
  };

  const handleDeleteConsumer = () => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <p className="font-bold text-slate-800">Delete this consumer?</p>
        <p className="text-sm text-slate-500">This action will mark the consumer as deleted.</p>
        <div className="flex gap-2 mt-1">
          <button 
            onClick={() => {
              toast.dismiss(t.id);
              executeDeleteConsumer();
            }} 
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Delete
          </button>
          <button 
            onClick={() => toast.dismiss(t.id)} 
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };
  
  const executeDeleteConsumer = async () => {
    if (!id) return;
    try {
      await db.consumers.update(id, {
        isDeleted: true,
        synced: false
      });
      toast.success('Consumer deleted', { duration: 3000 });
      syncOfflineData().catch(console.error);
      navigate(-1); // Go back to search/dashboard
    } catch (error) {
      console.error("Failed to delete consumer", error);
      toast.error("Failed to delete consumer", { duration: 3000 });
    }
  };

  const handleAddNote = async () => {
    if (!id || !newNote.trim()) return;
    try {
      await db.delivery_notes.add({
        consumer_id: id,
        note: newNote.trim(),
        uploaded_by: 'agent-1',
        created_at: new Date().toISOString(),
        synced: false
      });
      setNewNote('');
      setIsAddingNote(false);
      toast.success('Note added successfully', { duration: 3000 });
      syncOfflineData().catch(console.error);
    } catch (error) {
      console.error("Failed to add note", error);
      toast.error("Failed to add note", { duration: 3000 });
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    try {
      await db.delivery_notes.update(noteId, { isDeleted: true, synced: false });
      toast.success('Note deleted', { duration: 3000 });
      syncOfflineData().catch(console.error);
    } catch (error) {
      console.error("Failed to delete note", error);
      toast.error("Failed to delete note");
    }
  };

  const handleNavigate = () => {
    if (location) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`;
      window.open(url, '_blank');
    }
  };

  const hasLocation = !!location;
  const hasPhotos = photos && photos.length > 0;

  return (
    <div className="min-h-screen bg-premium-gradient flex flex-col pb-20">
      <header className="glass-header text-white p-5 sticky top-0 z-20 flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/10 rounded-full transition-colors backdrop-blur-sm border border-white/10 bg-white/5">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold flex-1 truncate tracking-tight">Consumer Details</h1>
        <button onClick={() => setIsEditModalOpen(true)} className="p-2 hover:bg-white/20 rounded-full transition-colors text-white" title="Edit Consumer">
          <Edit2 size={20} />
        </button>
        <button onClick={handleDeleteConsumer} className="p-2 hover:bg-red-500/80 rounded-full transition-colors text-white" title="Delete Consumer">
          <Trash2 size={20} />
        </button>
      </header>

      <ConsumerModal 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        initialData={consumer}
      />

      <main className="p-5 space-y-5">
        <section className="glass-card rounded-2xl p-6">
          <div className="mb-5">
            <span className="inline-block px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg mb-3 border border-blue-100/50">
              #{consumer.consumer_number}
            </span>
            <h2 className="text-2xl font-bold text-slate-800">{consumer.consumer_name}</h2>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Mobile Number</p>
              <p className="text-slate-800 text-lg font-medium">{consumer.mobile}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Address</p>
              <p className="text-slate-700 leading-relaxed">{consumer.address}</p>
            </div>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-5 border-b border-slate-200/50 pb-3">Location & Photos</h3>
          
          <div className="space-y-4">
            {/* GPS Status */}
            <div>
              {pendingLocation ? (
                <div className="p-5 bg-blue-50/80 backdrop-blur-md rounded-xl border border-blue-200 shadow-inner animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-full mt-0.5">
                      <MapPin size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-blue-900">Confirm Location</h4>
                      <p className="text-sm text-blue-700 mt-1">Accuracy: <span className="font-bold">{Math.round(pendingLocation.coords.accuracy)} meters</span></p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setPendingLocation(null)}
                      disabled={isCapturingGPS}
                      className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={confirmAndSaveLocation}
                      disabled={isCapturingGPS}
                      className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-blue-600 text-white shadow-md shadow-blue-500/30 hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                    >
                      {isCapturingGPS ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-4 bg-slate-50/50 backdrop-blur-sm rounded-xl border border-slate-100/50 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-full shadow-sm ${hasLocation ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                      <MapPin size={20} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 text-sm">GPS Location</p>
                      <p className="text-xs text-slate-500 font-medium">{hasLocation ? 'Captured accurately' : 'Pending capture'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {hasLocation && (
                      <button 
                        onClick={() => handleDeleteLocation(location.id as number)}
                        className="p-2.5 rounded-xl bg-red-100 text-red-600 hover:bg-red-200 transition-colors shadow-sm"
                        title="Delete Location"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                    <button 
                      onClick={handleCaptureGPS}
                      disabled={isCapturingGPS}
                      className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center min-w-[90px] shadow-md ${
                        hasLocation ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 shadow-none' : 'bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 hover:shadow-blue-500/30'
                      } ${isCapturingGPS ? 'opacity-70 cursor-not-allowed' : 'active:scale-95'}`}
                    >
                      {isCapturingGPS ? <Loader2 size={18} className="animate-spin" /> : hasLocation ? 'Update' : 'Capture'}
                    </button>
                  </div>
                </div>
              )}
              
              {/* Map Preview */}
              {hasLocation && location && !pendingLocation && (
                <div className="mt-3 rounded-xl overflow-hidden shadow-sm border border-slate-200/60 h-32 relative z-0">
                  <MapContainer 
                    center={[location.latitude, location.longitude]} 
                    zoom={16} 
                    scrollWheelZoom={false}
                    dragging={false}
                    className="w-full h-full"
                    zoomControl={false}
                    attributionControl={false}
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <Marker position={[location.latitude, location.longitude]} />
                  </MapContainer>
                </div>
              )}

              {gpsError && <p className="text-xs text-red-500 mt-2 px-2 font-medium">{gpsError}</p>}
            </div>

            {/* Photos Status */}
            <div>
              <div className="flex items-center justify-between p-4 bg-slate-50/50 backdrop-blur-sm rounded-xl border border-slate-100/50 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className={`p-2.5 rounded-full shadow-sm ${hasPhotos ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                    <Camera size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Consumer Photos</p>
                    <p className="text-xs text-slate-500 font-medium">{hasPhotos ? `${photos.length} uploaded` : 'None uploaded'}</p>
                  </div>
                </div>
                <label 
                  className={`cursor-pointer px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center min-w-[90px] shadow-md ${isCompressing ? 'bg-blue-400 text-white cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 hover:shadow-blue-500/30 active:scale-95'}`}
                >
                  {isCompressing ? <Loader2 size={18} className="animate-spin" /> : 'Add'}
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    className="hidden" 
                    onChange={handlePhotoCapture} 
                    disabled={isCompressing}
                  />
                </label>
              </div>
              
              {/* Thumbnail Gallery */}
              {hasPhotos && (
                <div className="flex gap-3 mt-4 overflow-x-auto pb-2 px-1">
                  {photos.map((photo) => (
                    <div key={photo.id} className="relative w-24 h-24 rounded-xl overflow-hidden shadow-sm border border-slate-200/50 shrink-0 group">
                      <img 
                        src={photo.photo_data_url} 
                        alt="Consumer Upload" 
                        className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform" 
                        onClick={() => setSelectedPhoto(photo.photo_data_url)}
                      />
                      <button 
                        onClick={(e) => { e.stopPropagation(); if(photo.id) handleDeletePhoto(photo.id); }}
                        className="absolute top-1 right-1 p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-full opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                        title="Delete photo"
                      >
                        <Trash2 size={14} />
                      </button>
                      <div className="absolute bottom-0 inset-x-0 bg-slate-900/60 backdrop-blur-sm px-2 py-1 pointer-events-none">
                        <p className="text-[10px] font-bold text-white uppercase text-center truncate tracking-wider">{photo.photo_type}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5 border-b border-slate-200/50 pb-3">
            <h3 className="text-lg font-bold text-slate-800">Delivery Notes</h3>
            {!isAddingNote && (
              <button 
                onClick={() => setIsAddingNote(true)}
                className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus size={16} /> Add
              </button>
            )}
          </div>

          <div className="space-y-4">
            {isAddingNote && (
              <div className="bg-slate-50 p-4 rounded-xl border border-blue-200 shadow-inner">
                <textarea
                  autoFocus
                  placeholder="e.g., Blue gate, call before delivery..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none min-h-[80px]"
                  maxLength={500}
                />
                <div className="flex justify-end gap-2 mt-3">
                  <button 
                    onClick={() => {
                      setIsAddingNote(false);
                      setNewNote('');
                    }}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleAddNote}
                    disabled={!newNote.trim()}
                    className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
                  >
                    Save Note
                  </button>
                </div>
              </div>
            )}

            {notes && notes.length > 0 ? (
              <div className="space-y-3">
                {notes.map(note => (
                  <div key={note.id} className="group relative bg-white border border-slate-100 p-4 rounded-xl shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-amber-50 text-amber-500 rounded-lg shrink-0">
                        <FileText size={18} />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-slate-700 leading-relaxed">{note.note}</p>
                        <p className="text-[10px] text-slate-400 font-semibold mt-2 uppercase tracking-wider">
                          {new Date(note.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button 
                        onClick={() => note.id && handleDeleteNote(note.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        title="Delete Note"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : !isAddingNote ? (
              <div className="text-center p-6 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                <p className="text-slate-500 text-sm font-medium">No delivery notes added yet.</p>
              </div>
            ) : null}
          </div>
        </section>

        {/* Fixed Action Button */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-slate-200/50 pb-safe z-30 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
          <div className="max-w-2xl mx-auto flex gap-3">
            <button 
              onClick={handleNavigate}
              disabled={!hasLocation}
              className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-lg transition-all active:scale-[0.98] ${
                hasLocation 
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-700 hover:to-emerald-600 shadow-xl shadow-emerald-500/30 ring-2 ring-emerald-500/20 ring-offset-2 ring-offset-white/80' 
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
              }`}
            >
              <Navigation size={22} className={!hasLocation ? 'opacity-50' : 'animate-pulse'} />
              {hasLocation ? 'Navigate to House' : 'Location Required'}
            </button>
            <a 
              href={`tel:${consumer.mobile}`}
              className="flex items-center justify-center aspect-square h-[60px] w-[60px] bg-blue-100 text-blue-600 hover:bg-blue-200 rounded-2xl transition-colors shadow-sm"
              title="Call Consumer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            </a>
          </div>
        </div>
      </main>

      {/* Photo Preview Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/95 backdrop-blur-md" onClick={() => setSelectedPhoto(null)}>
          <button 
            className="absolute top-6 right-6 p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); setSelectedPhoto(null); }}
          >
            <X size={24} />
          </button>
          <img 
            src={selectedPhoto} 
            alt="Preview" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200" 
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
