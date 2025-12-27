import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, startOfWeek, endOfWeek, parseISO, addDays } from 'date-fns';
import { CalendarIcon, Info } from 'lucide-react';

interface DayOverride {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

interface WeekOverride {
  id: string;
  startDate: string;
  endDate: string;
  days: {
    sunday: DayOverride;
    monday: DayOverride;
    tuesday: DayOverride;
    wednesday: DayOverride;
    thursday: DayOverride;
    friday: DayOverride;
    saturday: DayOverride;
  };
}

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAYS_LABELS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYS_LABELS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface TemporaryOverrideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (override: WeekOverride) => void;
  existingOverride?: WeekOverride | null;
}

export const TemporaryOverrideModal: React.FC<TemporaryOverrideModalProps> = ({
  open,
  onOpenChange,
  onSave,
  existingOverride,
}) => {
  const { language } = useLanguage();
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  
  // Initialize with current week dates
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 0 });

  const [override, setOverride] = useState<WeekOverride>({
    id: `override-${Date.now()}`,
    startDate: format(weekStart, 'yyyy-MM-dd'),
    endDate: format(weekEnd, 'yyyy-MM-dd'),
    days: {
      sunday: { enabled: true, startTime: '08:30', endTime: '21:00' },
      monday: { enabled: true, startTime: '08:30', endTime: '21:00' },
      tuesday: { enabled: true, startTime: '08:30', endTime: '21:00' },
      wednesday: { enabled: true, startTime: '08:30', endTime: '21:00' },
      thursday: { enabled: true, startTime: '08:30', endTime: '21:00' },
      friday: { enabled: false, startTime: '09:00', endTime: '14:00' },
      saturday: { enabled: false, startTime: '09:00', endTime: '14:00' },
    },
  });

  useEffect(() => {
    if (existingOverride) {
      setOverride(existingOverride);
    } else {
      // Reset to current week defaults
      setOverride({
        id: `override-${Date.now()}`,
        startDate: format(weekStart, 'yyyy-MM-dd'),
        endDate: format(weekEnd, 'yyyy-MM-dd'),
        days: {
          sunday: { enabled: true, startTime: '08:30', endTime: '21:00' },
          monday: { enabled: true, startTime: '08:30', endTime: '21:00' },
          tuesday: { enabled: true, startTime: '08:30', endTime: '21:00' },
          wednesday: { enabled: true, startTime: '08:30', endTime: '21:00' },
          thursday: { enabled: true, startTime: '08:30', endTime: '21:00' },
          friday: { enabled: false, startTime: '09:00', endTime: '14:00' },
          saturday: { enabled: false, startTime: '09:00', endTime: '14:00' },
        },
      });
    }
  }, [open, existingOverride]);

  const updateDayOverride = (day: typeof DAYS_OF_WEEK[number], field: keyof DayOverride, value: boolean | string) => {
    setOverride(prev => ({
      ...prev,
      days: {
        ...prev.days,
        [day]: {
          ...prev.days[day],
          [field]: value,
        },
      },
    }));
  };

  const handleSave = () => {
    onSave(override);
    onOpenChange(false);
  };

  const dayLabels = language === 'he' ? DAYS_LABELS_HE : DAYS_LABELS_EN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {language === 'he' ? 'שינוי לוז זמני' : 'Temporary Schedule Override'}
          </DialogTitle>
          <DialogDescription className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <span>
              {language === 'he' 
                ? 'שינוי זמני לטווח תאריכים זה בלבד. בסוף הטווח הכל חוזר אוטומטית להגדרות הרגילות.'
                : 'Temporary override for this date range only. After it ends, settings automatically return to defaults.'}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'he' ? 'מתאריך' : 'From Date'}</Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !override.startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {override.startDate 
                      ? format(parseISO(override.startDate), 'dd/MM/yyyy')
                      : (language === 'he' ? 'בחר תאריך' : 'Pick date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={parseISO(override.startDate)}
                    onSelect={(date) => {
                      if (date) {
                        setOverride(prev => ({ ...prev, startDate: format(date, 'yyyy-MM-dd') }));
                      }
                      setStartDateOpen(false);
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>{language === 'he' ? 'עד תאריך' : 'To Date'}</Label>
              <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !override.endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {override.endDate 
                      ? format(parseISO(override.endDate), 'dd/MM/yyyy')
                      : (language === 'he' ? 'בחר תאריך' : 'Pick date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={parseISO(override.endDate)}
                    onSelect={(date) => {
                      if (date) {
                        setOverride(prev => ({ ...prev, endDate: format(date, 'yyyy-MM-dd') }));
                      }
                      setEndDateOpen(false);
                    }}
                    disabled={(date) => date < parseISO(override.startDate)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Days Table */}
          <div className="space-y-2">
            <Label>{language === 'he' ? 'לוז זמנים לכל יום' : 'Schedule per day'}</Label>
            <div className="border rounded-lg overflow-hidden">
              {DAYS_OF_WEEK.map((day, index) => (
                <div 
                  key={day}
                  className={cn(
                    "flex items-center gap-4 p-3",
                    index !== DAYS_OF_WEEK.length - 1 && "border-b"
                  )}
                >
                  <div className="w-20">
                    <span className="font-medium text-sm">{dayLabels[index]}</span>
                  </div>
                  <Switch
                    checked={override.days[day].enabled}
                    onCheckedChange={(checked) => updateDayOverride(day, 'enabled', checked)}
                  />
                  {override.days[day].enabled && (
                    <>
                      <Input
                        type="time"
                        value={override.days[day].startTime}
                        onChange={(e) => updateDayOverride(day, 'startTime', e.target.value)}
                        className="w-28 h-9"
                      />
                      <span className="text-muted-foreground">—</span>
                      <Input
                        type="time"
                        value={override.days[day].endTime}
                        onChange={(e) => updateDayOverride(day, 'endTime', e.target.value)}
                        className="w-28 h-9"
                      />
                    </>
                  )}
                  {!override.days[day].enabled && (
                    <span className="text-sm text-muted-foreground">
                      {language === 'he' ? 'יום חופש' : 'Day off'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Info note */}
          <p className="text-xs text-muted-foreground text-center">
            {language === 'he' 
              ? 'לא משנה את ברירת המחדל של המפעל'
              : "Doesn't change the factory's default settings"}
          </p>

          {/* Save Button */}
          <Button onClick={handleSave} className="w-full">
            {language === 'he' ? 'החל לשבוע הזה' : 'Apply to this week'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
