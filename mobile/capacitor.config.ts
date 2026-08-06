import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.spotlight.billboard360",
  appName: "Billboard 360",
  webDir: "dist",
  server: {
    androidScheme: "http",
    cleartext: true,
  },
  plugins: {
    Camera: {
      quality: 80,
    },
  },
};

export default config;
