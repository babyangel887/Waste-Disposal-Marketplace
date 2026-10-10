import React, { useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator, Image, ScrollView, Linking } from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { API_BASE, authHeaders } from '../api';
import { theme } from '../theme';

// Same booking API calls as before:
// POST /bookings/estimate, POST /bookings, POST /bookings/:id/authorize-payment.
// Live Paystack returns authorization_url -> in-app browser, then poll
// GET /bookings/:id until it leaves awaiting_payment. Mock mode has no
// authorization_url and holds immediately.
// GPS replaces hardcoded lat/lng; image picker + presign replaces hardcoded photo key.
const CATS = ['bagged', 'bulky', 'rubble', 'recyclable'];

// Poll the booking every few seconds (up to ~1 minute) until the webhook
// moves it out of awaiting_payment. Returns the final status or null.
async function waitForPayment(bookingId: string, token: string, onTick?: (n: number) => void): Promise<string | null> {
  const TRIES = 20;
  const GAP_MS = 3000;
  for (let i = 0; i < TRIES; i++) {
    await new Promise((r) => setTimeout(r, GAP_MS));
    onTick?.(i + 1);
    try {
      const d: any = await fetch(`${API_BASE}/api/v1/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((x) => x.json());
      if (d?.booking && d.booking.status !== 'awaiting_payment') return d.booking.status as string;
    } catch {
      // transient network error — keep polling
    }
  }
  return null;
}

export function BookingScreen({ token, onBooked }: { token: string; onBooked?: (bookingId: string) => void }) {
  const [cat, setCat] = useState('bagged');
  const [qty, setQty] = useState('2');
  const [lga, setLga] = useState('Ikeja');
  const [address, setAddress] = useState('');
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [localUris, setLocalUris] = useState<string[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function useGps() {
    setMsg('');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setMsg('location permission denied');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    setMsg(`gps: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
  }

  async function pickPhoto() {
    setMsg('');
    // Android 13+ uses READ_MEDIA_IMAGES (declared in app.json); expo maps
    // this call to the right permission per OS version. Check first so we
    // can tell "denied forever" (open Settings) apart from "just denied".
    try {
      const current = await ImagePicker.getMediaLibraryPermissionsAsync();
      let granted = current.granted;
      if (!granted && current.canAskAgain !== false) {
        const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
        granted = asked.granted;
      }
      if (!granted) {
        setMsg('photo permission denied — enable Photos access for this app in system Settings, then try again.');
        return;
      }
    } catch (e: any) {
      setMsg('could not check photo permission: ' + String(e?.message ?? e));
      return;
    }
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: false,
        quality: 0.7,
      });
    } catch (e: any) {
      setMsg('could not open photo library: ' + String(e?.message ?? e));
      return;
    }
    if (res.canceled || !res.assets?.[0]) {
      setMsg('No photo selected.');
      return;
    }
    const asset = res.assets[0];
    if (photoKeys.length >= 5) {
      setMsg('max 5 photos');
      return;
    }
    // Ask the API for an upload slot. Mock/dev mode returns mock:true (no
    // upload needed); real S3/R2 mode returns a presigned PUT uploadUrl.
    let pre: any;
    try {
      const r = await fetch(`${API_BASE}/api/v1/uploads/presign`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ kind: 'waste_photo', contentType: 'image/jpeg' }),
      });
      pre = await r.json();
      if (!r.ok || !pre?.key) throw new Error(pre?.error ?? `presign HTTP ${r.status}`);
    } catch (e: any) {
      setMsg('could not prepare photo upload: ' + String(e?.message ?? e));
      return;
    }
    if (pre.mock) {
      // Dev storage: nothing to upload, the key itself books the photo.
      setPhotoKeys((k) => [...k, pre.key].slice(0, 5));
      setLocalUris((u) => [...u, asset.uri].slice(0, 5));
      setMsg(`${Math.min(photoKeys.length + 1, 5)} photo(s) added (dev storage — not production)`);
      return;
    }
    if (!pre.uploadUrl || !pre.publicUrl) {
      setMsg('could not prepare photo upload: bad server response');
      return;
    }
    try {
      const blob: any = await (await fetch(asset.uri)).blob();
      const up = await fetch(pre.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!up.ok) throw new Error(`upload HTTP ${up.status}`);
      setPhotoKeys((k) => [...k, pre.publicUrl].slice(0, 5));
      setLocalUris((u) => [...u, asset.uri].slice(0, 5));
      setMsg(`${Math.min(photoKeys.length + 1, 5)} photo(s) added`);
    } catch (e: any) {
      setMsg('photo upload failed, please try again: ' + String(e?.message ?? e));
    }
  }

  async function estimate() {
    setBusy(true);
    try {
      const r: any = await fetch(`${API_BASE}/api/v1/bookings/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_slug: cat, qty: Number(qty), lga }),
      }).then((x) => x.json());
      setMsg('estimate: ' + JSON.stringify(r));
    } catch (e: any) {
      setMsg('estimate failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function bookAndPay() {
    if (!coords) {
      setMsg('tap Use GPS first');
      return;
    }
    if (photoKeys.length < 1) {
      setMsg('add at least 1 waste photo');
      return;
    }
    if (!address.trim()) {
      setMsg('pickup address required');
      return;
    }
    setBusy(true);
    try {
      const b: any = await fetch(`${API_BASE}/api/v1/bookings`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          category_slug: cat,
          qty: Number(qty),
          lga,
          pickup_lat: coords.lat,
          pickup_lng: coords.lng,
          pickup_address: address,
          photo_keys: photoKeys,
        }),
      }).then((x) => x.json());
      if (!b.booking) {
        setMsg('booking failed: ' + JSON.stringify(b));
        return;
      }
      const p: any = await fetch(`${API_BASE}/api/v1/bookings/${b.booking.id}/authorize-payment`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ provider: 'paystack' }),
      }).then((x) => x.json());
      if (!p.payment) {
        setMsg('payment init failed: ' + JSON.stringify(p));
        return;
      }
      // Live mode: open the Paystack checkout, then wait for the webhook.
      if (p.authorization_url) {
        setMsg('opening secure checkout…');
        try {
          await WebBrowser.openBrowserAsync(p.authorization_url);
        } catch {
          await Linking.openURL(p.authorization_url);
        }
        setMsg('confirming payment…');
        const status = await waitForPayment(b.booking.id, token, (n) =>
          setMsg(`confirming payment… (${n * 3}s)`)
        );
        if (status) {
          setMsg(`payment confirmed: booking ${b.booking.id} is ${status}`);
          onBooked?.(b.booking.id);
        } else {
          setMsg(`payment not confirmed yet for booking ${b.booking.id}. The webhook may still arrive — check Track driver later.`);
        }
        return;
      }
      // Mock mode: hold is immediate, no browser step.
      setMsg('booked+held: ' + JSON.stringify({ booking: b.booking.id, status: p.booking?.status, payment: p.payment?.status }));
      onBooked?.(b.booking.id);
    } catch (e: any) {
      setMsg('booking failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={theme.card}>
      <Text style={theme.title}>Book pickup</Text>
      <Text style={theme.subtitle}>Categories: {CATS.join(', ')}</Text>
      <Text style={theme.label}>Category</Text>
      <TextInput value={cat} onChangeText={setCat} placeholder="bagged" style={theme.input} />
      <Text style={theme.label}>Qty</Text>
      <TextInput value={qty} onChangeText={setQty} placeholder="2" style={theme.input} keyboardType="number-pad" />
      <Text style={theme.label}>LGA</Text>
      <TextInput value={lga} onChangeText={setLga} placeholder="Ikeja" style={theme.input} />
      <Text style={theme.label}>Pickup address</Text>
      <TextInput value={address} onChangeText={setAddress} placeholder="Street, area" style={theme.input} />
      <View style={theme.buttonRow}>
        <Button title="Use GPS" onPress={useGps} />
        <Button title="Add photo" onPress={pickPhoto} />
      </View>
      {!!coords && <Text style={theme.msg}>gps: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</Text>}
      {!!photoKeys.length && <Text style={theme.msg}>{photoKeys.length} photo(s) added</Text>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {localUris.map((u) => (
          <Image key={u} source={{ uri: u }} style={{ width: 100, height: 100, borderRadius: 8 }} />
        ))}
      </View>
      <View style={theme.buttonRow}>
        <Button title="Estimate" onPress={estimate} disabled={busy} />
        <Button title="Book + Pay" onPress={bookAndPay} disabled={busy} />
      </View>
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!!msg && <Text style={theme.msg}>{msg}</Text>}
    </ScrollView>
  );
}
