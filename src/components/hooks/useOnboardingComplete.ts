import { useState } from 'react';
import { saveFactorySettings, FactorySettingsData } from '@/components/services/base44FactorySettings';

export interface OnboardingData {
  weeklySchedule: Record<string, unknown>;
  afterHoursBehavior: 'NONE' | 'ONE_CYCLE_END_OF_DAY' | 'FULL_AUTOMATION';
  printerNames: string[];
  printerAMSConfigs: any[];
}

export const useOnboardingComplete = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completeOnboarding = async (data: OnboardingData): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const settingsData: FactorySettingsData = {
        factory_name: 'PrintFlow Factory',
        weekly_work_hours: data.weeklySchedule,
        transition_minutes: 10,
        after_hours_behavior: data.afterHoursBehavior,
      };

      const success = await saveFactorySettings(settingsData);

      if (!success) {
        setError('Failed to save factory settings');
        return false;
      }

      console.log('[useOnboardingComplete] Onboarding saved to Base44');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useOnboardingComplete] Error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { completeOnboarding, isLoading, error };
};
