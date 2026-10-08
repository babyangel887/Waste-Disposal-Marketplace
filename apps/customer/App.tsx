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
import { API_BASE, TOKEN_KEY } from './src/api';
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
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [lastBooking, setLastBooking] = useState<string | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY)
      .then((t) => setToken(t))
      .finally(() => setReady(true));
  }, []);

  async function saveToken(t: string) {
    await AsyncStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }

  async function logout() {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
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
            <Stack.Screen name="Login" options={{ title: 'Login' }}>
              {() => (
                <View style={theme.screen}>
                  <OtpScreen onToken={saveToken} />
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
                      token={token}
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
                    <JobTracking token={token} bookingId={lastBooking} />
                  </View>
                )}
              </Stack.Screen>
              <Stack.Screen name="Dispute" options={{ title: 'Dispute' }} initialParams={{ bookingId: lastBooking }}>
                {() => (
                  <View style={theme.screen}>
                    <DisputeScreen token={token} bookingId={lastBooking} />
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
