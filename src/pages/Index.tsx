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
import { Button } from '@/components/ui/button';
import { Construction, Loader2, Upload, AlertCircle } from 'lucide-react';
import { isOnboardingCompleteCloud, saveOnboardingToCloud, getPrinters, getProjects } from '@/services/cloudStorage';
import { hydrateLocalFromCloud, migrateAllLocalDataToCloud, FullMigrationReport } from '@/services/cloudBridge';
import { checkAndHandleDayChange } from '@/services/dayChangeDetector';
import { KEYS, cleanupOrphanedCycles } from '@/services/storage';
import { toast } from 'sonner';

interface LocalDataSummary {
  projects: number;
  cycles: number;
  products: number;
}

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
  
  // Migration prompt state
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [localDataSummary, setLocalDataSummary] = useState<LocalDataSummary | null>(null);
  const [migrating, setMigrating] = useState(false);

  // Listen for sync-cycles-skipped events and show toast
  useEffect(() => {
    const handleSyncSkipped = (e: CustomEvent<{ skipped: number; projects: string[] }>) => {
      const { skipped, projects } = e.detail;
      toast.error(
        language === 'he'
          ? `${skipped} מחזורים לא סונכרנו - פרויקטים לא קיימים: ${projects.slice(0, 3).join(', ')}${projects.length > 3 ? '...' : ''}`
          : `${skipped} cycles not synced - orphaned projects: ${projects.slice(0, 3).join(', ')}${projects.length > 3 ? '...' : ''}`
      );
    };
    
    window.addEventListener('sync-cycles-skipped', handleSyncSkipped as EventListener);
    return () => window.removeEventListener('sync-cycles-skipped', handleSyncSkipped as EventListener);
  }, [language]);

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
        
        // If onboarding complete, check migration and hydration
        if (isComplete) {
          // A. Check if Cloud has data
          const cloudProjects = await getProjects(workspaceId);
          const cloudHasData = cloudProjects.length > 0;
          
          // B. Check if localStorage has data
          const localProjectsRaw = localStorage.getItem(KEYS.PROJECTS);
          const localCyclesRaw = localStorage.getItem(KEYS.PLANNED_CYCLES);
          const localProductsRaw = localStorage.getItem(KEYS.PRODUCTS);
          
          const localProjects = localProjectsRaw ? JSON.parse(localProjectsRaw) : [];
          const localCycles = localCyclesRaw ? JSON.parse(localCyclesRaw) : [];
          const localProducts = localProductsRaw ? JSON.parse(localProductsRaw) : [];
          const localHasData = localProjects.length > 0 || localProducts.length > 0;
          
          console.log('[Index] Data check:', { cloudHasData, localHasData, cloudProjects: cloudProjects.length, localProjects: localProjects.length });
          
          // C. Migration decision logic
          if (cloudHasData) {
            // Cloud has data → ALWAYS hydrate from Cloud (no auto-migration)
            console.log('[Index] Cloud has data → hydrating from cloud');
            await hydrateLocalFromCloud(workspaceId, { 
              force: true, 
              includeProjects: true, 
              includePlannedCycles: true, 
              includeProducts: true, 
              includeInventory: true,
            });
            
            // Cleanup any orphaned cycles after hydration
            const cleanupResult = cleanupOrphanedCycles();
            if (cleanupResult.removed > 0) {
              console.log(`[Index] Cleaned up ${cleanupResult.removed} orphaned cycles`);
            }
            
            // Run day-change detection after hydration
            await runDayChangeDetection(workspaceId);
            
          } else if (localHasData) {
            // Cloud empty + Local has data → Show migration prompt
            console.log('[Index] Cloud empty + local has data → showing migration prompt');
            setLocalDataSummary({
              projects: localProjects.length,
              cycles: localCycles.length,
              products: localProducts.length,
            });
            setShowMigrationPrompt(true);
            setCheckingData(false);
            return; // Don't continue - wait for user decision
            
          } else {
            // Both empty → just hydrate (will get empty data)
            console.log('[Index] Both empty → hydrating from cloud');
            await hydrateLocalFromCloud(workspaceId, { 
              force: true, 
              includeProjects: true, 
              includePlannedCycles: true, 
              includeProducts: true, 
              includeInventory: true,
            });
          }
          
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
  
  // Day-change detection helper
  const runDayChangeDetection = async (wsId: string) => {
    try {
      const result = await checkAndHandleDayChange(wsId);
      
      if (result.isNewDay) {
        if (result.triggeredReplan && result.replanSuccess) {
          toast.info(language === 'he' ? 'התכנון עודכן ליום חדש' : 'Planning updated for new day');
        } else if (result.wasLocked) {
          // Another device handled it - refresh data
          console.log('[Index] Day change handled by another device, refreshing data');
          await hydrateLocalFromCloud(wsId, { 
            force: true, 
            includeProjects: true, 
            includePlannedCycles: true, 
            includeProducts: true, 
            includeInventory: true,
          });
        }
      }
    } catch (error) {
      console.error('[Index] Day change detection error:', error);
    }
  };
  
  // Handle migration from prompt
  const handleMigration = async () => {
    if (!workspaceId) return;
    
    setMigrating(true);
    try {
      const report: FullMigrationReport = await migrateAllLocalDataToCloud(workspaceId);
      
      console.log('[Index] Migration report:', report);
      toast.success(
        language === 'he' 
          ? `הועברו ${report.totalMigrated} פריטים לענן` 
          : `Migrated ${report.totalMigrated} items to cloud`
      );
      
      // Hydrate from cloud after migration
      await hydrateLocalFromCloud(workspaceId, { 
        force: true, 
        includeProjects: true, 
        includePlannedCycles: true, 
        includeProducts: true, 
        includeInventory: true,
      });
      
      // Run day-change detection
      await runDayChangeDetection(workspaceId);
      
      const printers = await getPrinters(workspaceId);
      setPrinterNames(printers.map(p => p.name));
      
      setShowMigrationPrompt(false);
    } catch (error) {
      console.error('[Index] Migration error:', error);
      toast.error(language === 'he' ? 'שגיאה בהעברת הנתונים' : 'Error migrating data');
    } finally {
      setMigrating(false);
    }
  };
  
  // Handle "Start Fresh" - skip migration
  const handleStartFresh = async () => {
    if (!workspaceId) return;
    
    // Clear local data to start fresh
    localStorage.removeItem(KEYS.PROJECTS);
    localStorage.removeItem(KEYS.PLANNED_CYCLES);
    localStorage.removeItem(KEYS.PRODUCTS);
    localStorage.removeItem(KEYS.COLOR_INVENTORY);
    localStorage.removeItem(KEYS.SPOOLS);
    
    const printers = await getPrinters(workspaceId);
    setPrinterNames(printers.map(p => p.name));
    
    setShowMigrationPrompt(false);
    toast.info(language === 'he' ? 'התחלת מחדש - הנתונים המקומיים נמחקו' : 'Starting fresh - local data cleared');
  };
  
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
      await hydrateLocalFromCloud(workspaceId, { force: true, includeProjects: true, includePlannedCycles: true, includeProducts: true, includeInventory: true });
      
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
  
  // Show migration prompt if local data found but cloud is empty
  if (showMigrationPrompt && localDataSummary) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir={language === 'he' ? 'rtl' : 'ltr'}>
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-warning" />
              {language === 'he' ? 'נמצאו נתונים מקומיים' : 'Local Data Found'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-foreground">
              {language === 'he' 
                ? `נמצאו ${localDataSummary.projects} פרויקטים, ${localDataSummary.products} מוצרים ו-${localDataSummary.cycles} מחזורים במכשיר זה.`
                : `Found ${localDataSummary.projects} projects, ${localDataSummary.products} products and ${localDataSummary.cycles} cycles on this device.`
              }
            </p>
            <p className="text-sm text-muted-foreground">
              {language === 'he'
                ? 'לייבא לענן? (פעולה חד־פעמית)'
                : 'Import to cloud? (One-time operation)'
              }
            </p>
            <div className="flex gap-3 pt-2">
              <Button 
                onClick={handleMigration}
                disabled={migrating}
                className="flex-1"
              >
                {migrating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                <Upload className="w-4 h-4 mr-2" />
                {language === 'he' ? 'כן, לייבא' : 'Yes, Import'}
              </Button>
              <Button 
                variant="outline"
                onClick={handleStartFresh}
                disabled={migrating}
                className="flex-1"
              >
                {language === 'he' ? 'התחל מחדש' : 'Start Fresh'}
              </Button>
            </div>
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
