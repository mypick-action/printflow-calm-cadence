// Feature Flags Service
// Gradual rollout of new features - all flags default to OFF
// Toggle via: localStorage.setItem('printflow_ff_<flag_name>', '1')
// Disable via: localStorage.removeItem('printflow_ff_<flag_name>')

const FF_STORAGE_PREFIX = 'printflow_ff_';

// Feature flag definitions
export type FeatureFlagName =
  | 'PHYSICAL_PLATES_LIMIT'      // Enable physical plate count limits per printer
  | 'WEEKEND_AUTONOMY_BUDGET'    // Enable weekend/after-hours autonomy budget calculation
  | 'OVERNIGHT_SPOOL_PREP_MODAL' // Show modal for overnight spool preparation
  | 'OVERNIGHT_OPEN_SPOOL_ALLOWED'; // Allow using open spools for overnight cycles

// Feature flag configuration
interface FeatureFlagConfig {
  name: FeatureFlagName;
  description: string;
  defaultValue: boolean;
}

const FLAG_CONFIGS: Record<FeatureFlagName, FeatureFlagConfig> = {
  PHYSICAL_PLATES_LIMIT: {
    name: 'PHYSICAL_PLATES_LIMIT',
    description: 'הפעלת הגבלת מספר פלטות פיזיות למדפסת',
    defaultValue: false,
  },
  WEEKEND_AUTONOMY_BUDGET: {
    name: 'WEEKEND_AUTONOMY_BUDGET',
    description: 'חישוב תקציב אוטונומיה לסופ"ש ולילה',
    defaultValue: false,
  },
  OVERNIGHT_SPOOL_PREP_MODAL: {
    name: 'OVERNIGHT_SPOOL_PREP_MODAL',
    description: 'הצגת מודל הכנת גלילים למחזורי לילה',
    defaultValue: false,
  },
  OVERNIGHT_OPEN_SPOOL_ALLOWED: {
    name: 'OVERNIGHT_OPEN_SPOOL_ALLOWED',
    description: 'אפשר שימוש בגלילים פתוחים למחזורי לילה',
    defaultValue: false,
  },
};

// Check if a feature flag is enabled
export const isFeatureEnabled = (flag: FeatureFlagName): boolean => {
  // Check global override first (for testing)
  const globalFlags = (globalThis as any).__PRINTFLOW_FF__;
  if (globalFlags && typeof globalFlags[flag] === 'boolean') {
    return globalFlags[flag];
  }

  // Check localStorage
  const storageKey = `${FF_STORAGE_PREFIX}${flag}`;
  const fromStorage = localStorage.getItem(storageKey);
  
  if (fromStorage === '1' || fromStorage === 'true') return true;
  if (fromStorage === '0' || fromStorage === 'false') return false;
  
  // Return default value
  return FLAG_CONFIGS[flag]?.defaultValue ?? false;
};

// Enable a feature flag
export const enableFeature = (flag: FeatureFlagName): void => {
  const storageKey = `${FF_STORAGE_PREFIX}${flag}`;
  localStorage.setItem(storageKey, '1');
  console.log(`[FeatureFlags] ${flag} ENABLED`);
};

// Disable a feature flag
export const disableFeature = (flag: FeatureFlagName): void => {
  const storageKey = `${FF_STORAGE_PREFIX}${flag}`;
  localStorage.removeItem(storageKey);
  console.log(`[FeatureFlags] ${flag} DISABLED`);
};

// Get all feature flags and their current state
export const getAllFeatureFlags = (): Record<FeatureFlagName, { enabled: boolean; description: string }> => {
  const result: Record<string, { enabled: boolean; description: string }> = {};
  
  for (const [name, config] of Object.entries(FLAG_CONFIGS)) {
    result[name] = {
      enabled: isFeatureEnabled(name as FeatureFlagName),
      description: config.description,
    };
  }
  
  return result as Record<FeatureFlagName, { enabled: boolean; description: string }>;
};

// Reset all feature flags to defaults (OFF)
export const resetAllFeatureFlags = (): void => {
  for (const flag of Object.keys(FLAG_CONFIGS)) {
    const storageKey = `${FF_STORAGE_PREFIX}${flag}`;
    localStorage.removeItem(storageKey);
  }
  (globalThis as any).__PRINTFLOW_FF__ = undefined;
  console.log('[FeatureFlags] All flags reset to defaults (OFF)');
};

// Debug: Log all feature flag states
export const logFeatureFlagStates = (): void => {
  console.group('[FeatureFlags] Current State');
  for (const [name, config] of Object.entries(FLAG_CONFIGS)) {
    const enabled = isFeatureEnabled(name as FeatureFlagName);
    console.log(`  ${name}: ${enabled ? '✅ ON' : '❌ OFF'} - ${config.description}`);
  }
  console.groupEnd();
};

// Expose to window for easy debugging
if (typeof window !== 'undefined') {
  (window as any).FF = {
    enable: enableFeature,
    disable: disableFeature,
    isEnabled: isFeatureEnabled,
    getAll: getAllFeatureFlags,
    resetAll: resetAllFeatureFlags,
    log: logFeatureFlagStates,
  };
}
