import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { 
  Calendar, 
  Save,
  Clock,
  RefreshCw,
  Info,
  Loader2,
  Moon,
  Zap,
  StopCircle
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getFactorySettings, 
  saveFactorySettings, 
  markCapacityChanged,
  WeeklySchedule,
  DaySchedule,
  getDefaultWeeklySchedule
} from '@/services/storage';
import { updateFactorySettings as updateCloudFactorySettings } from '@/services/cloudStorage';
import { RecalculateModal } from '@/components/planning/RecalculateModal';

type DayKey = keyof WeeklySchedule;
type AfterHoursBehavior = 'NONE' | 'ONE_CYCLE_END_OF_DAY' | 'FULL_AUTOMATION';

interface DayConfig {
  key: DayKey;
  heLabel: string;
  enLabel: string;
}

const DAYS: DayConfig[] = [
  { key: 'sunday', heLabel: 'ראשון', enLabel: 'Sunday' },
  { key: 'monday', heLabel: 'שני', enLabel: 'Monday' },
  { key: 'tuesday', heLabel: 'שלישי', enLabel: 'Tuesday' },
  { key: 'wednesday', heLabel: 'רביעי', enLabel: 'Wednesday' },
  { key: 'thursday', heLabel: 'חמישי', enLabel: 'Thursday' },
  { key: 'friday', heLabel: 'שישי', enLabel: 'Friday' },
  { key: 'saturday', heLabel: 'שבת', enLabel: 'Saturday' },
];

export const WorkScheduleSection: React.FC = () => {
  const { language } = useLanguage();
  const { workspaceId } = useAuth();
  const [schedule, setSchedule] = useState<WeeklySchedule>(getDefaultWeeklySchedule());
  const [afterHoursBehavior, setAfterHoursBehavior] = useState<AfterHoursBehavior>('ONE_CYCLE_END_OF_DAY');
  const [hasChanges, setHasChanges] = useState(false);
  const [showRecalculateModal, setShowRecalculateModal] = useState(false);
  const [showRecalculateButton, setShowRecalculateButton] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const settings = getFactorySettings();
    if (settings?.weeklySchedule) {
      setSchedule(settings.weeklySchedule);
    }
    if (settings?.afterHoursBehavior) {
      setAfterHoursBehavior(settings.afterHoursBehavior);
    }
  }, []);

  const updateDay = (dayKey: DayKey, updates: Partial<DaySchedule>) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...updates }
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    // Validate times
    for (const day of DAYS) {
      const daySchedule = schedule[day.key];
      if (daySchedule.enabled) {
        if (!daySchedule.startTime || !daySchedule.endTime) {
          toast({
            title: language === 'he' ? 'שגיאה' : 'Error',
            description: language === 'he' 
              ? `${day.heLabel}: נדרשת שעת התחלה וסיום`
              : `${day.enLabel}: Start and end time required`,
            variant: 'destructive',
          });
          return;
        }
        if (daySchedule.startTime >= daySchedule.endTime) {
          toast({
            title: language === 'he' ? 'שגיאה' : 'Error',
            description: language === 'he'
              ? `${day.heLabel}: שעת ההתחלה חייבת להיות לפני שעת הסיום`
              : `${day.enLabel}: Start time must be before end time`,
            variant: 'destructive',
          });
          return;
        }
      }
    }

    setIsSaving(true);

    try {
      // Save to localStorage first
      const settings = getFactorySettings();
      if (settings) {
        const updatedSettings = {
          ...settings,
          weeklySchedule: schedule,
          afterHoursBehavior: afterHoursBehavior
        };
        saveFactorySettings(updatedSettings);
        
        // ============= HARD DEBUG: Verify localStorage write =============
        const verifySettings = getFactorySettings();
        console.log('[WorkSchedule] VERIFY localStorage after save:', {
          savedValue: afterHoursBehavior,
          readBackValue: verifySettings?.afterHoursBehavior,
          match: verifySettings?.afterHoursBehavior === afterHoursBehavior
        });
      }

      // Save to Cloud (Supabase) - include after_hours_behavior
      if (workspaceId) {
        console.log('[WorkSchedule] Saving to cloud, payload:', { schedule, afterHoursBehavior });
        const cloudResult = await updateCloudFactorySettings(workspaceId, {
          weekly_work_hours: schedule as unknown as Record<string, unknown>,
          after_hours_behavior: afterHoursBehavior
        });
        
        if (!cloudResult) {
          toast({
            title: language === 'he' ? 'שגיאת שמירה' : 'Save Error',
            description: language === 'he'
              ? 'ההגדרות נשמרו מקומית אך נכשלה השמירה לענן. נסה שוב.'
              : 'Settings saved locally but cloud sync failed. Please try again.',
            variant: 'destructive',
          });
          setIsSaving(false);
          return;
        }
        console.log('[WorkSchedule] Cloud save successful:', cloudResult);
      }

      markCapacityChanged(language === 'he' ? 'שעות עבודה עודכנו' : 'Work schedule updated');
      setHasChanges(false);
      setShowRecalculateButton(true);
      toast({
        title: language === 'he' ? 'נשמר בהצלחה' : 'Saved successfully',
        description: language === 'he'
          ? 'לוח שעות העבודה עודכן בענן ומקומית'
          : 'Work schedule has been updated in cloud and locally',
      });
    } catch (error) {
      console.error('[WorkSchedule] Save error:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he'
          ? 'שגיאה בשמירת ההגדרות'
          : 'Error saving settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Card variant="elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="w-5 h-5 text-primary" />
            {language === 'he' ? 'לוח שעות עבודה' : 'Work Schedule'}
          </CardTitle>
          <CardDescription>
            {language === 'he'
              ? 'הגדר את ימי ושעות העבודה של המפעל'
              : 'Set your factory work days and hours'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Schedule Table */}
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-4 gap-2 text-sm font-medium text-muted-foreground pb-2 border-b">
              <div>{language === 'he' ? 'יום' : 'Day'}</div>
              <div>{language === 'he' ? 'פתוח' : 'Open'}</div>
              <div>{language === 'he' ? 'התחלה' : 'Start'}</div>
              <div>{language === 'he' ? 'סיום' : 'End'}</div>
            </div>

            {/* Day Rows */}
            {DAYS.map((day) => {
              const daySchedule = schedule[day.key];
              return (
                <div 
                  key={day.key} 
                  className={`grid grid-cols-4 gap-2 items-center py-2 rounded-lg transition-colors ${
                    daySchedule.enabled ? 'bg-muted/30' : 'opacity-50'
                  }`}
                >
                  <div className="font-medium text-sm">
                    {language === 'he' ? day.heLabel : day.enLabel}
                  </div>
                  
                  <div>
                    <Switch
                      checked={daySchedule.enabled}
                      onCheckedChange={(enabled) => updateDay(day.key, { enabled })}
                    />
                  </div>
                  
                  <div>
                    <Input
                      type="time"
                      value={daySchedule.startTime}
                      onChange={(e) => updateDay(day.key, { startTime: e.target.value })}
                      disabled={!daySchedule.enabled}
                      className="h-9 text-sm"
                    />
                  </div>
                  
                  <div>
                    <Input
                      type="time"
                      value={daySchedule.endTime}
                      onChange={(e) => updateDay(day.key, { endTime: e.target.value })}
                      disabled={!daySchedule.enabled}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* After Hours Behavior Section */}
          <div className="pt-4 border-t">
            <div className="flex items-center gap-2 mb-3">
              <Moon className="w-4 h-4 text-primary" />
              <span className="font-medium text-sm">
                {language === 'he' ? 'התנהגות אחרי שעות עבודה' : 'After Hours Behavior'}
              </span>
            </div>
            
            <RadioGroup
              value={afterHoursBehavior}
              onValueChange={(value: AfterHoursBehavior) => {
                setAfterHoursBehavior(value);
                setHasChanges(true);
              }}
              className="space-y-2"
            >
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                afterHoursBehavior === 'NONE' ? 'bg-primary/5 border-primary' : 'bg-muted/30 border-border hover:border-primary/40'
              }`}>
                <RadioGroupItem value="NONE" id="none" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <StopCircle className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm">
                      {language === 'he' ? 'ללא הדפסות בלילה' : 'No Night Printing'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {language === 'he' 
                      ? 'מחזורים יסתיימו לפני סוף יום העבודה'
                      : 'Cycles will finish before end of workday'}
                  </p>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                afterHoursBehavior === 'ONE_CYCLE_END_OF_DAY' ? 'bg-primary/5 border-primary' : 'bg-muted/30 border-border hover:border-primary/40'
              }`}>
                <RadioGroupItem value="ONE_CYCLE_END_OF_DAY" id="one_cycle" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Moon className="w-4 h-4 text-info" />
                    <span className="font-medium text-sm">
                      {language === 'he' ? 'מחזור אחד נוסף (ברירת מחדל)' : 'One Extra Cycle (Default)'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {language === 'he' 
                      ? 'אפשר להתחיל מחזור אחד שירוץ בלילה'
                      : 'Allow starting one cycle that runs overnight'}
                  </p>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                afterHoursBehavior === 'FULL_AUTOMATION' ? 'bg-primary/5 border-primary' : 'bg-muted/30 border-border hover:border-primary/40'
              }`}>
                <RadioGroupItem value="FULL_AUTOMATION" id="full_auto" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-success" />
                    <span className="font-medium text-sm">
                      {language === 'he' ? 'אוטומציה מלאה' : 'Full Automation'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {language === 'he' 
                      ? 'מדפסות עם הרשאה יכולות להתחיל מחזורים חדשים בלילה ובסופ״ש'
                      : 'Enabled printers can start new cycles at night and weekends'}
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          {/* Info Note */}
          <Alert className="bg-info/5 border-info/20">
            <Info className="h-4 w-4 text-info" />
            <AlertDescription className="text-sm text-muted-foreground">
              {language === 'he'
                ? 'שינויים ישפיעו על תכנון עתידי. תוכניות קיימות לא ישתנו עד שתחשב מחדש.'
                : 'Changes affect future planning. Existing plans will not change until you recalculate.'}
            </AlertDescription>
          </Alert>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="flex-1 gap-2"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {language === 'he' ? 'שמור שינויים' : 'Save Changes'}
            </Button>

            {showRecalculateButton && (
              <Button
                variant="outline"
                onClick={() => setShowRecalculateModal(true)}
                className="flex-1 gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {language === 'he' ? 'חשב מחדש תכנון' : 'Recalculate Planning'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <RecalculateModal
        open={showRecalculateModal}
        onOpenChange={setShowRecalculateModal}
        onRecalculated={() => setShowRecalculateButton(false)}
      />
    </>
  );
};
