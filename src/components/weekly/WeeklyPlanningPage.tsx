import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { 
  CalendarDays, 
  Search, 
  AlertTriangle, 
  Moon,
  Filter
} from 'lucide-react';
import { getPrinters } from '@/services/storage';
import { 
  getWeekRange, 
  getCyclesByDayAndPrinter,
  getWeeklyProductSummary,
  CycleWithDetails,
  DayInfo,
  ProductWeeklySummary
} from '@/services/weeklyPlanningService';
import { CycleDetailsModal } from './CycleDetailsModal';
import { format } from 'date-fns';
import { Package } from 'lucide-react';

interface WeeklyPlanningPageProps {
  onNavigateToProject?: (projectId: string) => void;
}

export const WeeklyPlanningPage: React.FC<WeeklyPlanningPageProps> = ({
  onNavigateToProject,
}) => {
  const { language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPrinter, setSelectedPrinter] = useState<string>('all');
  const [riskOnly, setRiskOnly] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<CycleWithDetails | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Listen for auto-replan completion to refresh data
  useEffect(() => {
    const onReplanComplete = () => {
      console.log('[WeeklyPlanningPage] Auto-replan completed, refreshing...');
      setRefreshKey(prev => prev + 1);
    };
    window.addEventListener('printflow:replan-complete', onReplanComplete);
    return () => window.removeEventListener('printflow:replan-complete', onReplanComplete);
  }, []);

  const printers = getPrinters();
  const weekDays = getWeekRange();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cyclesByDayAndPrinter = useMemo(() => getCyclesByDayAndPrinter(), [refreshKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const productSummary = useMemo(() => getWeeklyProductSummary(), [refreshKey]);

  // Filter printers
  const filteredPrinters = useMemo(() => {
    if (selectedPrinter === 'all') {
      return printers.filter(p => p.status === 'active');
    }
    return printers.filter(p => p.id === selectedPrinter);
  }, [printers, selectedPrinter]);

  // Filter cycles
  const filterCycles = (cycles: CycleWithDetails[]): CycleWithDetails[] => {
    return cycles.filter(cycle => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesProject = cycle.projectName.toLowerCase().includes(query);
        const matchesColor = cycle.color?.toLowerCase().includes(query);
        if (!matchesProject && !matchesColor) return false;
      }
      
      // Risk filter
      if (riskOnly) {
        const hasRisk = cycle.risk.crossesDeadline || cycle.risk.requiresOvernight;
        if (!hasRisk) return false;
      }
      
      return true;
    });
  };

  const formatTime = (dateStr: string) => {
    return format(new Date(dateStr), 'HH:mm');
  };

  const getCycleClasses = (cycle: CycleWithDetails): string => {
    const base = 'p-2 rounded-lg border cursor-pointer hover:shadow-md transition-shadow text-xs';
    
    if (cycle.risk.crossesDeadline) {
      return `${base} bg-red-50 border-red-300 dark:bg-red-950 dark:border-red-800`;
    }
    if (cycle.risk.requiresOvernight) {
      return `${base} bg-purple-50 border-purple-300 dark:bg-purple-950 dark:border-purple-800`;
    }
    if (cycle.risk.isRecovery) {
      return `${base} bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-800`;
    }
    
    return `${base} bg-card border-border`;
  };

  const renderDayHeader = (day: DayInfo) => (
    <div 
      className={`p-2 text-center border-b ${day.isToday ? 'bg-primary/10' : 'bg-muted/50'}`}
    >
      <div className="font-medium text-sm">
        {language === 'he' ? day.dayNameHe : day.dayName}
      </div>
      <div className={`text-xs ${day.isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
        {format(day.date, 'dd/MM')}
      </div>
    </div>
  );

  const renderCycleCell = (cycles: CycleWithDetails[]) => {
    const filtered = filterCycles(cycles);
    
    if (filtered.length === 0) {
      return (
        <div className="h-full min-h-[80px] p-1 flex items-center justify-center text-muted-foreground/50 text-xs">
          —
        </div>
      );
    }

    return (
      <div className="p-1 space-y-1 min-h-[80px]">
        {filtered.map(cycle => (
          <div
            key={cycle.id}
            className={getCycleClasses(cycle)}
            onClick={() => setSelectedCycle(cycle)}
          >
            <div className="flex items-center gap-1 mb-1">
              {cycle.color && (
                <div 
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cycle.color }}
                />
              )}
              <span className="font-medium truncate flex-1">{cycle.projectName}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{formatTime(cycle.startTime)}</span>
              <span>{cycle.unitsPlanned}u</span>
            </div>
            {/* Risk indicators */}
            <div className="flex gap-1 mt-1">
              {cycle.risk.crossesDeadline && (
                <AlertTriangle className="w-3 h-3 text-destructive" />
              )}
              {cycle.risk.requiresOvernight && (
                <Moon className="w-3 h-3 text-purple-500" />
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">
              {language === 'he' ? 'תכנון שבועי' : 'Weekly Planning'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {language === 'he' 
                ? `${format(weekDays[0].date, 'dd/MM')} - ${format(weekDays[6].date, 'dd/MM')}`
                : `${format(weekDays[0].date, 'MMM dd')} - ${format(weekDays[6].date, 'MMM dd')}`
              }
            </p>
          </div>
        </div>
      </div>

      {/* Product Summary */}
      {productSummary.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Package className="w-4 h-4" />
              {language === 'he' ? 'סיכום מוצרים לשבוע' : 'Weekly Product Summary'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {productSummary.map((product) => (
                <Badge 
                  key={product.productId} 
                  variant="secondary" 
                  className="flex items-center gap-2 py-1.5 px-3"
                >
                  {product.color && (
                    <div 
                      className="w-3 h-3 rounded-full flex-shrink-0 border border-border"
                      style={{ backgroundColor: product.color }}
                    />
                  )}
                  <span className="font-medium">{product.productName}</span>
                  <span className="text-muted-foreground">
                    {product.totalUnitsPlanned} {language === 'he' ? 'יח׳' : 'u'}
                  </span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={language === 'he' ? 'חיפוש פרויקט/צבע...' : 'Search project/color...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={selectedPrinter} onValueChange={setSelectedPrinter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {language === 'he' ? 'כל המדפסות' : 'All Printers'}
                  </SelectItem>
                  {printers.filter(p => p.status === 'active').map(printer => (
                    <SelectItem key={printer.id} value={printer.id}>
                      {printer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <Checkbox
                id="risk-only"
                checked={riskOnly}
                onCheckedChange={(checked) => setRiskOnly(checked === true)}
              />
              <Label htmlFor="risk-only" className="text-sm cursor-pointer">
                {language === 'he' ? 'בסיכון בלבד' : 'Risk only'}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Grid */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="w-full">
            <div className="min-w-[800px]">
              {/* Header row with days */}
              <div className="grid grid-cols-8 border-b">
                <div className="p-2 bg-muted/50 border-e font-medium text-sm">
                  {language === 'he' ? 'מדפסת' : 'Printer'}
                </div>
                {weekDays.map(day => (
                  <div key={day.dateStr} className="border-e last:border-e-0">
                    {renderDayHeader(day)}
                  </div>
                ))}
              </div>

              {/* Printer rows */}
              {filteredPrinters.map(printer => (
                <div key={printer.id} className="grid grid-cols-8 border-b last:border-b-0">
                  <div className="p-2 bg-muted/30 border-e flex items-center">
                    <span className="font-medium text-sm">{printer.name}</span>
                  </div>
                  {weekDays.map(day => {
                    const cycles = cyclesByDayAndPrinter[printer.id]?.[day.dateStr] || [];
                    return (
                      <div 
                        key={day.dateStr} 
                        className={`border-e last:border-e-0 ${day.isToday ? 'bg-primary/5' : ''}`}
                      >
                        {renderCycleCell(cycles)}
                      </div>
                    );
                  })}
                </div>
              ))}

              {filteredPrinters.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  {language === 'he' ? 'אין מדפסות פעילות' : 'No active printers'}
                </div>
              )}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-100 border border-red-300 dark:bg-red-950 dark:border-red-800" />
          <span>{language === 'he' ? 'חוצה דדליין' : 'Crosses deadline'}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-purple-100 border border-purple-300 dark:bg-purple-950 dark:border-purple-800" />
          <span>{language === 'he' ? 'דורש לילה' : 'Overnight'}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-amber-100 border border-amber-300 dark:bg-amber-950 dark:border-amber-800" />
          <span>{language === 'he' ? 'השלמה' : 'Recovery'}</span>
        </div>
      </div>

      {/* Cycle Details Modal */}
      <CycleDetailsModal
        cycle={selectedCycle}
        open={!!selectedCycle}
        onOpenChange={(open) => !open && setSelectedCycle(null)}
        onNavigateToProject={onNavigateToProject}
      />
    </div>
  );
};
