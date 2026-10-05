import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';

// Phase 2: category picker + load estimator + photo keys + upfront total + mock authorize.
// Photo capture is a file-key input in this skeleton (presigned upload wired in Phase 0).
const CATS = ['bagged', 'bulky', 'rubble', 'recyclable'];
export function BookingScreen({ apiBase, token }: { apiBase: string; token: string }) {
  const [cat, setCat] = useState('bagged');
  const [qty, setQty] = useState('2');
  const [lga, setLga] = useState('Ikeja');
  const [photo, setPhoto] = useState('waste_photo/demo-key');
  const [msg, setMsg] = useState('');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  async function estimate() {
    const r: any = await fetch(`${apiBase}/api/v1/bookings/estimate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_slug: cat, qty: Number(qty), lga }),
    }).then((x) => x.json());
    setMsg('estimate: ' + JSON.stringify(r));
  }
  async function bookAndPay() {
    const b: any = await fetch(`${apiBase}/api/v1/bookings`, {
      method: 'POST', headers,
      body: JSON.stringify({
        category_slug: cat, qty: Number(qty), lga,
        pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'Lekki Phase 1',
        photo_keys: [photo],
      }),
    }).then((x) => x.json());
    if (!b.booking) { setMsg('booking failed: ' + JSON.stringify(b)); return; }
    // Paystack inline would go here; Phase 2 uses mock hold.
    const p: any = await fetch(`${apiBase}/api/v1/bookings/${b.booking.id}/authorize-payment`, {
      method: 'POST', headers, body: JSON.stringify({ provider: 'paystack' }),
    }).then((x) => x.json());
    setMsg('booked+held: ' + JSON.stringify({ booking: b.booking.id, status: p.booking?.status, payment: p.payment?.status }));
  }
  return (
    <View>
      <Text>Book pickup — Phase 2 (cats: {CATS.join(', ')})</Text>
      <TextInput value={cat} onChangeText={setCat} placeholder="category" />
      <TextInput value={qty} onChangeText={setQty} placeholder="qty" />
      <TextInput value={lga} onChangeText={setLga} placeholder="LGA" />
      <TextInput value={photo} onChangeText={setPhoto} placeholder="photo key" />
      <Button title="Estimate" onPress={estimate} />
      <Button title="Book + Pay (mock)" onPress={bookAndPay} />
      <Text>{msg}</Text>
    </View>
  );
}
