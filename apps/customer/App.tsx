import React, { useEffect, useState } from 'react';
import { View, Text, Button, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OtpScreen } from './src/screens/OtpScreen';
import { BookingScreen } from './src/screens/BookingScreen';
import { JobTracking } from './src/screens/JobTracking';
import { DisputeScreen } from './src/screens/DisputeScreen';
import { API_BASE, TOKEN_KEY, REFRESH_TOKEN_KEY, SESSION_EXPIRED_MSG, Session, AuthState } from './src/api';
import { theme } from './src/theme';

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Booking: undefined;
  Tracking: { bookingId?: string };
  Dispute: { bookingId?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function HomeScreen({ navigation, onLogout }: { navigation: any; onLogout: () => void }) {
  return (
    <View style={theme.screen}>
      <View style={theme.card}>
        <Text style={theme.title}>Waste pickup</Text>
        <Text style={theme.subtitle}>{API_BASE}</Text>
        <View style={theme.navButton}>
          <Button title="New booking" onPress={() => navigation.navigate('Booking')} />
        </View>
        <View style={theme.navButton}>
          <Button title="Track driver" onPress={() => navigation.navigate('Tracking', {})} />
        </View>
        <View style={theme.navButton}>
          <Button title="Raise dispute" onPress={() => navigation.navigate('Dispute', {})} />
        </View>
        <Button title="Log out" onPress={onLogout} />
      </View>
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [lastBooking, setLastBooking] = useState<string | undefined>(undefined);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(TOKEN_KEY), AsyncStorage.getItem(REFRESH_TOKEN_KEY)])
      .then(([a, r]) => {
        if (a && r) setSession({ access: a, refresh: r });
      })
      .finally(() => setReady(true));
  }, []);

  async function saveTokens(access: string, refresh: string) {
    await AsyncStorage.setItem(TOKEN_KEY, access);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    setSession({ access, refresh });
    setNotice('');
  }

  async function updateSession(s: Session) {
    await AsyncStorage.setItem(TOKEN_KEY, s.access);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, s.refresh);
    setSession(s);
  }

  async function logout() {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    setSession(null);
    setNotice('');
  }

  function expireSession() {
    AsyncStorage.removeItem(TOKEN_KEY);
    AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    setSession(null);
    setNotice(SESSION_EXPIRED_MSG);
  }

  const auth: AuthState | null = session
    ? { session, update: updateSession, expire: expireSession }
    : null;

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
          {!auth ? (
            <Stack.Screen name="Login" options={{ title: 'Login' }}>
              {() => (
                <View style={theme.screen}>
                  <OtpScreen onToken={saveTokens} notice={notice} />
                </View>
              )}
            </Stack.Screen>
          ) : (
            <>
              <Stack.Screen name="Home" options={{ title: 'Home' }}>
                {({ navigation }: any) => <HomeScreen navigation={navigation} onLogout={logout} />}
              </Stack.Screen>
              <Stack.Screen name="Booking" options={{ title: 'New booking' }}>
                {({ navigation }: any) => (
                  <View style={theme.screen}>
                    <BookingScreen
                      auth={auth}
                      onBooked={(id) => {
                        setLastBooking(id);
                        navigation.navigate('Tracking', { bookingId: id });
                      }}
                    />
                  </View>
                )}
              </Stack.Screen>
              <Stack.Screen name="Tracking" options={{ title: 'Track driver' }} initialParams={{ bookingId: lastBooking }}>
                {() => (
                  <View style={theme.screen}>
                    <JobTracking auth={auth} bookingId={lastBooking} />
                  </View>
                )}
              </Stack.Screen>
              <Stack.Screen name="Dispute" options={{ title: 'Dispute' }} initialParams={{ bookingId: lastBooking }}>
                {() => (
                  <View style={theme.screen}>
                    <DisputeScreen auth={auth} bookingId={lastBooking} />
                  </View>
                )}
              </Stack.Screen>
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
