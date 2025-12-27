import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OnboardingData, AfterHoursBehavior } from './OnboardingWizard';
import { Label } from '@/components/ui/label';
import { Info, Moon, Clock, Zap, Star } from 'lucide-react';
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
  const { t } = useLanguage();
  
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
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Label className="text-base font-medium">{t('onboarding.step2.question')}</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-4 h-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs">{t('onboarding.step2.tooltip')}</p>
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
  );
};
