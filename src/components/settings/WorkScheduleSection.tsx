import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Calendar, 
  Save,
  Clock,
  RefreshCw,
  Info
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
import { RecalculateModal } from '@/components/planning/RecalculateModal';

type DayKey = keyof WeeklySchedule;

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
  const [schedule, setSchedule] = useState<WeeklySchedule>(getDefaultWeeklySchedule());
  const [hasChanges, setHasChanges] = useState(false);
  const [showRecalculateModal, setShowRecalculateModal] = useState(false);
  const [showRecalculateButton, setShowRecalculateButton] = useState(false);

  useEffect(() => {
    const settings = getFactorySettings();
    if (settings?.weeklySchedule) {
      setSchedule(settings.weeklySchedule);
    }
  }, []);

  const updateDay = (dayKey: DayKey, updates: Partial<DaySchedule>) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...updates }
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
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

    const settings = getFactorySettings();
    if (settings) {
      saveFactorySettings({
        ...settings,
        weeklySchedule: schedule
      });
      markCapacityChanged(language === 'he' ? 'שעות עבודה עודכנו' : 'Work schedule updated');
      setHasChanges(false);
      setShowRecalculateButton(true);
      toast({
        title: language === 'he' ? 'נשמר בהצלחה' : 'Saved successfully',
        description: language === 'he'
          ? 'לוח שעות העבודה עודכן'
          : 'Work schedule has been updated',
      });
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
              disabled={!hasChanges}
              className="flex-1 gap-2"
            >
              <Save className="w-4 h-4" />
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
