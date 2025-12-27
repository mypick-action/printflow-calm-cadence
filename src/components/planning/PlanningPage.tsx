import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format, addDays, startOfWeek, isSameDay, isWithinInterval, parseISO } from 'date-fns';
import { 
  CalendarDays, 
  ChevronLeft, 
  ChevronRight,
  Clock,
  Printer,
  Moon,
  Sun,
  Settings2,
  Trash2,
  Info,
  RefreshCw,
} from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { 
  getFactorySettings, 
  getPrinters, 
  getPlannedCycles,
  getProject,
  getPlanningMeta,
  FactorySettings,
  Printer as PrinterType,
  PlannedCycle
} from '@/services/storage';
import { RecalculateButton } from './RecalculateButton';
import { RecalculateModal } from './RecalculateModal';
import { CapacityChangeBanner } from './CapacityChangeBanner';
import { DailyPlanDrawer } from './DailyPlanDrawer';
import { TemporaryOverrideModal } from './TemporaryOverrideModal';
import { toast } from '@/hooks/use-toast';

interface DayOverride {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

interface WeekOverride {
  id: string;
  startDate: string;
  endDate: string;
  days: {
    sunday: DayOverride;
    monday: DayOverride;
    tuesday: DayOverride;
    wednesday: DayOverride;
    thursday: DayOverride;
    friday: DayOverride;
    saturday: DayOverride;
  };
}

interface DaySchedule {
  date: Date;
  isWorkday: boolean;
  isOverride: boolean;
  startTime: string;
  endTime: string;
  cycles: (PlannedCycle & { projectName: string; projectColor: string })[];
}

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAYS_LABELS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYS_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STORAGE_KEY = 'printflow_week_overrides';

export const PlanningPage: React.FC = () => {
  const { language } = useLanguage();
  const [settings, setSettings] = useState<FactorySettings | null>(null);
  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [plannedCycles, setPlannedCycles] = useState<PlannedCycle[]>([]);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [overrides, setOverrides] = useState<WeekOverride[]>([]);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [recalculateModalOpen, setRecalculateModalOpen] = useState(false);
  const [planningMeta, setPlanningMeta] = useState(getPlanningMeta());
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selectedDay, setSelectedDay] = useState<DaySchedule | null>(null);
  const [dailyDrawerOpen, setDailyDrawerOpen] = useState(false);
  // For mobile info popovers
  const [recalculateInfoOpen, setRecalculateInfoOpen] = useState(false);
  const [overrideInfoOpen, setOverrideInfoOpen] = useState(false);

  const refreshData = () => {
    setSettings(getFactorySettings());
    setPrinters(getPrinters().filter(p => p.status === 'active'));
    setPlannedCycles(getPlannedCycles());
    setPlanningMeta(getPlanningMeta());
    setBannerDismissed(false);
  };

  useEffect(() => {
    refreshData();
    
    // Load overrides from localStorage
    const savedOverrides = localStorage.getItem(STORAGE_KEY);
    if (savedOverrides) {
      setOverrides(JSON.parse(savedOverrides));
    }
  }, []);

  const saveOverrides = (newOverrides: WeekOverride[]) => {
    setOverrides(newOverrides);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newOverrides));
  };

  const handleSaveOverride = (override: WeekOverride) => {
    // Remove any existing override for the same date range and add new one
    const filtered = overrides.filter(o => 
      !(o.startDate === override.startDate && o.endDate === override.endDate)
    );
    saveOverrides([...filtered, override]);
    toast({
      title: language === 'he' ? 'שינוי לוז נשמר' : 'Schedule override saved',
      description: language === 'he' 
        ? 'השינוי יחול על הימים שנבחרו'
        : 'Override will apply to selected days',
    });
  };

  const handleRemoveOverride = (id: string) => {
    saveOverrides(overrides.filter(o => o.id !== id));
  };

  const getWeekDays = (): DaySchedule[] => {
    const days: DaySchedule[] = [];
    
    for (let i = 0; i < 7; i++) {
      const date = addDays(currentWeekStart, i);
      const dayName = DAYS_OF_WEEK[date.getDay()];
      
      // Check if this day is a regular workday from weekly schedule
      let isWorkday = false;
      let startTime = '08:00';
      let endTime = '17:00';
      
      if (settings?.weeklySchedule) {
        const daySchedule = settings.weeklySchedule[dayName];
        if (daySchedule) {
          isWorkday = daySchedule.enabled;
          startTime = daySchedule.startTime;
          endTime = daySchedule.endTime;
        }
      } else if (settings?.workdays) {
        // Legacy support
        isWorkday = settings.workdays.includes(dayName);
        startTime = settings.startTime || '08:00';
        endTime = settings.endTime || '17:00';
      }
      
      let isOverride = false;
      
      // Check for week overrides
      for (const override of overrides) {
        const overrideStart = parseISO(override.startDate);
        const overrideEnd = parseISO(override.endDate);
        
        if (isWithinInterval(date, { start: overrideStart, end: overrideEnd })) {
          const dayOverride = override.days[dayName];
          if (dayOverride) {
            isWorkday = dayOverride.enabled;
            startTime = dayOverride.startTime;
            endTime = dayOverride.endTime;
            isOverride = true;
          }
        }
      }
      
      // Get cycles for this day
      const dayCycles = plannedCycles
        .filter(cycle => {
          const cycleDate = new Date(cycle.startTime);
          return isSameDay(cycleDate, date);
        })
        .map(cycle => {
          const project = getProject(cycle.projectId);
          return {
            ...cycle,
            projectName: project?.name || 'Unknown',
            projectColor: project?.color || 'Gray',
          };
        });
      
      days.push({
        date,
        isWorkday,
        isOverride,
        startTime,
        endTime,
        cycles: dayCycles,
      });
    }
    
    return days;
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    setCurrentWeekStart(prev => addDays(prev, direction === 'next' ? 7 : -7));
  };

  const calculateDailyCapacity = (day: DaySchedule): number => {
    if (!day.isWorkday || !settings) return 0;
    
    const start = parseFloat(day.startTime.replace(':', '.')) * (100/60);
    const end = parseFloat(day.endTime.replace(':', '.')) * (100/60);
    const hours = end - start;
    
    // Assume average 3-hour cycle with 8 units per cycle
    const cyclesPerPrinter = Math.floor(hours / 3);
    return cyclesPerPrinter * 8 * printers.length;
  };

  const handleDayClick = (day: DaySchedule) => {
    setSelectedDay(day);
    setDailyDrawerOpen(true);
  };

  const handleRecalculateDay = (date: Date) => {
    // For now, just trigger full recalculation
    // In the future, this could be day-specific
    setDailyDrawerOpen(false);
    setRecalculateModalOpen(true);
  };

  const weekDays = getWeekDays();
  const dayLabels = language === 'he' ? DAYS_LABELS_HE : DAYS_LABELS_EN;

  // Get end-of-day cycles for each printer
  const getEndOfDayCycles = (day: DaySchedule) => {
    return day.cycles.filter(c => c.shift === 'end_of_day');
  };

  // Tooltip content
  const recalculateTooltipText = language === 'he' 
    ? 'מחשב מחדש את התכנון לפי: פרויקטים פתוחים, זמינות מדפסות, שעות עבודה, וזמינות פילמנט.\nלא מוחק נתונים — רק מייצר לוז חדש.'
    : "Rebuilds the plan based on active projects, printer availability, work hours, and filament inventory.\nIt doesn't delete data — it only generates a new schedule.";

  const overrideTooltipText = language === 'he'
    ? 'שינוי זמני לשבוע הזה בלבד (למשל לעבוד עד 21:00 או לפתוח שישי).\nבסוף הטווח הכל חוזר אוטומטית להגדרות הרגילות.'
    : 'Temporary override for this week only (e.g., work until 21:00 or open Friday).\nAfter the date range ends, it automatically returns to default settings.';

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

      {/* Temporary Override Modal */}
      <TemporaryOverrideModal
        open={overrideModalOpen}
        onOpenChange={setOverrideModalOpen}
        onSave={handleSaveOverride}
      />

      {/* Daily Plan Drawer */}
      <DailyPlanDrawer
        open={dailyDrawerOpen}
        onOpenChange={setDailyDrawerOpen}
        day={selectedDay}
        printers={printers}
        onRecalculateDay={handleRecalculateDay}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <CalendarDays className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {language === 'he' ? 'תכנון שבועי' : 'Weekly Planning'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {language === 'he' ? 'לחצו על יום לצפייה בתכנון מפורט' : 'Click a day to view detailed plan'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Recalculate Button with Tooltip */}
          <div className="flex items-center">
            <RecalculateButton 
              onClick={() => setRecalculateModalOpen(true)} 
              showLastCalculated={true}
            />
            {/* Desktop tooltip */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="hidden sm:flex h-8 w-8">
                  <Info className="w-4 h-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line">
                {recalculateTooltipText}
              </TooltipContent>
            </Tooltip>
            {/* Mobile popover */}
            <Popover open={recalculateInfoOpen} onOpenChange={setRecalculateInfoOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="sm:hidden h-8 w-8">
                  <Info className="w-4 h-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 text-sm">
                {recalculateTooltipText}
              </PopoverContent>
            </Popover>
          </div>

          {/* Override Button with Tooltip */}
          <div className="flex items-center">
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={() => setOverrideModalOpen(true)}
            >
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline">
                {language === 'he' ? 'שינוי לוז זמני' : 'Temporary Override'}
              </span>
            </Button>
            {/* Desktop tooltip */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="hidden sm:flex h-8 w-8">
                  <Info className="w-4 h-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line">
                {overrideTooltipText}
              </TooltipContent>
            </Tooltip>
            {/* Mobile popover */}
            <Popover open={overrideInfoOpen} onOpenChange={setOverrideInfoOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="sm:hidden h-8 w-8">
                  <Info className="w-4 h-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 text-sm">
                {overrideTooltipText}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* Active Overrides */}
      {overrides.length > 0 && (
        <Card variant="glass" className="border-warning/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 className="w-4 h-4 text-warning" />
              <span className="font-medium text-sm">
                {language === 'he' ? 'שינויי לוז פעילים' : 'Active Schedule Overrides'}
              </span>
            </div>
            <div className="space-y-2">
              {overrides.map((override) => {
                const enabledDays = Object.entries(override.days)
                  .filter(([_, v]) => v.enabled)
                  .map(([k, _]) => {
                    const idx = DAYS_OF_WEEK.indexOf(k as typeof DAYS_OF_WEEK[number]);
                    return language === 'he' ? DAYS_LABELS_HE[idx] : DAYS_LABELS_EN[idx];
                  });

                return (
                  <div key={override.id} className="flex items-center justify-between p-3 bg-background rounded-lg">
                    <div className="text-sm">
                      <span className="font-medium">
                        {format(parseISO(override.startDate), 'dd/MM')} - {format(parseISO(override.endDate), 'dd/MM')}
                      </span>
                      <span className="text-muted-foreground mx-2">•</span>
                      <span className="text-muted-foreground">
                        {enabledDays.join(', ')}
                      </span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => handleRemoveOverride(override.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-error"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigateWeek('prev')} className="gap-1">
          <ChevronLeft className="w-4 h-4" />
          {language === 'he' ? 'שבוע קודם' : 'Previous'}
        </Button>
        <h2 className="text-lg font-semibold">
          {format(currentWeekStart, 'dd MMM')} - {format(addDays(currentWeekStart, 6), 'dd MMM yyyy')}
        </h2>
        <Button variant="ghost" onClick={() => navigateWeek('next')} className="gap-1">
          {language === 'he' ? 'שבוע הבא' : 'Next'}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Week Calendar View */}
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map((day, index) => {
          const isToday = isSameDay(day.date, new Date());
          const capacity = calculateDailyCapacity(day);
          const endOfDayCycles = getEndOfDayCycles(day);
          
          return (
            <Card 
              key={index}
              variant={day.isWorkday ? 'elevated' : 'glass'}
              className={cn(
                "min-h-[200px] transition-all cursor-pointer hover:ring-2 hover:ring-primary/50",
                isToday && "ring-2 ring-primary",
                !day.isWorkday && "opacity-60",
                day.isOverride && "border-warning/50 bg-warning/5"
              )}
              onClick={() => handleDayClick(day)}
            >
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{dayLabels[index]}</div>
                    <div className={cn(
                      "text-lg font-bold",
                      isToday && "text-primary"
                    )}>
                      {format(day.date, 'd')}
                    </div>
                  </div>
                  {day.isOverride && (
                    <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                      {language === 'he' ? 'מיוחד' : 'Special'}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-3">
                {day.isWorkday ? (
                  <>
                    {/* Work Hours */}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {day.startTime} - {day.endTime}
                    </div>
                    
                    {/* Capacity */}
                    <div className="p-2 bg-muted rounded-lg text-center">
                      <div className="text-lg font-bold text-foreground">{capacity}</div>
                      <div className="text-xs text-muted-foreground">
                        {language === 'he' ? 'יחידות' : 'units'}
                      </div>
                    </div>

                    {/* Cycles */}
                    {day.cycles.length > 0 && (
                      <div className="space-y-1">
                        {day.cycles.slice(0, 3).map((cycle) => (
                          <div 
                            key={cycle.id}
                            className={cn(
                              "flex items-center gap-2 p-2 rounded-lg text-xs",
                              cycle.shift === 'end_of_day' 
                                ? "bg-primary/10 border border-primary/20" 
                                : "bg-muted"
                            )}
                          >
                            <SpoolIcon color={getSpoolColor(cycle.projectColor)} size={14} />
                            <span className="truncate flex-1">{cycle.projectName}</span>
                            <span className="text-muted-foreground">{cycle.unitsPlanned}</span>
                          </div>
                        ))}
                        {day.cycles.length > 3 && (
                          <div className="text-xs text-center text-muted-foreground">
                            +{day.cycles.length - 3} {language === 'he' ? 'נוספים' : 'more'}
                          </div>
                        )}
                      </div>
                    )}

                    {/* End of Day Indicator */}
                    {endOfDayCycles.length > 0 && (
                      <div className="flex items-center gap-1 text-xs text-primary">
                        <Moon className="w-3 h-3" />
                        {language === 'he' ? 'מחזור סוף יום' : 'End-of-day cycle'}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
                    <Sun className="w-6 h-6 mb-1 opacity-50" />
                    <span className="text-xs">{language === 'he' ? 'יום חופש' : 'Day Off'}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Printer End-of-Day Summary */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Moon className="w-5 h-5 text-primary" />
            {language === 'he' ? 'מחזורי סוף יום למדפסות' : 'End-of-Day Cycles by Printer'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {printers.map((printer) => {
              const todayCycles = weekDays.find(d => isSameDay(d.date, new Date()))?.cycles || [];
              const printerEodCycle = todayCycles.find(c => c.printerId === printer.id && c.shift === 'end_of_day');
              
              return (
                <div 
                  key={printer.id}
                  className="flex items-center justify-between p-4 bg-muted rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <Printer className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium">{printer.name}</span>
                  </div>
                  {printerEodCycle ? (
                    <div className="flex items-center gap-2">
                      <SpoolIcon color={getSpoolColor(printerEodCycle.projectColor)} size={20} />
                      <div className="text-right">
                        <div className="text-sm font-medium">{printerEodCycle.projectName}</div>
                        <div className="text-xs text-muted-foreground">
                          {printerEodCycle.unitsPlanned} {language === 'he' ? 'יחידות' : 'units'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      {language === 'he' ? 'אין מחזור' : 'No cycle'}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
