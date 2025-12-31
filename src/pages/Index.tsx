import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { OnboardingWizard, OnboardingData } from '@/components/onboarding/OnboardingWizard';
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
import { WeeklyPlanningPage } from '@/components/weekly/WeeklyPlanningPage';
import { OperationalDashboard } from '@/components/weekly/OperationalDashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Construction, Loader2 } from 'lucide-react';
import { isOnboardingCompleteCloud, saveOnboardingToCloud, getPrinters } from '@/services/cloudStorage';
import { hydrateLocalFromCloud } from '@/services/cloudBridge';
import { toast } from 'sonner';

const PrintFlowApp: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, workspaceId } = useAuth();
  const { language } = useLanguage();
  
  const [checkingData, setCheckingData] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [printerNames, setPrinterNames] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [endCyclePrinterId, setEndCyclePrinterId] = useState<string | undefined>(undefined);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Check if onboarding is complete (has printers + factory_settings in cloud)
  useEffect(() => {
    const checkOnboarding = async () => {
      if (!workspaceId) {
        setCheckingData(false);
        return;
      }
      
      try {
        const isComplete = await isOnboardingCompleteCloud(workspaceId);
        setOnboardingDone(isComplete);
        
        // If onboarding complete, hydrate localStorage from cloud and load printer names
        if (isComplete) {
          await hydrateLocalFromCloud(workspaceId, { force: true, includeProjects: true, includePlannedCycles: true });
          const printers = await getPrinters(workspaceId);
          setPrinterNames(printers.map(p => p.name));
        }
      } catch (error) {
        console.error('Error checking onboarding status:', error);
      }
      
      setCheckingData(false);
    };
    
    if (!authLoading && user && workspaceId) {
      checkOnboarding();
    }
  }, [user, workspaceId, authLoading]);
  
  const handleOnboardingComplete = async (data: OnboardingData) => {
    if (!workspaceId) {
      toast.error(language === 'he' ? 'שגיאה: לא נמצא workspace' : 'Error: No workspace found');
      return;
    }
    
    // Convert WeeklySchedule to plain object for cloud storage
    const weeklyScheduleObj = JSON.parse(JSON.stringify(data.weeklySchedule));
    
    // Save to cloud with workspaceId
    const success = await saveOnboardingToCloud(workspaceId, {
      weeklySchedule: weeklyScheduleObj,
      afterHoursBehavior: data.afterHoursBehavior,
      transitionMinutes: 10,
      printers: data.printerNames.map((name, index) => ({
        name,
        hasAMS: data.printerAMSConfigs[index]?.hasAMS || false,
        amsSlots: data.printerAMSConfigs[index]?.amsSlots,
        amsBackupMode: data.printerAMSConfigs[index]?.amsModes?.backupSameColor,
        amsMultiColor: data.printerAMSConfigs[index]?.amsModes?.multiColor,
      })),
    });
    
    if (success) {
      // Hydrate localStorage from cloud so engines can work
      await hydrateLocalFromCloud(workspaceId, { force: true, includeProjects: true, includePlannedCycles: true });
      
      toast.success(language === 'he' ? 'ההגדרות נשמרו בהצלחה!' : 'Settings saved successfully!');
      setPrinterNames(data.printerNames);
      setOnboardingDone(true);
    } else {
      toast.error(language === 'he' ? 'שגיאה בשמירת ההגדרות' : 'Error saving settings');
    }
  };

  // Show loading while checking auth
  if (authLoading || checkingData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">{language === 'he' ? 'טוען...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  // If not logged in, will redirect (handled by useEffect)
  if (!user) {
    return null;
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
            key={dashboardRefreshKey}
            printerNames={printerNames} 
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
              setDashboardRefreshKey(prev => prev + 1);
              setCurrentPage('dashboard');
            }}
          />
        );
      case 'quoteCheck':
        return <QuoteCheckPage />;
      case 'planning':
        return <PlanningPage onEndCycle={handleEndCycle} />;
      case 'weekly':
        return <WeeklyPlanningPage onNavigateToProject={() => setCurrentPage('projects')} />;
      case 'operationalDashboard':
        return (
          <OperationalDashboard 
            onNavigateToProject={() => setCurrentPage('projects')}
            onNavigateToWeekly={() => setCurrentPage('weekly')}
          />
        );
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
