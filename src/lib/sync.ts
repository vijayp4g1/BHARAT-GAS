import db from './db';
import { supabase } from './supabase';

const LAST_PULL_KEY = 'bgcls_last_pull_timestamp';

/**
 * Downloads new/updated locations, photos, and notes from Supabase into local IndexedDB.
 * Ensures all devices/logins quickly see locations and photos added by other devices.
 */
export async function pullLatestCloudData() {
  if (!navigator.onLine) return;

  try {
    const lastPull = localStorage.getItem(LAST_PULL_KEY);
    const nowIso = new Date().toISOString();

    // 1. Fetch updated locations from Supabase
    let locQuery = supabase.from('consumer_locations').select('*');
    if (lastPull) {
      locQuery = locQuery.gte('uploaded_at', lastPull);
    }
    const { data: remoteLocations, error: locError } = await locQuery;

    if (!locError && remoteLocations && remoteLocations.length > 0) {
      const formattedLocs = remoteLocations.map((l) => ({
        id: l.id,
        consumer_id: l.consumer_id,
        latitude: l.latitude,
        longitude: l.longitude,
        accuracy: l.accuracy,
        uploaded_by: l.uploaded_by,
        uploaded_at: l.uploaded_at,
        synced: true,
      }));

      await db.consumer_locations.bulkPut(formattedLocs);

      // Update local consumer has_location status
      const consumerIdsWithLoc = Array.from(new Set(remoteLocations.map((l) => l.consumer_id)));
      for (const cId of consumerIdsWithLoc) {
        await db.consumers.update(cId, { has_location: true });
      }
    }

    // 2. Fetch updated photos from Supabase
    let photoQuery = supabase.from('consumer_photos').select('*');
    if (lastPull) {
      photoQuery = photoQuery.gte('uploaded_at', lastPull);
    }
    const { data: remotePhotos, error: photoError } = await photoQuery;

    if (!photoError && remotePhotos && remotePhotos.length > 0) {
      const formattedPhotos = remotePhotos.map((p) => ({
        id: p.id,
        consumer_id: p.consumer_id,
        photo_url: p.photo_url,
        photo_data_url: p.photo_url, // Use remote URL directly if local base64 is missing
        photo_type: p.photo_type,
        status: p.status,
        rejection_reason: p.rejection_reason,
        uploaded_by: p.uploaded_by,
        uploaded_at: p.uploaded_at,
        synced: true,
      }));

      await db.consumer_photos.bulkPut(formattedPhotos);

      // Update local consumer has_photos status
      const consumerIdsWithPhoto = Array.from(new Set(remotePhotos.map((p) => p.consumer_id)));
      for (const cId of consumerIdsWithPhoto) {
        await db.consumers.update(cId, { has_photos: true });
      }
    }

    // 3. Fetch updated delivery notes from Supabase
    let notesQuery = supabase.from('delivery_notes').select('*');
    if (lastPull) {
      notesQuery = notesQuery.gte('created_at', lastPull);
    }
    const { data: remoteNotes, error: notesError } = await notesQuery;

    if (!notesError && remoteNotes && remoteNotes.length > 0) {
      const formattedNotes = remoteNotes.map((n) => ({
        id: n.id,
        consumer_id: n.consumer_id,
        note: n.note,
        uploaded_by: n.uploaded_by,
        created_at: n.created_at,
        synced: true,
      }));

      await db.delivery_notes.bulkPut(formattedNotes);
    }

    // Update last pull timestamp
    localStorage.setItem(LAST_PULL_KEY, nowIso);
    console.log('Pulled latest cloud data into local database successfully');
  } catch (err) {
    console.error('Failed to pull cloud data:', err);
  }
}

/**
 * Uploads local offline changes to Supabase in parallel batches.
 */
export async function syncOfflineData() {
  if (!navigator.onLine) {
    console.log('Offline: Sync skipped');
    return;
  }

  console.log('Online: Starting background sync...');

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      console.log('No authenticated user. Sync skipped.');
      return;
    }

    // 0. Sync Consumers
    const unsyncedConsumers = await db.consumers.filter((c) => c.synced === false).toArray();
    for (const consumer of unsyncedConsumers) {
      if (consumer.isDeleted) {
        const { error } = await supabase.from('consumers').delete().eq('id', consumer.id);
        if (!error) {
          await db.consumers.delete(consumer.id);
        }
      } else {
        const { data, error } = await supabase.rpc('sync_consumer', {
          p_id: consumer.id,
          p_consumer_number: consumer.consumer_number,
          p_consumer_name: consumer.consumer_name,
          p_mobile: consumer.mobile,
          p_address: consumer.address,
          p_verification_status: consumer.verification_status || 'Not Collected',
          p_assigned_agent_id: user.id || null,
          p_area_code: consumer.area_code || null,
          p_created_at: consumer.created_at || new Date().toISOString(),
          p_updated_at: consumer.updated_at || new Date().toISOString(),
        });

        if (!error && data === true) {
          await db.consumers.update(consumer.id, { synced: true });
        } else if (!error && data === false) {
          const { data: latestData } = await supabase.from('consumers').select('*').eq('id', consumer.id).single();
          if (latestData) {
            await db.consumers.put({ ...latestData, synced: true });
          }
        }
      }
    }

    // 1. Parallel Batch Sync Locations
    const unsyncedLocations = await db.consumer_locations.filter((loc) => loc.synced === false).toArray();
    if (unsyncedLocations.length > 0) {
      const locPromises = unsyncedLocations.map(async (loc) => {
        if (!loc.id) return;
        if (loc.isDeleted) {
          let query = supabase.from('consumer_locations').delete().eq('consumer_id', loc.consumer_id);
          if (typeof loc.id === 'string') {
            query = query.eq('id', loc.id);
          } else {
            query = query.eq('uploaded_at', loc.uploaded_at);
          }
          const { error } = await query;
          if (!error) await db.consumer_locations.delete(loc.id);
        } else {
          const { error } = await supabase.from('consumer_locations').insert({
            consumer_id: loc.consumer_id,
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy,
            uploaded_by: user.id,
            uploaded_at: loc.uploaded_at,
          });
          if (!error) {
            await db.consumer_locations.update(loc.id, { synced: true });
          }
        }
      });
      await Promise.all(locPromises);
    }

    // 2. Parallel Chunked Sync Photos (Chunk size = 4 to avoid browser network throttle)
    const unsyncedPhotos = await db.consumer_photos.filter((photo) => photo.synced === false).toArray();
    if (unsyncedPhotos.length > 0) {
      const chunkSize = 4;
      for (let i = 0; i < unsyncedPhotos.length; i += chunkSize) {
        const chunk = unsyncedPhotos.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (photo) => {
            if (!photo.id) return;
            if (photo.isDeleted) {
              try {
                if (photo.photo_url) {
                  const urlParts = photo.photo_url.split('/consumer-photos/');
                  if (urlParts.length > 1) {
                    await supabase.storage.from('consumer-photos').remove([urlParts[1]]);
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
              if (!error) await db.consumer_photos.delete(photo.id);
            } else {
              try {
                const response = await fetch(photo.photo_data_url);
                const blob = await response.blob();
                const fileName = `${photo.consumer_id}/${Date.now()}-${photo.photo_type}.jpg`;

                const { error: storageError } = await supabase.storage.from('consumer-photos').upload(fileName, blob, {
                  contentType: 'image/jpeg',
                  upsert: true,
                });

                if (storageError) return;

                const {
                  data: { publicUrl },
                } = supabase.storage.from('consumer-photos').getPublicUrl(fileName);

                const { error: dbError } = await supabase.from('consumer_photos').insert({
                  consumer_id: photo.consumer_id,
                  photo_url: publicUrl,
                  photo_type: photo.photo_type,
                  status: 'Pending',
                  uploaded_by: user.id,
                  uploaded_at: photo.uploaded_at,
                });

                if (!dbError) {
                  await db.consumer_photos.update(photo.id, {
                    synced: true,
                    photo_url: publicUrl,
                  });
                }
              } catch (err) {
                console.error('Error uploading photo chunk:', err);
              }
            }
          })
        );
      }
    }

    // 3. Parallel Batch Sync Notes
    const unsyncedNotes = await db.delivery_notes.filter((note) => note.synced === false).toArray();
    if (unsyncedNotes.length > 0) {
      await Promise.all(
        unsyncedNotes.map(async (note) => {
          if (!note.id) return;
          if (note.isDeleted) {
            let query = supabase.from('delivery_notes').delete().eq('consumer_id', note.consumer_id);
            if (typeof note.id === 'string') {
              query = query.eq('id', note.id);
            } else {
              query = query.eq('created_at', note.created_at);
            }
            const { error } = await query;
            if (!error) await db.delivery_notes.delete(note.id);
          } else {
            const { error } = await supabase.from('delivery_notes').insert({
              consumer_id: note.consumer_id,
              note: note.note,
              uploaded_by: user.id,
              created_at: note.created_at,
            });
            if (!error) await db.delivery_notes.update(note.id, { synced: true });
          }
        })
      );
    }

    // After uploading local changes, pull latest cloud updates
    await pullLatestCloudData();
  } catch (error) {
    console.error('Error during background sync:', error);
  }
}

// Global listener setup
export function setupSyncListeners() {
  window.addEventListener('online', () => {
    syncOfflineData().catch(console.error);
    pullLatestCloudData().catch(console.error);
  });
}
