// Planning Status Debug Panel
// Temporary UI to diagnose why projects aren't generating PlannedCycles

import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Bug, ChevronDown, RefreshCw, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  getProjects,
  getProducts,
  getPrinters,
  getActivePrinters,
  getPlannedCycles,
  getFactorySettings,
  getPlanningMeta,
} from '@/services/storage';
import { getPlanningLog, getLastReplanInfo, clearPlanningLog, PlanningLogEntry } from '@/services/planningLogger';

interface DebugStats {
  projectsTotal: number;
  projectsActive: number;
  printersTotal: number;
  printersActive: number;
  productsTotal: number;
  plannedCyclesTotal: number;
  plannedCyclesThisWeek: number;
  capacityChanged: boolean;
  lastReplanAt: string | null;
  lastReplanReason: string | null;
  lastReplanResult: {
    cyclesCreated: number;
    unitsPlanned: number;
    warningsCount: number;
    errorsCount: number;
  } | null;
}

export const PlanningDebugPanel: React.FC = () => {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<DebugStats | null>(null);
  const [logEntries, setLogEntries] = useState<PlanningLogEntry[]>([]);
  const [showFullLog, setShowFullLog] = useState(false);

  const refreshStats = () => {
    const projects = getProjects();
    const products = getProducts();
    const printers = getPrinters();
    const activePrinters = getActivePrinters();
    const cycles = getPlannedCycles();
    const settings = getFactorySettings();
    const meta = getPlanningMeta();
    const lastReplan = getLastReplanInfo();
    const log = getPlanningLog();

    // Calculate cycles for this week
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const cyclesThisWeek = cycles.filter(c => {
      const cycleDate = new Date(c.startTime);
      return cycleDate >= weekStart && cycleDate < weekEnd;
    });

    setStats({
      projectsTotal: projects.length,
      projectsActive: projects.filter(p => p.status === 'in_progress' || p.status === 'pending').length,
      printersTotal: printers.length,
      printersActive: activePrinters.length,
      productsTotal: products.length,
      plannedCyclesTotal: cycles.length,
      plannedCyclesThisWeek: cyclesThisWeek.length,
      capacityChanged: meta.capacityChangedSinceLastRecalculation,
      lastReplanAt: lastReplan.lastReplanAt,
      lastReplanReason: lastReplan.lastReplanReason,
      lastReplanResult: lastReplan.lastReplanResult,
    });

    setLogEntries(log);
  };

  useEffect(() => {
    if (isOpen) {
      refreshStats();
    }
  }, [isOpen]);

  const handleClearLog = () => {
    clearPlanningLog();
    refreshStats();
  };

  const formatTimestamp = (ts: string) => {
    try {
      return format(new Date(ts), 'dd/MM HH:mm:ss');
    } catch {
      return ts;
    }
  };

  const StatBadge = ({ label, value, variant = 'default' }: { label: string; value: string | number; variant?: 'default' | 'success' | 'warning' | 'destructive' }) => (
    <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant={variant === 'success' ? 'default' : variant === 'warning' ? 'outline' : 'secondary'} className={variant === 'success' ? 'bg-success' : variant === 'warning' ? 'border-warning text-warning' : ''}>
        {value}
      </Badge>
    </div>
  );

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="w-full justify-between text-xs text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            <Bug className="w-3 h-3" />
            {language === 'he' ? 'פאנל דיבוג תכנון' : 'Planning Debug Panel'}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <Card className="mt-2 border-dashed border-warning/50 bg-warning/5">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Bug className="w-4 h-4 text-warning" />
              {language === 'he' ? 'סטטוס תכנון (דיבוג)' : 'Planning Status (Debug)'}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={refreshStats}>
                <RefreshCw className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClearLog}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-4 text-sm">
            {stats && (
              <>
                {/* Data Counts */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <StatBadge 
                    label="Projects (active)" 
                    value={`${stats.projectsActive} / ${stats.projectsTotal}`}
                    variant={stats.projectsActive > 0 ? 'success' : 'warning'}
                  />
                  <StatBadge 
                    label="Printers (active)" 
                    value={`${stats.printersActive} / ${stats.printersTotal}`}
                    variant={stats.printersActive > 0 ? 'success' : 'warning'}
                  />
                  <StatBadge 
                    label="Products" 
                    value={stats.productsTotal}
                  />
                  <StatBadge 
                    label="Cycles (week)" 
                    value={`${stats.plannedCyclesThisWeek} / ${stats.plannedCyclesTotal}`}
                    variant={stats.plannedCyclesThisWeek > 0 ? 'success' : 'warning'}
                  />
                </div>

                {/* Last Replan Info */}
                <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Last Replan:</span>
                    <span className="text-xs font-mono">
                      {stats.lastReplanAt ? formatTimestamp(stats.lastReplanAt) : 'Never'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Reason:</span>
                    <Badge variant="outline" className="text-xs">
                      {stats.lastReplanReason || 'N/A'}
                    </Badge>
                  </div>
                  {stats.lastReplanResult && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {stats.lastReplanResult.cyclesCreated} cycles
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {stats.lastReplanResult.unitsPlanned} units
                      </Badge>
                      {stats.lastReplanResult.warningsCount > 0 && (
                        <Badge variant="outline" className="text-xs border-warning text-warning">
                          {stats.lastReplanResult.warningsCount} warnings
                        </Badge>
                      )}
                      {stats.lastReplanResult.errorsCount > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {stats.lastReplanResult.errorsCount} errors
                        </Badge>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Capacity Changed:</span>
                    <span className={`text-xs ${stats.capacityChanged ? 'text-warning' : 'text-success'}`}>
                      {stats.capacityChanged ? 'Yes (needs recalc)' : 'No'}
                    </span>
                  </div>
                </div>

                {/* Diagnosis */}
                <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs font-medium mb-2">Diagnosis:</div>
                  {stats.projectsActive === 0 && (
                    <div className="flex items-center gap-2 text-warning">
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-xs">No active projects (in_progress or pending)</span>
                    </div>
                  )}
                  {stats.printersActive === 0 && (
                    <div className="flex items-center gap-2 text-warning">
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-xs">No active printers</span>
                    </div>
                  )}
                  {stats.productsTotal === 0 && (
                    <div className="flex items-center gap-2 text-warning">
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-xs">No products defined</span>
                    </div>
                  )}
                  {stats.projectsActive > 0 && stats.printersActive > 0 && stats.plannedCyclesThisWeek === 0 && (
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-xs">Has data but no cycles! Check products have plate presets with unitsPerPlate &gt; 0</span>
                    </div>
                  )}
                  {stats.projectsActive > 0 && stats.printersActive > 0 && stats.plannedCyclesThisWeek > 0 && (
                    <div className="flex items-center gap-2 text-success">
                      <CheckCircle2 className="w-3 h-3" />
                      <span className="text-xs">Planning appears to be working correctly</span>
                    </div>
                  )}
                </div>

                {/* Log Entries */}
                {logEntries.length > 0 && (
                  <div className="space-y-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full text-xs"
                      onClick={() => setShowFullLog(!showFullLog)}
                    >
                      {showFullLog ? 'Hide' : 'Show'} Full Log ({logEntries.length} entries)
                    </Button>
                    
                    {showFullLog && (
                      <div className="max-h-60 overflow-y-auto space-y-1 text-xs font-mono bg-muted/50 rounded p-2">
                        {logEntries.map((entry, idx) => (
                          <div 
                            key={idx} 
                            className={`p-2 rounded ${entry.output.success ? 'bg-success/10' : 'bg-destructive/10'}`}
                          >
                            <div className="flex items-center justify-between">
                              <span>{formatTimestamp(entry.timestamp)}</span>
                              <Badge variant={entry.output.success ? 'default' : 'destructive'} className="text-xs">
                                {entry.reason}
                              </Badge>
                            </div>
                            <div className="text-muted-foreground">
                              In: {entry.inputSnapshot.projectsActive}p/{entry.inputSnapshot.printersActive}pr | 
                              Out: {entry.output.cyclesCreated}c/{entry.output.unitsPlanned}u
                            </div>
                            {entry.errors.length > 0 && (
                              <div className="text-destructive mt-1">
                                Errors: {entry.errors.join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
};
