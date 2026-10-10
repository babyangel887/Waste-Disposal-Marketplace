import React, { useEffect, useState } from 'react';
import { View, Text, Button, ActivityIndicator, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OtpScreen } from './src/screens/OtpScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { OffersScreen } from './src/screens/OffersScreen';
import { EarningsScreen } from './src/screens/EarningsScreen';
import { API_BASE, TOKEN_KEY } from './src/api';
import { theme } from './src/theme';

export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  Pending: undefined;
  Home: undefined;
  Offers: undefined;
  Earnings: undefined;
};

type VendorStatus = 'unknown' | 'none' | 'pending' | 'approved' | 'rejected' | 'blocked';

const Stack = createNativeStackNavigator<RootStackParamList>();

function HomeScreen({ navigation, onLogout }: { navigation: any; onLogout: () => void }) {
  return (
    <View style={theme.screen}>
      <View style={theme.card}>
        <Text style={theme.title}>Vendor home</Text>
        <Text style={theme.subtitle}>{API_BASE}</Text>
        <View style={theme.navButton}>
          <Button title="Job offers" onPress={() => navigation.navigate('Offers')} />
        </View>
        <View style={theme.navButton}>
          <Button title="Earnings" onPress={() => navigation.navigate('Earnings')} />
        </View>
        <Button title="Log out" onPress={onLogout} />
      </View>
    </View>
  );
}

function PendingScreen({ status, message, checking, onCheck, onLogout }: {
  status: VendorStatus; message: string; checking: boolean; onCheck: () => void; onLogout: () => void;
}) {
  return (
    <View style={theme.screen}>
      <View style={theme.card}>
        <Text style={theme.title}>Submitted. Waiting for admin approval</Text>
        {status === 'rejected' ? (
          <Text style={theme.subtitle}>Your application was rejected. Contact support or submit again.</Text>
        ) : status === 'blocked' ? (
          <Text style={theme.subtitle}>Your account is blocked. Contact support.</Text>
        ) : (
          <Text style={theme.subtitle}>We will notify you once an admin reviews your application.</Text>
        )}
        <View style={theme.buttonRow}>
          <Button title="Check status" onPress={onCheck} disabled={checking} />
        </View>
        {checking ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        {!!message && <Text style={theme.msg}>{message}</Text>}
        <View style={theme.buttonRow}>
          <Button title="Log out" onPress={onLogout} />
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [vstatus, setVstatus] = useState<VendorStatus>('unknown');
  const [statusMsg, setStatusMsg] = useState('');
  const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY)
      .then((t) => setToken(t))
      .finally(() => setReady(true));
  }, []);

  // Single status check used everywhere: after login, after submit,
  // "already approved", and the pending screen's Check status button.
  // approved → Home, pending/rejected/blocked → Pending, 404 → Onboarding.
  async function checkStatus(): Promise<VendorStatus> {
    if (!token) return 'unknown';
    setChecking(true);
    setStatusMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/vendor/me/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body: any = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setVstatus('none');
        return 'none';
      }
      if (!res.ok) {
        setStatusMsg(body?.error ? String(body.error) : `status check failed (HTTP ${res.status})`);
        return vstatus;
      }
      const p = body.profile ?? {};
      let s: VendorStatus = String(p.approved_status ?? 'pending') as VendorStatus;
      if (p.blocked === true || p.blocked === 1) s = 'blocked';
      if (!['pending', 'approved', 'rejected', 'blocked'].includes(s)) s = 'pending';
      setVstatus(s);
      if (s === 'rejected' && p.rejection_reason) setStatusMsg(`Application rejected: ${p.rejection_reason}`);
      return s;
    } catch (e: any) {
      setStatusMsg('status check failed: ' + String(e?.message ?? e));
      return vstatus;
    } finally {
      setChecking(false);
    }
  }

  // Route by status right after login (or app restart with a saved token).
  useEffect(() => {
    if (token && vstatus === 'unknown' && !checking) {
      checkStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, vstatus]);

  async function saveToken(t: string) {
    await AsyncStorage.setItem(TOKEN_KEY, t);
    setVstatus('unknown');
    setStatusMsg('');
    setToken(t);
  }

  async function logout() {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setVstatus('unknown');
    setStatusMsg('');
  }

  if (!ready) {
    return (
      <View style={[theme.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          {!token ? (
            <Stack.Screen name="Login" options={{ title: 'Vendor login' }}>
              {() => (
                <View style={theme.screen}>
                  <OtpScreen onToken={saveToken} />
                </View>
              )}
            </Stack.Screen>
          ) : vstatus === 'approved' ? (
            <>
              <Stack.Screen name="Home" options={{ title: 'Home' }}>
                {({ navigation }: any) => <HomeScreen navigation={navigation} onLogout={logout} />}
              </Stack.Screen>
              <Stack.Screen name="Offers" options={{ title: 'Job offers' }}>
                {() => (
                  <ScrollView style={theme.screen}>
                    <OffersScreen token={token} />
                  </ScrollView>
                )}
              </Stack.Screen>
              <Stack.Screen name="Earnings" options={{ title: 'Earnings' }}>
                {() => (
                  <ScrollView style={theme.screen}>
                    <EarningsScreen token={token} />
                  </ScrollView>
                )}
              </Stack.Screen>
            </>
          ) : vstatus === 'none' ? (
            <Stack.Screen name="Onboarding" options={{ title: 'Onboarding' }}>
              {() => (
                <View style={theme.screen}>
                  <OnboardingScreen token={token} onDone={() => { checkStatus(); }} />
                  <View style={theme.card}>
                    <Button title="I am already approved — continue" onPress={() => { checkStatus(); }} disabled={checking} />
                    <View style={theme.navButton} />
                    <Button title="Log out" onPress={logout} />
                  </View>
                  {!!statusMsg && (
                    <View style={theme.card}>
                      <Text style={theme.msg}>{statusMsg}</Text>
                    </View>
                  )}
                </View>
              )}
            </Stack.Screen>
          ) : vstatus === 'unknown' ? (
            <Stack.Screen name="Pending" options={{ title: 'Checking…' }}>
              {() => (
                <View style={[theme.screen, { justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator />
                  {!!statusMsg && <Text style={theme.msg}>{statusMsg}</Text>}
                </View>
              )}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Pending" options={{ title: 'Pending review' }}>
              {() => (
                <PendingScreen status={vstatus} message={statusMsg} checking={checking} onCheck={() => { checkStatus(); }} onLogout={logout} />
              )}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
