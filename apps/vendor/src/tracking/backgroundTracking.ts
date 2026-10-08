// Phase 3 background tracking contract (mock; native wiring in bare workflow).
// Production: use `react-native-background-geolocation` (Transistorsoft) with:
//   - heartbeat every 30-60s (desiredAccuracy medium, distanceFilter 25m, stopOnTerminate false)
//   - start on job accept, stop on complete/cancel (privacy boundary PRD §5.1)
//   - POST each fix to /api/v1/tracking/ping {booking_id, lat, lng, accuracy}
// This stub sends one mock ping (screen-locked behavior verified natively in Phase 5).
export async function sendHeartbeat(apiBase: string, token: string, bookingId: string, lat: number, lng: number) {
  const r: any = await fetch(`${apiBase}/api/v1/tracking/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ booking_id: bookingId, lat, lng, accuracy: 10 }),
  }).then((x) => x.json());
  return r;
}
export const TRACKING_WINDOW = 'accepted|en_route|arrived|loading|adjustment_pending';
export const HEARTBEAT_MIN_SEC = 30;
export const HEARTBEAT_MAX_SEC = 60;
