// Planning Status Debug Panel
// Temporary UI to diagnose why projects aren't generating PlannedCycles

import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Bug, ChevronDown, RefreshCw, Trash2, AlertCircle, CheckCircle2, Copy, Zap, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  getProjectsSync,
  getProducts,
  getPrinters,
  getActivePrinters,
  getPlannedCycles,
  getFactorySettings,
  getPlanningMeta,
} from '@/services/storage';
import { getPlanningLog, getLastReplanInfo, clearPlanningLog, PlanningLogEntry } from '@/services/planningLogger';
import { getBlockSummary, CycleBlockReason, clearBlockLog, BlockSummary } from '@/services/cycleBlockLogger';

interface OriginInfo {
  href: string;
  origin: string;
  topHref: string | null;
  referrer: string;
  isIframe: boolean;
}

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
  // Origin diagnostics
  originInfo: OriginInfo;
  localStorageKeys: string[];
  cyclesRawLength: number;
  testKeyResult: { found: boolean; value: string | null };
}

export const PlanningDebugPanel: React.FC = () => {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<DebugStats | null>(null);
  const [logEntries, setLogEntries] = useState<PlanningLogEntry[]>([]);
  const [showFullLog, setShowFullLog] = useState(false);
  const [blockSummary, setBlockSummary] = useState<BlockSummary | null>(null);

  const getOriginInfo = (): OriginInfo => {
    let topHref: string | null = null;
    let isIframe = false;
    
    try {
      isIframe = window.self !== window.top;
      if (window.top) {
        topHref = window.top.location.href;
      }
    } catch (e) {
      // Cross-origin - can't access top
      topHref = '[CROSS-ORIGIN - cannot access]';
      isIframe = true;
    }

    return {
      href: window.location.href,
      origin: window.location.origin,
      topHref,
      referrer: document.referrer || '[empty]',
      isIframe,
    };
  };

  const refreshStats = () => {
    const projects = getProjectsSync();
    const products = getProducts();
    const printers = getPrinters();
    const activePrinters = getActivePrinters();
    const cycles = getPlannedCycles();
    const meta = getPlanningMeta();
    const lastReplan = getLastReplanInfo();
    const log = getPlanningLog();
    const originInfo = getOriginInfo();

    // Origin diagnostics - get all PrintFlow localStorage keys
    const allKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('printflow_')) {
        allKeys.push(key);
      }
    }

    // Get raw cycles from localStorage to verify
    const rawCyclesStr = localStorage.getItem('printflow_planned_cycles');
    const rawCycles = rawCyclesStr ? JSON.parse(rawCyclesStr) : [];

    // Check for test key
    const testKeyStr = localStorage.getItem('printflow_origin_test');
    const testKeyResult = {
      found: !!testKeyStr,
      value: testKeyStr,
    };

    // Log comprehensive origin info to console
    console.log('═══════════════════════════════════════════════════════');
    console.log('[PlanningDebugPanel] ORIGIN DIAGNOSTICS');
    console.log('═══════════════════════════════════════════════════════');
    console.log('window.location.href:', originInfo.href);
    console.log('window.location.origin:', originInfo.origin);
    console.log('window.top.location.href:', originInfo.topHref);
    console.log('document.referrer:', originInfo.referrer);
    console.log('Is iframe:', originInfo.isIframe);
    console.log('───────────────────────────────────────────────────────');
    console.log('localStorage keys (printflow_*):', allKeys);
    console.log('Raw cycles count:', rawCycles.length);
    console.log('Parsed cycles count:', cycles.length);
    console.log('Test key:', testKeyResult);
    console.log('═══════════════════════════════════════════════════════');

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
      // Origin diagnostics
      originInfo,
      localStorageKeys: allKeys,
      cyclesRawLength: rawCycles.length,
      testKeyResult,
    });

    setLogEntries(log);
    setBlockSummary(getBlockSummary());
  };

  useEffect(() => {
    if (isOpen) {
      refreshStats();
    }
  }, [isOpen]);

  const handleClearLog = () => {
    clearPlanningLog();
    clearBlockLog();
    refreshStats();
  };

  const handleWriteTestKey = () => {
    const testData = {
      origin: window.location.origin,
      href: window.location.href,
      ts: Date.now(),
      tsReadable: new Date().toISOString(),
    };
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('[TEST KEY WRITE]');
    console.log('Writing to localStorage from origin:', window.location.origin);
    console.log('Data:', testData);
    
    localStorage.setItem('printflow_origin_test', JSON.stringify(testData));
    
    // Immediately read back
    const readBack = localStorage.getItem('printflow_origin_test');
    console.log('Read back immediately:', readBack);
    console.log('═══════════════════════════════════════════════════════');
    
    toast.success(`Test key written from: ${window.location.origin}`);
    refreshStats();
  };

  const handleCopyDiagnostics = () => {
    if (!stats) return;
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      originInfo: stats.originInfo,
      localStorage: {
        keys: stats.localStorageKeys,
        cyclesRaw: stats.cyclesRawLength,
        cyclesParsed: stats.plannedCyclesTotal,
        testKey: stats.testKeyResult,
      },
      counts: {
        projects: { total: stats.projectsTotal, active: stats.projectsActive },
        printers: { total: stats.printersTotal, active: stats.printersActive },
        products: stats.productsTotal,
        cycles: { thisWeek: stats.plannedCyclesThisWeek, total: stats.plannedCyclesTotal },
      },
      lastReplan: {
        at: stats.lastReplanAt,
        reason: stats.lastReplanReason,
        result: stats.lastReplanResult,
      },
    };
    
    navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    toast.success('Diagnostics copied to clipboard');
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
              <Button variant="ghost" size="sm" onClick={refreshStats} title="Refresh">
                <RefreshCw className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCopyDiagnostics} title="Copy diagnostics">
                <Copy className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClearLog} title="Clear log">
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-4 text-sm">
            {stats && (
              <>
                {/* Origin Diagnostics - FIRST and PROMINENT */}
                <div className="space-y-2 p-3 bg-blue-500/10 rounded-lg border-2 border-blue-500/50">
                  <div className="text-xs font-bold mb-2 text-blue-400">🔬 ORIGIN PROOF (Hard Evidence)</div>
                  
                  <div className="space-y-1 font-mono text-[10px] bg-background/50 p-2 rounded">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">window.location.href:</span>
                      <code className="text-blue-300 break-all text-right max-w-[60%]">{stats.originInfo.href}</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">window.location.origin:</span>
                      <code className="text-green-400 font-bold">{stats.originInfo.origin}</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">window.top.location.href:</span>
                      <code className="text-yellow-300 break-all text-right max-w-[60%]">{stats.originInfo.topHref || 'N/A'}</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">document.referrer:</span>
                      <code className="text-purple-300 break-all text-right max-w-[60%]">{stats.originInfo.referrer}</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Is iframe:</span>
                      <Badge variant={stats.originInfo.isIframe ? 'outline' : 'default'} className="text-[10px]">
                        {stats.originInfo.isIframe ? 'YES' : 'NO'}
                      </Badge>
                    </div>
                  </div>

                  {/* Test Key Button */}
                  <div className="flex items-center gap-2 mt-3">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleWriteTestKey}
                      className="text-xs border-blue-500 text-blue-400 hover:bg-blue-500/20"
                    >
                      <Zap className="w-3 h-3 mr-1" />
                      Write Test Key
                    </Button>
                    <div className="text-[10px] text-muted-foreground">
                      {stats.testKeyResult.found ? (
                        <span className="text-green-400">✓ Test key found: {stats.testKeyResult.value?.substring(0, 50)}...</span>
                      ) : (
                        <span className="text-yellow-400">No test key yet</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* localStorage Keys and Cycles */}
                <div className="space-y-2 p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
                  <div className="text-xs font-bold mb-2 text-purple-400">📦 localStorage Contents</div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">printflow_planned_cycles:</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={stats.cyclesRawLength > 0 ? 'default' : 'destructive'} className="text-xs bg-green-600">
                        {stats.cyclesRawLength} raw
                      </Badge>
                      <Badge variant={stats.plannedCyclesTotal > 0 ? 'default' : 'destructive'} className="text-xs">
                        {stats.plannedCyclesTotal} parsed
                      </Badge>
                    </div>
                  </div>
                  
                  {stats.cyclesRawLength !== stats.plannedCyclesTotal && (
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-xs">⚠️ MISMATCH: Raw ({stats.cyclesRawLength}) ≠ Parsed ({stats.plannedCyclesTotal})</span>
                    </div>
                  )}

                  <div className="text-xs mt-2">
                    <span className="font-medium">All PrintFlow Keys ({stats.localStorageKeys.length}):</span>
                    <div className="mt-1 max-h-24 overflow-y-auto bg-muted/50 rounded p-2 font-mono text-[10px]">
                      {stats.localStorageKeys.length > 0 
                        ? stats.localStorageKeys.map((k, i) => (
                            <div key={i} className={k === 'printflow_planned_cycles' ? 'text-green-400 font-bold' : ''}>
                              {k}
                            </div>
                          ))
                        : <span className="text-destructive">❌ No printflow_ keys found in localStorage!</span>
                      }
                    </div>
                  </div>
                </div>

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

                {/* Block Summary - Why cycles weren't scheduled */}
                {blockSummary && blockSummary.total > 0 && (
                  <div className="space-y-2 p-3 bg-destructive/10 rounded-lg border border-destructive/30">
                    <div className="text-xs font-bold mb-2 text-destructive flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      {language === 'he' ? `חסימות תכנון (${blockSummary.total})` : `Blocked Cycles (${blockSummary.total})`}
                    </div>
                    
                    <TooltipProvider>
                      <div className="flex flex-wrap gap-2">
                        {(Object.entries(blockSummary.byReason) as [CycleBlockReason, number][])
                          .filter(([_, count]) => count > 0)
                          .sort((a, b) => b[1] - a[1])
                          .map(([reason, count]) => {
                            const reasonLabels: Record<CycleBlockReason, { he: string; en: string; tooltip: string }> = {
                              plates_limit: { he: 'הגבלת פלטות', en: 'Plate limit', tooltip: 'לא נותרו פלטות פנויות למחזור הזה' },
                              material_insufficient: { he: 'חוסר חומר', en: 'No material', tooltip: 'אין מספיק פילמנט בצבע הנדרש' },
                              spool_parallel_limit: { he: 'מקביליות גלילים', en: 'Spool parallel', tooltip: 'יותר מדי מדפסות צריכות את אותו צבע בו זמנית' },
                              after_hours_policy: { he: 'מדיניות לילה', en: 'Night policy', tooltip: 'הגדרות המפעל לא מאפשרות הדפסה אחרי שעות העבודה' },
                              no_night_preset: { he: 'פריסט לא לילה', en: 'No night preset', tooltip: 'הפריסט לא מוגדר כמותר להדפסת לילה' },
                              printer_inactive: { he: 'מדפסת לא פעילה', en: 'Printer inactive', tooltip: 'המדפסת מכובה או לא זמינה' },
                              no_matching_preset: { he: 'אין פריסט מתאים', en: 'No preset', tooltip: 'לא נמצא פריסט שמתאים לפרויקט' },
                              deadline_passed: { he: 'דדליין עבר', en: 'Deadline passed', tooltip: 'תאריך היעד של הפרויקט כבר עבר' },
                              project_complete: { he: 'פרויקט הושלם', en: 'Project done', tooltip: 'הפרויקט כבר הושלם' },
                              color_lock_night: { he: 'נעילת צבע לילה', en: 'Color lock night', tooltip: 'מדפסת ללא AMS לא יכולה לשנות צבע בלילה' },
                              cycle_too_long_night: { he: 'מחזור ארוך ללילה', en: 'Too long for night', tooltip: 'משך המחזור ארוך מחלון הלילה הזמין' },
                            };
                            const label = reasonLabels[reason];
                            
                            return (
                              <Tooltip key={reason}>
                                <TooltipTrigger asChild>
                                  <Badge 
                                    variant="destructive" 
                                    className="text-xs cursor-help"
                                  >
                                    {language === 'he' ? label.he : label.en}: {count}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <p className="text-sm">{label.tooltip}</p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })
                        }
                      </div>
                    </TooltipProvider>
                    
                    {/* Recent block details */}
                    {blockSummary.recentBlocks.length > 0 && (
                      <div className="mt-3 space-y-1 max-h-32 overflow-y-auto text-xs font-mono bg-background/50 rounded p-2">
                        {blockSummary.recentBlocks.slice(0, 5).map((block, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-muted-foreground">
                            <span className="text-destructive">❌</span>
                            <span className="flex-1">
                              <span className="text-foreground">{block.projectName || block.projectId}</span>
                              {' → '}
                              <span className="text-warning">{block.printerName || block.printerId}</span>
                              {': '}
                              <span className="text-muted-foreground">{block.details}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

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
