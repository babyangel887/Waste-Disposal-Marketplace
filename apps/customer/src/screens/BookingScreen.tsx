import React, { useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator, Image, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { API_BASE, authHeaders } from '../api';
import { theme } from '../theme';

// Same booking API calls as before:
// POST /bookings/estimate, POST /bookings, POST /bookings/:id/authorize-payment.
// GPS replaces hardcoded lat/lng; image picker + presign replaces hardcoded photo key.
const CATS = ['bagged', 'bulky', 'rubble', 'recyclable'];

export function BookingScreen({ token, onBooked }: { token: string; onBooked?: (bookingId: string) => void }) {
  const [cat, setCat] = useState('bagged');
  const [qty, setQty] = useState('2');
  const [lga, setLga] = useState('Ikeja');
  const [address, setAddress] = useState('');
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [localUri, setLocalUri] = useState<string | null>(null);
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
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setMsg('photo permission denied');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setLocalUri(asset.uri);
    // Upload via presign so the booking uses a real key, not a demo string.
    try {
      const pre: any = await fetch(`${API_BASE}/api/v1/uploads/presign`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ kind: 'waste_photo', contentType: 'image/jpeg' }),
      }).then((x) => x.json());
      if (pre?.key && pre?.uploadUrl) {
        const blob: any = await (await fetch(asset.uri)).blob();
        await fetch(pre.uploadUrl, { method: 'PUT', body: blob });
        setPhotoKeys((k) => [...k, pre.key].slice(0, 5));
        setMsg('photo uploaded: ' + pre.key);
      } else {
        setMsg('presign failed: ' + JSON.stringify(pre).slice(0, 200));
      }
    } catch (e: any) {
      setMsg('upload failed (key kept locally): ' + String(e?.message ?? e));
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
      {!!localUri && <Image source={{ uri: localUri }} style={{ width: '100%', height: 180, borderRadius: 8, marginTop: 8 }} />}
      {!!photoKeys.length && <Text style={theme.msg}>photos: {photoKeys.join(', ')}</Text>}
      <View style={theme.buttonRow}>
        <Button title="Estimate" onPress={estimate} disabled={busy} />
        <Button title="Book + Pay" onPress={bookAndPay} disabled={busy} />
      </View>
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!!msg && <Text style={theme.msg}>{msg}</Text>}
    </ScrollView>
  );
}
