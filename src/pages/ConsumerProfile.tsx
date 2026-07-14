import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, MapPin, Camera, Navigation, CheckCircle, Loader2, Trash2, X, Edit2, FileText, Plus, Phone } from 'lucide-react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import db from '../lib/db';
import { compressImage } from '../lib/imageUtils';
import toast from 'react-hot-toast';
import { ConsumerModal } from '../components/ConsumerModal';
import { syncOfflineData } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { ConfirmationModal } from '../components/ConfirmationModal';

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
  const [photoToDelete, setPhotoToDelete] = useState<number | null>(null);
  const [locationToDelete, setLocationToDelete] = useState<number | null>(null);
  const [consumerToDelete, setConsumerToDelete] = useState(false);

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
        // Fetch locations - only overwrite if there are no unsynced local changes
        const { data: locations } = await supabase.from('consumer_locations').select('*').eq('consumer_id', id);
        if (locations && locations.length > 0) {
          const unsyncedLoc = await db.consumer_locations.where({ consumer_id: id }).filter(l => l.synced === false).first();
          if (!unsyncedLoc) {
            const formattedLocations = locations.map(l => ({ ...l, synced: true }));
            await db.consumer_locations.bulkPut(formattedLocations);
            await db.consumers.update(id, { has_location: true });
          }
        }

        // Fetch photos - only overwrite if there are no unsynced local changes
        const { data: photosData } = await supabase.from('consumer_photos').select('*').eq('consumer_id', id);
        if (photosData && photosData.length > 0) {
          const unsyncedPhotos = await db.consumer_photos.where({ consumer_id: id }).filter(p => p.synced === false).toArray();
          if (unsyncedPhotos.length === 0) {
            const formattedPhotos = photosData.map(p => ({ ...p, synced: true }));
            await db.consumer_photos.bulkPut(formattedPhotos);
            await db.consumers.update(id, { has_photos: true });
          }
        }

        // Fetch notes - only overwrite if there are no unsynced local changes
        const { data: notesData } = await supabase.from('delivery_notes').select('*').eq('consumer_id', id);
        if (notesData && notesData.length > 0) {
          const unsyncedNotes = await db.delivery_notes.where({ consumer_id: id }).filter(n => n.synced === false).toArray();
          if (unsyncedNotes.length === 0) {
            const formattedNotes = notesData.map(n => ({ ...n, synced: true }));
            await db.delivery_notes.bulkPut(formattedNotes);
          }
        }
        
      } catch (err) {
        console.error('Failed to fetch latest consumer data from cloud:', err);
      }
    };
    
    fetchLatestData();
  }, [id]);

  // Update last_interacted_at when profile is viewed
  React.useEffect(() => {
    if (id && consumer) {
      db.consumers.update(id, { last_interacted_at: new Date().toISOString() }).catch(console.error);
    }
  }, [id, consumer]);

  if (consumer === undefined) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    );
  }

  if (consumer === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6">
          <X size={40} />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Consumer not found</h2>
        <p className="text-slate-500 mb-8 max-w-xs">The consumer you're looking for might have been deleted or doesn't exist.</p>
        <button onClick={() => navigate(-1)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold transition-colors shadow-lg shadow-blue-500/30">
          Go Back
        </button>
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
      // Clear existing locations for this consumer first to avoid duplicates
      const existingLocs = await db.consumer_locations.where({ consumer_id: id }).toArray();
      for (const loc of existingLocs) {
        if (loc.id) {
          if (loc.synced) {
            await db.consumer_locations.update(loc.id, { isDeleted: true, synced: false });
          } else {
            await db.consumer_locations.delete(loc.id);
          }
        }
      }

      await db.consumer_locations.add({
        consumer_id: id,
        latitude: pendingLocation.coords.latitude,
        longitude: pendingLocation.coords.longitude,
        accuracy: pendingLocation.coords.accuracy,
        uploaded_by: localStorage.getItem('bgcls_agent_id') || 'unknown',
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
    
    processPhoto(file, 'house');
    
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
        uploaded_by: localStorage.getItem('bgcls_agent_id') || 'unknown',
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
    setPhotoToDelete(photoId);
  };

  const executeDelete = async (photoId: number) => {
    if (!id) return;
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
    setLocationToDelete(locationId);
  };
  
  const executeDeleteLocation = async (locationId: number) => {
    if (!id) return;
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
    setConsumerToDelete(true);
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
        uploaded_by: localStorage.getItem('bgcls_agent_id') || 'unknown',
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
    <div className="min-h-screen bg-slate-50 flex flex-col pb-24 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-400/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

      <header className="glass-header text-white p-4 sm:p-5 sticky top-0 z-20 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/20 rounded-xl transition-colors backdrop-blur-sm shadow-inner active:scale-95">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg sm:text-xl font-bold flex-1 truncate tracking-wide">Consumer Details</h1>
        <div className="flex gap-2">
          <button onClick={() => setIsEditModalOpen(true)} className="p-2 hover:bg-white/20 rounded-xl transition-colors text-white shadow-sm active:scale-95" title="Edit Consumer">
            <Edit2 size={18} />
          </button>
          <button onClick={handleDeleteConsumer} className="p-2 hover:bg-red-500/80 rounded-xl transition-colors text-white shadow-sm active:scale-95" title="Delete Consumer">
            <Trash2 size={18} />
          </button>
        </div>
      </header>

      <ConsumerModal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} consumerToEdit={consumer} />

      <ConfirmationModal
        isOpen={photoToDelete !== null}
        onClose={() => setPhotoToDelete(null)}
        onConfirm={() => {
          if (photoToDelete !== null) executeDelete(photoToDelete);
        }}
        title="Delete this photo?"
        message="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
      />

      <ConfirmationModal
        isOpen={locationToDelete !== null}
        onClose={() => setLocationToDelete(null)}
        onConfirm={() => {
          if (locationToDelete !== null) executeDeleteLocation(locationToDelete);
        }}
        title="Delete this location?"
        message="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
      />
      
      <ConfirmationModal
        isOpen={consumerToDelete}
        onClose={() => setConsumerToDelete(false)}
        onConfirm={executeDeleteConsumer}
        title="Delete this consumer?"
        message="This action will mark the consumer as deleted."
        confirmText="Delete"
        cancelText="Cancel"
      />

      <main className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full relative z-10">
        
        {/* Profile Card with Avatar */}
        <section className="glass-card rounded-3xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>
          
          <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center relative z-10">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-lg shadow-blue-500/30 border-4 border-white shrink-0">
              {consumer.consumer_name.charAt(0).toUpperCase()}
            </div>
            
            {/* Info */}
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="inline-block px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-100 uppercase tracking-wider">
                  #{consumer.consumer_number}
                </span>
                {hasLocation && hasPhotos ? (
                  <span className="inline-block px-2.5 py-1 bg-emerald-50 text-emerald-600 text-xs font-bold rounded-lg border border-emerald-100 uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle size={12} /> Completed
                  </span>
                ) : (
                  <span className="inline-block px-2.5 py-1 bg-amber-50 text-amber-600 text-xs font-bold rounded-lg border border-amber-100 uppercase tracking-wider">
                    Pending
                  </span>
                )}
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-800 leading-tight mb-2">
                {consumer.consumer_name}
              </h2>
              
              <div className="flex flex-wrap items-center gap-4 text-slate-600 mt-3">
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                  <Phone size={16} className="text-blue-500" />
                  <span className="font-bold font-mono">{consumer.mobile}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-5 pt-5 border-t border-slate-100/50">
            <div className="flex gap-3">
              <MapPin size={18} className="text-slate-400 shrink-0 mt-0.5" />
              <p className="text-slate-700 leading-relaxed font-medium">{consumer.address}</p>
            </div>
          </div>
        </section>

        {/* Location & Photos Task Board */}
        <section className="space-y-4">
          <h3 className="text-lg font-bold text-slate-800 px-2 flex items-center gap-2">
            Verification Tasks
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* GPS Card */}
            <div className={`glass-card rounded-2xl p-5 border-l-4 transition-all ${hasLocation ? 'border-l-emerald-400' : 'border-l-amber-400'}`}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${hasLocation ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                    <MapPin size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">GPS Location</h4>
                    <p className="text-xs text-slate-500 font-medium">{hasLocation ? 'Captured accurately' : 'Pending capture'}</p>
                  </div>
                </div>
                {hasLocation && (
                  <button 
                    onClick={() => handleDeleteLocation(location.id as number)}
                    className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete Location"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {pendingLocation ? (
                <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100 animate-in fade-in">
                  <p className="text-sm text-blue-800 font-medium mb-3 flex items-center gap-2">
                    Accuracy: <span className="font-bold bg-blue-100 px-2 py-0.5 rounded text-blue-700">{Math.round(pendingLocation.coords.accuracy)}m</span>
                  </p>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setPendingLocation(null)}
                      disabled={isCapturingGPS}
                      className="flex-1 py-2 rounded-lg font-bold text-sm bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={confirmAndSaveLocation}
                      disabled={isCapturingGPS}
                      className="flex-1 py-2 rounded-lg font-bold text-sm bg-blue-600 text-white shadow-md shadow-blue-500/30 hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                    >
                      {isCapturingGPS ? <Loader2 size={16} className="animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={handleCaptureGPS}
                  disabled={isCapturingGPS}
                  className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm ${
                    hasLocation 
                      ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' 
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-blue-500/30'
                  } ${isCapturingGPS ? 'opacity-70 cursor-not-allowed' : 'active:scale-[0.98]'}`}
                >
                  {isCapturingGPS ? <Loader2 size={18} className="animate-spin" /> : hasLocation ? 'Update Location' : 'Capture Location'}
                </button>
              )}
              
              {gpsError && <p className="text-xs text-red-500 mt-3 font-medium bg-red-50 p-2 rounded-lg border border-red-100">{gpsError}</p>}
            </div>

            {/* Photos Card */}
            <div className={`glass-card rounded-2xl p-5 border-l-4 transition-all ${hasPhotos ? 'border-l-emerald-400' : 'border-l-amber-400'}`}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${hasPhotos ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                    <Camera size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">Consumer Photos</h4>
                    <p className="text-xs text-slate-500 font-medium">{hasPhotos ? `${photos.length} uploaded` : 'None uploaded'}</p>
                  </div>
                </div>
              </div>

              <label 
                className={`cursor-pointer w-full py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm mb-4 ${isCompressing ? 'bg-blue-400 text-white cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-blue-500/30 active:scale-[0.98]'}`}
              >
                {isCompressing ? <Loader2 size={18} className="animate-spin" /> : <><Plus size={18} /> Add Photo</>}
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment"
                  className="hidden" 
                  onChange={handlePhotoCapture} 
                  disabled={isCompressing}
                />
              </label>

              {/* Photo Mini-Gallery */}
              {hasPhotos && (
                <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                  {photos.map((photo) => (
                    <div key={photo.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200/50 shrink-0 group">
                      <img 
                        src={photo.photo_data_url || photo.photo_url} 
                        alt="Consumer Upload" 
                        className="w-full h-full object-cover cursor-pointer hover:scale-110 transition-transform duration-300" 
                        onClick={() => setSelectedPhoto(photo.photo_data_url || photo.photo_url || null)}
                      />
                      <button 
                        onClick={(e) => { e.stopPropagation(); if(photo.id) handleDeletePhoto(photo.id); }}
                        className="absolute top-0 right-0 p-1 bg-red-500/90 hover:bg-red-600 text-white rounded-bl-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                        title="Delete photo"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Map Preview (Full Width) */}
          {hasLocation && location && !pendingLocation && (
            <div className="glass-card rounded-2xl p-2 overflow-hidden h-40 relative z-0 mt-4 border border-slate-200/50">
              <div className="rounded-xl overflow-hidden h-full">
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
            </div>
          )}
        </section>

        {/* Timeline Notes Section */}
        <section className="glass-card rounded-3xl p-6 relative">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FileText size={20} className="text-blue-500" /> Delivery Notes
            </h3>
            {!isAddingNote && (
              <button 
                onClick={() => setIsAddingNote(true)}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors shadow-sm"
              >
                <Plus size={16} />
              </button>
            )}
          </div>

          {isAddingNote && (
            <div className="mb-6 bg-slate-50/50 p-4 rounded-2xl border border-blue-200 shadow-inner animate-in fade-in slide-in-from-top-2">
              <textarea
                autoFocus
                placeholder="e.g., Blue gate, call before delivery..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none min-h-[80px] font-medium"
                maxLength={500}
              />
              <div className="flex justify-end gap-2 mt-3">
                <button 
                  onClick={() => {
                    setIsAddingNote(false);
                    setNewNote('');
                  }}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  className="px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-md transition-colors"
                >
                  Save Note
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {notes && notes.length > 0 ? (
              <div className="relative border-l-2 border-slate-100 ml-3 pl-5 space-y-6 pb-2">
                {notes.map((note) => (
                  <div key={note.id} className="relative group">
                    {/* Timeline dot */}
                    <div className="absolute -left-[27px] top-1.5 w-3 h-3 bg-white border-2 border-amber-400 rounded-full shadow-sm"></div>
                    
                    <div className="bg-white border border-slate-100 p-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow relative">
                      <p className="text-sm text-slate-700 leading-relaxed font-medium">{note.note}</p>
                      <div className="flex items-center justify-between mt-3">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          {new Date(note.created_at).toLocaleDateString()}
                        </p>
                        <button 
                          onClick={() => note.id && handleDeleteNote(note.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          title="Delete Note"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !isAddingNote ? (
              <div className="text-center py-8 px-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <FileText size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm font-medium">No notes available.</p>
                <p className="text-slate-400 text-xs mt-1">Add helpful delivery information here.</p>
              </div>
            ) : null}
          </div>
        </section>

        {/* Fixed Bottom Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-xl border-t border-slate-200/50 z-30 shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.1)]">
          <div className="max-w-4xl mx-auto flex gap-3">
            <button 
              onClick={handleNavigate}
              disabled={!hasLocation}
              className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.98] shadow-lg ${
                hasLocation 
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-emerald-500/30' 
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
              }`}
            >
              <Navigation size={20} className={hasLocation ? 'animate-pulse' : ''} />
              {hasLocation ? 'Navigate to House' : 'Location Required'}
            </button>
            <a 
              href={`tel:${consumer.mobile}`}
              className="flex items-center justify-center aspect-square h-[56px] w-[56px] bg-blue-100 text-blue-600 hover:bg-blue-200 rounded-2xl transition-colors shadow-sm active:scale-95"
              title="Call Consumer"
            >
              <Phone size={24} />
            </a>
          </div>
        </div>
      </main>

      {/* Enhanced Photo Preview Modal (Lightbox) */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/95 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setSelectedPhoto(null)}>
          <button 
            className="absolute top-6 right-6 p-3 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors z-10 active:scale-95"
            onClick={(e) => { e.stopPropagation(); setSelectedPhoto(null); }}
          >
            <X size={24} />
          </button>
          <div className="w-full h-full p-4 sm:p-10 flex items-center justify-center">
            <img 
              src={selectedPhoto} 
              alt="Consumer Document/House" 
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl animate-in zoom-in-95 duration-300" 
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};
