import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OnboardingData } from './OnboardingWizard';
import { Check } from 'lucide-react';

interface SummaryProps {
  data: OnboardingData;
}

export const OnboardingSummary: React.FC<SummaryProps> = ({ data }) => {
  const { t } = useLanguage();
  
  const summaryItems = [
    t('onboarding.summary.item1'),
    t('onboarding.summary.item2'),
    t('onboarding.summary.item3'),
  ];
  
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
            {data.printerCount === 1 ? 'מדפסת' : 'מדפסות'}
          </div>
        </div>
        <div className="text-center p-4 bg-muted/50 rounded-xl">
          <div className="text-2xl font-bold text-primary">{data.colors.length}</div>
          <div className="text-sm text-muted-foreground">צבעים</div>
        </div>
        <div className="text-center p-4 bg-muted/50 rounded-xl">
          <div className="text-2xl font-bold text-primary">{data.workdays.length}</div>
          <div className="text-sm text-muted-foreground">ימי עבודה</div>
        </div>
      </div>
    </div>
  );
};
