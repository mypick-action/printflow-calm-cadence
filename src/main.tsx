import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { migrateInventoryData } from "./services/inventoryMigration";

// Import feature flags and block logger for console debugging
import { logFeatureFlagStates } from "./services/featureFlags";
import { logBlockSummary } from "./services/cycleBlockLogger";

// Run inventory migration on app init (idempotent - runs once)
migrateInventoryData();

// Log feature flag states on startup (dev info)
if (import.meta.env.DEV) {
  console.log('[PrintFlow] Dev mode - Feature Flags and Block Logger available');
  console.log('[PrintFlow] Use window.FF.log() to see feature flags');
  console.log('[PrintFlow] Use window.BlockLog.summary() to see block summary');
  logFeatureFlagStates();
}

createRoot(document.getElementById("root")!).render(<App />);
