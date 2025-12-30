import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { migrateInventoryData } from "./services/inventoryMigration";

// Run inventory migration on app init (idempotent - runs once)
migrateInventoryData();

createRoot(document.getElementById("root")!).render(<App />);
