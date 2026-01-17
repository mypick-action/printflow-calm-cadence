import { base44 } from '@/api/base44Client';

export interface FactorySettingsData {
  factory_name: string;
  weekly_work_hours: Record<string, unknown>;
  transition_minutes: number;
  after_hours_behavior: 'NONE' | 'ONE_CYCLE_END_OF_DAY' | 'FULL_AUTOMATION';
}

export const getFactorySettings = async (): Promise<FactorySettingsData | null> => {
  try {
    const settings = await base44.entities.FactorySettings.list();
    if (!settings || settings.length === 0) return null;
    
    const data = settings[0];
    return {
      factory_name: data.factory_name,
      weekly_work_hours: data.weekly_work_hours as Record<string, unknown>,
      transition_minutes: data.transition_minutes,
      after_hours_behavior: data.after_hours_behavior,
    };
  } catch (error) {
    console.error('[base44FactorySettings] Error fetching:', error);
    return null;
  }
};

export const saveFactorySettings = async (data: FactorySettingsData): Promise<boolean> => {
  try {
    const existing = await base44.entities.FactorySettings.list();
    
    if (existing && existing.length > 0) {
      const id = existing[0].id;
      await base44.entities.FactorySettings.update(id, {
        factory_name: data.factory_name,
        weekly_work_hours: data.weekly_work_hours,
        transition_minutes: data.transition_minutes,
        after_hours_behavior: data.after_hours_behavior,
      });
      console.log('[base44FactorySettings] Updated settings:', id);
    } else {
      await base44.entities.FactorySettings.create({
        factory_name: data.factory_name,
        weekly_work_hours: data.weekly_work_hours,
        transition_minutes: data.transition_minutes,
        after_hours_behavior: data.after_hours_behavior,
      });
      console.log('[base44FactorySettings] Created new settings');
    }
    return true;
  } catch (error) {
    console.error('[base44FactorySettings] Error saving:', error);
    return false;
  }
};

export const isFactorySettingsConfigured = async (): Promise<boolean> => {
  try {
    const settings = await getFactorySettings();
    if (!settings) return false;
    
    const hasWorkHours = settings.weekly_work_hours && 
                         Object.keys(settings.weekly_work_hours).length > 0;
    const hasBehavior = settings.after_hours_behavior !== 'NONE';
    
    return hasWorkHours || hasBehavior;
  } catch (error) {
    console.error('[base44FactorySettings] Error checking config:', error);
    return false;
  }
};
