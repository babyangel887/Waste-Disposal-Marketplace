import React from 'react';
import { Platform, View, Text, Button } from 'react-native';
import { WebView } from 'react-native-webview';
import { theme } from '../theme';

export interface MapPin {
  lat: number;
  lng: number;
  label: string;
  color: 'driver' | 'pickup';
}

// Leaflet + OpenStreetMap tiles (no API key). One HTML string shared by the
// native WebView and the web iframe. Required OSM attribution included.
export function leafletHtml(driver: MapPin | null, pickup: MapPin): string {
  const pts = [
    ...(driver ? [{ ...driver, kind: 'driver' }] : []),
    { ...pickup, kind: 'pickup' },
  ];
  const markers = pts
    .map(
      (p) => `
      L.marker([${JSON.stringify(p.lat)}, ${JSON.stringify(p.lng)}])
        .addTo(map)
        .bindPopup(${JSON.stringify(p.label)});`
    )
    .join('\n');
  const bounds = pts.map((p) => `[${JSON.stringify(p.lat)}, ${JSON.stringify(p.lng)}]`).join(',');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{height:100%;margin:0;padding:0;}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map = L.map('map').fitBounds([${bounds}], { padding: [30, 30] });
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
${markers}
</script></body></html>`;
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// Driver + pickup pins, both kept visible via fitBounds. Native uses
// react-native-webview; web (PWA) uses an iframe since WebView is native-only.
// Anything that fails to load falls back to text + Google Maps button.
export function DriverMap({ driver, pickup, onOpenMaps, onMapError }: {
  driver: MapPin | null;
  pickup: MapPin;
  onOpenMaps: (url: string) => void;
  onMapError: () => void;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [driver?.lat, driver?.lng, pickup.lat, pickup.lng]);
  if (failed) {
    const ref = driver ?? pickup;
    return (
      <View style={theme.card}>
        <Text style={theme.msg}>Map unavailable offline.</Text>
        <Button title="Open in Google Maps" onPress={() => onOpenMaps(mapsLink(ref.lat, ref.lng))} />
      </View>
    );
  }
  if (Platform.OS === 'web') {
    return (
      <View style={{ height: 280, borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
        {/* iframe only ever renders on web (branch above); types come from react-native-web */}
        <iframe
          title="Driver map"
          srcDoc={leafletHtml(driver, pickup)}
          style={{ width: '100%', height: '100%', border: 0 }}
          sandbox="allow-scripts"
          onError={() => { onMapError(); setFailed(true); }}
        />
        <Text style={theme.msg}>© OpenStreetMap contributors</Text>
      </View>
    );
  }
  return (
    <View style={{ height: 280, borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
      <WebView
        originWhitelist={['*']}
        source={{ html: leafletHtml(driver, pickup) }}
        javaScriptEnabled
        domStorageEnabled
        onError={() => { onMapError(); setFailed(true); }}
        onHttpError={() => { onMapError(); setFailed(true); }}
      />
      <Text style={theme.msg}>© OpenStreetMap contributors</Text>
    </View>
  );
}
