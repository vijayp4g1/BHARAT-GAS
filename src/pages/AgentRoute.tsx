import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useLiveLocation } from '../hooks/useLiveLocation';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Loader2, Navigation, MapPin, Search, Camera, CheckCircle2, Map as MapIcon, List } from 'lucide-react';
import db from '../lib/db';
import { AgentBottomNav } from '../components/AgentBottomNav';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

// Distance calculation
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c; // Distance in km
}

export const AgentRoute = () => {
  const navigate = useNavigate();
  const { location, error: locationError } = useLiveLocation();
  const [routeItems, setRouteItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('list');

  useEffect(() => {
    fetchRoute();
  }, []);

  const fetchRoute = async () => {
    setIsLoading(true);
    try {
      const agentId = localStorage.getItem('bgcls_agent_id');
      if (!agentId) {
        setIsLoading(false);
        return;
      }

      // Fetch today's dispatch for this agent
      const today = new Date().toISOString().split('T')[0];
      const { data: dispatches, error: dispatchError } = await supabase
        .from('daily_dispatch')
        .select('id')
        .eq('agent_id', agentId)
        .eq('dispatch_date', today);

      if (dispatchError) throw dispatchError;
      
      if (!dispatches || dispatches.length === 0) {
        setRouteItems([]);
        setIsLoading(false);
        return;
      }
      
      const dispatchIds = dispatches.map(d => d.id);

      // Fetch items with consumer details
      const { data: items, error: itemsError } = await supabase
        .from('dispatch_items')
        .select(`
          *,
          consumers (
            id,
            consumer_name,
            consumer_number,
            address,
            mobile,
            consumer_locations ( latitude, longitude )
          )
        `)
        .in('dispatch_id', dispatchIds)
        .eq('status', 'PENDING');

      if (itemsError) throw itemsError;
      
      // Merge with local Dexie state
      const localConsumers = await db.consumers.toArray();
      const localMap = new Map(localConsumers.map(c => [c.id, c]));

      // Process and sort by distance
      let processedItems = items
        .map((item: any) => {
          const localConsumer = localMap.get(item.consumer_id);
          // Prefer local status if it exists, otherwise fallback to server data
          const hasLocation = localConsumer ? localConsumer.has_location : (item.consumers.consumer_locations && item.consumers.consumer_locations.length > 0);
          const hasPhotos = localConsumer ? localConsumer.has_photos : false; // we didn't fetch photos from supabase here for brevity
          
          // If they have both, we consider it completed
          const isCompleted = item.status === 'COMPLETED';

          const loc = hasLocation ? (item.consumers.consumer_locations?.[0] || null) : null;
          let distance = Infinity;
          
          if (loc && location) {
            distance = getDistance(location.latitude, location.longitude, loc.latitude, loc.longitude);
          }

          return {
            ...item,
            hasLocation,
            isCompleted,
            latitude: loc?.latitude,
            longitude: loc?.longitude,
            distance
          };
        })
        .filter((item: any) => !item.isCompleted); // Hide completed ones

      // Sort: items with location by distance, then items without location
      processedItems.sort((a, b) => {
        if (a.hasLocation && !b.hasLocation) return -1;
        if (!a.hasLocation && b.hasLocation) return 1;
        return a.distance - b.distance;
      });

      setRouteItems(processedItems);
    } catch (error) {
      console.error('Error fetching route:', error);
      toast.error('Failed to load route');
    } finally {
      setIsLoading(false);
    }
  };

  const center = location ? [location.latitude, location.longitude] as [number, number] : [17.3850, 78.4867] as [number, number];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20">
      <header className="glass-header text-white p-4 sticky top-0 z-20 shadow-md flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Today's Route</h1>
        <div className="flex bg-white/20 p-1 rounded-xl backdrop-blur-md">
          <button 
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all ${viewMode === 'list' ? 'bg-white text-blue-900 shadow-sm' : 'text-white/80'}`}
          >
            <List size={16} /> List
          </button>
          <button 
            onClick={() => setViewMode('map')}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all ${viewMode === 'map' ? 'bg-white text-blue-900 shadow-sm' : 'text-white/80'}`}
          >
            <MapIcon size={16} /> Map
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="animate-spin text-blue-500" size={40} />
          </div>
        ) : routeItems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 mb-4 shadow-inner">
              <CheckCircle2 size={40} />
            </div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">You're All Caught Up!</h2>
            <p className="text-slate-500 max-w-xs mx-auto">You have no pending deliveries assigned for today's route.</p>
          </div>
        ) : (
          <>
            {/* Status Banner */}
            <div className="bg-blue-600 text-white p-3 text-sm font-bold flex justify-between items-center shadow-md z-10 relative">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                <span>{routeItems.length} Stops Remaining</span>
              </div>
              {locationError && <span className="text-red-200 text-xs bg-red-900/30 px-2 py-1 rounded">GPS Issue</span>}
            </div>

            {viewMode === 'map' ? (
              <div className="flex-1 relative z-0">
                <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  
                  {/* Agent Location */}
                  {location && (
                    <Marker position={[location.latitude, location.longitude]} icon={L.divIcon({
                      className: 'custom-map-marker',
                      html: `<div class="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg shadow-blue-500/50 relative"><div class="absolute inset-0 bg-blue-600 rounded-full animate-ping opacity-50"></div></div>`,
                      iconSize: [16, 16], iconAnchor: [8, 8]
                    })} />
                  )}

                  {/* Route Items */}
                  {routeItems.filter(item => item.hasLocation && item.latitude !== undefined && item.longitude !== undefined).map((item, index) => (
                    <Marker key={item.id} position={[item.latitude, item.longitude]} icon={L.divIcon({
                      className: 'route-marker',
                      html: `<div class="w-8 h-8 bg-gradient-to-br from-indigo-500 to-blue-600 text-white rounded-full flex items-center justify-center font-black shadow-md border-2 border-white text-xs">${index + 1}</div>`,
                      iconSize: [32, 32], iconAnchor: [16, 32]
                    })}>
                      <Popup className="premium-popup">
                        <div className="p-1">
                          <h3 className="font-bold text-slate-800">{item.consumers.consumer_name}</h3>
                          <p className="text-xs text-slate-500 mb-2">#{item.consumers.consumer_number}</p>
                          <button onClick={() => navigate(`/agent/consumer/${item.consumer_id}`, { state: { dispatchItemId: item.id } })} className="w-full py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold">View Profile</button>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            ) : (
              <div className="p-4 space-y-3 pb-24 overflow-y-auto custom-scrollbar">
                {routeItems.map((item, index) => (
                  <div 
                    key={item.id} 
                    onClick={() => navigate(`/agent/consumer/${item.consumer_id}`, { state: { dispatchItemId: item.id } })}
                    className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-start gap-4 active:scale-95 transition-transform"
                  >
                    <div className="w-10 h-10 shrink-0 bg-gradient-to-br from-indigo-500 to-blue-600 text-white rounded-full flex items-center justify-center font-black text-lg shadow-md border-2 border-white ring-2 ring-blue-100">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-800 truncate">{item.consumers.consumer_name}</h3>
                      <p className="text-xs font-bold text-slate-400 mb-1 truncate">#{item.consumers.consumer_number}</p>
                      
                      {item.hasLocation ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                          <Navigation size={12} className="text-emerald-500" />
                          <span>{item.distance !== Infinity ? `${item.distance.toFixed(2)} km away` : 'Location available'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded w-fit border border-amber-100">
                          <MapPin size={12} /> Needs Location & Photos
                        </div>
                      )}
                    </div>
                    
                    {item.hasLocation && (
                      <a 
                        href={`https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`}
                        target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100 shadow-sm active:bg-emerald-100"
                      >
                        <Navigation size={18} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <AgentBottomNav />
    </div>
  );
};
