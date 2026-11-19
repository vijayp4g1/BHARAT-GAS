import type { SyntheticEvent } from 'react';

/**
 * Old consumer photos live in the previous Supabase project's Storage bucket.
 * Until those files are copied (the old project is temporarily restricted),
 * show a neutral placeholder instead of a broken-image icon.
 */
export const PHOTO_FALLBACK_DATA_URL =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">' +
      '<rect width="100%" height="100%" fill="#e2e8f0"/>' +
      '<text x="50%" y="50%" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#64748b" text-anchor="middle" dominant-baseline="middle">Photo unavailable until sync</text>' +
      '</svg>'
  );

export function handlePhotoError(event: SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget;
  if (img.dataset.fallbackApplied === 'true') return;
  img.dataset.fallbackApplied = 'true';
  img.src = PHOTO_FALLBACK_DATA_URL;
}
