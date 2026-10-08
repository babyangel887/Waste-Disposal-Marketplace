import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { OtpScreen } from './src/screens/OtpScreen';

// Phase 0 skeleton: OTP + consent only. Booking flow lands in Phase 2.
// NOTE: requires bare workflow in Phase 3 for react-native-background-geolocation.
// Phase 2: booking UI after login.
import { BookingScreen } from './src/screens/BookingScreen';
const API_BASE = 'http://10.0.2.2:4000';
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  return (
    <View style={{ padding: 24, flex: 1, justifyContent: 'center' }}>
      {token ? (
        <BookingScreen apiBase={API_BASE} token={token} />
      ) : (
        <OtpScreen apiBase="http://10.0.2.2:4000" onToken={setToken} />
      )}
    </View>
  );
}
