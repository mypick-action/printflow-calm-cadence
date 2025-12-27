import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { 
  Clock, 
  Printer, 
  Package, 
  RefreshCw,
  Calendar,
  Info,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { PlannedCycle, Printer as PrinterType } from '@/services/storage';

interface CycleWithProject extends PlannedCycle {
  projectName: string;
  projectColor: string;
}

interface DayScheduleData {
  date: Date;
  isWorkday: boolean;
  isOverride: boolean;
  startTime: string;
  endTime: string;
  cycles: CycleWithProject[];
}

interface DailyPlanDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: DayScheduleData | null;
  printers: PrinterType[];
  onRecalculateDay?: (date: Date) => void;
  onNavigateToProjects?: () => void;
}

export const DailyPlanDrawer: React.FC<DailyPlanDrawerProps> = ({
  open,
  onOpenChange,
  day,
  printers,
  onRecalculateDay,
  onNavigateToProjects,
}) => {
  const { language, direction } = useLanguage();

  if (!day) return null;

  // Group cycles by printer
  const cyclesByPrinter: Record<string, CycleWithProject[]> = {};
  printers.forEach(printer => {
    cyclesByPrinter[printer.id] = day.cycles.filter(c => c.printerId === printer.id);
  });

  const formatDayName = (date: Date) => {
    if (language === 'he') {
      return format(date, 'EEEE', { locale: he });
    }
    return format(date, 'EEEE');
  };

  const hasCycles = day.cycles.length > 0;
  
  // Calculate summary stats
  const totalUnits = day.cycles.reduce((sum, c) => sum + c.unitsPlanned, 0);
  const totalCycles = day.cycles.length;
  const endOfDayCycles = day.cycles.filter(c => c.shift === 'end_of_day').length;

  // Explanation text
  const explanationText = language === 'he'
    ? 'זה התכנון ליום הזה לפי שעות העבודה והזמינות של המדפסות. אם אין מחזורים – כנראה שלא בוצע חישוב מחדש או שאין עבודות בתהליך.'
    : "This is the plan for this day based on working hours and printer availability. If there are no cycles, either recalculation hasn't been run or there are no active jobs.";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side={direction === 'rtl' ? 'left' : 'right'} 
        className="w-full sm:max-w-lg overflow-y-auto"
      >
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2 text-xl">
            <Calendar className="w-5 h-5 text-primary" />
            {language === 'he' ? 'תכנון יומי' : 'Daily Plan'}
          </SheetTitle>
          <SheetDescription className="text-base">
            <span className="font-semibold text-foreground">
              {formatDayName(day.date)}
            </span>
            {' • '}
            {format(day.date, 'dd/MM/yyyy')}
            {day.isWorkday && (
              <>
                {' • '}
                <span className="font-mono">{day.startTime} - {day.endTime}</span>
              </>
            )}
            {day.isOverride && (
              <Badge variant="outline" className="ms-2 bg-warning/10 text-warning border-warning/30">
                {language === 'he' ? 'לוז מיוחד' : 'Special Schedule'}
              </Badge>
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Content */}
        <div className="space-y-6">
          {/* Day off state */}
          {!day.isWorkday ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Package className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-lg font-medium">
                {language === 'he' ? 'יום חופש' : 'Day Off'}
              </p>
              <p className="text-sm text-center mt-2">
                {language === 'he' 
                  ? 'ניתן להגדיר שינוי לוז זמני כדי לעבוד ביום הזה'
                  : 'You can set a temporary schedule override to work on this day'}
              </p>
            </div>
          ) : !hasCycles ? (
            /* Empty state with friendly actions */
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Package className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-lg font-medium">
                {language === 'he' ? 'אין תכנון ליום הזה עדיין' : 'No plan for this day yet'}
              </p>
              <p className="text-sm text-center mt-2 max-w-xs text-muted-foreground">
                {language === 'he' 
                  ? 'ייתכן שלא בוצע חישוב מחדש או שאין פרויקטים פעילים'
                  : 'Either recalculation has not been run or there are no active projects'}
              </p>
              
              {/* Action buttons */}
              <div className="flex flex-col gap-2 mt-6 w-full max-w-xs">
                {onRecalculateDay && (
                  <Button 
                    variant="default" 
                    className="w-full gap-2"
                    onClick={() => onRecalculateDay(day.date)}
                  >
                    <RefreshCw className="w-4 h-4" />
                    {language === 'he' ? 'חשב מחדש' : 'Recalculate'}
                  </Button>
                )}
                {onNavigateToProjects && (
                  <Button 
                    variant="outline" 
                    className="w-full gap-2"
                    onClick={onNavigateToProjects}
                  >
                    <FolderOpen className="w-4 h-4" />
                    {language === 'he' ? 'לך לפרויקטים בתהליך' : 'Go to Active Projects'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3 p-3 bg-muted/50 rounded-xl">
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground">{totalCycles}</div>
                  <div className="text-xs text-muted-foreground">
                    {language === 'he' ? 'מחזורים' : 'Cycles'}
                  </div>
                </div>
                <div className="text-center border-x border-border">
                  <div className="text-2xl font-bold text-foreground">{totalUnits}</div>
                  <div className="text-xs text-muted-foreground">
                    {language === 'he' ? 'יחידות' : 'Units'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{endOfDayCycles}</div>
                  <div className="text-xs text-muted-foreground">
                    {language === 'he' ? 'סוף יום' : 'End of Day'}
                  </div>
                </div>
              </div>

              {/* Printers with cycles */}
              {printers.map((printer) => {
                const printerCycles = cyclesByPrinter[printer.id] || [];
                
                return (
                  <div key={printer.id} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Printer className="w-5 h-5 text-primary" />
                      <h3 className="font-semibold text-foreground">{printer.name}</h3>
                      {printerCycles.length > 0 && (
                        <Badge variant="secondary" className="ms-auto">
                          {printerCycles.length} {language === 'he' ? 'מחזורים' : 'cycles'}
                        </Badge>
                      )}
                    </div>
                    
                    {printerCycles.length > 0 ? (
                      <div className="space-y-2">
                        {printerCycles.map((cycle) => (
                          <div 
                            key={cycle.id}
                            className={`
                              flex items-center gap-3 p-3 rounded-xl border transition-all
                              ${cycle.shift === 'end_of_day' 
                                ? 'bg-primary/5 border-primary/30' 
                                : 'bg-muted/50 border-border'
                              }
                            `}
                          >
                            <SpoolIcon color={getSpoolColor(cycle.projectColor)} size={32} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Clock className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground font-mono">
                                  {typeof cycle.startTime === 'string' && cycle.startTime.includes('T') 
                                    ? format(new Date(cycle.startTime), 'HH:mm')
                                    : cycle.startTime} - {typeof cycle.endTime === 'string' && cycle.endTime.includes('T')
                                    ? format(new Date(cycle.endTime), 'HH:mm')
                                    : cycle.endTime}
                                </span>
                                {cycle.shift === 'end_of_day' && (
                                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                                    {language === 'he' ? 'סוף יום' : 'End of day'}
                                  </Badge>
                                )}
                              </div>
                              <div className="font-medium text-foreground mt-1">
                                {cycle.projectName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {cycle.projectColor}
                              </div>
                            </div>
                            <div className="text-center flex-shrink-0">
                              <div className="text-lg font-bold text-foreground">{cycle.unitsPlanned}</div>
                              <div className="text-xs text-muted-foreground">
                                {language === 'he' ? 'יחידות' : 'units'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg bg-muted/30 text-center text-sm text-muted-foreground">
                        {language === 'he' ? 'אין מחזורים למדפסת זו' : 'No cycles for this printer'}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Explanation block */}
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    {explanationText}
                  </p>
                </div>
              </div>

              {/* Recalculate button for days with cycles too */}
              {onRecalculateDay && (
                <Button 
                  variant="outline" 
                  className="w-full gap-2"
                  onClick={() => onRecalculateDay(day.date)}
                >
                  <RefreshCw className="w-4 h-4" />
                  {language === 'he' ? 'חשב תכנון מחדש' : 'Recalculate Plan'}
                </Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
