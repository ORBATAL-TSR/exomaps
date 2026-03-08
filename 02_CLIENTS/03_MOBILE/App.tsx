/**
 * ExoMaps Mobile — App entry point (placeholder).
 *
 * React Native + Expo + React Navigation scaffold.
 * Actual implementation follows after desktop client stabilisation.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StarMapScreen } from './src/screens/StarMapScreen';
import { SystemDetailScreen } from './src/screens/SystemDetailScreen';

export type RootStackParamList = {
  StarMap: undefined;
  SystemDetail: { mainId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="StarMap"
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0e17' },
          headerTintColor: '#e8edf5',
          headerTitleStyle: { fontWeight: '500' },
          contentStyle: { backgroundColor: '#0a0e17' },
        }}
      >
        <Stack.Screen
          name="StarMap"
          component={StarMapScreen}
          options={{ title: 'ExoMaps' }}
        />
        <Stack.Screen
          name="SystemDetail"
          component={SystemDetailScreen}
          options={{ title: 'System' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
