import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { OtpScreen } from './src/screens/OtpScreen';

// Phase 0 skeleton: OTP only. Offers/tracking/adjust-quote land in Phase 3.
// Phase 1: onboarding form after login.
import { OnboardingScreen } from './src/screens/OnboardingScreen';
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  return (
    <View style={{ padding: 24, flex: 1, justifyContent: 'center' }}>
      {!token ? (
        <OtpScreen onToken={setToken} />
      ) : !onboarded ? (
        <OnboardingScreen token={token} onDone={() => setOnboarded(true)} />
      ) : (
        <Text>Submitted for review. Job queue arrives in Phase 3.</Text>
      )}
    </View>
  );
}
