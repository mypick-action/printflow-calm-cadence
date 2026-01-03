// Dashboard Component
// A fully derived view - calculates the daily plan from core system data
// "The Dashboard is a calculated daily schedule, not a data entry screen."

import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SpoolIcon, getSpoolColor, getSpoolTextStyle } from '@/components/icons/SpoolIcon';
import { 
  Sun, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Moon,
  Flame,
  Printer,
  Package,
  RefreshCw,
  AlertCircle,
  Info,
  Calendar,
  ClipboardCheck,
  Play,
  ChevronDown,
  Pencil,
} from 'lucide-react';
import { getPlanningMeta, updatePlannedCycle, getProducts, getProjects, updatePrinter, getPrinter } from '@/services/storage';
import { StartPrintModal } from './StartPrintModal';
import { ManualStartPrintModal } from './ManualStartPrintModal';
import { PrinterActionsModal } from './PrinterActionsModal';
import { toast } from '@/hooks/use-toast';
import { 
  calculateTodayPlan, 
  TodayPlanResult,
  DashboardCycle,
  PrinterDayPlan,
  AttentionItem,
} from '@/services/dashboardCalculator';
import { RecalculateButton } from '@/components/planning/RecalculateButton';
import { RecalculateModal } from '@/components/planning/RecalculateModal';
import { CapacityChangeBanner } from '@/components/planning/CapacityChangeBanner';
// LoadedSpoolsModal removed - spool loading happens at print start, not during planning
// NOTE: migrateLocalProjectsToCloud import removed - migration should only run once during onboarding

import { PlanningDebugPanel } from './PlanningDebugPanel';
import { SyncDebugPanel } from './SyncDebugPanel';
import { format } from 'date-fns';

interface DashboardProps {
  printerNames?: string[];
  onReportIssue?: () => void;
  onEndCycle?: (printerId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onReportIssue, onEndCycle }) => {
  const { language } = useLanguage();
  const { workspaceId } = useAuth();
  const [recalculateModalOpen, setRecalculateModalOpen] = useState(false);
  // loadedSpoolsModalOpen state removed - no longer needed
  const [planningMeta, setPlanningMeta] = useState(getPlanningMeta());
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [todayPlan, setTodayPlan] = useState<TodayPlanResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startPrintModalOpen, setStartPrintModalOpen] = useState(false);
  const [selectedCycleForStart, setSelectedCycleForStart] = useState<DashboardCycle | null>(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(null);
  const [expandedPrinters, setExpandedPrinters] = useState<Set<string>>(new Set());
  const [manualStartModalOpen, setManualStartModalOpen] = useState(false);
  const [manualStartPrinterId, setManualStartPrinterId] = useState<string | undefined>(undefined);
  const [printerActionsModalOpen, setPrinterActionsModalOpen] = useState(false);
  const [selectedPrinterForActions, setSelectedPrinterForActions] = useState<string | null>(null);
  // hasSyncedProjects state removed - migration no longer runs from Dashboard

  const openPrinterActionsModal = (printerId: string) => {
    setSelectedPrinterForActions(printerId);
    setPrinterActionsModalOpen(true);
  };

  const handleOpenManualPrint = (printerId: string) => {
    setManualStartPrinterId(printerId);
    setManualStartModalOpen(true);
  };

  const refreshData = useCallback(() => {
    setIsLoading(true);
    // Calculate the daily plan from core system data
    const plan = calculateTodayPlan(new Date());
    setTodayPlan(plan);
    setPlanningMeta(getPlanningMeta());
    setBannerDismissed(false);
    setIsLoading(false);
    
    // NOTE: LoadedSpoolsModal removed from planning flow
    // Spool loading is now handled at print start (StartPrintModal)
  }, []);

  // NOTE: Auto-migration removed to prevent duplication snowball
  // Migration should only run once during onboarding or via manual trigger in debug panel

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return language === 'he' ? 'בוקר טוב!' : 'Good morning!';
    if (hour < 17) return language === 'he' ? 'צהריים טובים!' : 'Good afternoon!';
    return language === 'he' ? 'ערב טוב!' : 'Good evening!';
  };

  const renderAttentionItem = (item: AttentionItem, index: number) => {
    const Icon = item.severity === 'error' ? Flame : AlertTriangle;
    const bgClass = item.severity === 'error' 
      ? 'bg-error/10 border-error/30 text-error' 
      : 'bg-warning/10 border-warning/30 text-warning';
    
    return (
      <div 
        key={index}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${bgClass}`}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="text-sm">
          {language === 'he' ? item.message : item.messageEn}
        </span>
      </div>
    );
  };

  const renderCycleCard = (cycle: DashboardCycle, printerId: string, index: number) => {
    const isActive = cycle.status === 'in_progress';
    const isCompleted = cycle.status === 'completed';
    const isPlanned = cycle.status === 'planned';
    
    const handleStartCycle = () => {
      // Open the start print modal - it will handle material loading
      setSelectedCycleForStart(cycle);
      setSelectedPrinterId(printerId);
      setStartPrintModalOpen(true);
    };
    
    return (
      <div 
        key={cycle.id}
        className={`
          p-3 rounded-xl border transition-all
          ${cycle.isEndOfDay 
            ? 'bg-primary/5 border-primary/30' 
            : isActive
              ? 'bg-success/5 border-success/30 ring-2 ring-success/20'
              : isCompleted
                ? 'bg-muted/30 border-border opacity-60'
                : 'bg-muted/50 border-border'
          }
        `}
      >
        <div className="flex items-center gap-4">
          <SpoolIcon color={getSpoolColor(cycle.color)} size={36} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground font-mono">
                {cycle.startTime} - {cycle.endTime}
              </span>
              {cycle.isEndOfDay && (
                <Badge variant="outline" className="gap-1 bg-primary/10 text-primary border-primary/20">
                  <Moon className="w-3 h-3" />
                  {language === 'he' ? 'מחזור סוף יום' : 'End of day'}
                </Badge>
              )}
              {cycle.isRisky && (
                <Badge variant="outline" className="gap-1 bg-warning/10 text-warning border-warning/20">
                  <AlertTriangle className="w-3 h-3" />
                  {language === 'he' ? 'סיכון' : 'Risky'}
                </Badge>
              )}
              {cycle.hasAMS && (
                <Badge variant="outline" className="gap-1 bg-success/10 text-success border-success/20">
                  AMS
                </Badge>
              )}
              {/* Readiness state badges */}
              {cycle.readinessState === 'blocked_inventory' && (
                <Badge variant="destructive" className="gap-1">
                  <Package className="w-3 h-3" />
                  {language === 'he' ? 'דורש חומר' : 'Material needed'}
                </Badge>
              )}
              {cycle.readinessState === 'waiting_for_spool' && (
                <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-600 border-amber-500/20">
                  <Package className="w-3 h-3" />
                  {language === 'he' ? 'טען גליל' : 'Load spool'}
                </Badge>
              )}
              {isActive && (
                <Badge className="bg-success text-success-foreground">
                  {language === 'he' ? 'פעיל' : 'Active'}
                </Badge>
              )}
            </div>
            <div className="font-medium text-foreground mt-1">
              {cycle.projectName}
            </div>
            <div className="text-xs text-muted-foreground">
              {cycle.productName} • {cycle.color}
            </div>
            {/* Show readiness details when not ready */}
            {cycle.readinessDetails && cycle.readinessState !== 'ready' && (
              <div className="text-xs text-amber-600 mt-1 font-medium">
                {cycle.readinessDetails}
              </div>
            )}
          </div>
          <div className="text-center flex-shrink-0">
            <div className="text-lg font-bold text-foreground">{cycle.units}</div>
            <div className="text-xs text-muted-foreground">
              {language === 'he' ? 'יחידות' : 'units'}
            </div>
          </div>
        </div>
        
        {/* Buttons for cycle management */}
        {!isCompleted && (
          <div className="flex gap-2 mt-3">
            {/* Start Print Button - only for planned cycles */}
            {isPlanned && (
              <Button 
                size="sm" 
                variant="default"
                onClick={handleStartCycle}
                className="flex-1 gap-2"
              >
                <Play className="w-4 h-4" />
                {language === 'he' ? 'התחל הדפסה' : 'Start Print'}
              </Button>
            )}
            
            {/* End Cycle Button - only for active (in_progress) cycles */}
            {isActive && onEndCycle && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => onEndCycle(printerId)}
                className="flex-1 gap-2 border-success/30 text-success hover:bg-success/10"
              >
                <ClipboardCheck className="w-4 h-4" />
                {language === 'he' ? 'סיום עבודה' : 'Mark Complete'}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  const togglePrinterExpanded = (printerId: string) => {
    setExpandedPrinters(prev => {
      const next = new Set(prev);
      if (next.has(printerId)) {
        next.delete(printerId);
      } else {
        next.add(printerId);
      }
      return next;
    });
  };

  const renderPrinterCard = (plan: PrinterDayPlan) => {
    console.log(
      '[PrinterCard]',
      plan.printer.id,
      plan.cycles.length,
      plan.cycles.map(c => c.printerId)
    );
    const hasCycles = plan.cycles.length > 0;
    const hasMultipleCycles = plan.cycles.length > 1;
    const isExpanded = expandedPrinters.has(plan.printer.id);
    const firstCycle = plan.cycles[0];
    const remainingCycles = plan.cycles.slice(1);
    
    return (
      <Card key={plan.printer.id} variant="elevated" className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg">
              <Printer className="w-5 h-5 text-primary" />
              {plan.printer.name}
            </div>
            <div className="flex items-center gap-2">
              {/* Pencil button for printer actions */}
              <Button 
                variant="ghost" 
                size="icon"
                className="h-8 w-8"
                onClick={() => openPrinterActionsModal(plan.printer.id)}
              >
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </Button>
              {plan.totalUnits > 0 && (
                <Badge variant="secondary">
                  {plan.totalUnits} {language === 'he' ? 'יחידות' : 'units'}
                </Badge>
              )}
              {plan.printer.hasAMS && (
                <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                  AMS
                </Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {hasCycles ? (
            <>
              {/* Always show first cycle */}
              {renderCycleCard(firstCycle, plan.printer.id, 0)}
              
              {/* Expandable section for additional cycles */}
              {hasMultipleCycles && (
                <Collapsible open={isExpanded} onOpenChange={() => togglePrinterExpanded(plan.printer.id)}>
                  <CollapsibleTrigger asChild>
                    <Button 
                      variant="ghost" 
                      className="w-full justify-between gap-2 text-muted-foreground hover:text-foreground"
                    >
                      <span className="text-sm">
                        {isExpanded 
                          ? (language === 'he' ? 'הסתר עבודות נוספות' : 'Hide more jobs')
                          : (language === 'he' ? `עוד ${remainingCycles.length} עבודות` : `${remainingCycles.length} more jobs`)
                        }
                      </span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 mt-3">
                    {remainingCycles.map((cycle, idx) => renderCycleCard(cycle, plan.printer.id, idx + 1))}
                  </CollapsibleContent>
                </Collapsible>
              )}
              
              {/* Leave spool instruction */}
              {plan.lastColor && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
                  <SpoolIcon color={getSpoolColor(plan.lastColor)} size={28} />
                  <span className="text-sm font-medium" style={getSpoolTextStyle(plan.lastColor)}>
                    {language === 'he' 
                      ? `השאר גליל ${plan.lastColor}` 
                      : `Leave ${plan.lastColor} spool`}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                {language === 'he' ? 'אין מחזורים מתוכננים להיום' : 'No cycles planned for today'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading || !todayPlan) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasAttentionItems = todayPlan.attentionItems.length > 0;
  const hasMissingData = todayPlan.missingData.length > 0;
  const errorAttentionItems = todayPlan.attentionItems.filter(a => a.severity === 'error');
  const warningAttentionItems = todayPlan.attentionItems.filter(a => a.severity === 'warning');

  return (
    <div className="space-y-6">
      {/* Capacity Change Banner */}
      {planningMeta.capacityChangedSinceLastRecalculation && !bannerDismissed && (
        <CapacityChangeBanner
          reason={planningMeta.lastCapacityChangeReason}
          onRecalculate={() => setRecalculateModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/* Recalculate Modal */}
      <RecalculateModal
        open={recalculateModalOpen}
        onOpenChange={setRecalculateModalOpen}
        onRecalculated={refreshData}
      />

      {/* LoadedSpoolsModal removed - spool info shown at print start */}

      {/* Header with greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-warning/10 flex items-center justify-center">
            <Sun className="w-7 h-7 text-warning" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {getGreeting()}
            </h1>
            <p className="text-muted-foreground">
              {language === 'he' ? 'תכנית העבודה להיום' : "Today's Production Plan"}
              <span className="mx-2">•</span>
              <span className="font-mono text-sm">
                {format(new Date(), 'dd/MM/yyyy')}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="default" 
            className="gap-2" 
            onClick={() => setManualStartModalOpen(true)}
          >
            <Play className="w-4 h-4" />
            {language === 'he' ? 'התחל הדפסה ידנית' : 'Manual Start'}
          </Button>
          <RecalculateButton 
            onClick={() => setRecalculateModalOpen(true)} 
            showLastCalculated={true}
          />
          <Button variant="outline" className="gap-2" onClick={onReportIssue}>
            <AlertTriangle className="w-4 h-4" />
            {language === 'he' ? 'דווח על בעיה' : 'Report Issue'}
          </Button>
        </div>
      </div>

      {/* Not a workday notice */}
      {!todayPlan.isWorkday && (
        <Card variant="glass" className="border-muted">
          <CardContent className="flex items-center justify-center gap-3 py-8">
            <Calendar className="w-6 h-6 text-muted-foreground" />
            <span className="text-lg text-muted-foreground">
              {language === 'he' ? 'היום אינו יום עבודה' : 'Today is not a workday'}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Missing data warnings */}
      {hasMissingData && (
        <Card variant="glass" className="border-warning/30">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-5 h-5 text-warning" />
              <span className="font-medium text-warning">
                {language === 'he' ? 'חסרים נתונים לתכנון' : 'Missing data for planning'}
              </span>
            </div>
            <div className="space-y-2">
              {todayPlan.missingData.map((item, idx) => (
                <div key={idx} className="text-sm text-muted-foreground flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-warning" />
                  {language === 'he' ? item.message : item.messageEn}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}


      {/* Attention items */}
      {hasAttentionItems && todayPlan.isWorkday && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {language === 'he' ? 'דורש התייחסות' : 'Needs Attention'}
          </h2>
          <div className="flex flex-wrap gap-2">
            {errorAttentionItems.map((item, idx) => renderAttentionItem(item, idx))}
            {warningAttentionItems.map((item, idx) => renderAttentionItem(item, idx + errorAttentionItems.length))}
          </div>
        </div>
      )}

      {/* Summary stats */}
      {todayPlan.isWorkday && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card variant="glass">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-primary">{todayPlan.printerPlans.length}</div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'מדפסות פעילות' : 'Active Printers'}
              </div>
            </CardContent>
          </Card>
          <Card variant="glass">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-foreground">{todayPlan.totalCycles}</div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'מחזורים להיום' : "Today's Cycles"}
              </div>
            </CardContent>
          </Card>
          <Card variant="glass">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-foreground">{todayPlan.totalUnits}</div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'יחידות מתוכננות' : 'Planned Units'}
              </div>
            </CardContent>
          </Card>
          <Card variant="glass">
            <CardContent className="p-4">
              <div className="text-lg font-bold text-muted-foreground font-mono">
                {todayPlan.workdayStart} - {todayPlan.workdayEnd}
              </div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'שעות עבודה' : 'Work Hours'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Printer cards */}
      {todayPlan.isWorkday && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {todayPlan.printerPlans.map(plan => renderPrinterCard(plan))}
        </div>
      )}

      {/* All ready status */}
      {todayPlan.isAllReady && todayPlan.isWorkday && (
        <Card variant="glass" className="border-success/30">
          <CardContent className="flex items-center justify-center gap-3 py-6">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <span className="text-lg font-medium text-success">
              {language === 'he' ? 'הכל מוכן לעבודה' : 'All ready to go'}
            </span>
          </CardContent>
        </Card>
      )}

      {/* No cycles but is workday */}
      {todayPlan.totalCycles === 0 && todayPlan.isWorkday && !hasMissingData && (
        <Card variant="glass" className="border-muted">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
            <Package className="w-12 h-12 text-muted-foreground/50" />
            <span className="text-muted-foreground">
              {language === 'he' ? 'אין מחזורים מתוכננים להיום' : 'No cycles planned for today'}
            </span>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {language === 'he' 
                ? 'הוסיפו פרויקטים עם סטטוס "בתהליך" כדי לראות תכנון יומי'
                : 'Add projects with "In Progress" status to see daily planning'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Calculation timestamp */}
      <div className="text-center text-xs text-muted-foreground">
        {language === 'he' ? 'חושב לאחרונה:' : 'Last calculated:'}{' '}
        {format(new Date(todayPlan.lastCalculatedAt), 'HH:mm:ss')}
      </div>

      {/* Debug Panel */}
      <PlanningDebugPanel />
      <SyncDebugPanel />

      {/* Start Print Modal */}
      {selectedCycleForStart && selectedPrinterId && (
        <StartPrintModal
          open={startPrintModalOpen}
          onOpenChange={(open) => {
            setStartPrintModalOpen(open);
            if (!open) {
              setSelectedCycleForStart(null);
              setSelectedPrinterId(null);
            }
          }}
          cycle={{
            id: selectedCycleForStart.id,
            projectId: selectedCycleForStart.projectId,
            projectName: selectedCycleForStart.projectName,
            productName: selectedCycleForStart.productName,
            color: selectedCycleForStart.color,
            material: selectedCycleForStart.material || 'PLA',
            gramsPerCycle: selectedCycleForStart.gramsNeeded,
            units: selectedCycleForStart.units,
            cycleHours: selectedCycleForStart.cycleHours,
          }}
          printerId={selectedPrinterId}
          onConfirm={() => {
            // Modal handles: loadSpoolOnPrinter, startPrinterJob, updatePlannedCycle, scheduleAutoReplan
            toast({
              title: language === 'he' ? 'הדפסה התחילה' : 'Print Started',
              description: language === 'he' 
                ? `מחזור ${selectedCycleForStart.projectName} סומן כפעיל`
                : `Cycle ${selectedCycleForStart.projectName} marked as active`,
            });
            refreshData();
          }}
        />
      )}

      {/* Manual Start Print Modal */}
      <ManualStartPrintModal
        open={manualStartModalOpen}
        onOpenChange={(open) => {
          setManualStartModalOpen(open);
          if (!open) setManualStartPrinterId(undefined);
        }}
        onComplete={refreshData}
        defaultPrinterId={manualStartPrinterId}
      />

      {/* Printer Actions Modal */}
      {selectedPrinterForActions && (
        <PrinterActionsModal
          open={printerActionsModalOpen}
          onOpenChange={setPrinterActionsModalOpen}
          printerId={selectedPrinterForActions}
          onComplete={refreshData}
          onOpenManualPrint={handleOpenManualPrint}
        />
      )}
    </div>
  );
};
