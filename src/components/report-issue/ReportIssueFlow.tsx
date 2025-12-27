import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  AlertTriangle,
  Printer,
  Zap,
  PlayCircle,
  PauseCircle,
  HelpCircle,
  ChevronRight,
  CheckCircle2,
  Clock,
  Calendar,
  Timer,
  Package,
  ArrowRight,
  AlertCircle,
  Gauge,
  TrendingDown,
  Plus,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getPrinters, 
  getActiveCycleForPrinter, 
  getActiveProjects,
  createIssueReport,
  resolveIssue,
  getProject,
  getProduct,
  PlannedCycle,
  Project,
  Printer as PrinterType
} from '@/services/storage';
import {
  analyzeIssue,
  IssueContext,
  IssueAnalysis,
  RecoveryOption,
  IssueType,
} from '@/services/issueEngine';

interface ReportIssueFlowProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedPrinterId?: string;
  preselectedProjectId?: string;
}

type UIIssueType = 'power_outage' | 'print_not_started' | 'stopped_mid_cycle' | 'completed_with_defects' | 'other';

const issueTypes: { value: UIIssueType; labelHe: string; labelEn: string; icon: React.ElementType; engineType: IssueType }[] = [
  { value: 'power_outage', labelHe: 'הפסקת חשמל', labelEn: 'Power Outage', icon: Zap, engineType: 'interrupted_mid_cycle' },
  { value: 'print_not_started', labelHe: 'הדפסה לא התחילה', labelEn: 'Print did not start', icon: PlayCircle, engineType: 'printer_failure' },
  { value: 'stopped_mid_cycle', labelHe: 'הדפסה נעצרה באמצע', labelEn: 'Print stopped mid-cycle', icon: PauseCircle, engineType: 'interrupted_mid_cycle' },
  { value: 'completed_with_defects', labelHe: 'הושלם עם נפלים', labelEn: 'Completed with defects', icon: AlertCircle, engineType: 'completed_with_defects' },
  { value: 'other', labelHe: 'אחר', labelEn: 'Other', icon: HelpCircle, engineType: 'unknown' },
];

const getRecoveryIcon = (type: RecoveryOption['type']): React.ElementType => {
  switch (type) {
    case 'reduce_units': return TrendingDown;
    case 'add_cycle': return Plus;
    case 'change_spool': return Package;
    case 'extend_hours': return Clock;
    case 'defer_units': return Calendar;
    case 'move_printer': return Printer;
    case 'delay_project': return Calendar;
    default: return Timer;
  }
};

export const ReportIssueFlow: React.FC<ReportIssueFlowProps> = ({
  isOpen,
  onClose,
  preselectedPrinterId,
  preselectedProjectId,
}) => {
  const { language } = useLanguage();
  const [step, setStep] = useState(1);
  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState(preselectedPrinterId || '');
  const [activeCycle, setActiveCycle] = useState<PlannedCycle | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(preselectedProjectId || '');
  const [confirmedProject, setConfirmedProject] = useState(false);
  const [issueType, setIssueType] = useState<UIIssueType | ''>('');
  const [hadUnitsPrinted, setHadUnitsPrinted] = useState<boolean | null>(null);
  const [unitsPrinted, setUnitsPrinted] = useState(0);
  const [defectUnits, setDefectUnits] = useState(0);
  const [issueReportId, setIssueReportId] = useState<string | null>(null);
  const [issueAnalysis, setIssueAnalysis] = useState<IssueAnalysis | null>(null);
  const [selectedRecoveryId, setSelectedRecoveryId] = useState<string>('');

  useEffect(() => {
    setPrinters(getPrinters().filter(p => p.active));
  }, [isOpen]);

  useEffect(() => {
    if (selectedPrinterId) {
      const cycle = getActiveCycleForPrinter(selectedPrinterId);
      setActiveCycle(cycle || null);
      if (cycle) {
        setSelectedProjectId(cycle.projectId);
      }
    }
  }, [selectedPrinterId]);

  useEffect(() => {
    if (preselectedProjectId) {
      setConfirmedProject(true);
      setStep(2);
    }
  }, [preselectedProjectId]);

  const project = selectedProjectId ? getProject(selectedProjectId) : null;
  const product = project ? getProduct(project.productId) : null;
  const activeProjects = getActiveProjects();

  // Calculate planned units from active cycle or product preset
  const plannedUnits = useMemo(() => {
    if (activeCycle) return activeCycle.unitsPlanned;
    if (product) {
      const defaultPreset = product.platePresets.find(p => p.isRecommended) || product.platePresets[0];
      return defaultPreset?.unitsPerPlate || 8;
    }
    return 8;
  }, [activeCycle, product]);

  const handlePrinterSelect = (printerId: string) => {
    setSelectedPrinterId(printerId);
    const cycle = getActiveCycleForPrinter(printerId);
    if (cycle) {
      setActiveCycle(cycle);
      setSelectedProjectId(cycle.projectId);
      setStep(1.5);
    } else {
      setStep(1.6);
    }
  };

  const handleConfirmProject = (confirmed: boolean) => {
    if (confirmed) {
      setConfirmedProject(true);
      setStep(2);
    } else {
      setStep(1.6);
    }
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId);
    setConfirmedProject(true);
    setStep(2);
  };

  const handleIssueTypeSelect = (type: UIIssueType) => {
    setIssueType(type);
    if (type === 'completed_with_defects') {
      setStep(3.5); // Go to defects step
    } else {
      setStep(3);
    }
  };

  const runIssueAnalysis = () => {
    const issueTypeData = issueTypes.find(t => t.value === issueType);
    const engineType = issueTypeData?.engineType || 'unknown';
    
    // Calculate units lost based on issue type
    let unitsLost = 0;
    let gramsWasted = 0;
    
    if (issueType === 'completed_with_defects') {
      unitsLost = defectUnits;
      gramsWasted = product ? defectUnits * product.gramsPerUnit : 0;
    } else if (issueType === 'stopped_mid_cycle' || issueType === 'power_outage') {
      // If some units were printed, the lost units are the planned minus printed
      unitsLost = hadUnitsPrinted ? plannedUnits - unitsPrinted : plannedUnits;
      gramsWasted = product ? unitsLost * product.gramsPerUnit : 0;
    } else if (issueType === 'print_not_started') {
      unitsLost = 0; // Nothing was printed, nothing was wasted
    }

    const context: IssueContext = {
      printerId: selectedPrinterId,
      projectId: selectedProjectId,
      issueType: engineType,
      unitsLost,
      gramsWasted,
      cycleWasCompleted: issueType === 'completed_with_defects',
    };

    const analysis = analyzeIssue(context);
    setIssueAnalysis(analysis);
    
    // Create issue report
    const report = createIssueReport({
      printerId: selectedPrinterId,
      projectId: selectedProjectId,
      issueType: issueType as any,
      unitsPrinted: hadUnitsPrinted ? unitsPrinted : 0,
    });
    setIssueReportId(report.id);
    
    setStep(4);
  };

  const handleSubmitIssue = () => {
    runIssueAnalysis();
  };

  const handleSubmitDefects = () => {
    if (defectUnits > 0) {
      runIssueAnalysis();
    }
  };

  const handleSelectRecovery = (option: RecoveryOption) => {
    setSelectedRecoveryId(option.id);
    if (issueReportId) {
      resolveIssue(issueReportId, option.type);
    }
    setStep(5);
    
    toast({
      title: language === 'he' ? 'התכנון עודכן' : 'Planning Updated',
      description: language === 'he' ? option.description : option.descriptionEn,
    });
  };

  const handleClose = () => {
    // Reset state
    setStep(1);
    setSelectedPrinterId(preselectedPrinterId || '');
    setActiveCycle(null);
    setSelectedProjectId(preselectedProjectId || '');
    setConfirmedProject(!!preselectedProjectId);
    setIssueType('');
    setHadUnitsPrinted(null);
    setUnitsPrinted(0);
    setDefectUnits(0);
    setIssueReportId(null);
    setIssueAnalysis(null);
    setSelectedRecoveryId('');
    onClose();
  };

  const getSelectedRecovery = (): RecoveryOption | undefined => {
    return issueAnalysis?.recoveryOptions.find(o => o.id === selectedRecoveryId);
  };

  const getRecoveryInstructions = (): string[] => {
    const recovery = getSelectedRecovery();
    if (!recovery) {
      return language === 'he' 
        ? ['התכנון עודכן', 'המשיכו לעבוד כרגיל']
        : ['Planning updated', 'Continue working normally'];
    }

    switch (recovery.type) {
      case 'reduce_units':
        return language === 'he' 
          ? ['נקו את המגש', `הגדירו ${recovery.impact.unitsAffected} יחידות`, 'התחילו מחזור חדש']
          : ['Clean the tray', `Set ${recovery.impact.unitsAffected} units`, 'Start new cycle'];
      case 'add_cycle':
        return language === 'he'
          ? ['המחזור הנוכחי יסתיים כרגיל', 'מחזור נוסף יתוזמן מחר', 'אין צורך בפעולה נוספת כעת']
          : ['Current cycle will finish normally', 'Additional cycle scheduled for tomorrow', 'No action needed now'];
      case 'extend_hours':
        return language === 'he'
          ? ['יום העבודה הוארך', 'הוסיפו מחזור נוסף', 'זכרו לדווח בסיום']
          : ['Workday extended', 'Add one more cycle', 'Remember to report when done'];
      case 'change_spool':
        return language === 'he'
          ? ['החליפו את הגליל', 'ודאו שהצבע תואם', 'המשיכו עם המחזור']
          : ['Replace the spool', 'Verify color matches', 'Continue with cycle'];
      case 'defer_units':
        return language === 'he'
          ? ['חלק מהיחידות יופקו מחר', 'המשיכו במחזור הנוכחי', 'התכנון עודכן בהתאם']
          : ['Some units will be produced tomorrow', 'Continue with current cycle', 'Planning updated accordingly'];
      case 'delay_project':
        return language === 'he'
          ? ['תאריך היעד נדחה', 'עדכנו את הלקוח במידת הצורך', 'התכנון עודכן']
          : ['Due date postponed', 'Update customer if needed', 'Planning updated'];
      default:
        return language === 'he'
          ? ['התכנון עודכן', 'המשיכו לעבוד כרגיל']
          : ['Planning updated', 'Continue working normally'];
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            {language === 'he' ? 'דיווח על בעיה' : 'Report Issue'}
          </DialogTitle>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all duration-300 ${
                Math.floor(step) >= s ? 'w-6 bg-primary' : 'w-2 bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Select Printer */}
        {step === 1 && !preselectedPrinterId && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center text-muted-foreground">
              {language === 'he' ? 'באיזו מדפסת הבעיה?' : 'Which printer has the issue?'}
            </div>
            <div className="space-y-2">
              {printers.map((printer) => (
                <button
                  key={printer.id}
                  onClick={() => handlePrinterSelect(printer.id)}
                  className="w-full p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-accent transition-all text-start"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Printer className="w-5 h-5 text-primary" />
                      <span className="font-medium">{printer.name}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1.5: Confirm detected project */}
        {step === 1.5 && activeCycle && project && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center text-muted-foreground">
              {language === 'he' ? 'זיהינו את הפרויקט הפעיל:' : 'We detected the active project:'}
            </div>
            <Card className="border-2 border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="font-semibold text-lg">{project.name}</div>
                <div className="text-sm text-muted-foreground">
                  {activeCycle.unitsPlanned} {language === 'he' ? 'יחידות' : 'units'} • {project.color}
                </div>
              </CardContent>
            </Card>
            <div className="text-center text-sm text-muted-foreground">
              {language === 'he' ? 'האם זה הפרויקט הנכון?' : 'Is this the correct project?'}
            </div>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={() => handleConfirmProject(false)}
                className="flex-1"
              >
                {language === 'he' ? 'לא, בחר אחר' : 'No, select other'}
              </Button>
              <Button 
                onClick={() => handleConfirmProject(true)}
                className="flex-1"
              >
                {language === 'he' ? 'כן, זה הפרויקט' : 'Yes, this is it'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 1.6: Select project manually */}
        {step === 1.6 && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center text-muted-foreground">
              {language === 'he' ? 'בחרו את הפרויקט:' : 'Select the project:'}
            </div>
            <div className="space-y-2">
              {activeProjects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => handleProjectSelect(proj.id)}
                  className="w-full p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-accent transition-all text-start"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{proj.name}</div>
                      <div className="text-sm text-muted-foreground">{proj.productName} • {proj.color}</div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setStep(1)} className="w-full">
              {language === 'he' ? 'חזרה' : 'Back'}
            </Button>
          </div>
        )}

        {/* Step 2: What happened */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center text-muted-foreground">
              {language === 'he' ? 'מה קרה?' : 'What happened?'}
            </div>
            <div className="space-y-2">
              {issueTypes.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.value}
                    onClick={() => handleIssueTypeSelect(type.value)}
                    className="w-full p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-accent transition-all text-start"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        <Icon className="w-5 h-5 text-foreground" />
                      </div>
                      <span className="font-medium">
                        {language === 'he' ? type.labelHe : type.labelEn}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Any units printed? (for interruptions) */}
        {step === 3 && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center text-muted-foreground">
              {language === 'he' ? 'האם הודפסו יחידות כלשהן?' : 'Were any units printed?'}
            </div>
            
            <div className="flex gap-3">
              <Button
                variant={hadUnitsPrinted === false ? 'default' : 'outline'}
                onClick={() => setHadUnitsPrinted(false)}
                className="flex-1 h-16"
              >
                {language === 'he' ? 'לא' : 'No'}
              </Button>
              <Button
                variant={hadUnitsPrinted === true ? 'default' : 'outline'}
                onClick={() => setHadUnitsPrinted(true)}
                className="flex-1 h-16"
              >
                {language === 'he' ? 'כן' : 'Yes'}
              </Button>
            </div>

            {hadUnitsPrinted === true && (
              <div className="space-y-2 animate-fade-in">
                <Label>{language === 'he' ? 'כמה יחידות הודפסו?' : 'How many units were printed?'}</Label>
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setUnitsPrinted(Math.max(0, unitsPrinted - 1))}
                    className="h-14 w-14 text-xl"
                  >
                    -
                  </Button>
                  <div className="flex-1 text-center">
                    <div className="text-4xl font-bold">{unitsPrinted}</div>
                    <div className="text-sm text-muted-foreground">
                      {language === 'he' ? `מתוך ${plannedUnits} מתוכננות` : `out of ${plannedUnits} planned`}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setUnitsPrinted(Math.min(plannedUnits, unitsPrinted + 1))}
                    className="h-14 w-14 text-xl"
                  >
                    +
                  </Button>
                </div>
              </div>
            )}

            {hadUnitsPrinted !== null && (
              <Button 
                onClick={handleSubmitIssue}
                className="w-full h-12"
              >
                {language === 'he' ? 'המשך לניתוח' : 'Continue to Analysis'}
                <ArrowRight className="w-4 h-4 ms-2" />
              </Button>
            )}
          </div>
        )}

        {/* Step 3.5: Defect count */}
        {step === 3.5 && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center text-muted-foreground">
              {language === 'he' ? 'כמה יחידות נפלו / פגומות?' : 'How many units are defective?'}
            </div>
            
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setDefectUnits(Math.max(0, defectUnits - 1))}
                className="h-14 w-14 text-xl"
              >
                -
              </Button>
              <div className="flex-1 text-center">
                <div className="text-4xl font-bold text-destructive">{defectUnits}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? `מתוך ${plannedUnits} במחזור` : `out of ${plannedUnits} in cycle`}
                </div>
              </div>
              <Button
                variant="outline"
                size="lg"
                onClick={() => setDefectUnits(Math.min(plannedUnits, defectUnits + 1))}
                className="h-14 w-14 text-xl"
              >
                +
              </Button>
            </div>

            {product && defectUnits > 0 && (
              <div className="p-4 rounded-xl bg-muted">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {language === 'he' ? 'חומר שהושמד:' : 'Material wasted:'}
                  </span>
                  <span className="font-semibold">{defectUnits * product.gramsPerUnit}g</span>
                </div>
              </div>
            )}

            <Button 
              onClick={handleSubmitDefects}
              disabled={defectUnits === 0}
              className="w-full h-12"
            >
              {language === 'he' ? 'המשך לניתוח' : 'Continue to Analysis'}
              <ArrowRight className="w-4 h-4 ms-2" />
            </Button>
          </div>
        )}

        {/* Step 4: Issue Analysis & Recovery Options */}
        {step === 4 && issueAnalysis && (
          <div className="space-y-4 animate-fade-in">
            {/* Issue Summary */}
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
                  <div>
                    <div className="font-semibold text-destructive">
                      {language === 'he' ? 'בעיה זוהתה' : 'Issue Detected'}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {language === 'he' ? issueAnalysis.blockingReason : issueAnalysis.blockingReasonEn}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Context Info */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-muted-foreground">{language === 'he' ? 'יחידות נותרו' : 'Remaining'}</div>
                <div className="font-bold text-lg">{issueAnalysis.context.remainingUnits}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-muted-foreground">{language === 'he' ? 'זמן נותר היום' : 'Time Left Today'}</div>
                <div className="font-bold text-lg">{issueAnalysis.context.remainingTimeToday.toFixed(1)}h</div>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-muted-foreground">{language === 'he' ? 'ימים לדד-ליין' : 'Days to Due'}</div>
                <div className="font-bold text-lg">{issueAnalysis.context.remainingDaysUntilDue}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-muted-foreground">{language === 'he' ? 'פילמנט זמין' : 'Available Filament'}</div>
                <div className="font-bold text-lg">{issueAnalysis.context.availableFilament}g</div>
              </div>
            </div>

            {/* Recovery Options */}
            <div className="pt-2">
              <div className="text-center mb-3">
                <div className="font-semibold">
                  {language === 'he' ? 'אפשרויות התאוששות' : 'Recovery Options'}
                </div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'בחרו כיצד להמשיך' : 'Choose how to proceed'}
                </div>
              </div>
              
              <div className="space-y-2">
                {issueAnalysis.recoveryOptions.length > 0 ? (
                  issueAnalysis.recoveryOptions.map((option) => {
                    const Icon = getRecoveryIcon(option.type);
                    return (
                      <button
                        key={option.id}
                        onClick={() => handleSelectRecovery(option)}
                        className="w-full p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-accent transition-all text-start"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${option.resolvesIssue ? 'bg-success/10' : 'bg-warning/10'}`}>
                            <Icon className={`w-5 h-5 ${option.resolvesIssue ? 'text-success' : 'text-warning'}`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {language === 'he' ? option.title : option.titleEn}
                              </span>
                              {option.resolvesIssue && (
                                <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                                  {language === 'he' ? 'פותר' : 'Resolves'}
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {language === 'he' ? option.description : option.descriptionEn}
                            </div>
                            {/* Impact indicators */}
                            <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                              {option.impact.timeChange !== 0 && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {option.impact.timeChange > 0 ? '+' : ''}{option.impact.timeChange.toFixed(1)}h
                                </span>
                              )}
                              {option.impact.unitsAffected > 0 && (
                                <span className="flex items-center gap-1">
                                  <Gauge className="w-3 h-3" />
                                  {option.impact.unitsAffected} {language === 'he' ? 'יח׳' : 'units'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="text-center p-6 text-muted-foreground">
                    {language === 'he' 
                      ? 'לא נמצאו אפשרויות התאוששות אוטומטיות. צרו קשר עם מנהל.'
                      : 'No automatic recovery options found. Contact manager.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Resolution + Instructions */}
        {step === 5 && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center">
              <div className="inline-flex p-3 bg-success/10 rounded-2xl mb-4">
                <CheckCircle2 className="w-10 h-10 text-success" />
              </div>
              <h3 className="text-xl font-bold">
                {language === 'he' ? 'התכנון עודכן' : 'Planning Updated'}
              </h3>
              <p className="text-muted-foreground mt-1">
                {language === 'he' ? 'הנה מה שצריך לעשות עכשיו:' : "Here's what to do now:"}
              </p>
            </div>

            <div className="space-y-3">
              {getRecoveryInstructions().map((instruction, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-3 p-4 bg-muted rounded-xl"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {index + 1}
                  </div>
                  <span className="font-medium">{instruction}</span>
                </div>
              ))}
            </div>

            <Button onClick={handleClose} className="w-full h-12">
              {language === 'he' ? 'סיימתי' : 'Done'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
