import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { OtpScreen } from './src/screens/OtpScreen';

// Phase 0 skeleton: OTP + consent only. Booking flow lands in Phase 2.
// NOTE: requires bare workflow in Phase 3 for react-native-background-geolocation.
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  return (
    <View style={{ padding: 24, flex: 1, justifyContent: 'center' }}>
      {token ? (
        <Text>Logged in. Booking UI arrives in Phase 2.</Text>
      ) : (
        <OtpScreen apiBase="http://10.0.2.2:4000" onToken={setToken} />
      )}
    </View>
  );
}
