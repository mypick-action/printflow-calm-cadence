// Dashboard Component
// A fully derived view - calculates the daily plan from core system data
// "The Dashboard is a calculated daily schedule, not a data entry screen."

import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
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
} from 'lucide-react';
import { getPlanningMeta } from '@/services/storage';
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
import { format } from 'date-fns';

interface DashboardProps {
  printerNames?: string[];
  onReportIssue?: () => void;
  onEndCycle?: (printerId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onReportIssue, onEndCycle }) => {
  const { language } = useLanguage();
  const [recalculateModalOpen, setRecalculateModalOpen] = useState(false);
  const [planningMeta, setPlanningMeta] = useState(getPlanningMeta());
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [todayPlan, setTodayPlan] = useState<TodayPlanResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshData = useCallback(() => {
    setIsLoading(true);
    // Calculate the daily plan from core system data
    const plan = calculateTodayPlan(new Date());
    setTodayPlan(plan);
    setPlanningMeta(getPlanningMeta());
    setBannerDismissed(false);
    setIsLoading(false);
  }, []);

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
          </div>
          <div className="text-center flex-shrink-0">
            <div className="text-lg font-bold text-foreground">{cycle.units}</div>
            <div className="text-xs text-muted-foreground">
              {language === 'he' ? 'יחידות' : 'units'}
            </div>
          </div>
        </div>
        
        {/* End Cycle Button - show for active or planned cycles */}
        {isActive && !isCompleted && onEndCycle && (
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => onEndCycle(printerId)}
            className="w-full mt-3 gap-2 border-success/30 text-success hover:bg-success/10"
          >
            <ClipboardCheck className="w-4 h-4" />
            {language === 'he' ? 'סיים מחזור' : 'End Cycle'}
          </Button>
        )}
      </div>
    );
  };

  const renderPrinterCard = (plan: PrinterDayPlan) => {
    const hasCycles = plan.cycles.length > 0;
    
    return (
      <Card key={plan.printer.id} variant="elevated" className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg">
              <Printer className="w-5 h-5 text-primary" />
              {plan.printer.name}
            </div>
            <div className="flex items-center gap-2">
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
              {plan.cycles.map((cycle, idx) => renderCycleCard(cycle, plan.printer.id, idx))}
              
              {/* Leave spool instruction */}
              {plan.lastColor && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-success/5 border border-success/30">
                  <SpoolIcon color={getSpoolColor(plan.lastColor)} size={28} />
                  <span className="text-sm font-medium text-success">
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
    </div>
  );
};
