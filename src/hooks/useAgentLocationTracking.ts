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

      watchId = navigator.geolocation.watchPosition(
        async (position) => {
          const now = Date.now();
          // Throttle updates to every 15 seconds
          if (now - lastUpdateTime < 15000) return;
          
          lastUpdateTime = now;
          const { latitude, longitude } = position.coords;

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
            } else {
              console.log('Successfully updated agent location in DB:', latitude, longitude);
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
