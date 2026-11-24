// Foreground-only geolocation. Coordinates are compared to your saved places on-device
// and immediately discarded — no location history is stored or sent anywhere.
export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  });
}
