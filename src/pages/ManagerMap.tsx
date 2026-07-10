import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet.heat';
import { ArrowLeft, Loader2, MapPin, Layers, Flame } from 'lucide-react';

// Fix for default marker icons in React-Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Heatmap Component for React-Leaflet
const HeatmapLayer = ({ points }: { points: any[] }) => {
  const map = useMap();
  
  useEffect(() => {
    if (!map || points.length === 0) return;
    
    // @ts-ignore - leaflet.heat adds heatLayer to L
    const heat = L.heatLayer(points.map(p => [p.latitude, p.longitude, 1]), {
      radius: 25,
      blur: 15,
      maxZoom: 17,
      gradient: {0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red'}
    }).addTo(map);
    
    return () => {
      map.removeLayer(heat);
    };
  }, [map, points]);
  
  return null;
};

const SpatialFetcher = ({ setLocations, setIsFetching }: { setLocations: any, setIsFetching: any }) => {
  const map = useMapEvents({
    moveend: () => fetchLocationsInBounds(),
    zoomend: () => fetchLocationsInBounds(),
  });

  const fetchLocationsInBounds = async () => {
    const bounds = map.getBounds();
    
    try {
      setIsFetching(true);
      const { data, error } = await supabase.rpc('get_consumers_in_bounds', {
        min_lat: bounds.getSouth(),
        min_lng: bounds.getWest(),
        max_lat: bounds.getNorth(),
        max_lng: bounds.getEast()
      });
        
      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching map locations within bounds:', error);
    } finally {
      setIsFetching(false);
    }
  };

  // Initial fetch on mount
  useEffect(() => {
    fetchLocationsInBounds();
  }, []);

  return null;
};

export const ManagerMap = () => {
  const [locations, setLocations] = useState<any[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [viewMode, setViewMode] = useState<'cluster' | 'heatmap'>('cluster');

  // Default center (India roughly)
  const center: [number, number] = [20.5937, 78.9629];
  const zoom = 5;

  return (
    <div className="min-h-screen bg-premium-gradient flex flex-col relative">
      <header className="glass-header text-white p-5 sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/manager/dashboard" className="p-2 hover:bg-white/10 rounded-full transition-colors backdrop-blur-sm border border-white/10 bg-white/5">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-bold tracking-tight">Live Coverage Map</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="bg-white/10 p-1 rounded-xl backdrop-blur-md flex items-center border border-white/20">
            <button 
              onClick={() => setViewMode('cluster')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${viewMode === 'cluster' ? 'bg-white text-blue-900 shadow-sm' : 'text-white/80 hover:text-white'}`}
            >
              <Layers size={16} /> Clusters
            </button>
            <button 
              onClick={() => setViewMode('heatmap')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${viewMode === 'heatmap' ? 'bg-white text-orange-600 shadow-sm' : 'text-white/80 hover:text-white'}`}
            >
              <Flame size={16} /> Heatmap
            </button>
          </div>
          
          {isFetching && (
            <div className="hidden md:flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full border border-white/20 backdrop-blur-md">
              <Loader2 size={14} className="animate-spin text-white" />
              <span className="text-xs font-semibold text-white/90 uppercase tracking-wider">Syncing</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 relative z-0">
        <MapContainer 
          center={center} 
          zoom={zoom} 
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%', minHeight: 'calc(100vh - 73px)' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <SpatialFetcher setLocations={setLocations} setIsFetching={setIsFetching} />
          
          {viewMode === 'heatmap' ? (
            <HeatmapLayer points={locations} />
          ) : (
            <MarkerClusterGroup 
              chunkedLoading 
              maxClusterRadius={40}
              spiderfyOnMaxZoom={true}
            >
              {locations.map(loc => (
                <Marker key={loc.consumer_id} position={[loc.latitude, loc.longitude]}>
                  <Popup className="premium-popup">
                    <div className="p-1">
                      <h3 className="font-bold text-slate-800 text-sm mb-1">{loc.consumer_name}</h3>
                      <p className="text-xs font-semibold text-blue-600 mb-2">#{loc.consumer_number}</p>
                      <a 
                        href={`https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}`}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md border border-emerald-100 hover:bg-emerald-100 transition-colors"
                      >
                        <MapPin size={12} />
                        Open in Maps
                      </a>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          )}
        </MapContainer>
        
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-white/90 backdrop-blur-md border border-white/50 shadow-lg px-4 py-2 rounded-full flex items-center gap-2 pointer-events-auto">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-sm font-bold text-slate-700">Showing {locations.length} consumers in view</span>
          </div>
        </div>
      </main>
    </div>
  );
};
