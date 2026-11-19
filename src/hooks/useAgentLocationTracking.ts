import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export function useAgentLocationTracking() {
  useEffect(() => {
    let watchId: number;

    const startTracking = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const agentId = session.user.id;

      // Skip the role lookup for known managers/staff. Only non-agent roles
      // need to be filtered out; an unknown role still checks the agents row.
      const cachedRole = localStorage.getItem('bgcls_user_role');
      if (cachedRole && cachedRole !== 'AGENT') return;

      // Check if user is actually an agent
      const { data: agent } = await supabase
        .from('agents')
        .select('role')
        .eq('id', agentId)
        .single();
        
      if (agent?.role !== 'AGENT') return;

      if (!('geolocation' in navigator)) {
        console.warn('Geolocation is not supported by this browser.');
        return;
      }

      let lastUpdateTime = 0;
      let lastLat: number | null = null;
      let lastLng: number | null = null;

      watchId = navigator.geolocation.watchPosition(
        async (position) => {
          const now = Date.now();
          const { latitude, longitude } = position.coords;

          // Reduce database writes: at most once a minute while moving, and a
          // 5-minute heartbeat while stationary. The old code wrote every 15s.
          const moved =
            lastLat === null ||
            Math.abs(latitude - lastLat) > 0.0005 ||
            Math.abs(longitude - lastLng!) > 0.0005;
          const minInterval = moved ? 60_000 : 5 * 60_000;
          if (lastUpdateTime > 0 && now - lastUpdateTime < minInterval) return;

          lastUpdateTime = now;
          lastLat = latitude;
          lastLng = longitude;

          try {
            const { error } = await supabase
              .from('agent_locations')
              .upsert({
                agent_id: agentId,
                latitude,
                longitude,
                updated_at: new Date().toISOString()
              }, { onConflict: 'agent_id' });
               
            if (error) {
              console.error('Failed to update agent location in DB:', error);
            }
          } catch (error) {
            console.error('Failed to update agent location:', error);
          }
        },
        (error) => {
          console.error('Error watching agent position:', error);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 5000
        }
      );
    };

    startTracking();

    return () => {
      if (watchId !== undefined) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);
}
