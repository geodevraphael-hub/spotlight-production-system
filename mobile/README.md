# Billboard 360 — Field Collection APK

Mobile app for billboard field data collection and validation.

## Features

- **GPS-based collection** with high-accuracy coordinates
- **Multi-photo capture** — take multiple photos per billboard
- **Lamppost bulk capture** — single photo to capture entire lamppost lineup
- **Auto-location detection** — reverse geocode from uploaded GeoJSON boundaries
- **Tanzania admin hierarchy** — Region → District → Ward → Street/Mtaa (Mainland), Region → District → Shehia (Zanzibar)
- **Mission-based workflow** — admin assigns missions, field users collect data
- **Offline-ready form** — works with intermittent connectivity

## Prerequisites

- **Node.js** ≥ 18
- **Android Studio** with Android SDK 33+
- **Java JDK** 17+

## Setup

```bash
cd mobile
npm install

# Initialize Capacitor (first time only)
npx cap init "Billboard 360" com.spotlight.billboard360 --web-dir dist

# Add Android platform
npx cap add android
```

## Development

```bash
# Run in browser (connects to backend at localhost:3000)
npm run dev

# For production, set the API URL:
# Create .env with: VITE_API_URL=https://your-server.com
```

## Build APK

```bash
# Build web assets
npm run build

# Sync with Capacitor
npx cap sync

# Open in Android Studio
npx cap open android

# Or build directly (requires Android SDK in PATH):
cd android && ./gradlew assembleDebug
```

The debug APK will be at:
`android/app/build/outputs/apk/debug/app-debug.apk`

## Configuration

### API Server
Set `VITE_API_URL` in `.env` to point to your Spotlight OOH backend server.

### GeoJSON Boundaries
Upload GeoJSON files through the web app's **Field Management** tab. The GeoJSON features should have properties like:
- **Mainland**: `Region`, `District`, `Ward`, `Street` or `Village` or `Mtaa`
- **Zanzibar**: `Region`, `District`, `Shehia`

When a field user captures GPS coordinates, the app will automatically detect the admin location from the boundary data.

## Architecture

- **Vite + React** — lightweight SPA
- **Capacitor** — native Android wrapper
- **Leaflet** — map display with satellite imagery
- **Geolocation API** — high-accuracy GPS with `enableHighAccuracy: true`
- **Camera** — uses device camera via file input with `capture="environment"`
