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
  RotateCcw
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getPrinters, 
  getActiveCycleForPrinter, 
  getProject,
  logCycle,
  Printer as PrinterType,
  PlannedCycle
} from '@/services/storage';

type CycleResult = 'completed' | 'completed_with_scrap' | 'failed';
type WasteMethod = 'quick' | 'estimate' | 'manual';

export const EndCycleLog: React.FC = () => {
  const { language } = useLanguage();
  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [step, setStep] = useState(1);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [activeCycle, setActiveCycle] = useState<PlannedCycle | null>(null);
  const [result, setResult] = useState<CycleResult | ''>('');
  const [scrapUnits, setScrapUnits] = useState(0);
  const [wasteMethod, setWasteMethod] = useState<WasteMethod>('quick');
  const [wastedGrams, setWastedGrams] = useState(0);
  const [quickPickGrams, setQuickPickGrams] = useState<number | null>(null);

  useEffect(() => {
    setPrinters(getPrinters().filter(p => p.active));
  }, []);

  const handlePrinterSelect = (printerId: string) => {
    setSelectedPrinter(printerId);
    const cycle = getActiveCycleForPrinter(printerId);
    setActiveCycle(cycle || null);
    if (cycle) {
      setStep(2);
    }
  };

  const handleResultSelect = (resultValue: CycleResult) => {
    setResult(resultValue);
    if (resultValue === 'completed') {
      // Submit directly
      handleSubmit();
    } else {
      setStep(3);
    }
  };

  const handleSubmit = () => {
    toast({
      title: language === 'he' ? 'דיווח נשלח בהצלחה' : 'Report submitted successfully',
      description: language === 'he' 
        ? `מחזור של ${activeCycle?.projectName} דווח`
        : `Cycle for ${activeCycle?.projectName} reported`,
    });
    // Reset form
    setStep(1);
    setSelectedPrinter('');
    setActiveCycle(null);
    setResult('');
    setScrapUnits(0);
    setWasteMethod('quick');
    setWastedGrams(0);
    setQuickPickGrams(null);
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
  };

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
      label: language === 'he' ? 'הושלם עם פסולת' : 'Completed with Scrap',
      description: language === 'he' ? 'חלק מהיחידות נפסלו' : 'Some units were scrapped',
      color: 'text-warning',
      bgColor: 'bg-warning/10 border-warning/30 hover:bg-warning/20',
    },
    {
      value: 'failed' as CycleResult,
      icon: XCircle,
      label: language === 'he' ? 'נכשל / הופסק' : 'Failed / Stopped',
      description: language === 'he' ? 'המחזור לא הושלם' : 'Cycle did not complete',
      color: 'text-error',
      bgColor: 'bg-error/10 border-error/30 hover:bg-error/20',
    },
  ];

  const quickPickOptions = [50, 100, 200];

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex p-3 bg-primary/10 rounded-2xl">
          <ClipboardCheck className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">
          {language === 'he' ? 'דיווח סיום מחזור' : 'End-Cycle Report'}
        </h1>
        <p className="text-muted-foreground">
          {language === 'he' ? 'דווחו מה קרה בסוף מחזור ההדפסה' : 'Report what happened at the end of the print cycle'}
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
      {step === 1 && (
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
            {mockPrinters.map((printer) => {
              const cycle = mockPrinterCycles[printer.id];
              return (
                <button
                  key={printer.id}
                  onClick={() => handlePrinterSelect(printer.id)}
                  disabled={!cycle}
                  className={`
                    w-full p-4 rounded-xl border-2 text-start transition-all duration-200
                    ${cycle 
                      ? 'border-border hover:border-primary hover:bg-accent cursor-pointer' 
                      : 'border-border/50 bg-muted/30 cursor-not-allowed opacity-60'
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-foreground">{printer.name}</div>
                      {cycle ? (
                        <div className="text-sm text-muted-foreground mt-1">
                          {cycle.projectName} • {cycle.unitsPlanned} {language === 'he' ? 'יחידות' : 'units'}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground mt-1">
                          {language === 'he' ? 'אין מחזור פעיל' : 'No active cycle'}
                        </div>
                      )}
                    </div>
                    {cycle && <ChevronRight className="w-5 h-5 text-muted-foreground" />}
                  </div>
                </button>
              );
            })}
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
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                {language === 'he' ? 'חזרה' : 'Back'}
              </Button>
            </div>
            <div className="p-3 bg-muted rounded-lg mt-2">
              <div className="font-medium text-foreground">{activeCycle.projectName}</div>
              <div className="text-sm text-muted-foreground">
                {activeCycle.unitsPlanned} {language === 'he' ? 'יחידות' : 'units'} • {activeCycle.color}
              </div>
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
                  ? (language === 'he' ? 'פרטי הפסולת' : 'Scrap Details')
                  : (language === 'he' ? 'פרטי הכשל' : 'Failure Details')
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
                    {language === 'he' ? 'כמה יחידות נפסלו?' : 'How many units were scrapped?'}
                  </Label>
                  <div className="flex items-center gap-4">
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setScrapUnits(Math.max(0, scrapUnits - 1))}
                      className="h-14 w-14 text-xl"
                    >
                      -
                    </Button>
                    <div className="flex-1 text-center">
                      <div className="text-4xl font-bold text-foreground">{scrapUnits}</div>
                      <div className="text-sm text-muted-foreground">
                        {language === 'he' ? 'יחידות' : 'units'}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setScrapUnits(scrapUnits + 1)}
                      className="h-14 w-14 text-xl"
                    >
                      +
                    </Button>
                  </div>
                </div>
                
                <Button 
                  onClick={handleSubmit} 
                  className="w-full h-14 text-lg gap-2"
                  disabled={scrapUnits === 0}
                >
                  <Send className="w-5 h-5" />
                  {language === 'he' ? 'שלח דיווח' : 'Submit Report'}
                </Button>
              </div>
            )}

            {result === 'failed' && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-base">
                    {language === 'he' ? 'כמה חומר בוזבז?' : 'How much material was wasted?'}
                  </Label>
                  
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
                  {language === 'he' ? 'שלח דיווח' : 'Submit Report'}
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
          className="w-full gap-2 text-muted-foreground"
        >
          <RotateCcw className="w-4 h-4" />
          {language === 'he' ? 'התחל מחדש' : 'Start Over'}
        </Button>
      )}
    </div>
  );
};
