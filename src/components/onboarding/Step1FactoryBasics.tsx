import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OnboardingData } from './OnboardingWizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Minus, Plus, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { WeeklySchedule, DaySchedule } from '@/services/storage';

interface Step1Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
}

const DAYS_ORDER: (keyof WeeklySchedule)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const Step1FactoryBasics: React.FC<Step1Props> = ({ data, updateData }) => {
  const { t, language } = useLanguage();
  
  const dayLabels: Record<keyof WeeklySchedule, { he: string; en: string }> = {
    sunday: { he: 'ראשון', en: 'Sunday' },
    monday: { he: 'שני', en: 'Monday' },
    tuesday: { he: 'שלישי', en: 'Tuesday' },
    wednesday: { he: 'רביעי', en: 'Wednesday' },
    thursday: { he: 'חמישי', en: 'Thursday' },
    friday: { he: 'שישי', en: 'Friday' },
    saturday: { he: 'שבת', en: 'Saturday' },
  };
  
  const handlePrinterCountChange = (delta: number) => {
    const newCount = Math.max(1, Math.min(20, data.printerCount + delta));
    updatePrinterCount(newCount);
  };

  const handlePrinterCountInput = (value: string) => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return;
    const newCount = Math.max(1, Math.min(20, parsed));
    updatePrinterCount(newCount);
  };

  const updatePrinterCount = (newCount: number) => {
    const newNames = Array.from({ length: newCount }, (_, i) => {
      const defaultName = language === 'he' ? `מדפסת ${i + 1}` : `Printer ${i + 1}`;
      return data.printerNames[i] || defaultName;
    });
    // Also update AMS configs array to match printer count
    const defaultAMSConfig = { hasAMS: false, amsSlots: 4, amsModes: { backupSameColor: true, multiColor: false } };
    const newAMSConfigs = Array.from({ length: newCount }, (_, i) => {
      return data.printerAMSConfigs?.[i] || defaultAMSConfig;
    });
    updateData({ printerCount: newCount, printerNames: newNames, printerAMSConfigs: newAMSConfigs });
  };
  
  const handlePrinterNameChange = (index: number, name: string) => {
    const newNames = [...data.printerNames];
    newNames[index] = name;
    updateData({ printerNames: newNames });
  };
  
  const handleDayScheduleChange = (day: keyof WeeklySchedule, updates: Partial<DaySchedule>) => {
    const newSchedule = {
      ...data.weeklySchedule,
      [day]: { ...data.weeklySchedule[day], ...updates }
    };
    updateData({ weeklySchedule: newSchedule });
  };
  
  return (
    <div className="space-y-8">
      {/* Printer count */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Label className="text-base font-medium">{t('onboarding.step1.printerCount')}</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{t('onboarding.step1.tooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2" dir="ltr">
          <Button
            variant="outline"
            size="icon"
            onClick={() => handlePrinterCountChange(-1)}
            disabled={data.printerCount <= 1}
            className="h-10 w-10"
          >
            <Minus className="w-4 h-4" />
          </Button>
          <Input
            type="number"
            min={1}
            max={20}
            value={data.printerCount}
            onChange={(e) => handlePrinterCountInput(e.target.value)}
            className="w-20 text-center text-xl font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => handlePrinterCountChange(1)}
            disabled={data.printerCount >= 20}
            className="h-10 w-10"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      {/* Printer names */}
      <div className="space-y-3">
        <Label className="text-base font-medium">{t('onboarding.step1.printerNames')}</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-32 overflow-y-auto pr-2">
          {data.printerNames.map((name, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground whitespace-nowrap min-w-[70px]">
                {language === 'he' ? `מדפסת ${index + 1}` : `Printer ${index + 1}`}
              </span>
              <Input
                value={name}
                onChange={(e) => handlePrinterNameChange(index, e.target.value)}
                placeholder={language === 'he' ? `מדפסת ${index + 1}` : `Printer ${index + 1}`}
                className="flex-1"
              />
            </div>
          ))}
        </div>
      </div>
      
      {/* Weekly Schedule - Per Day */}
      <div className="space-y-3">
        <Label className="text-base font-medium">
          {language === 'he' ? 'שעות עבודה לפי יום' : 'Work Hours by Day'}
        </Label>
        <p className="text-sm text-muted-foreground">
          {language === 'he' 
            ? 'הגדירו שעות עבודה לכל יום בנפרד'
            : 'Set work hours for each day separately'}
        </p>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
          {DAYS_ORDER.map((day) => {
            const schedule = data.weeklySchedule[day];
            return (
              <div 
                key={day}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  schedule.enabled 
                    ? 'bg-card border-border' 
                    : 'bg-muted/50 border-transparent'
                }`}
              >
                <Switch
                  checked={schedule.enabled}
                  onCheckedChange={(enabled) => handleDayScheduleChange(day, { enabled })}
                />
                <span className={`min-w-[70px] font-medium ${!schedule.enabled && 'text-muted-foreground'}`}>
                  {language === 'he' ? dayLabels[day].he : dayLabels[day].en}
                </span>
                {schedule.enabled && (
                  <div className="flex items-center gap-2 flex-1" dir="ltr">
                    <Input
                      type="time"
                      value={schedule.startTime}
                      onChange={(e) => handleDayScheduleChange(day, { startTime: e.target.value })}
                      className="w-28"
                    />
                    <span className="text-muted-foreground">-</span>
                    <Input
                      type="time"
                      value={schedule.endTime}
                      onChange={(e) => handleDayScheduleChange(day, { endTime: e.target.value })}
                      className="w-28"
                    />
                  </div>
                )}
                {!schedule.enabled && (
                  <span className="text-sm text-muted-foreground">
                    {language === 'he' ? 'סגור' : 'Closed'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};