import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { 
  ClipboardCheck, 
  Printer, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  ChevronRight,
  Send,
  RotateCcw,
  ArrowRight,
  Package,
  Minus,
  Plus,
  Undo2,
  FlaskConical,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getPrinters, 
  getPlannedCycles,
  getProject,
  getProduct,
  logCycleWithMaterialConsumption,
  createProject,
  updatePlannedCycle,
  deleteProject,
  Printer as PrinterType,
  PlannedCycle
} from '@/services/storage';
import { analyzeDecisionOptions, DecisionOption, DecisionAnalysis } from '@/services/impactAnalysis';
import { 
  logDecision, 
  createComputedImpact, 
  canUndoDecision, 
  getUndoTimeRemaining,
  markDecisionUndone,
  DecisionLogEntry
} from '@/services/decisionLog';
import { logEndCycleEvent } from '@/services/endCycleEventLog';
import { DecisionModal } from './DecisionModal';
import { RecoveryInputStep, RecoveryInputData } from './RecoveryInputStep';
import { TestModePanel } from '@/components/dev/TestModePanel';

type CycleResult = 'completed' | 'completed_with_scrap' | 'failed';
type WasteMethod = 'quick' | 'estimate' | 'manual';

interface CycleWithProject extends PlannedCycle {
  projectName: string;
  productName: string;
  color: string;
  gramsPerUnit: number;
}

interface EndCycleLogProps {
  preSelectedPrinterId?: string;
  onComplete?: () => void;
}

export const EndCycleLog: React.FC<EndCycleLogProps> = ({ preSelectedPrinterId, onComplete }) => {
  const { language } = useLanguage();
  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [printerCycles, setPrinterCycles] = useState<Record<string, CycleWithProject | null>>({});
  const [step, setStep] = useState(1);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [activeCycle, setActiveCycle] = useState<CycleWithProject | null>(null);
  const [result, setResult] = useState<CycleResult | ''>('');
  const [scrapUnits, setScrapUnits] = useState(0);
  const [wasteMethod, setWasteMethod] = useState<WasteMethod>('quick');
  const [wastedGrams, setWastedGrams] = useState(0);
  const [quickPickGrams, setQuickPickGrams] = useState<number | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  
  // NEW: Decision modal state
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [decisionAnalysis, setDecisionAnalysis] = useState<DecisionAnalysis | null>(null);
  const [pendingResult, setPendingResult] = useState<CycleResult | null>(null);
  
  // Recovery input data state
  const [recoveryInputData, setRecoveryInputData] = useState<RecoveryInputData | null>(null);
  
  // Undo state
  const [lastDecisionId, setLastDecisionId] = useState<string | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(0);
  
  // Test mode state (developer only)
  const [showTestMode, setShowTestMode] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (preSelectedPrinterId && printers.length > 0) {
      const cycle = printerCycles[preSelectedPrinterId];
      if (cycle) {
        setSelectedPrinter(preSelectedPrinterId);
        setActiveCycle(cycle);
      }
    }
  }, [preSelectedPrinterId, printers, printerCycles]);

  const loadData = () => {
    const allPrinters = getPrinters().filter(p => p.active);
    setPrinters(allPrinters);
    
    const cyclesMap: Record<string, CycleWithProject | null> = {};
    const allCycles = getPlannedCycles();
    
    allPrinters.forEach(printer => {
      let cycle = allCycles.find(c => c.printerId === printer.id && c.status === 'in_progress');
      
      if (!cycle) {
        const pendingCycles = allCycles
          .filter(c => c.printerId === printer.id && c.status === 'planned')
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        cycle = pendingCycles[0];
      }
      
      if (cycle) {
        const project = getProject(cycle.projectId);
        const product = project ? getProduct(project.productId) : null;
        cyclesMap[printer.id] = {
          ...cycle,
          projectName: project?.name || 'Unknown Project',
          productName: product?.name || project?.productName || 'Unknown Product',
          color: project?.color || '',
          gramsPerUnit: product?.gramsPerUnit || 0,
        };
      } else {
        cyclesMap[printer.id] = null;
      }
    });
    setPrinterCycles(cyclesMap);
  };

  const handlePrinterSelect = (printerId: string) => {
    setSelectedPrinter(printerId);
    const cycle = printerCycles[printerId];
    setActiveCycle(cycle);
    setIsConfirmed(false);
  };

  const handleConfirmCycle = () => {
    setIsConfirmed(true);
    setStep(2);
  };

  const handleResultSelect = (resultValue: CycleResult) => {
    setResult(resultValue);
    if (resultValue === 'completed') {
      handleSubmitWithResult('completed');
    } else {
      setStep(3);
    }
  };

  // NEW: Proceed to recovery input step (step 4)
  const handleProceedToRecoveryInput = () => {
    if (!activeCycle || !result) return;
    setStep(4); // Go to recovery input step
  };

  // NEW: Handle recovery input submission - now uses user-provided data for analysis
  const handleRecoveryInputSubmit = (data: RecoveryInputData) => {
    if (!activeCycle || !result) return;
    
    setRecoveryInputData(data);
    
    const unitsToRecover = result === 'completed_with_scrap' ? scrapUnits : activeCycle.unitsPlanned;
    const gramsLost = result === 'completed_with_scrap' 
      ? scrapUnits * activeCycle.gramsPerUnit 
      : wastedGrams;
    
    // Analyze options using user-provided estimated hours
    try {
      const analysis = analyzeDecisionOptions(
        activeCycle.projectId,
        unitsToRecover,
        gramsLost,
        data.estimatedPrintHours, // Use user-provided estimate instead of default
        data.needsSpoolChange // Pass material availability info
      );
      setDecisionAnalysis(analysis);
      setPendingResult(result);
      setShowDecisionModal(true);
    } catch (error) {
      console.error('Error analyzing decision options:', error);
      // Fallback to old behavior if analysis fails
      handleSubmitWithResult(result);
    }
  };

  // Handle decision from modal with logging and undo support
  const handleDecision = (decision: DecisionOption, mergeCycleId?: string) => {
    if (!activeCycle || !pendingResult || !decisionAnalysis) return;

    // Capture state before
    const cyclesBefore = getPlannedCycles();
    const projectBefore = getProject(activeCycle.projectId);

    const printer = printers.find(p => p.id === selectedPrinter);
    let unitsCompleted = activeCycle.unitsPlanned;
    let unitsScrap = 0;
    let gramsWasted = 0;

    if (pendingResult === 'completed_with_scrap') {
      unitsCompleted = activeCycle.unitsPlanned - scrapUnits;
      unitsScrap = scrapUnits;
      gramsWasted = scrapUnits * activeCycle.gramsPerUnit;
    } else if (pendingResult === 'failed') {
      unitsCompleted = 0;
      unitsScrap = 0;
      gramsWasted = wastedGrams;
    }

    const unitsToRecover = pendingResult === 'completed_with_scrap' ? scrapUnits : activeCycle.unitsPlanned;

    // Log cycle
    const logResult = logCycleWithMaterialConsumption(
      {
        printerId: selectedPrinter,
        projectId: activeCycle.projectId,
        plannedCycleId: activeCycle.id,
        result: pendingResult,
        unitsCompleted,
        unitsScrap: decision === 'ignore' ? unitsScrap : 0,
        gramsWasted,
      },
      activeCycle.color,
      activeCycle.gramsPerUnit,
      selectedPrinter
    );

    if (!logResult.success) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? logResult.errorHe : logResult.error,
        variant: 'destructive',
      });
      return;
    }

    const project = getProject(activeCycle.projectId);
    let createdProjectId: string | undefined;
    let previousMergedUnits: number | undefined;

    // Execute decision
    if (decision === 'complete_now' || decision === 'defer_to_later') {
      if (project) {
        const newProject = createProject({
          name: `${project.name} - השלמה`,
          productId: project.productId,
          productName: project.productName,
          preferredPresetId: undefined,
          quantityTarget: unitsToRecover,
          dueDate: project.dueDate,
          urgency: decision === 'complete_now' ? 'critical' : 'urgent',
          urgencyManualOverride: true,
          status: 'pending',
          color: project.color,
          parentProjectId: project.id,
        });
        createdProjectId = newProject?.id;
      }
    } else if (decision === 'merge_with_future' && mergeCycleId) {
      const cycles = getPlannedCycles();
      const targetCycle = cycles.find(c => c.id === mergeCycleId);
      if (targetCycle) {
        previousMergedUnits = targetCycle.unitsPlanned;
        updatePlannedCycle(mergeCycleId, {
          unitsPlanned: targetCycle.unitsPlanned + unitsToRecover,
          gramsPlanned: (targetCycle.gramsPlanned || 0) + (unitsToRecover * activeCycle.gramsPerUnit),
        });
      }
    }

    // Log decision with computed impact
    const completeNowOption = decisionAnalysis.options.find(o => o.option === 'complete_now');
    const decisionEntry = logDecision({
      printerId: selectedPrinter,
      printerName: printer?.name || 'Unknown',
      projectId: activeCycle.projectId,
      projectName: activeCycle.projectName,
      cycleId: activeCycle.id,
      cycleResult: pendingResult === 'failed' ? 'failed' : 'completed_with_scrap',
      unitsToRecover,
      gramsWasted,
      estimatedPrintHours: recoveryInputData?.estimatedPrintHours || 2.5,
      needsSpoolChange: recoveryInputData?.needsSpoolChange || false,
      decision,
      mergeCycleId,
      computedImpact: createComputedImpact(completeNowOption?.impact || null),
      undoData: {
        createdProjectId,
        mergedCycleId: mergeCycleId,
        previousMergedUnits,
      },
    });

    // Capture state after and log event
    const cyclesAfter = getPlannedCycles();
    const projectAfter = getProject(activeCycle.projectId);
    
    logEndCycleEvent({
      ts: new Date().toISOString(),
      cycleId: activeCycle.id,
      printerId: selectedPrinter,
      projectId: activeCycle.projectId,
      decision,
      inputs: {
        result: pendingResult,
        unitsCompleted,
        unitsScrap,
        unitsToRecover,
        gramsWasted,
        cycleStatusBefore: activeCycle.status,
        plannedCyclesBefore: cyclesBefore.length,
        projectProgressBefore: {
          quantityGood: projectBefore?.quantityGood || 0,
          quantityScrap: projectBefore?.quantityScrap || 0,
          quantityTarget: projectBefore?.quantityTarget || 0,
        },
      },
      outputs: {
        cycleStatusAfter: 'completed',
        plannedCyclesAfter: cyclesAfter.length,
        projectProgressAfter: {
          quantityGood: projectAfter?.quantityGood || 0,
          quantityScrap: projectAfter?.quantityScrap || 0,
          quantityTarget: projectAfter?.quantityTarget || 0,
        },
        remakeProjectCreated: createdProjectId,
        mergeCycleId,
      },
      computedImpact: {
        dominoEffect: completeNowOption?.impact?.dominoEffect?.map(d => ({
          cycleId: d.cycleId,
          delayHours: d.delayHours,
          crossesDeadline: d.crossesDeadline,
        })),
        deferAnalysis: decisionAnalysis.deferAnalysis ? {
          latestStart: decisionAnalysis.deferAnalysis.latestStart || '',
          estimatedStart: decisionAnalysis.deferAnalysis.estimatedStart || '',
          riskLevel: decisionAnalysis.deferAnalysis.riskLevel,
        } : undefined,
      },
      replanTriggered: true,
    });

    setLastDecisionId(decisionEntry.id);
    setUndoCountdown(30);

    // Start undo countdown
    const interval = setInterval(() => {
      setUndoCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setLastDecisionId(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    toast({
      title: language === 'he' ? 'ההחלטה נרשמה' : 'Decision Recorded',
      description: language === 'he' 
        ? `${unitsToRecover} יחידות • לחץ לביטול (${30}s)`
        : `${unitsToRecover} units • Click to undo (${30}s)`,
      action: (
        <Button variant="outline" size="sm" onClick={() => handleUndo(decisionEntry.id)}>
          <Undo2 className="w-4 h-4 mr-1" />
          {language === 'he' ? 'בטל' : 'Undo'}
        </Button>
      ),
    });

    if (onComplete) {
      onComplete();
    } else {
      handleReset();
    }
  };

  // Undo a decision
  const handleUndo = useCallback((decisionId: string) => {
    if (!canUndoDecision(decisionId)) {
      toast({
        title: language === 'he' ? 'לא ניתן לבטל' : 'Cannot Undo',
        description: language === 'he' ? 'עברו 30 שניות' : '30 seconds have passed',
        variant: 'destructive',
      });
      return;
    }

    const entry = markDecisionUndone(decisionId);
    if (!entry) return;

    // Reverse the action
    if (entry.undoData.createdProjectId) {
      deleteProject(entry.undoData.createdProjectId);
    }
    if (entry.undoData.mergedCycleId && entry.undoData.previousMergedUnits !== undefined) {
      updatePlannedCycle(entry.undoData.mergedCycleId, {
        unitsPlanned: entry.undoData.previousMergedUnits,
      });
    }

    setLastDecisionId(null);
    setUndoCountdown(0);

    toast({
      title: language === 'he' ? 'הפעולה בוטלה' : 'Action Undone',
      description: language === 'he' ? 'ההחלטה בוטלה בהצלחה' : 'Decision successfully reversed',
    });
  }, [language]);

  // Legacy direct submit for 'completed' result only
  const handleSubmitWithResult = (resultType: CycleResult) => {
    if (!activeCycle) return;

    // Capture state before
    const cyclesBefore = getPlannedCycles();
    const projectBefore = getProject(activeCycle.projectId);

    const logResult = logCycleWithMaterialConsumption(
      {
        printerId: selectedPrinter,
        projectId: activeCycle.projectId,
        plannedCycleId: activeCycle.id,
        result: resultType,
        unitsCompleted: activeCycle.unitsPlanned,
        unitsScrap: 0,
        gramsWasted: 0,
      },
      activeCycle.color,
      activeCycle.gramsPerUnit,
      selectedPrinter
    );

    if (!logResult.success) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? logResult.errorHe : logResult.error,
        variant: 'destructive',
      });
      return;
    }

    // Capture state after
    const cyclesAfter = getPlannedCycles();
    const projectAfter = getProject(activeCycle.projectId);

    // Log event
    logEndCycleEvent({
      ts: new Date().toISOString(),
      cycleId: activeCycle.id,
      printerId: selectedPrinter,
      projectId: activeCycle.projectId,
      decision: 'completed_successfully',
      inputs: {
        result: resultType,
        unitsCompleted: activeCycle.unitsPlanned,
        unitsScrap: 0,
        unitsToRecover: 0,
        gramsWasted: 0,
        cycleStatusBefore: activeCycle.status,
        plannedCyclesBefore: cyclesBefore.length,
        projectProgressBefore: {
          quantityGood: projectBefore?.quantityGood || 0,
          quantityScrap: projectBefore?.quantityScrap || 0,
          quantityTarget: projectBefore?.quantityTarget || 0,
        },
      },
      outputs: {
        cycleStatusAfter: 'completed',
        plannedCyclesAfter: cyclesAfter.length,
        projectProgressAfter: {
          quantityGood: projectAfter?.quantityGood || 0,
          quantityScrap: projectAfter?.quantityScrap || 0,
          quantityTarget: projectAfter?.quantityTarget || 0,
        },
      },
      replanTriggered: true,
    });

    toast({
      title: language === 'he' ? 'המחזור הושלם' : 'Cycle Completed',
      description: language === 'he' 
        ? `${activeCycle.unitsPlanned} יחידות הושלמו בהצלחה.`
        : `${activeCycle.unitsPlanned} units completed successfully.`,
    });

    if (onComplete) {
      onComplete();
    } else {
      handleReset();
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedPrinter('');
    setActiveCycle(null);
    setResult('');
    setScrapUnits(0);
    setWasteMethod('quick');
    setWastedGrams(0);
    setQuickPickGrams(null);
    setIsConfirmed(false);
    setShowDecisionModal(false);
    setDecisionAnalysis(null);
    setPendingResult(null);
    setRecoveryInputData(null);
    loadData();
  };

  // Calculate wasted grams from scrap units automatically
  const calculatedWastedGrams = scrapUnits * (activeCycle?.gramsPerUnit || 0);

  const resultOptions = [
    {
      value: 'completed' as CycleResult,
      icon: CheckCircle2,
      label: language === 'he' ? 'הושלם בהצלחה' : 'Completed Successfully',
      description: language === 'he' ? 'כל היחידות הודפסו כמתוכנן' : 'All units printed as planned',
      color: 'text-success',
      bgColor: 'bg-success/10 border-success/30 hover:bg-success/20',
    },
    {
      value: 'completed_with_scrap' as CycleResult,
      icon: AlertTriangle,
      label: language === 'he' ? 'הושלם עם נפלים' : 'Completed with Defects',
      description: language === 'he' ? 'המחזור הסתיים אך חלק מהיחידות פסולות' : 'Cycle finished but some units are defective',
      color: 'text-warning',
      bgColor: 'bg-warning/10 border-warning/30 hover:bg-warning/20',
    },
    {
      value: 'failed' as CycleResult,
      icon: XCircle,
      label: language === 'he' ? 'נתקע / נעצר באמצע' : 'Stopped / Failed',
      description: language === 'he' ? 'המחזור לא הושלם' : 'Cycle did not complete',
      color: 'text-error',
      bgColor: 'bg-error/10 border-error/30 hover:bg-error/20',
    },
  ];

  const quickPickOptions = [50, 100, 200];

  const printersWithCycles = printers.filter(p => printerCycles[p.id] !== null);
  const printersWithoutCycles = printers.filter(p => printerCycles[p.id] === null);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Developer Test Mode Toggle */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTestMode(!showTestMode)}
          className="text-xs text-muted-foreground hover:text-warning"
        >
          <FlaskConical className="w-3 h-3 mr-1" />
          Test Mode
        </Button>
      </div>

      {/* Test Mode Panel */}
      {showTestMode && (
        <TestModePanel 
          onClose={() => setShowTestMode(false)}
          onScenarioSeeded={() => loadData()}
        />
      )}

      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex p-3 bg-primary/10 rounded-2xl">
          <ClipboardCheck className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">
          {language === 'he' ? 'דיווח סיום מחזור' : 'End Cycle Report'}
        </h1>
        <p className="text-muted-foreground">
          {language === 'he' ? 'דווחו על תוצאת מחזור ההדפסה' : 'Report the result of the print cycle'}
        </p>
      </div>

      {/* Progress indicator - dynamic based on flow */}
      <div className="flex items-center justify-center gap-2">
        {(result === 'completed' ? [1, 2] : [1, 2, 3, 4]).map((s) => (
          <div
            key={s}
            className={`h-2 rounded-full transition-all duration-300 ${
              s === step ? 'w-8 bg-primary' : s < step ? 'w-2 bg-primary/50' : 'w-2 bg-muted'
            }`}
          />
        ))}
      </div>

      {/* Step 1: Select Printer */}
      {step === 1 && !isConfirmed && (
        <Card variant="elevated" className="animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Printer className="w-5 h-5 text-primary" />
              {language === 'he' ? 'בחרו מדפסת' : 'Select Printer'}
            </CardTitle>
            <CardDescription>
              {language === 'he' ? 'איזו מדפסת סיימה מחזור?' : 'Which printer finished a cycle?'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Printers with active cycles */}
            {printersWithCycles.map((printer) => {
              const cycle = printerCycles[printer.id]!;
              const isSelected = selectedPrinter === printer.id;
              return (
                <button
                  key={printer.id}
                  onClick={() => handlePrinterSelect(printer.id)}
                  className={`
                    w-full p-4 rounded-xl border-2 text-start transition-all duration-200
                    ${isSelected 
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20' 
                      : 'border-border hover:border-primary/50 hover:bg-accent cursor-pointer'
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-foreground">{printer.name}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {cycle.projectName} • {cycle.unitsPlanned} {language === 'he' ? 'יחידות' : 'units'}
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </button>
              );
            })}

            {/* Printers without active cycles */}
            {printersWithoutCycles.map((printer) => (
              <div
                key={printer.id}
                className="w-full p-4 rounded-xl border-2 border-border/50 bg-muted/30 opacity-60"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-foreground">{printer.name}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {language === 'he' ? 'אין מחזור פעיל' : 'No active cycle'}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {printersWithCycles.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{language === 'he' ? 'אין מחזורים פעילים כרגע' : 'No active cycles at the moment'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmation Card */}
      {step === 1 && selectedPrinter && activeCycle && !isConfirmed && (
        <Card variant="elevated" className="animate-fade-in border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg">
              {language === 'he' ? 'אישור מחזור' : 'Confirm Cycle'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {language === 'he' ? 'פרויקט:' : 'Project:'}
                </span>
                <span className="font-medium text-foreground">{activeCycle.projectName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {language === 'he' ? 'מוצר:' : 'Product:'}
                </span>
                <span className="font-medium text-foreground">{activeCycle.productName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {language === 'he' ? 'יחידות מתוכננות:' : 'Planned Units:'}
                </span>
                <span className="font-medium text-foreground">{activeCycle.unitsPlanned}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {language === 'he' ? 'צבע:' : 'Color:'}
                </span>
                <span className="font-medium text-foreground">{activeCycle.color}</span>
              </div>
            </div>
            
            <Button 
              onClick={handleConfirmCycle} 
              className="w-full h-14 text-lg gap-2"
            >
              {language === 'he' ? 'המשך לדיווח' : 'Continue to Report'}
              <ArrowRight className="w-5 h-5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Select Result */}
      {step === 2 && activeCycle && (
        <Card variant="elevated" className="animate-fade-in">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {language === 'he' ? 'מה קרה?' : 'What happened?'}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => { setStep(1); setIsConfirmed(false); }}>
                {language === 'he' ? 'חזרה' : 'Back'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {resultOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => handleResultSelect(option.value)}
                  className={`
                    w-full p-4 rounded-xl border-2 text-start transition-all duration-200
                    ${option.bgColor}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg bg-background ${option.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className={`font-semibold ${option.color}`}>{option.label}</div>
                      <div className="text-sm text-muted-foreground">{option.description}</div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Details based on result */}
      {step === 3 && (
        <Card variant="elevated" className="animate-fade-in">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {result === 'completed_with_scrap' 
                  ? (language === 'he' ? 'כמה יחידות נפלו?' : 'How many units failed?')
                  : (language === 'he' ? 'כמה חומר בוזבז?' : 'How much material was wasted?')
                }
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                {language === 'he' ? 'חזרה' : 'Back'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {result === 'completed_with_scrap' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-base">
                    {language === 'he' ? 'מספר יחידות פסולות' : 'Number of defective units'}
                  </Label>
                  <div className="flex items-center gap-4">
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setScrapUnits(Math.max(0, scrapUnits - 1))}
                      className="h-14 w-14 text-xl"
                    >
                      <Minus className="w-5 h-5" />
                    </Button>
                    <div className="flex-1 text-center">
                      <div className="text-4xl font-bold text-foreground">{scrapUnits}</div>
                      <div className="text-sm text-muted-foreground">
                        {language === 'he' ? `מתוך ${activeCycle?.unitsPlanned} יחידות` : `of ${activeCycle?.unitsPlanned} units`}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setScrapUnits(Math.min(activeCycle?.unitsPlanned || 0, scrapUnits + 1))}
                      className="h-14 w-14 text-xl"
                    >
                      <Plus className="w-5 h-5" />
                    </Button>
                  </div>
                </div>

                {/* Auto-calculated grams */}
                {scrapUnits > 0 && activeCycle?.gramsPerUnit && activeCycle.gramsPerUnit > 0 && (
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <span className="text-sm text-muted-foreground">
                      {language === 'he' ? 'חומר שבוזבז:' : 'Material wasted:'}
                    </span>
                    <span className="font-bold text-foreground ms-2">
                      {calculatedWastedGrams}g
                    </span>
                  </div>
                )}
                
                <Button 
                  onClick={handleProceedToRecoveryInput} 
                  className="w-full h-14 text-lg gap-2"
                  disabled={scrapUnits === 0}
                >
                  <ArrowRight className="w-5 h-5" />
                  {language === 'he' ? 'המשך' : 'Continue'}
                </Button>
              </div>
            )}

            {result === 'failed' && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {language === 'he' 
                      ? 'אם לא ידוע בדיוק – הערכה מספיקה' 
                      : "If exact amount is unknown – an estimate is fine"}
                  </p>
                  
                  <RadioGroup 
                    value={wasteMethod} 
                    onValueChange={(v) => setWasteMethod(v as WasteMethod)}
                    className="space-y-3"
                  >
                    {/* Quick Pick */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="quick" id="quick" />
                        <Label htmlFor="quick" className="font-medium cursor-pointer">
                          {language === 'he' ? 'בחירה מהירה' : 'Quick Pick'}
                        </Label>
                      </div>
                      {wasteMethod === 'quick' && (
                        <div className="flex gap-2 ps-6">
                          {quickPickOptions.map((grams) => (
                            <Button
                              key={grams}
                              variant={quickPickGrams === grams ? 'default' : 'outline'}
                              onClick={() => {
                                setQuickPickGrams(grams);
                                setWastedGrams(grams);
                              }}
                              className="flex-1"
                            >
                              {grams}g
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Estimate */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="estimate" id="estimate" />
                        <Label htmlFor="estimate" className="font-medium cursor-pointer">
                          {language === 'he' ? 'הערכה לפי משקל נותר' : 'Estimate from remaining weight'}
                        </Label>
                      </div>
                      {wasteMethod === 'estimate' && (
                        <div className="ps-6">
                          <Input
                            type="number"
                            placeholder={language === 'he' ? 'משקל נותר בגליל (גרם)' : 'Remaining spool weight (grams)'}
                            className="h-12"
                            onChange={(e) => {
                              // Simple estimation logic
                              const remaining = parseInt(e.target.value) || 0;
                              setWastedGrams(Math.max(0, 1000 - remaining));
                            }}
                          />
                          <p className="text-sm text-muted-foreground mt-1">
                            {language === 'he' ? `חומר שבוזבז: ${wastedGrams}g` : `Wasted material: ${wastedGrams}g`}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Manual */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="manual" id="manual" />
                        <Label htmlFor="manual" className="font-medium cursor-pointer">
                          {language === 'he' ? 'הזנה ידנית' : 'Manual Entry'}
                        </Label>
                      </div>
                      {wasteMethod === 'manual' && (
                        <div className="ps-6">
                          <Input
                            type="number"
                            placeholder={language === 'he' ? 'גרמים שבוזבזו' : 'Grams wasted'}
                            className="h-12"
                            value={wastedGrams || ''}
                            onChange={(e) => setWastedGrams(parseInt(e.target.value) || 0)}
                          />
                        </div>
                      )}
                    </div>
                  </RadioGroup>
                </div>

                <Button 
                  onClick={handleProceedToRecoveryInput} 
                  className="w-full h-14 text-lg gap-2"
                  disabled={wastedGrams === 0}
                >
                  <ArrowRight className="w-5 h-5" />
                  {language === 'he' ? 'המשך' : 'Continue'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: Recovery Input - collect estimated print time and material availability */}
      {step === 4 && activeCycle && (
        <RecoveryInputStep
          unitsToRecover={result === 'completed_with_scrap' ? scrapUnits : activeCycle.unitsPlanned}
          gramsPerUnit={activeCycle.gramsPerUnit}
          color={activeCycle.color}
          onSubmit={handleRecoveryInputSubmit}
          onBack={() => setStep(3)}
        />
      )}

      {/* Reset Button */}
      {step > 1 && (
        <Button 
          variant="ghost" 
          onClick={handleReset}
          className="w-full gap-2 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="w-4 h-4" />
          {language === 'he' ? 'התחל מחדש' : 'Start Over'}
        </Button>
      )}

      {/* Decision Modal */}
      <DecisionModal
        open={showDecisionModal}
        onOpenChange={setShowDecisionModal}
        analysis={decisionAnalysis}
        cycleResult={pendingResult === 'failed' ? 'failed' : 'completed_with_scrap'}
        onDecision={handleDecision}
      />
    </div>
  );
};
