/**
 * StarMapScreen — Placeholder for the 3D star map on mobile.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function StarMapScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Star Map</Text>
      <Text style={styles.subtitle}>
        3D neighborhood view — coming soon
      </Text>
      <Text style={styles.hint}>
        Will use expo-gl + expo-three with mobile-tier shaders
        from @exomaps/shared
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0e17',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#e8edf5',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#8899aa',
    marginBottom: 16,
  },
  hint: {
    fontSize: 12,
    color: '#556677',
    textAlign: 'center',
    lineHeight: 18,
  },
});
