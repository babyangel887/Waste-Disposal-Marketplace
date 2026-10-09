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
  Home: undefined;
  Offers: undefined;
  Earnings: undefined;
};

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

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [ready, setReady] = useState(false);

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
    setOnboarded(false);
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
          ) : !onboarded ? (
            <Stack.Screen name="Onboarding" options={{ title: 'Onboarding' }}>
              {({ navigation }: any) => (
                <View style={theme.screen}>
                  <OnboardingScreen token={token} onDone={() => { setOnboarded(true); navigation.navigate('Home'); }} />
                  <View style={theme.card}>
                    <Button title="I am already approved — continue" onPress={() => { setOnboarded(true); navigation.navigate('Home'); }} />
                    <View style={theme.navButton} />
                    <Button title="Log out" onPress={logout} />
                  </View>
                </View>
              )}
            </Stack.Screen>
          ) : (
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
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
