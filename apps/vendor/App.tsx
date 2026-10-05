import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { OtpScreen } from './src/screens/OtpScreen';

// Phase 0 skeleton: OTP only. Offers/tracking/adjust-quote land in Phase 3.
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  return (
    <View style={{ padding: 24, flex: 1, justifyContent: 'center' }}>
      {token ? <Text>Logged in as vendor. Job queue arrives in Phase 3.</Text> : <OtpScreen onToken={setToken} />}
    </View>
  );
}
