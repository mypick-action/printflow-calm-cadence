import React, { useState, useEffect } from 'react';
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
  Plus
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getPrinters, 
  getActiveCycleForPrinter, 
  getProject,
  getProduct,
  logCycleWithMaterialConsumption,
  Printer as PrinterType,
  PlannedCycle
} from '@/services/storage';

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

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Auto-select printer if pre-selected
    if (preSelectedPrinterId && printers.length > 0) {
      const cycle = printerCycles[preSelectedPrinterId];
      if (cycle) {
        setSelectedPrinter(preSelectedPrinterId);
        setActiveCycle(cycle);
        // Don't auto-advance to step 2, let user confirm first
      }
    }
  }, [preSelectedPrinterId, printers, printerCycles]);

  const loadData = () => {
    const allPrinters = getPrinters().filter(p => p.active);
    setPrinters(allPrinters);
    
    // Build printer cycles map with project info
    const cyclesMap: Record<string, CycleWithProject | null> = {};
    allPrinters.forEach(printer => {
      const cycle = getActiveCycleForPrinter(printer.id);
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
      // For completed, go directly to submit
      handleSubmitWithResult('completed');
    } else {
      setStep(3);
    }
  };

  const handleSubmitWithResult = (resultType: CycleResult) => {
    if (!activeCycle) return;

    let unitsCompleted = activeCycle.unitsPlanned;
    let unitsScrap = 0;
    let gramsWasted = 0;

    if (resultType === 'completed_with_scrap') {
      unitsCompleted = activeCycle.unitsPlanned - scrapUnits;
      unitsScrap = scrapUnits;
      // Auto-calculate grams wasted from scrap units
      gramsWasted = scrapUnits * activeCycle.gramsPerUnit;
    } else if (resultType === 'failed') {
      unitsCompleted = 0;
      unitsScrap = 0;
      gramsWasted = wastedGrams;
    }

    // Use the new function that handles material consumption
    const result = logCycleWithMaterialConsumption(
      {
        printerId: selectedPrinter,
        projectId: activeCycle.projectId,
        plannedCycleId: activeCycle.id,
        result: resultType,
        unitsCompleted,
        unitsScrap,
        gramsWasted,
      },
      activeCycle.color,
      activeCycle.gramsPerUnit,
      selectedPrinter
    );

    if (!result.success) {
      // Show error - not enough material
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? result.errorHe : result.error,
        variant: 'destructive',
      });
      return;
    }

    // Show success with material info
    const materialInfo = result.materialResult 
      ? (language === 'he' 
          ? `נוכו ${result.materialResult.gramsConsumed}g מהמלאי.`
          : `${result.materialResult.gramsConsumed}g deducted from inventory.`)
      : '';

    // Auto-replan is now triggered automatically by the material consumption
    // No need to call recalculatePlan manually
    
    toast({
      title: language === 'he' ? 'המחזור עודכן' : 'Cycle Updated',
      description: language === 'he' 
        ? `${materialInfo} התכנון יתעדכן אוטומטית.`
        : `${materialInfo} Plan will update automatically.`,
    });

    if (onComplete) {
      onComplete();
    } else {
      handleReset();
    }
  };

  const handleSubmit = () => {
    if (result) {
      handleSubmitWithResult(result);
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

      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3].map((s) => (
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
                  onClick={handleSubmit} 
                  className="w-full h-14 text-lg gap-2"
                  disabled={scrapUnits === 0}
                >
                  <Send className="w-5 h-5" />
                  {language === 'he' ? 'אישור' : 'Confirm'}
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
                  onClick={handleSubmit} 
                  className="w-full h-14 text-lg gap-2"
                  disabled={wastedGrams === 0}
                >
                  <Send className="w-5 h-5" />
                  {language === 'he' ? 'אישור' : 'Confirm'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
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
    </div>
  );
};
