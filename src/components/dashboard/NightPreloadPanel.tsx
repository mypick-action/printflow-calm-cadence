import React, { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Moon, 
  Printer as PrinterIcon, 
  Package,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  calculateNightPreload,
  NightPreloadPlan,
} from '@/services/nightPreloadCalculator';
import {
  getProjectsSync,
  findProjectById,
} from '@/services/storage';

interface NightPreloadPanelProps {
  date?: Date;
  className?: string;
}

export const NightPreloadPanel: React.FC<NightPreloadPanelProps> = ({
  date = new Date(),
  className,
}) => {
  const { language } = useLanguage();

  const { summary, enrichedPlans } = useMemo(() => {
    const summary = calculateNightPreload(date);
    const projects = getProjectsSync();

    // Enrich plans with project names
    const enrichedPlans = summary.printers.map(plan => ({
      ...plan,
      cycles: plan.cycles.map(cycle => {
        const project = findProjectById(projects, cycle.projectName);
        return {
          ...cycle,
          projectName: project?.name || cycle.projectName,
          color: project?.color || '',
        };
      }),
    }));

    return { summary, enrichedPlans };
  }, [date]);

  // Don't show if no night work
  if (!summary.hasNightWork) {
    return null;
  }

  const formatHours = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  const isHebrew = language === 'he';

  return (
    <Card variant="glass" className={cn("border-primary/20", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Moon className="w-5 h-5 text-primary" />
            {isHebrew ? 'הכנת לילה' : 'Night Preparation'}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
              {summary.totalPlatesAllocated} / {summary.globalPlateInventory} {isHebrew ? 'פלטות' : 'plates'}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground mb-4">
          {isHebrew 
            ? 'לפני היציאה, טען את הפלטות הבאות:'
            : 'Before leaving, load the following plates:'}
        </div>

        {enrichedPlans.map(plan => (
          <div 
            key={plan.printerId}
            className="p-4 rounded-lg border bg-card/50"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <PrinterIcon className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{plan.printerName}</span>
                {/* Color lock indicator for non-AMS printers */}
                {!plan.hasAMS && plan.physicalLockedColor && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="w-3 h-3" />
                    <span 
                      className="w-3 h-3 rounded-full border"
                      style={{ backgroundColor: plan.physicalLockedColor }}
                    />
                  </div>
                )}
              </div>
              <Badge className="bg-primary/20 text-primary border-0">
                {plan.allocatedPlates} {isHebrew ? 'פלטות' : 'plates'}
              </Badge>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Package className="w-3 h-3" />
                <span>{plan.nightCycleCount} {isHebrew ? 'מחזורים' : 'cycles'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{formatHours(plan.totalNightHours)}</span>
              </div>
            </div>

            {/* Show deferred cycles warning */}
            {plan.deferredCycles > 0 && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded bg-warning/10 text-warning text-xs">
                <AlertTriangle className="w-3 h-3" />
                <span>
                  {isHebrew 
                    ? `${plan.deferredCycles} מחזורים נדחו ליום הבא (מגבלת פלטות)`
                    : `${plan.deferredCycles} cycles deferred to tomorrow (plate limit)`}
                </span>
              </div>
            )}

            {plan.cycles.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <div className="text-xs text-muted-foreground">
                  {plan.cycles.slice(0, 3).map((cycle, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-muted-foreground/50" 
                            style={{ backgroundColor: cycle.color || undefined }} />
                      <span>{cycle.projectName}</span>
                      <span className="text-muted-foreground/60">
                        ({formatHours(cycle.cycleHours)})
                      </span>
                    </div>
                  ))}
                  {plan.cycles.length > 3 && (
                    <div className="text-muted-foreground/60">
                      +{plan.cycles.length - 3} {isHebrew ? 'נוספים' : 'more'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Global constraint warning */}
        {summary.isGloballyConstrained && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span className="text-sm text-warning">
              {isHebrew 
                ? `מגבלת פלטות גלובלית: ${summary.totalCyclesDeferred} מחזורים נדחו ליום הבא`
                : `Global plate limit: ${summary.totalCyclesDeferred} cycles deferred to tomorrow`}
            </span>
          </div>
        )}

        {/* Summary */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/30">
          <CheckCircle2 className="w-4 h-4 text-success" />
          <span className="text-sm text-success">
            {isHebrew 
              ? `סה"כ ${summary.totalPlatesAllocated} פלטות לטעינה (מתוך ${summary.globalPlateInventory} במלאי)`
              : `Total ${summary.totalPlatesAllocated} plates to load (from ${summary.globalPlateInventory} in inventory)`}
          </span>
        </div>

        {/* Night window info */}
        {enrichedPlans[0]?.nightWindow && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Clock className="w-3 h-3" />
            <span>
              {isHebrew ? 'חלון לילה: ' : 'Night window: '}
              {formatHours(enrichedPlans[0].nightWindow.totalHours)}
              {' ('}
              {enrichedPlans[0].nightWindow.start.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
              {' - '}
              {enrichedPlans[0].nightWindow.end.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
              {')'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
