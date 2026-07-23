export interface GeolocationResult {
  position?: GeolocationPosition;
  error?: {
    code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'NOT_SUPPORTED' | 'UNKNOWN';
    rawError?: GeolocationPositionError;
    message: string;
  };
}

/**
 * Checks the current browser geolocation permission status if supported.
 */
export async function checkGeolocationPermission(): Promise<PermissionState | 'unsupported'> {
  if (!navigator.permissions || !navigator.permissions.query) {
    return 'unsupported';
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state; // 'granted' | 'prompt' | 'denied'
  } catch (err) {
    return 'unsupported';
  }
}

/**
 * Captures user geolocation with automatic fallback to standard accuracy if high accuracy times out.
 */
export function getAccurateLocation(options?: {
  timeoutMs?: number;
  maxAgeMs?: number;
}): Promise<GeolocationResult> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator) || !navigator.geolocation) {
      resolve({
        error: {
          code: 'NOT_SUPPORTED',
          message: 'Geolocation is not supported by your browser or device.',
        },
      });
      return;
    }

    const timeoutMs = options?.timeoutMs ?? 10000;
    const maxAgeMs = options?.maxAgeMs ?? 0;

    // First attempt with high accuracy
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({ position });
      },
      (firstError) => {
        // If permission denied, resolve immediately with PERMISSION_DENIED
        if (firstError.code === firstError.PERMISSION_DENIED) {
          resolve({
            error: {
              code: 'PERMISSION_DENIED',
              rawError: firstError,
              message: 'Location access denied. Please allow location permission in your browser settings.',
            },
          });
          return;
        }

        // If high accuracy timed out, retry with standard accuracy (cell/wifi)
        if (firstError.code === firstError.TIMEOUT) {
          console.warn('High accuracy GPS timed out, falling back to standard accuracy...');
          navigator.geolocation.getCurrentPosition(
            (fallbackPosition) => {
              resolve({ position: fallbackPosition });
            },
            (fallbackError) => {
              const code =
                fallbackError.code === fallbackError.PERMISSION_DENIED
                  ? 'PERMISSION_DENIED'
                  : fallbackError.code === fallbackError.TIMEOUT
                  ? 'TIMEOUT'
                  : 'POSITION_UNAVAILABLE';
              resolve({
                error: {
                  code,
                  rawError: fallbackError,
                  message:
                    code === 'PERMISSION_DENIED'
                      ? 'Location access denied by user or device settings.'
                      : code === 'TIMEOUT'
                      ? 'GPS request timed out. Please ensure you are outdoors or have cellular network access.'
                      : 'Unable to determine your current location. Please turn on device GPS.',
                },
              });
            },
            {
              enableHighAccuracy: false,
              timeout: 10000,
              maximumAge: 10000,
            }
          );
          return;
        }

        // Position unavailable or other error
        resolve({
          error: {
            code: 'POSITION_UNAVAILABLE',
            rawError: firstError,
            message: 'Unable to retrieve your location. Please ensure location/GPS is enabled on your device.',
          },
        });
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: maxAgeMs,
      }
    );
  });
}
