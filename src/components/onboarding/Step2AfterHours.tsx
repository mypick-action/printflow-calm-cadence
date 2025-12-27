import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OnboardingData, AfterHoursBehavior, PrinterAMSConfig } from './OnboardingWizard';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Info, Moon, Clock, Zap, Star, Box, Settings2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Step2Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
}

interface OptionConfig {
  value: AfterHoursBehavior;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
  recommended?: boolean;
}

export const Step2AfterHours: React.FC<Step2Props> = ({ data, updateData }) => {
  const { t, language } = useLanguage();
  
  const options: OptionConfig[] = [
    {
      value: 'NONE',
      labelKey: 'onboarding.step2.option1',
      descKey: 'onboarding.step2.option1Desc',
      icon: <Moon className="w-5 h-5" />,
    },
    {
      value: 'ONE_CYCLE_END_OF_DAY',
      labelKey: 'onboarding.step2.option2',
      descKey: 'onboarding.step2.option2Desc',
      icon: <Clock className="w-5 h-5" />,
      recommended: true,
    },
    {
      value: 'FULL_AUTOMATION',
      labelKey: 'onboarding.step2.option3',
      descKey: 'onboarding.step2.option3Desc',
      icon: <Zap className="w-5 h-5" />,
    },
  ];

  const handleAMSChange = (hasAMS: boolean) => {
    updateData({ hasAMS });
    // If turning off AMS at factory level, reset all printer AMS configs
    if (!hasAMS) {
      const resetConfigs = data.printerAMSConfigs.map(config => ({
        ...config,
        hasAMS: false,
      }));
      updateData({ hasAMS, printerAMSConfigs: resetConfigs });
    }
  };

  const handlePrinterAMSToggle = (index: number, enabled: boolean) => {
    const newConfigs = [...data.printerAMSConfigs];
    newConfigs[index] = {
      ...newConfigs[index],
      hasAMS: enabled,
    };
    updateData({ printerAMSConfigs: newConfigs });
  };

  const handlePrinterAMSSlots = (index: number, slots: number) => {
    const newConfigs = [...data.printerAMSConfigs];
    newConfigs[index] = {
      ...newConfigs[index],
      amsSlots: Math.max(1, Math.min(16, slots)),
    };
    updateData({ printerAMSConfigs: newConfigs });
  };

  const handlePrinterAMSMode = (index: number, mode: 'backupSameColor' | 'multiColor', enabled: boolean) => {
    const newConfigs = [...data.printerAMSConfigs];
    newConfigs[index] = {
      ...newConfigs[index],
      amsModes: {
        ...newConfigs[index].amsModes,
        [mode]: enabled,
      },
    };
    updateData({ printerAMSConfigs: newConfigs });
  };

  const enabledPrintersWithAMS = data.printerAMSConfigs.filter(c => c.hasAMS).length;
  
  return (
    <div className="space-y-8">
      {/* After hours behavior */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Label className="text-base font-medium">{t('onboarding.step2.question')}</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm p-4">
                <p className="font-semibold mb-2">
                  {language === 'he' 
                    ? 'איך זה משפיע על תכנון העבודה?' 
                    : 'How does this affect work planning?'}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {language === 'he' 
                    ? 'הבחירה כאן קובעת איך המערכת מתכננת את סוף יום העבודה:'
                    : 'This choice determines how the system plans the end of the workday:'}
                </p>
                <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                  <li>
                    {language === 'he'
                      ? '• אם לא מדפיסים בלי נוכחות צוות – המערכת תפסיק תכנון מחזורים בסיום היום.'
                      : '• If no unattended printing – the system will stop planning cycles at end of day.'}
                  </li>
                  <li>
                    {language === 'he'
                      ? '• אם שולחים מחזור אחד אחרון – המערכת תתכנן מחזור שיסתיים גם אחרי שעות העבודה, וימתין לבוקר.'
                      : '• If sending one last cycle – the system will plan a cycle that finishes after hours and waits until morning.'}
                  </li>
                  <li>
                    {language === 'he'
                      ? '• אם יש אוטומציה מלאה – המערכת תוכל לתכנן עבודה רציפה גם בלילה.'
                      : '• If full automation – the system can plan continuous work through the night.'}
                  </li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        
        <div className="space-y-3">
          {options.map((option) => (
            <label
              key={option.value}
              className={`
                relative flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200
                ${data.afterHoursBehavior === option.value
                  ? 'bg-primary-light border-primary'
                  : 'bg-card border-border hover:border-primary/40'
                }
              `}
            >
              <input
                type="radio"
                name="afterHoursBehavior"
                value={option.value}
                checked={data.afterHoursBehavior === option.value}
                onChange={() => updateData({ afterHoursBehavior: option.value })}
                className="sr-only"
              />
              
              <div className={`
                flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors
                ${data.afterHoursBehavior === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
                }
              `}>
                {option.icon}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${
                    data.afterHoursBehavior === option.value ? 'text-primary' : 'text-foreground'
                  }`}>
                    {t(option.labelKey)}
                  </span>
                  {option.recommended && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-light text-success text-xs font-medium">
                      <Star className="w-3 h-3" />
                      {t('onboarding.step2.recommended')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(option.descKey)}
                </p>
              </div>
              
              <div className={`
                w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 transition-all
                ${data.afterHoursBehavior === option.value
                  ? 'border-primary bg-primary'
                  : 'border-muted-foreground/30'
                }
              `}>
                {data.afterHoursBehavior === option.value && (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* AMS Question - Factory Level */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Label className="text-base font-medium">
            {language === 'he' 
              ? 'האם יש מערכת AMS מחוברת למדפסת כלשהי?' 
              : 'Do you have AMS systems connected to any of your printers?'}
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  {language === 'he' 
                    ? 'AMS (מערכת חומרים אוטומטית) מאפשרת החלפה אוטומטית של גלילים והדפסה רב-צבעית'
                    : 'AMS (Automatic Material System) enables automatic spool switching and multi-color printing'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        
        <div className="flex gap-3">
          <label
            className={`
              flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all
              ${!data.hasAMS
                ? 'bg-primary-light border-primary'
                : 'bg-card border-border hover:border-primary/40'
              }
            `}
          >
            <input
              type="radio"
              name="hasAMS"
              checked={!data.hasAMS}
              onChange={() => handleAMSChange(false)}
              className="sr-only"
            />
            <span className={`font-medium ${!data.hasAMS ? 'text-primary' : 'text-foreground'}`}>
              {language === 'he' ? 'לא' : 'No'}
            </span>
          </label>
          
          <label
            className={`
              flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all
              ${data.hasAMS
                ? 'bg-primary-light border-primary'
                : 'bg-card border-border hover:border-primary/40'
              }
            `}
          >
            <input
              type="radio"
              name="hasAMS"
              checked={data.hasAMS}
              onChange={() => handleAMSChange(true)}
              className="sr-only"
            />
            <span className={`font-medium ${data.hasAMS ? 'text-primary' : 'text-foreground'}`}>
              {language === 'he' ? 'כן' : 'Yes'}
            </span>
          </label>
        </div>
        
        {/* Per-Printer AMS Configuration */}
        {data.hasAMS && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {language === 'he' 
                  ? 'בחר לאילו מדפסות יש AMS:' 
                  : 'Select which printers have AMS:'}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Settings2 className="w-3 h-3" />
                {language === 'he' 
                  ? 'ניתן להגדיר בהמשך בהגדרות מדפסות' 
                  : 'Can configure later in Printers settings'}
              </p>
            </div>
            
            <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
              {data.printerNames.map((printerName, index) => {
                const config = data.printerAMSConfigs[index] || { hasAMS: false, amsSlots: 4, amsModes: { backupSameColor: true, multiColor: false } };
                
                return (
                  <div 
                    key={index}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      config.hasAMS 
                        ? 'bg-card border-primary/30' 
                        : 'bg-muted/30 border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Box className={`w-5 h-5 ${config.hasAMS ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className={`font-medium ${config.hasAMS ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {printerName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {language === 'he' ? 'יש AMS' : 'Has AMS'}
                        </span>
                        <Switch
                          checked={config.hasAMS}
                          onCheckedChange={(checked) => handlePrinterAMSToggle(index, checked)}
                        />
                      </div>
                    </div>
                    
                    {/* AMS Configuration for this printer */}
                    {config.hasAMS && (
                      <div className="mt-4 pt-4 border-t border-border space-y-4 animate-fade-in">
                        {/* AMS Slots */}
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">
                            {language === 'he' ? 'מספר סלוטים:' : 'Number of slots:'}
                          </Label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handlePrinterAMSSlots(index, config.amsSlots === 4 ? 4 : 4)}
                              className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
                                config.amsSlots === 4 
                                  ? 'bg-primary text-primary-foreground border-primary' 
                                  : 'bg-card border-border hover:border-primary/40'
                              }`}
                            >
                              4
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePrinterAMSSlots(index, 8)}
                              className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
                                config.amsSlots === 8 
                                  ? 'bg-primary text-primary-foreground border-primary' 
                                  : 'bg-card border-border hover:border-primary/40'
                              }`}
                            >
                              8
                            </button>
                            <Input
                              type="number"
                              min={1}
                              max={16}
                              value={config.amsSlots !== 4 && config.amsSlots !== 8 ? config.amsSlots : ''}
                              placeholder={language === 'he' ? 'אחר' : 'Other'}
                              onChange={(e) => handlePrinterAMSSlots(index, parseInt(e.target.value) || 4)}
                              className="w-20 text-center h-8"
                            />
                          </div>
                        </div>
                        
                        {/* AMS Modes */}
                        <div className="space-y-2">
                          <Label className="text-sm">
                            {language === 'he' ? 'מצבי שימוש:' : 'Usage modes:'}
                          </Label>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={config.amsModes.backupSameColor}
                                onCheckedChange={(checked) => handlePrinterAMSMode(index, 'backupSameColor', !!checked)}
                              />
                              <span className="text-sm">
                                {language === 'he' 
                                  ? 'גיבוי / מילוי אוטומטי (אותו צבע)' 
                                  : 'Backup / auto refill (same color)'}
                              </span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={config.amsModes.multiColor}
                                onCheckedChange={(checked) => handlePrinterAMSMode(index, 'multiColor', !!checked)}
                              />
                              <span className="text-sm">
                                {language === 'he' 
                                  ? 'הדפסה רב-צבעית' 
                                  : 'Multi-color printing'}
                              </span>
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Summary */}
            {enabledPrintersWithAMS > 0 && (
              <p className="text-sm text-success text-center animate-fade-in">
                {language === 'he' 
                  ? `${enabledPrintersWithAMS} מדפסות עם AMS מוגדרות` 
                  : `${enabledPrintersWithAMS} printer(s) with AMS configured`}
              </p>
            )}
            
            {enabledPrintersWithAMS === 0 && (
              <p className="text-sm text-muted-foreground text-center animate-fade-in">
                {language === 'he' 
                  ? 'לא נבחרו מדפסות עם AMS. ניתן להגדיר בהמשך בהגדרות מדפסות.' 
                  : 'No printers with AMS selected. You can configure this later in Printers settings.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};