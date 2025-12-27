import React, { useState, useEffect } from 'react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { OnboardingWizard, OnboardingData } from '@/components/onboarding/OnboardingWizard';
import { AppLayout } from '@/components/layout/AppLayout';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { ProjectsPage } from '@/components/projects/ProjectsPage';
import { EndCycleLog } from '@/components/end-cycle/EndCycleLog';
import { QuoteCheckPage } from '@/components/quote-check/QuoteCheckPage';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { ReportIssueFlow } from '@/components/report-issue/ReportIssueFlow';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Construction, AlertTriangle } from 'lucide-react';
import { isOnboardingComplete, completeOnboarding, saveFactorySettings } from '@/services/storage';

const PrintFlowApp: React.FC = () => {
  const { language } = useLanguage();
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [factoryData, setFactoryData] = useState<OnboardingData | null>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  
  useEffect(() => {
    if (isOnboardingComplete()) {
      setOnboardingDone(true);
    }
  }, []);
  
  const handleOnboardingComplete = (data: OnboardingData) => {
    setFactoryData(data);
    setOnboardingDone(true);
    saveFactorySettings({
      printerCount: data.printerCount,
      workdays: data.workdays,
      startTime: data.startTime,
      endTime: data.endTime,
      afterHoursBehavior: data.afterHoursBehavior,
      colors: data.colors,
      standardSpoolWeight: data.spoolWeight,
      deliveryDays: data.deliveryDays,
      transitionMinutes: 10,
      priorityRules: {
        urgentDaysThreshold: 14,
        criticalDaysThreshold: 7,
      },
    });
    completeOnboarding();
  };
  
  if (!onboardingDone) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }
  
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return (
          <>
            <Dashboard printerNames={factoryData?.printerNames || []} />
            <div className="fixed bottom-6 right-6 z-50">
              <Button 
                onClick={() => setReportIssueOpen(true)}
                className="gap-2 shadow-lg"
                variant="destructive"
              >
                <AlertTriangle className="w-4 h-4" />
                {language === 'he' ? 'דווח על בעיה' : 'Report Issue'}
              </Button>
            </div>
          </>
        );
      case 'projects':
        return <ProjectsPage />;
      case 'endCycleLog':
        return <EndCycleLog />;
      case 'quoteCheck':
        return <QuoteCheckPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return (
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Construction className="w-6 h-6 text-warning" />
                {language === 'he' ? 'בקרוב...' : 'Coming soon...'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {language === 'he' 
                  ? 'עמוד זה נמצא בפיתוח. בקרוב יהיה זמין!'
                  : 'This page is under development. Coming soon!'}
              </p>
            </CardContent>
          </Card>
        );
    }
  };
  
  return (
    <AppLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {renderPage()}
      <ReportIssueFlow 
        isOpen={reportIssueOpen} 
        onClose={() => setReportIssueOpen(false)} 
      />
    </AppLayout>
  );
};

const Index: React.FC = () => {
  return (
    <LanguageProvider>
      <PrintFlowApp />
    </LanguageProvider>
  );
};

export default Index;
