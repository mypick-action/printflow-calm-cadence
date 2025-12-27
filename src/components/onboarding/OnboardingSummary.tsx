import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OnboardingData } from './OnboardingWizard';
import { Check } from 'lucide-react';
import { WeeklySchedule } from '@/services/storage';

interface SummaryProps {
  data: OnboardingData;
}

export const OnboardingSummary: React.FC<SummaryProps> = ({ data }) => {
  const { t, language } = useLanguage();
  
  const summaryItems = [
    t('onboarding.summary.item1'),
    t('onboarding.summary.item2'),
    t('onboarding.summary.item3'),
  ];

  // Count enabled workdays from weekly schedule
  const enabledDaysCount = Object.values(data.weeklySchedule).filter(d => d.enabled).length;
  
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-4">
        {summaryItems.map((item, index) => (
          <div
            key={index}
            className="flex items-center gap-4 p-4 bg-success-light rounded-xl animate-slide-up"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="w-8 h-8 rounded-full bg-success flex items-center justify-center flex-shrink-0">
              <Check className="w-5 h-5 text-success-foreground" />
            </div>
            <span className="text-foreground font-medium">{item}</span>
          </div>
        ))}
      </div>
      
      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
        <div className="text-center p-4 bg-muted/50 rounded-xl">
          <div className="text-2xl font-bold text-primary">{data.printerCount}</div>
          <div className="text-sm text-muted-foreground">
            {language === 'he' 
              ? (data.printerCount === 1 ? 'מדפסת' : 'מדפסות')
              : (data.printerCount === 1 ? 'Printer' : 'Printers')}
          </div>
        </div>
        <div className="text-center p-4 bg-muted/50 rounded-xl">
          <div className="text-2xl font-bold text-primary">{data.colors.length}</div>
          <div className="text-sm text-muted-foreground">
            {language === 'he' ? 'צבעים' : 'Colors'}
          </div>
        </div>
        <div className="text-center p-4 bg-muted/50 rounded-xl">
          <div className="text-2xl font-bold text-primary">{enabledDaysCount}</div>
          <div className="text-sm text-muted-foreground">
            {language === 'he' ? 'ימי עבודה' : 'Workdays'}
          </div>
        </div>
      </div>

      {/* AMS status */}
      {data.hasAMS && (
        <div className="p-4 bg-primary/10 rounded-xl text-center">
          <span className="text-sm font-medium text-primary">
            {language === 'he' ? '✓ יש לך AMS - תוכל להגדיר אותו בהמשך במסך המדפסות' : '✓ You have AMS - configure it later in Printers screen'}
          </span>
        </div>
      )}
    </div>
  );
};
