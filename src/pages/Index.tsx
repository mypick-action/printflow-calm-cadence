import React, { useState, useEffect } from 'react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { NavigationProvider } from '@/contexts/NavigationContext';
import { OnboardingWizard, OnboardingData } from '@/components/onboarding/OnboardingWizard';
import { BootstrapScreen } from '@/components/bootstrap/BootstrapScreen';
import { AppLayout } from '@/components/layout/AppLayout';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { ProjectsPage } from '@/components/projects/ProjectsPage';
import { ProductsPage } from '@/components/products/ProductsPage';
import { PrintersPage } from '@/components/printers/PrintersPage';
import { InventoryPage } from '@/components/inventory/InventoryPage';
import { EndCycleLog } from '@/components/end-cycle/EndCycleLog';
import { QuoteCheckPage } from '@/components/quote-check/QuoteCheckPage';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { PlanningPage } from '@/components/planning/PlanningPage';
import { ReportIssueFlow } from '@/components/report-issue/ReportIssueFlow';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Construction } from 'lucide-react';
import { 
  isOnboardingComplete, 
  completeOnboarding, 
  saveFactorySettings,
  isBootstrapped,
  bootstrapFresh,
  bootstrapWithDemo,
} from '@/services/storage';

const PrintFlowApp: React.FC = () => {
  const { language } = useLanguage();
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [factoryData, setFactoryData] = useState<OnboardingData | null>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [endCyclePrinterId, setEndCyclePrinterId] = useState<string | undefined>(undefined);
  
  useEffect(() => {
    // Check bootstrap status first
    const isBootstrapDone = isBootstrapped();
    setBootstrapped(isBootstrapDone);
    
    if (isBootstrapDone && isOnboardingComplete()) {
      setOnboardingDone(true);
    }
  }, []);

  const handleBootstrapFresh = () => {
    bootstrapFresh();
    setBootstrapped(true);
    // Will show onboarding next
  };

  const handleBootstrapDemo = () => {
    bootstrapWithDemo();
    setBootstrapped(true);
    // Will show onboarding next
  };
  
  const handleOnboardingComplete = (data: OnboardingData) => {
    setFactoryData(data);
    setOnboardingDone(true);
    saveFactorySettings(
      {
        printerCount: data.printerCount,
        weeklySchedule: data.weeklySchedule,
        afterHoursBehavior: data.afterHoursBehavior,
        colors: data.colors,
        standardSpoolWeight: data.spoolWeight,
        deliveryDays: data.deliveryDays,
        transitionMinutes: 10,
        priorityRules: {
          urgentDaysThreshold: 14,
          criticalDaysThreshold: 7,
        },
        hasAMS: data.hasAMS,
      },
      data.printerNames,
      data.printerAMSConfigs
    );
    completeOnboarding();
  };

  // Show loading while checking bootstrap status
  if (bootstrapped === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Show bootstrap screen if not bootstrapped
  if (!bootstrapped) {
    return (
      <BootstrapScreen 
        onStartFresh={handleBootstrapFresh}
        onLoadDemo={handleBootstrapDemo}
      />
    );
  }
  
  // Show onboarding if not complete
  if (!onboardingDone) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }
  
  const handleEndCycle = (printerId: string) => {
    setEndCyclePrinterId(printerId);
    setCurrentPage('endCycleLog');
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return (
          <Dashboard 
            printerNames={factoryData?.printerNames || []} 
            onReportIssue={() => setReportIssueOpen(true)}
            onEndCycle={handleEndCycle}
          />
        );
      case 'projects':
        return <ProjectsPage />;
      case 'products':
        return <ProductsPage />;
      case 'printers':
        return <PrintersPage />;
      case 'inventory':
        return <InventoryPage />;
      case 'endCycleLog':
        return (
          <EndCycleLog 
            preSelectedPrinterId={endCyclePrinterId}
            onComplete={() => {
              setEndCyclePrinterId(undefined);
              setCurrentPage('dashboard');
            }}
          />
        );
      case 'quoteCheck':
        return <QuoteCheckPage />;
      case 'planning':
        return <PlanningPage />;
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
    <NavigationProvider currentPage={currentPage} onNavigate={setCurrentPage}>
      <AppLayout currentPage={currentPage} onNavigate={setCurrentPage}>
        {renderPage()}
        <ReportIssueFlow 
          isOpen={reportIssueOpen} 
          onClose={() => setReportIssueOpen(false)} 
        />
      </AppLayout>
    </NavigationProvider>
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
