import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useLiveLocation } from '../hooks/useLiveLocation';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Loader2, Navigation, MapPin, Search, Camera, CheckCircle2, Map as MapIcon, List, Sparkles, Phone, PhoneCall } from 'lucide-react';
import db from '../lib/db';
import { AgentBottomNav } from '../components/AgentBottomNav';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { optimizeRouteWithGemini } from '../lib/gemini';

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
  const [isAiRouting, setIsAiRouting] = useState(false);
  const [aiOverview, setAiOverview] = useState<string | null>(null);
  const [aiAdviceMap, setAiAdviceMap] = useState<Map<string, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [cylinderFilter, setCylinderFilter] = useState<'ALL' | '10KG_LITE' | '14.2KG_STD'>('ALL');

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
      let items: any[] = [];
      const { data: primaryData, error: primaryError } = await supabase
        .from('dispatch_items')
        .select(`
          *,
          consumers (
            id,
            consumer_name,
            consumer_number,
            address,
            mobile,
            cylinder_type,
            consumer_locations ( latitude, longitude )
          )
        `)
        .in('dispatch_id', dispatchIds)
        .eq('status', 'PENDING');

      if (primaryError) {
        console.warn('Primary query failed, running fallback query:', primaryError);
        const { data: fallbackData, error: fallbackError } = await supabase
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
          
        if (fallbackError) throw fallbackError;
        items = fallbackData || [];
      } else {
        items = primaryData || [];
      }
      
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

          const cylinderType = localConsumer?.cylinder_type || item.consumers?.cylinder_type || '14.2KG_STD';

          return {
            ...item,
            hasLocation,
            isCompleted,
            cylinderType,
            is10kgLite: cylinderType === '10KG_LITE',
            latitude: loc?.latitude,
            longitude: loc?.longitude,
            distance
          };
        })
        .filter((item: any) => !item.isCompleted); // Hide completed ones

      // Smart Routing: Sort 10kg Composite Priority items first, then TSP Nearest Neighbor Algorithm
      const priority10kgItems = processedItems.filter((i: any) => i.is10kgLite);
      const standardItems = processedItems.filter((i: any) => !i.is10kgLite);

      const sortWithTsp = (itemsToRoute: any[]) => {
        const itemsWithLoc = itemsToRoute.filter((i: any) => i.hasLocation && i.latitude && i.longitude);
        const itemsWithoutLoc = itemsToRoute.filter((i: any) => !(i.hasLocation && i.latitude && i.longitude));
        const routeResult = [];

        let currentLat = location?.latitude;
        let currentLng = location?.longitude;

        if (currentLat && currentLng && itemsWithLoc.length > 0) {
          let unvisited = [...itemsWithLoc];
          while (unvisited.length > 0) {
            let nearestIdx = 0;
            let minDistance = Infinity;

            for (let i = 0; i < unvisited.length; i++) {
              const dist = getDistance(currentLat!, currentLng!, unvisited[i].latitude, unvisited[i].longitude);
              if (dist < minDistance) {
                minDistance = dist;
                nearestIdx = i;
              }
            }

            const nextStop = unvisited.splice(nearestIdx, 1)[0];
            if (location) {
               nextStop.distance = getDistance(location.latitude, location.longitude, nextStop.latitude, nextStop.longitude);
            }
            routeResult.push(nextStop);
            currentLat = nextStop.latitude;
            currentLng = nextStop.longitude;
          }
        } else {
          routeResult.push(...itemsWithLoc);
        }
        return [...routeResult, ...itemsWithoutLoc];
      };

      const finalRoute = [...sortWithTsp(priority10kgItems), ...sortWithTsp(standardItems)];

      setRouteItems(finalRoute);
    } catch (error) {
      console.error('Error fetching route:', error);
      toast.error('Failed to load route');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigateFullRoute = () => {
    if (!location) return;

    const stops = routeItems.filter(i => i.hasLocation && i.latitude && i.longitude);
    if (stops.length === 0) return;

    // Google Maps dir URL limits waypoints, usually 9 is safe
    const maxStops = 10;
    const routeStops = stops.slice(0, maxStops);

    const origin = `${location.latitude},${location.longitude}`;
    const destination = `${routeStops[routeStops.length - 1].latitude},${routeStops[routeStops.length - 1].longitude}`;
    
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    
    if (routeStops.length > 1) {
      const waypoints = routeStops.slice(0, -1).map(s => `${s.latitude},${s.longitude}`).join('|');
      url += `&waypoints=${waypoints}`;
    }

    window.open(url, '_blank');
  };

  const handleGeminiAiRoute = async () => {
    if (routeItems.length === 0) return;

    setIsAiRouting(true);
    toast.loading('Gemini AI is analyzing traffic & delivery order...', { id: 'ai-route' });

    try {
      const agentPos = location ? { latitude: location.latitude, longitude: location.longitude } : null;

      const aiRes = await optimizeRouteWithGemini(
        agentPos,
        routeItems.map(item => ({
          id: item.id,
          consumer_id: item.consumer_id,
          consumer_name: item.consumers.consumer_name,
          address: item.consumers.address,
          cylinder_type: item.cylinderType,
          latitude: item.latitude,
          longitude: item.longitude
        }))
      );

      if (aiRes.error) {
        toast.error(`AI Routing Error: ${aiRes.error}`, { id: 'ai-route' });
        return;
      }

      // Reorder routeItems based on Gemini AI output
      const orderMap = new Map(aiRes.optimizedOrder.map((cId, idx) => [cId, idx]));
      const sortedRoute = [...routeItems].sort((a, b) => {
        const orderA = orderMap.get(a.consumer_id) ?? 999;
        const orderB = orderMap.get(b.consumer_id) ?? 999;
        return orderA - orderB;
      });

      // Build advice map
      const adviceMap = new Map<string, string>();
      aiRes.stopAdvice.forEach(sa => {
        adviceMap.set(sa.consumerId, sa.aiAdvice);
      });

      setRouteItems(sortedRoute);
      setAiAdviceMap(adviceMap);
      setAiOverview(aiRes.aiOverview);

      toast.success('Route optimized with Gemini AI!', { id: 'ai-route', duration: 4000 });
    } catch (err) {
      console.error('AI Smart Route failed:', err);
      toast.error('AI Route optimization failed.', { id: 'ai-route' });
    } finally {
      setIsAiRouting(false);
    }
  };

  const center = location ? [location.latitude, location.longitude] as [number, number] : [17.3850, 78.4867] as [number, number];

  const filteredRouteItems = routeItems.filter(item => {
    const matchesSearch = 
      !searchQuery ||
      item.consumers?.consumer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.consumers?.consumer_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.consumers?.address?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter =
      cylinderFilter === 'ALL' ||
      (cylinderFilter === '10KG_LITE' && item.is10kgLite) ||
      (cylinderFilter === '14.2KG_STD' && !item.is10kgLite);

    return matchesSearch && matchesFilter;
  });

  const polylinePoints: [number, number][] = [];
  if (location) {
    polylinePoints.push([location.latitude, location.longitude]);
  }
  filteredRouteItems.forEach(item => {
    if (item.hasLocation && item.latitude && item.longitude) {
      polylinePoints.push([item.latitude, item.longitude]);
    }
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20">
      <header className="glass-header text-white p-4 sticky top-0 z-20 shadow-md flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Today's Route</h1>
          <p className="text-xs text-blue-200">{filteredRouteItems.length} active stops remaining</p>
        </div>
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
            {/* Search & Filter Bar */}
            <div className="p-3 bg-white border-b border-slate-200 z-10 relative flex flex-col gap-2">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search stop by name, number or address..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar text-xs">
                <button
                  onClick={() => setCylinderFilter('ALL')}
                  className={`px-3 py-1 rounded-lg font-bold shrink-0 transition-all ${cylinderFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  All Stops ({routeItems.length})
                </button>
                <button
                  onClick={() => setCylinderFilter('10KG_LITE')}
                  className={`px-3 py-1 rounded-lg font-bold shrink-0 transition-all flex items-center gap-1 ${cylinderFilter === '10KG_LITE' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}`}
                >
                  🔥 10kg Composite ({routeItems.filter(i => i.is10kgLite).length})
                </button>
                <button
                  onClick={() => setCylinderFilter('14.2KG_STD')}
                  className={`px-3 py-1 rounded-lg font-bold shrink-0 transition-all ${cylinderFilter === '14.2KG_STD' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                >
                  Standard 14.2kg ({routeItems.filter(i => !i.is10kgLite).length})
                </button>
              </div>
            </div>

            {/* Action Bar with Gemini AI Smart Route */}
            <div className="p-3 pb-0 z-10 relative bg-slate-50 flex flex-col sm:flex-row gap-2">
              <button 
                onClick={handleGeminiAiRoute}
                disabled={isAiRouting}
                className="flex-1 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md hover:from-purple-700 hover:to-blue-700 active:scale-95 transition-all"
              >
                {isAiRouting ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} className="text-purple-200 animate-pulse" />}
                Gemini AI Smart Route
              </button>

              {location && routeItems.filter(i => i.hasLocation && i.latitude && i.longitude).length > 0 && (
                <button 
                  onClick={handleNavigateFullRoute}
                  className="sm:w-auto px-5 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm hover:from-emerald-600 hover:to-emerald-500 active:scale-95 transition-all"
                >
                  <Navigation size={18} /> Full Route Maps
                </button>
              )}
            </div>

            {aiOverview && (
              <div className="mx-3 mt-3 p-3 bg-purple-50 rounded-xl border border-purple-200 text-purple-900 text-xs flex justify-between items-center z-10 relative">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-purple-600 shrink-0" />
                  <span><strong>AI Strategy:</strong> {aiOverview}</span>
                </div>
                <button onClick={() => setAiOverview(null)} className="text-purple-500 font-bold ml-2">Dismiss</button>
              </div>
            )}

            {viewMode === 'map' ? (
              <div className="flex-1 relative z-0 min-h-[400px]">
                <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  
                  {/* Route Polyline Path */}
                  {polylinePoints.length > 1 && (
                    <Polyline positions={polylinePoints} color="#4f46e5" weight={4} opacity={0.7} dashArray="8, 8" />
                  )}

                  {/* Agent Location Marker */}
                  {location && (
                    <Marker position={[location.latitude, location.longitude]} icon={L.divIcon({
                      className: 'custom-map-marker',
                      html: `<div class="w-5 h-5 bg-emerald-500 rounded-full border-2 border-white shadow-lg shadow-emerald-500/50 relative flex items-center justify-center"><div class="w-2 h-2 bg-white rounded-full"></div><div class="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-40"></div></div>`,
                      iconSize: [20, 20], iconAnchor: [10, 10]
                    })}>
                      <Popup>
                        <div className="p-1 font-bold text-xs text-slate-800">Your Current Location</div>
                      </Popup>
                    </Marker>
                  )}

                  {/* Delivery Stop Markers */}
                  {filteredRouteItems.filter(item => item.hasLocation && item.latitude !== undefined && item.longitude !== undefined).map((item, index) => (
                    <Marker key={item.id} position={[item.latitude, item.longitude]} icon={L.divIcon({
                      className: 'route-marker',
                      html: `<div class="w-9 h-9 rounded-full flex items-center justify-center font-black shadow-lg border-2 border-white text-xs text-white ${item.is10kgLite ? 'bg-gradient-to-br from-purple-600 to-indigo-600 ring-2 ring-purple-400' : 'bg-gradient-to-br from-indigo-500 to-blue-600 ring-2 ring-blue-300'}">${index + 1}</div>`,
                      iconSize: [36, 36], iconAnchor: [18, 36]
                    })}>
                      <Popup className="premium-popup">
                        <div className="p-1.5 space-y-1.5">
                          <div className="flex items-center gap-1">
                            <h3 className="font-bold text-slate-800 text-sm">{item.consumers.consumer_name}</h3>
                            {item.is10kgLite && (
                              <span className="text-[9px] font-black bg-purple-600 text-white px-1.5 py-0.5 rounded">
                                10kg
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-semibold text-slate-500">#{item.consumers.consumer_number}</p>
                          <p className="text-xs text-slate-600 line-clamp-2">{item.consumers.address}</p>
                          
                          <div className="pt-2 flex gap-1.5">
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`}
                              target="_blank" rel="noreferrer"
                              className="flex-1 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-bold text-center flex items-center justify-center gap-1"
                            >
                              <Navigation size={12} /> Navigate
                            </a>
                            <button onClick={() => navigate(`/agent/consumer/${item.consumer_id}`, { state: { dispatchItemId: item.id } })} className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold">
                              Profile
                            </button>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            ) : (
              <div className="p-4 space-y-3 pb-24 overflow-y-auto custom-scrollbar">
                {filteredRouteItems.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 font-bold text-sm">
                    No stops match your search or filter.
                  </div>
                ) : (
                  filteredRouteItems.map((item, index) => (
                    <div 
                      key={item.id} 
                      onClick={() => navigate(`/agent/consumer/${item.consumer_id}`, { state: { dispatchItemId: item.id } })}
                      className={`p-4 rounded-2xl shadow-sm border flex flex-col gap-3 active:scale-[0.99] transition-transform ${item.is10kgLite ? 'bg-purple-50/40 border-purple-200 ring-1 ring-purple-300/50' : 'bg-white border-slate-100'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-black text-lg shadow-md border-2 border-white ring-2 ${item.is10kgLite ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white ring-purple-200' : 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white ring-blue-100'}`}>
                          {index + 1}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-slate-800 truncate text-base">{item.consumers.consumer_name}</h3>
                            {item.is10kgLite && (
                              <span className="text-[10px] font-black bg-purple-600 text-white px-2 py-0.5 rounded-md shadow-xs shrink-0">
                                🔥 10kg Composite
                              </span>
                            )}
                          </div>
                          
                          <p className="text-xs font-bold text-slate-400 mb-1">#{item.consumers.consumer_number}</p>
                          <p className="text-xs text-slate-600 line-clamp-1 mb-1 font-medium">{item.consumers.address}</p>

                          {item.hasLocation ? (
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                              <Navigation size={12} className="text-emerald-500 shrink-0" />
                              <span>{item.distance !== Infinity ? `${item.distance.toFixed(2)} km away` : 'Location verified'}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded w-fit border border-amber-100">
                              <MapPin size={12} /> Needs Location & Photos
                            </div>
                          )}

                          {aiAdviceMap.has(item.consumer_id) && (
                            <div className="mt-2 text-xs bg-purple-100/70 text-purple-900 p-2 rounded-xl border border-purple-200 flex items-start gap-1.5 font-medium">
                              <Sparkles size={13} className="text-purple-600 shrink-0 mt-0.5" />
                              <span>{aiAdviceMap.get(item.consumer_id)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons footer */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        {item.consumers.mobile && (
                          <a
                            href={`tel:${item.consumers.mobile}`}
                            onClick={(e) => e.stopPropagation()}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                          >
                            <PhoneCall size={14} className="text-blue-600" />
                            <span>Call</span>
                          </a>
                        )}

                        <div className="flex items-center gap-2 ml-auto">
                          {item.hasLocation && (
                            <a 
                              href={`https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`}
                              target="_blank" rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1.5 text-xs font-bold border border-emerald-200 shadow-xs"
                            >
                              <Navigation size={14} />
                              <span>Navigate</span>
                            </a>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/agent/consumer/${item.consumer_id}`, { state: { dispatchItemId: item.id } });
                            }}
                            className="px-4 py-1.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-xs font-bold shadow-xs flex items-center gap-1"
                          >
                            Deliver Now
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </main>

      <AgentBottomNav />
    </div>
  );
};
