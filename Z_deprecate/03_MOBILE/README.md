# ExoMaps Mobile

React Native + Expo client for iOS and Android.

## Architecture

Per [05_CLIENTS.MD](../../00_ARCHITECTURE/05_CLIENTS.MD):

- **Navigation**: React Navigation native-stack (5 screens)
- **3D Rendering**: expo-gl + expo-three (Three.js on native GL)
- **Shader tier**: Mobile-optimised GLSL from `@exomaps/shared/shaders`
- **Data**: REST API via `@exomaps/shared/api` with offline-first caching

## Screens

| Screen | Description |
|--------|-------------|
| `StarMapScreen` | 3D neighborhood view (touch pan/pinch zoom) |
| `SystemDetailScreen` | Star + planet list, basic orrery |
| `PlanetDetailScreen` | Globe with procgen textures (mobile tier) |
| `SearchScreen` | Full-text search across systems |
| `SettingsScreen` | API endpoint, cache management, display prefs |

## Status

**Placeholder** — scaffold only. Implementation follows after desktop client stabilisation.

## Getting Started

```bash
cd 02_CLIENTS/03_MOBILE
npm install
npx expo start
```
