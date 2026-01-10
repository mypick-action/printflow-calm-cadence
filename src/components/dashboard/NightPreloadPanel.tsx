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

  return (
    <Card variant="glass" className={cn("border-primary/20", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Moon className="w-5 h-5 text-primary" />
            {language === 'he' ? 'הכנת לילה' : 'Night Preparation'}
          </div>
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
            {summary.totalPlatesNeeded} {language === 'he' ? 'פלטות' : 'plates'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground mb-4">
          {language === 'he' 
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
              </div>
              <Badge className="bg-primary/20 text-primary border-0">
                {plan.requiredPlates} {language === 'he' ? 'פלטות' : 'plates'}
              </Badge>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Package className="w-3 h-3" />
                <span>{plan.nightCycleCount} {language === 'he' ? 'מחזורים' : 'cycles'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{formatHours(plan.totalNightHours)}</span>
              </div>
            </div>

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
                      +{plan.cycles.length - 3} {language === 'he' ? 'נוספים' : 'more'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Summary */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/30">
          <CheckCircle2 className="w-4 h-4 text-success" />
          <span className="text-sm text-success">
            {language === 'he' 
              ? `סה"כ ${summary.totalPlatesNeeded} פלטות לטעינה`
              : `Total ${summary.totalPlatesNeeded} plates to load`}
          </span>
        </div>

        {/* Night window info */}
        {enrichedPlans[0]?.nightWindow && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Clock className="w-3 h-3" />
            <span>
              {language === 'he' ? 'חלון לילה: ' : 'Night window: '}
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
