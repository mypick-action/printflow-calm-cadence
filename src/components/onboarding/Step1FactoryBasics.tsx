import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OnboardingData } from './OnboardingWizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Minus, Plus, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Step1Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
}

export const Step1FactoryBasics: React.FC<Step1Props> = ({ data, updateData }) => {
  const { t, language } = useLanguage();
  
  const days = [
    { id: 'sunday', label: t('day.sunday') },
    { id: 'monday', label: t('day.monday') },
    { id: 'tuesday', label: t('day.tuesday') },
    { id: 'wednesday', label: t('day.wednesday') },
    { id: 'thursday', label: t('day.thursday') },
    { id: 'friday', label: t('day.friday') },
    { id: 'saturday', label: t('day.saturday') },
  ];
  
  const handlePrinterCountChange = (delta: number) => {
    const newCount = Math.max(1, Math.min(20, data.printerCount + delta));
    const newNames = Array.from({ length: newCount }, (_, i) => {
      const defaultName = language === 'he' ? `מדפסת ${i + 1}` : `Printer ${i + 1}`;
      return data.printerNames[i] || defaultName;
    });
    updateData({ printerCount: newCount, printerNames: newNames });
  };
  
  const handlePrinterNameChange = (index: number, name: string) => {
    const newNames = [...data.printerNames];
    newNames[index] = name;
    updateData({ printerNames: newNames });
  };
  
  const handleDayToggle = (dayId: string) => {
    const newDays = data.workdays.includes(dayId)
      ? data.workdays.filter(d => d !== dayId)
      : [...data.workdays, dayId];
    updateData({ workdays: newDays });
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
        <div className="flex items-center gap-4" dir="ltr">
          <Button
            variant="outline"
            size="icon"
            onClick={() => handlePrinterCountChange(-1)}
            disabled={data.printerCount <= 1}
          >
            <Minus className="w-4 h-4" />
          </Button>
          <span className="text-2xl font-semibold w-12 text-center">{data.printerCount}</span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => handlePrinterCountChange(1)}
            disabled={data.printerCount >= 20}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      {/* Printer names */}
      <div className="space-y-3">
        <Label className="text-base font-medium">{t('onboarding.step1.printerNames')}</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-2">
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
      
      {/* Workdays */}
      <div className="space-y-3">
        <Label className="text-base font-medium">{t('onboarding.step1.workdays')}</Label>
        <div className="flex flex-wrap gap-2">
          {days.map((day) => (
            <label
              key={day.id}
              className={`
                flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-all duration-200
                ${data.workdays.includes(day.id)
                  ? 'bg-primary-light border-primary text-primary'
                  : 'bg-card border-border hover:border-primary/50'
                }
              `}
            >
              <Checkbox
                checked={data.workdays.includes(day.id)}
                onCheckedChange={() => handleDayToggle(day.id)}
                className="sr-only"
              />
              <span className="text-sm font-medium">{day.label}</span>
            </label>
          ))}
        </div>
      </div>
      
      {/* Work hours */}
      <div className="space-y-3">
        <Label className="text-base font-medium">{t('onboarding.step1.workHours')}</Label>
        <div className="flex items-center gap-4 flex-wrap" dir="ltr">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">{t('onboarding.step1.startTime')}</Label>
            <Input
              type="time"
              value={data.startTime}
              onChange={(e) => updateData({ startTime: e.target.value })}
              className="w-32"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">{t('onboarding.step1.endTime')}</Label>
            <Input
              type="time"
              value={data.endTime}
              onChange={(e) => updateData({ endTime: e.target.value })}
              className="w-32"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
