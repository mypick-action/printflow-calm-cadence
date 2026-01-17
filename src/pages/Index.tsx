import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { usePrinters } from '@/components/hooks/usePrinters';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
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
import { Button } from '@/components/ui/button';
import { Construction, Loader2, Upload, AlertCircle } from 'lucide-react';

import { getProjects } from '@/services/cloudStorage';
import {
  hydrateLocalFromCloud,
  migrateAllLocalDataToCloud,
  FullMigrationReport,
  shouldProtectLocalCycles,
} from '@/services/cloudBridge';
import { checkAndHandleDayChange } from '@/services/dayChangeDetector';
import { KEYS, cleanupOrphanedCycles } from '@/services/storage';
import {
  syncCycleOperation,
  CycleOperationPayload,
  OperationType,
} from '@/services/cycleOperationSync';
import { toast } from 'sonner';
import { isFactorySettingsConfigured } from '@/components/services/base44FactorySettings';

interface LocalDataSummary {
  projects: number;
  cycles: number;
  products: number;
}

const PrintFlowApp: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, workspaceId } = useAuth();
  const { language } = useLanguage();
  const { printers } = usePrinters();

  const [checkingData, setCheckingData] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [printerNames, setPrinterNames] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [endCyclePrinterId, setEndCyclePrinterId] = useState<string | undefined>();
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [localDataSummary, setLocalDataSummary] = useState<LocalDataSummary | null>(null);
  const [migrating, setMigrating] = useState(false);

  /* 🔑 מקור אמת יחיד לשמות מדפסות */
  useEffect(() => {
    setPrinterNames(printers.map(p => p.name));
  }, [printers]);

  /* Redirect to auth */
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  /* Onboarding + hydration */
  useEffect(() => {
    const checkOnboarding = async () => {
      if (!workspaceId) {
        setCheckingData(false);
        return;
      }

      try {
        const isComplete = await isFactorySettingsConfigured();
        setOnboardingDone(isComplete);

        if (!isComplete) {
          setCheckingData(false);
          return;
        }

        const cloudProjects = await getProjects(workspaceId);
        const cloudHasData = cloudProjects.length > 0;

        const localProjects = JSON.parse(localStorage.getItem(KEYS.PROJECTS) || '[]');
        const localProducts = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
        const localCycles = JSON.parse(localStorage.getItem(KEYS.PLANNED_CYCLES) || '[]');

        const localHasData =
          localProjects.length > 0 ||
          localProducts.length > 0 ||
          localCycles.length > 0;

        if (cloudHasData) {
          await hydrateLocalFromCloud(workspaceId, {
            force: false,
            includeProjects: true,
            includePlannedCycles: true,
            includeProducts: true,
            includeInventory: true,
            source: 'Index-cloudHasData',
          });

          if (!shouldProtectLocalCycles()) {
            cleanupOrphanedCycles();
          }

          await runDayChangeDetection(workspaceId);
        } else if (localHasData) {
          setLocalDataSummary({
            projects: localProjects.length,
            products: localProducts.length,
            cycles: localCycles.length,
          });
          setShowMigrationPrompt(true);
          setCheckingData(false);
          return;
        }
      } catch (err) {
        console.error('[Index] onboarding check failed', err);
      }

      setCheckingData(false);
    };

    if (!authLoading && user && workspaceId) {
      checkOnboarding();
    }
  }, [user, workspaceId, authLoading]);

  const runDayChangeDetection = async (wsId: string) => {
    try {
      const result = await checkAndHandleDayChange(wsId);
      if (result.isNewDay && result.triggeredReplan) {
        toast.info(language === 'he' ? 'התכנון עודכן ליום חדש' : 'Planning updated');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMigration = async () => {
    if (!workspaceId) return;
    setMigrating(true);

    try {
      const report: FullMigrationReport =
        await migrateAllLocalDataToCloud(workspaceId);

      toast.success(
        language === 'he'
          ? `הועברו ${report.totalMigrated} פריטים לענן`
          : `Migrated ${report.totalMigrated} items`
      );

      await hydrateLocalFromCloud(workspaceId, {
        force: false,
        includeProjects: true,
        includePlannedCycles: true,
        includeProducts: true,
        includeInventory: true,
        source: 'Index-afterMigration',
      });

      await runDayChangeDetection(workspaceId);
      setShowMigrationPrompt(false);
    } catch (err) {
      toast.error(language === 'he' ? 'שגיאה בהעברה' : 'Migration failed');
    } finally {
      setMigrating(false);
    }
  };

  const handleStartFresh = () => {
    localStorage.removeItem(KEYS.PROJECTS);
    localStorage.removeItem(KEYS.PLANNED_CYCLES);
    localStorage.removeItem(KEYS.PRODUCTS);
    localStorage.removeItem(KEYS.COLOR_INVENTORY);
    localStorage.removeItem(KEYS.SPOOLS);

    setShowMigrationPrompt(false);
    toast.info(language === 'he' ? 'התחלה מחדש' : 'Starting fresh');
  };

  if (authLoading || checkingData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  if (!onboardingDone) {
    return <OnboardingContainer onFinished={() => setOnboardingDone(true)} />;
  }

  if (showMigrationPrompt && localDataSummary) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>
              {language === 'he' ? 'נמצאו נתונים מקומיים' : 'Local data found'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleMigration} disabled={migrating}>
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Button variant="outline" onClick={handleStartFresh}>
              Start fresh
            </Button>
          </CardContent>
        </Card>
      </div>
    );
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
            onEndCycle={handleEndCycle}
            onReportIssue={() => setReportIssueOpen(true)}
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
              setDashboardRefreshKey(k => k + 1);
              setCurrentPage('dashboard');
            }}
          />
        );
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
        return <div>Coming soon</div>;
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

const Index: React.FC = () => (
  <LanguageProvider>
    <PrintFlowApp />
  </LanguageProvider>
);

export default Index;
