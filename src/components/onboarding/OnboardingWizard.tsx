import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Step1FactoryBasics } from './Step1FactoryBasics';
import { Step2AfterHours } from './Step2AfterHours';
import { Step3Materials } from './Step3Materials';
import { OnboardingSummary } from './OnboardingSummary';
import { CheckCircle2 } from 'lucide-react';
import { WeeklySchedule, getDefaultWeeklySchedule } from '@/services/storage';

export type AfterHoursBehavior = 'NONE' | 'ONE_CYCLE_END_OF_DAY' | 'FULL_AUTOMATION';

export interface PrinterAMSConfig {
  hasAMS: boolean;
  amsSlots: number;
  amsModes: {
    backupSameColor: boolean;
    multiColor: boolean;
  };
}

export interface OnboardingData {
  printerCount: number;
  printerNames: string[];
  weeklySchedule: WeeklySchedule;
  afterHoursBehavior: AfterHoursBehavior;
  colors: string[];
  spoolWeight: number;
  deliveryDays: number;
  hasAMS: boolean; // Factory-level: does any printer have AMS?
  printerAMSConfigs: PrinterAMSConfig[]; // Per-printer AMS configuration
}

interface OnboardingWizardProps {
  onComplete: (data: OnboardingData) => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const { t, direction } = useLanguage();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({
    printerCount: 1,
    printerNames: ['מדפסת 1'],
    weeklySchedule: getDefaultWeeklySchedule(),
    afterHoursBehavior: 'ONE_CYCLE_END_OF_DAY',
    colors: ['שחור', 'לבן', 'אפור', 'אדום', 'כחול', 'ירוק', 'צהוב', 'כתום', 'סגול', 'ורוד', 'חום', 'שקוף'],
    spoolWeight: 1000,
    deliveryDays: 3,
    hasAMS: false,
    printerAMSConfigs: [{ hasAMS: false, amsSlots: 4, amsModes: { backupSameColor: true, multiColor: false } }],
  });
  
  const totalSteps = 3;
  
  const updateData = (updates: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...updates }));
  };
  
  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(prev => prev + 1);
    }
  };
  
  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };
  
  const handleComplete = () => {
    onComplete(data);
  };
  
  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <Step1FactoryBasics data={data} updateData={updateData} />;
      case 1:
        return <Step2AfterHours data={data} updateData={updateData} />;
      case 2:
        return <Step3Materials data={data} updateData={updateData} />;
      case 3:
        return <OnboardingSummary data={data} />;
      default:
        return null;
    }
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center p-4 gradient-bg" dir={direction}>
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="flex justify-center mb-6">
            <LanguageSwitcher />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {t('onboarding.welcome')}
          </h1>
          <p className="text-muted-foreground text-lg">
            {t('onboarding.welcomeDesc')}
          </p>
        </div>
        
        {/* Progress indicator */}
        {currentStep < totalSteps && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {Array.from({ length: totalSteps }).map((_, idx) => (
              <div
                key={idx}
                className={`h-2 rounded-full transition-all duration-300 ${
                  idx === currentStep
                    ? 'w-8 bg-primary'
                    : idx < currentStep
                    ? 'w-2 bg-success'
                    : 'w-2 bg-muted'
                }`}
              />
            ))}
          </div>
        )}
        
        {/* Step card */}
        <Card variant="elevated" className="animate-slide-up">
          {currentStep < totalSteps && (
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle>
                  {currentStep === 0 && t('onboarding.step1.title')}
                  {currentStep === 1 && t('onboarding.step2.title')}
                  {currentStep === 2 && t('onboarding.step3.title')}
                </CardTitle>
                <span className="text-sm text-muted-foreground">
                  {t('onboarding.step')} {currentStep + 1} {t('onboarding.of')} {totalSteps}
                </span>
              </div>
            </CardHeader>
          )}
          
          {currentStep === totalSteps && (
            <CardHeader className="pb-4 text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-success-light flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-success" />
                </div>
              </div>
              <CardTitle className="text-2xl">{t('onboarding.summary.title')}</CardTitle>
            </CardHeader>
          )}
          
          <CardContent className="pt-2">
            {renderStep()}
            
            {/* Navigation buttons */}
            <div className="flex justify-between mt-8 pt-6 border-t border-border">
              {currentStep > 0 ? (
                <Button variant="ghost" onClick={handleBack}>
                  {t('common.back')}
                </Button>
              ) : (
                <div />
              )}
              
              {currentStep < totalSteps ? (
                <Button onClick={handleNext}>
                  {t('common.next')}
                </Button>
              ) : (
                <Button size="lg" onClick={handleComplete}>
                  {t('onboarding.summary.start')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
