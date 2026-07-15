import db from './db';
import { supabase } from './supabase';

export async function syncOfflineData() {
  if (!navigator.onLine) {
    console.log('Offline: Sync skipped');
    return;
  }

  console.log('Online: Starting background sync...');

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('No authenticated user. Sync skipped.');
      return;
    }

    // 0. Sync Consumers
    const unsyncedConsumers = await db.consumers.filter(c => c.synced === false).toArray();
    for (const consumer of unsyncedConsumers) {
      if (consumer.isDeleted) {
        // Delete from Supabase
        const { error } = await supabase.from('consumers').delete().eq('id', consumer.id);
        if (!error) {
          console.log(`Synced deletion of consumer ${consumer.id}`);
          // Remove completely from local DB
          await db.consumers.delete(consumer.id);
        } else {
          console.error('Failed to sync consumer deletion:', error);
        }
      } else {
        // Upsert to Supabase (handles both Create and Edit) using RPC for conflict resolution
        const { data, error } = await supabase
          .rpc('sync_consumer', {
            p_id: consumer.id,
            p_consumer_number: consumer.consumer_number,
            p_consumer_name: consumer.consumer_name,
            p_mobile: consumer.mobile,
            p_address: consumer.address,
            p_verification_status: consumer.verification_status || 'Not Collected',
            p_assigned_agent_id: user.id || null,
            p_area_code: consumer.area_code || null,
            p_created_at: consumer.created_at || new Date().toISOString(),
            p_updated_at: consumer.updated_at || new Date().toISOString()
          });

        if (!error && data === true) {
          console.log(`Synced consumer ${consumer.consumer_number}`);
          await db.consumers.update(consumer.id, { synced: true });
        } else if (!error && data === false) {
           console.warn(`Sync conflict for consumer ${consumer.consumer_number}, server has newer data`);
           // Fetch latest data and update local DB to resolve conflict
           const { data: latestData } = await supabase.from('consumers').select('*').eq('id', consumer.id).single();
           if (latestData) {
             await db.consumers.put({ ...latestData, synced: true });
             console.log(`Reverted local changes for consumer ${consumer.consumer_number} due to conflict.`);
           }
        } else {
          console.error('Failed to sync consumer:', error);
        }
      }
    }

    // 1. Sync Locations
    const unsyncedLocations = await db.consumer_locations.filter(loc => loc.synced === false).toArray();
    for (const loc of unsyncedLocations) {
      if (loc.id) {
        if (loc.isDeleted) {
          let query = supabase.from('consumer_locations').delete().eq('consumer_id', loc.consumer_id);
          if (typeof loc.id === 'string') {
            query = query.eq('id', loc.id);
          } else {
            query = query.eq('uploaded_at', loc.uploaded_at);
          }
          const { error } = await query;
          if (!error) {
            console.log(`Synced deletion of location for consumer ${loc.consumer_id}`);
            await db.consumer_locations.delete(loc.id);
          } else {
            console.error('Failed to sync location deletion:', error);
          }
        } else {
          const { error } = await supabase
            .from('consumer_locations')
            .insert({
              consumer_id: loc.consumer_id,
              latitude: loc.latitude,
              longitude: loc.longitude,
              accuracy: loc.accuracy,
              uploaded_by: user.id, // Use real agent UUID
              uploaded_at: loc.uploaded_at
            });

          if (!error) {
            console.log(`Synced location for consumer ${loc.consumer_id}`);
            await db.consumer_locations.update(loc.id, { synced: true });
          } else {
            console.error('Failed to sync location:', error);
          }
        }
      }
    }

    // 2. Sync Photos
    const unsyncedPhotos = await db.consumer_photos.filter(photo => photo.synced === false).toArray();
    for (const photo of unsyncedPhotos) {
      if (photo.id) {
        if (photo.isDeleted) {
          // Extract filename from photo_url to delete from storage bucket
          // Expected URL format: .../storage/v1/object/public/consumer-photos/CONSUMER_ID/TIMESTAMP-TYPE.jpg
          try {
            if (photo.photo_url) {
              const urlParts = photo.photo_url.split('/consumer-photos/');
              if (urlParts.length > 1) {
                const fileName = urlParts[1];
                await supabase.storage.from('consumer-photos').remove([fileName]);
              }
            }
          } catch (e) {
            console.error('Failed to delete photo from storage:', e);
          }

          let query = supabase.from('consumer_photos').delete().eq('consumer_id', photo.consumer_id);
          if (typeof photo.id === 'string') {
            query = query.eq('id', photo.id);
          } else {
            query = query.eq('uploaded_at', photo.uploaded_at);
          }
          const { error } = await query;
          if (!error) {
            console.log(`Synced deletion of photo for consumer ${photo.consumer_id}`);
            await db.consumer_photos.delete(photo.id);
          } else {
            console.error('Failed to sync photo deletion:', error);
          }
        } else {
          // Convert base64 back to Blob for storage upload
          const response = await fetch(photo.photo_data_url);
          const blob = await response.blob();
          
          const fileName = `${photo.consumer_id}/${Date.now()}-${photo.photo_type}.jpg`;

          // Upload to Storage
          const { error: storageError } = await supabase.storage
            .from('consumer-photos')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              upsert: true
            });

          if (storageError) {
            console.error('Failed to upload photo to storage:', storageError);
            continue;
          }
          
          // Get public URL
          const { data: { publicUrl } } = supabase.storage.from('consumer-photos').getPublicUrl(fileName);

          // Insert DB Record
          const { error: dbError } = await supabase
            .from('consumer_photos')
            .insert({
              consumer_id: photo.consumer_id,
              photo_url: publicUrl,
              photo_type: photo.photo_type,
              status: 'Pending',
              uploaded_by: user.id,
              uploaded_at: photo.uploaded_at
            });

          if (!dbError) {
            console.log(`Synced photo for consumer ${photo.consumer_id}`);
            await db.consumer_photos.update(photo.id, { synced: true });
          } else {
            console.error('Failed to sync photo record:', dbError);
          }
        }
      }
    }

    // 3. Sync Delivery Notes
    const unsyncedNotes = await db.delivery_notes.filter(note => note.synced === false).toArray();
    for (const note of unsyncedNotes) {
      if (note.id) {
        if (note.isDeleted) {
          let query = supabase.from('delivery_notes').delete().eq('consumer_id', note.consumer_id);
          if (typeof note.id === 'string') {
            query = query.eq('id', note.id);
          } else {
            query = query.eq('created_at', note.created_at);
          }
          const { error } = await query;
          if (!error) {
            console.log(`Synced deletion of note for consumer ${note.consumer_id}`);
            await db.delivery_notes.delete(note.id);
          } else {
            console.error('Failed to sync note deletion:', error);
          }
        } else {
          const { error } = await supabase
            .from('delivery_notes')
            .insert({
              consumer_id: note.consumer_id,
              note: note.note,
              uploaded_by: user.id,
              created_at: note.created_at
            });

          if (!error) {
            console.log(`Synced note for consumer ${note.consumer_id}`);
            await db.delivery_notes.update(note.id, { synced: true });
          } else {
            console.error('Failed to sync note:', error);
          }
        }
      }
    }

    if (unsyncedLocations.length > 0 || unsyncedPhotos.length > 0 || unsyncedNotes.length > 0) {
      console.log('Background sync completed successfully!');
    }
  } catch (error) {
    console.error('Error during background sync:', error);
  }
}

// Global listener setup
export function setupSyncListeners() {
  window.addEventListener('online', () => {
    syncOfflineData().catch(console.error);
  });
}
