import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet.heat';
import { ArrowLeft, Loader2, MapPin, Layers, Flame, Navigation, Truck } from 'lucide-react';
import { ManagerBottomNav } from '../components/ManagerBottomNav';

// Fix for default marker icons in React-Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
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
  const [viewMode, setViewMode] = useState<'markers' | 'heatmap'>('markers');
  
  const [showAgents, setShowAgents] = useState(false);
  const [agentLocations, setAgentLocations] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!showAgents) return;

    const fetchAgents = async () => {
      const { data, error } = await supabase
        .from('agent_locations')
        .select('*, agents(name)');
      
      if (error) {
        console.error('Error fetching agent locations:', error);
      }
      
      if (data) {
        const locationsMap = data.reduce((acc: any, curr: any) => {
          acc[curr.agent_id] = curr;
          return acc;
        }, {});
        setAgentLocations(locationsMap);
      }
    };

    fetchAgents();

    const channel = supabase
      .channel('agent_tracking')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_locations' }, async (payload) => {
        const newLocation = payload.new as any;
        const { data, error } = await supabase.from('agents').select('name').eq('id', newLocation.agent_id).single();
        if (error) {
           console.error('Error fetching agent name on realtime update:', error);
        }
        if (data) {
           newLocation.agents = { name: data.name };
        }
        setAgentLocations(prev => ({
          ...prev,
          [newLocation.agent_id]: newLocation
        }));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [showAgents]);

  // Default center (Hyderabad roughly)
  const center: [number, number] = [17.3850, 78.4867];
  const zoom = 11;

  return (
    <div className="h-[100dvh] flex flex-col relative overflow-hidden bg-premium-gradient">
      <header className="glass-header text-white p-3 sm:p-5 sticky top-0 z-20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <Link to="/manager/dashboard" className="p-2 hover:bg-white/10 rounded-full transition-colors backdrop-blur-sm border border-white/10 bg-white/5">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight hidden sm:block">Live Coverage Map</h1>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
          <div className="bg-white/10 p-1 rounded-xl backdrop-blur-md flex items-center border border-white/20 shrink-0">
            <button 
              onClick={() => setViewMode('markers')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${viewMode === 'markers' ? 'bg-white text-blue-900 shadow-sm' : 'text-white/80 hover:text-white'}`}
            >
              <MapPin size={16} /> <span className="hidden sm:inline">Markers</span>
            </button>
            <button 
              onClick={() => setViewMode('heatmap')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${viewMode === 'heatmap' ? 'bg-white text-orange-600 shadow-sm' : 'text-white/80 hover:text-white'}`}
            >
              <Flame size={16} /> <span className="hidden sm:inline">Heatmap</span>
            </button>
            <div className="w-px h-6 bg-white/20 mx-1"></div>
            <button 
              onClick={() => setShowAgents(!showAgents)}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${showAgents ? 'bg-indigo-600 text-white shadow-sm' : 'text-white/80 hover:text-white'}`}
            >
              <Truck size={16} /> <span className="hidden sm:inline">Agents</span>
            </button>
          </div>
          
          {isFetching && (
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full border border-white/20 backdrop-blur-md shrink-0">
              <Loader2 size={14} className="animate-spin text-white" />
              <span className="hidden sm:inline text-xs font-semibold text-white/90 uppercase tracking-wider">Syncing</span>
            </div>
          )}
        </div>
      </header>
      
      <ManagerBottomNav />

      <main className="flex-1 relative z-0">
        <MapContainer 
          center={center} 
          zoom={zoom} 
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <SpatialFetcher setLocations={setLocations} setIsFetching={setIsFetching} />
          
          {viewMode === 'heatmap' ? (
            <HeatmapLayer points={locations} />
          ) : (
            <>
              {locations.map(loc => {
                const customIcon = L.divIcon({
                  className: 'custom-map-marker',
                  html: `
                    <div class="marker-pin"></div>
                    <div class="marker-pulse"></div>
                  `,
                  iconSize: [32, 32],
                  iconAnchor: [16, 32],
                  popupAnchor: [0, -32]
                });

                return (
                  <Marker key={loc.consumer_id} position={[loc.latitude, loc.longitude]} icon={customIcon}>
                    <Popup className="premium-popup">
                      <div className="flex flex-col gap-2 p-1 min-w-[160px]">
                        <div className="flex items-center gap-3 border-b border-slate-100 pb-2">
                          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg shrink-0">
                            {loc.consumer_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-800 text-sm leading-tight">{loc.consumer_name}</h3>
                            <p className="text-xs font-semibold text-slate-500">#{loc.consumer_number}</p>
                          </div>
                        </div>
                        <a 
                          href={`https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}`}
                          target="_blank" rel="noreferrer"
                          className="mt-1 flex items-center justify-center gap-1.5 w-full bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold px-3 py-2 rounded-xl shadow-md hover:from-emerald-600 hover:to-emerald-500 transition-all active:scale-95 text-xs"
                        >
                          <MapPin size={14} />
                          Navigate
                        </a>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </>
          )}

          {/* Render Agents */}
          {showAgents && Object.values(agentLocations).filter((agent: any) => {
            const ACTIVE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
            return Date.now() - new Date(agent.updated_at).getTime() < ACTIVE_THRESHOLD_MS;
          }).map((agent: any) => {
            const agentIcon = L.divIcon({
              className: 'custom-agent-marker',
              html: `
                <div style="background-color: #4f46e5; width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5"/><path d="M14 17h1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
                </div>
                <div class="marker-pulse" style="background-color: #4f46e5; opacity: 0.3;"></div>
              `,
              iconSize: [32, 32],
              iconAnchor: [16, 16],
              popupAnchor: [0, -16]
            });

            return (
              <Marker key={agent.agent_id} position={[agent.latitude, agent.longitude]} icon={agentIcon}>
                <Popup className="premium-popup">
                  <div className="flex flex-col gap-2 p-1 min-w-[140px]">
                    <div className="flex items-center gap-3 border-b border-slate-100 pb-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">
                        {agent.agents?.name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm leading-tight">{agent.agents?.name}</h3>
                        <p className="text-xs font-semibold text-indigo-600">Active Now</p>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
        
        <div className="absolute bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none w-max max-w-[90vw]">
          <div className="bg-white/90 backdrop-blur-md border border-white/50 shadow-lg px-3 sm:px-4 py-2 rounded-full flex items-center gap-2 pointer-events-auto">
            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
            <span className="text-xs sm:text-sm font-bold text-slate-700 truncate">Showing {locations.length} consumers {showAgents ? `and ${Object.values(agentLocations).filter((agent: any) => Date.now() - new Date(agent.updated_at).getTime() < 15 * 60 * 1000).length} agents` : ''}</span>
          </div>
        </div>
      </main>
    </div>
  );
};
