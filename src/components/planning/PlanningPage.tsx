import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
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
  Plus,
  Trash2,
  CalendarIcon
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

interface ScheduleOverride {
  id: string;
  startDate: string;
  endDate: string;
  extraDays: string[];
  customStartTime?: string;
  customEndTime?: string;
}

interface DaySchedule {
  date: Date;
  isWorkday: boolean;
  isOverride: boolean;
  startTime: string;
  endTime: string;
  cycles: (PlannedCycle & { projectName: string; projectColor: string })[];
}

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAYS_LABELS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYS_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const PlanningPage: React.FC = () => {
  const { language } = useLanguage();
  const [settings, setSettings] = useState<FactorySettings | null>(null);
  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [plannedCycles, setPlannedCycles] = useState<PlannedCycle[]>([]);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [overrides, setOverrides] = useState<ScheduleOverride[]>([]);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [newOverride, setNewOverride] = useState<Partial<ScheduleOverride>>({
    extraDays: [],
    customStartTime: '08:00',
    customEndTime: '17:00',
  });
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [recalculateModalOpen, setRecalculateModalOpen] = useState(false);
  const [planningMeta, setPlanningMeta] = useState(getPlanningMeta());
  const [bannerDismissed, setBannerDismissed] = useState(false);

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
    const savedOverrides = localStorage.getItem('printflow_schedule_overrides');
    if (savedOverrides) {
      setOverrides(JSON.parse(savedOverrides));
    }
  }, []);

  const saveOverrides = (newOverrides: ScheduleOverride[]) => {
    setOverrides(newOverrides);
    localStorage.setItem('printflow_schedule_overrides', JSON.stringify(newOverrides));
  };

  const handleAddOverride = () => {
    if (!newOverride.startDate || !newOverride.endDate) return;
    
    const override: ScheduleOverride = {
      id: `override-${Date.now()}`,
      startDate: newOverride.startDate,
      endDate: newOverride.endDate,
      extraDays: newOverride.extraDays || [],
      customStartTime: newOverride.customStartTime,
      customEndTime: newOverride.customEndTime,
    };
    
    saveOverrides([...overrides, override]);
    setNewOverride({
      extraDays: [],
      customStartTime: '08:00',
      customEndTime: '17:00',
    });
    setOverrideDialogOpen(false);
  };

  const handleRemoveOverride = (id: string) => {
    saveOverrides(overrides.filter(o => o.id !== id));
  };

  const getWeekDays = (): DaySchedule[] => {
    const days: DaySchedule[] = [];
    
    for (let i = 0; i < 7; i++) {
      const date = addDays(currentWeekStart, i);
      const dayName = DAYS_OF_WEEK[date.getDay()];
      
      // Check if this day is a regular workday
      let isWorkday = settings?.workdays.includes(dayName) || false;
      let isOverride = false;
      let startTime = settings?.startTime || '08:00';
      let endTime = settings?.endTime || '17:00';
      
      // Check for overrides
      for (const override of overrides) {
        const overrideStart = parseISO(override.startDate);
        const overrideEnd = parseISO(override.endDate);
        
        if (isWithinInterval(date, { start: overrideStart, end: overrideEnd })) {
          // Check if this day is an extra day in the override
          if (override.extraDays.includes(dayName)) {
            isWorkday = true;
            isOverride = true;
            startTime = override.customStartTime || startTime;
            endTime = override.customEndTime || endTime;
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

  const weekDays = getWeekDays();
  const dayLabels = language === 'he' ? DAYS_LABELS_HE : DAYS_LABELS_EN;

  // Get end-of-day cycles for each printer
  const getEndOfDayCycles = (day: DaySchedule) => {
    return day.cycles.filter(c => c.shift === 'end_of_day');
  };

  const toggleExtraDay = (day: string) => {
    const current = newOverride.extraDays || [];
    if (current.includes(day)) {
      setNewOverride({ ...newOverride, extraDays: current.filter(d => d !== day) });
    } else {
      setNewOverride({ ...newOverride, extraDays: [...current, day] });
    }
  };

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
              {language === 'he' ? 'תצוגת קיבולת ומחזורים לפי יום' : 'Daily capacity and cycles view'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <RecalculateButton 
            onClick={() => setRecalculateModalOpen(true)} 
            showLastCalculated={true}
          />
        
          <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Settings2 className="w-4 h-4" />
                {language === 'he' ? 'שינוי לוח זמנים זמני' : 'Temporary Override'}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {language === 'he' ? 'שינוי לוח זמנים זמני' : 'Temporary Schedule Override'}
                </DialogTitle>
              </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Date Range */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{language === 'he' ? 'מתאריך' : 'From Date'}</Label>
                  <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !newOverride.startDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {newOverride.startDate 
                          ? format(parseISO(newOverride.startDate), 'dd/MM/yyyy')
                          : (language === 'he' ? 'בחר תאריך' : 'Pick date')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={newOverride.startDate ? parseISO(newOverride.startDate) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            setNewOverride({ ...newOverride, startDate: format(date, 'yyyy-MM-dd') });
                          }
                          setStartDateOpen(false);
                        }}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>{language === 'he' ? 'עד תאריך' : 'To Date'}</Label>
                  <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !newOverride.endDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {newOverride.endDate 
                          ? format(parseISO(newOverride.endDate), 'dd/MM/yyyy')
                          : (language === 'he' ? 'בחר תאריך' : 'Pick date')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={newOverride.endDate ? parseISO(newOverride.endDate) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            setNewOverride({ ...newOverride, endDate: format(date, 'yyyy-MM-dd') });
                          }
                          setEndDateOpen(false);
                        }}
                        disabled={(date) => newOverride.startDate ? date < parseISO(newOverride.startDate) : false}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Extra Days */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'ימי עבודה נוספים' : 'Extra Workdays'}</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day, index) => {
                    const isRegularWorkday = settings?.workdays.includes(day);
                    const isSelected = newOverride.extraDays?.includes(day);
                    const label = language === 'he' ? DAYS_LABELS_HE[index] : DAYS_LABELS_EN[index];
                    
                    return (
                      <button
                        key={day}
                        onClick={() => !isRegularWorkday && toggleExtraDay(day)}
                        disabled={isRegularWorkday}
                        className={cn(
                          "px-3 py-2 rounded-lg text-sm font-medium transition-all",
                          isRegularWorkday 
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted hover:bg-accent"
                        )}
                      >
                        {label}
                        {isRegularWorkday && <span className="text-xs ml-1">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {language === 'he' 
                    ? 'ימים עם ✓ הם ימי עבודה רגילים. בחרו ימים נוספים.'
                    : 'Days with ✓ are regular workdays. Select additional days.'}
                </p>
              </div>

              {/* Custom Hours */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{language === 'he' ? 'שעת התחלה' : 'Start Time'}</Label>
                  <Input
                    type="time"
                    value={newOverride.customStartTime || '08:00'}
                    onChange={(e) => setNewOverride({ ...newOverride, customStartTime: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'he' ? 'שעת סיום' : 'End Time'}</Label>
                  <Input
                    type="time"
                    value={newOverride.customEndTime || '17:00'}
                    onChange={(e) => setNewOverride({ ...newOverride, customEndTime: e.target.value })}
                  />
                </div>
              </div>

              <Button 
                onClick={handleAddOverride}
                disabled={!newOverride.startDate || !newOverride.endDate || (newOverride.extraDays?.length === 0)}
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                {language === 'he' ? 'הוסף שינוי' : 'Add Override'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Active Overrides */}
      {overrides.length > 0 && (
        <Card variant="glass" className="border-warning/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 className="w-4 h-4 text-warning" />
              <span className="font-medium text-sm">
                {language === 'he' ? 'שינויי לוח זמנים פעילים' : 'Active Schedule Overrides'}
              </span>
            </div>
            <div className="space-y-2">
              {overrides.map((override) => (
                <div key={override.id} className="flex items-center justify-between p-3 bg-background rounded-lg">
                  <div className="text-sm">
                    <span className="font-medium">
                      {format(parseISO(override.startDate), 'dd/MM')} - {format(parseISO(override.endDate), 'dd/MM')}
                    </span>
                    <span className="text-muted-foreground mx-2">•</span>
                    <span className="text-muted-foreground">
                      {override.extraDays.map(d => {
                        const idx = DAYS_OF_WEEK.indexOf(d);
                        return language === 'he' ? DAYS_LABELS_HE[idx] : DAYS_LABELS_EN[idx];
                      }).join(', ')}
                    </span>
                    <span className="text-muted-foreground mx-2">•</span>
                    <span className="text-muted-foreground">
                      {override.customStartTime} - {override.customEndTime}
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
              ))}
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
                "min-h-[200px] transition-all",
                isToday && "ring-2 ring-primary",
                !day.isWorkday && "opacity-60",
                day.isOverride && "border-warning/50 bg-warning/5"
              )}
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