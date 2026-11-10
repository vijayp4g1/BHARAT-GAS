import { supabase } from './supabase';

/**
 * Shared realtime broadcast topic for staff permission / delivery-boy
 * assignment changes.
 *
 * Realtime `send()` only works on a channel that has finished joining. The
 * permission code used to create a channel and immediately call `send()`
 * (dropped), and the listener used a different topic name, so manager changes
 * never reached the delivery-boy device. One joined channel + one topic fixes
 * both sides.
 */
export const PERMISSIONS_TOPIC = 'bgcls_staff_permissions_channel';

let permissionsChannel: ReturnType<typeof supabase.channel> | null = null;
let permissionsJoined = false;

function getPermissionsChannel() {
  if (!permissionsChannel) {
    permissionsChannel = supabase.channel(PERMISSIONS_TOPIC, {
      config: { broadcast: { self: false } },
    });
    permissionsChannel.subscribe((status: string) => {
      permissionsJoined = status === 'SUBSCRIBED';
    });
  }
  return permissionsChannel;
}

export async function broadcastPermissionsEvent(
  event: 'staff_permission_changed' | 'delivery_boy_assignment_changed',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const channel = getPermissionsChannel();
    if (!permissionsJoined) {
      for (let i = 0; i < 10 && !permissionsJoined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    await channel.send({ type: 'broadcast', event, payload });
  } catch (err) {
    // Realtime is an optimisation; the database write is the source of truth.
    console.warn('Permission realtime broadcast skipped:', err);
  }
}
