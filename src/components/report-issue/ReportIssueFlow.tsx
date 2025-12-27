import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Truck,
  Timer,
  RotateCcw,
  X
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getPrinters, 
  getActiveCycleForPrinter, 
  getActiveProjects,
  createIssueReport,
  resolveIssue,
  getProject,
  PlannedCycle,
  Project,
  Printer as PrinterType
} from '@/services/storage';

interface ReportIssueFlowProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedPrinterId?: string;
  preselectedProjectId?: string;
}

type IssueType = 'power_outage' | 'print_not_started' | 'stopped_mid_cycle' | 'other';
type RecoveryOption = 'reduce_units' | 'cancel_end_of_day' | 'delay_project' | 'outsource' | 'overtime';

interface RecoveryOptionData {
  id: RecoveryOption;
  icon: React.ElementType;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
}

const issueTypes: { value: IssueType; labelHe: string; labelEn: string; icon: React.ElementType }[] = [
  { value: 'power_outage', labelHe: 'הפסקת חשמל', labelEn: 'Power Outage', icon: Zap },
  { value: 'print_not_started', labelHe: 'הדפסה לא התחילה', labelEn: 'Print did not start', icon: PlayCircle },
  { value: 'stopped_mid_cycle', labelHe: 'הדפסה נעצרה באמצע', labelEn: 'Print stopped mid-cycle', icon: PauseCircle },
  { value: 'other', labelHe: 'אחר', labelEn: 'Other', icon: HelpCircle },
];

const recoveryOptions: RecoveryOptionData[] = [
  {
    id: 'reduce_units',
    icon: Timer,
    title: 'הפחת יחידות במחזורים הבאים',
    titleEn: 'Reduce units per upcoming cycles',
    description: 'המערכת תתאים את כמות היחידות במחזורים הבאים',
    descriptionEn: 'System will adjust unit count in upcoming cycles',
  },
  {
    id: 'cancel_end_of_day',
    icon: Clock,
    title: 'בטל מחזור סוף יום',
    titleEn: 'Cancel end-of-day cycle',
    description: 'לא נשלח מחזור בסוף יום העבודה',
    descriptionEn: 'No cycle will be sent at end of workday',
  },
  {
    id: 'delay_project',
    icon: Calendar,
    title: 'דחה את הפרויקט',
    titleEn: 'Delay project',
    description: 'עדכן את תאריך היעד של הפרויקט',
    descriptionEn: 'Update the project due date',
  },
  {
    id: 'outsource',
    icon: Truck,
    title: 'מיקור חוץ ליחידות שנותרו',
    titleEn: 'Outsource remaining units',
    description: 'שלח את היחידות הנותרות לייצור חיצוני',
    descriptionEn: 'Send remaining units to external production',
  },
  {
    id: 'overtime',
    icon: Timer,
    title: 'הוסף שעות נוספות היום',
    titleEn: 'Add overtime today',
    description: 'הארכה חד-פעמית של יום העבודה',
    descriptionEn: 'One-time extension of today\'s workday',
  },
];

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
  const [issueType, setIssueType] = useState<IssueType | ''>('');
  const [hadUnitsPrinted, setHadUnitsPrinted] = useState<boolean | null>(null);
  const [unitsPrinted, setUnitsPrinted] = useState(0);
  const [selectedRecovery, setSelectedRecovery] = useState<RecoveryOption | ''>('');
  const [issueReportId, setIssueReportId] = useState<string | null>(null);

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

  const handlePrinterSelect = (printerId: string) => {
    setSelectedPrinterId(printerId);
    const cycle = getActiveCycleForPrinter(printerId);
    if (cycle) {
      setActiveCycle(cycle);
      setSelectedProjectId(cycle.projectId);
      // Move to confirmation step
      setStep(1.5);
    } else {
      // No active cycle, let user select project manually
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

  const handleIssueTypeSelect = (type: IssueType) => {
    setIssueType(type);
    setStep(3);
  };

  const handleSubmitIssue = () => {
    const report = createIssueReport({
      printerId: selectedPrinterId,
      projectId: selectedProjectId,
      issueType: issueType as IssueType,
      unitsPrinted: hadUnitsPrinted ? unitsPrinted : 0,
    });
    setIssueReportId(report.id);
    setStep(4);
  };

  const handleSelectRecovery = (option: RecoveryOption) => {
    setSelectedRecovery(option);
    if (issueReportId) {
      resolveIssue(issueReportId, option);
    }
    setStep(5);
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
    setSelectedRecovery('');
    setIssueReportId(null);
    onClose();
  };

  const project = selectedProjectId ? getProject(selectedProjectId) : null;
  const activeProjects = getActiveProjects();

  const getRecoveryInstructions = () => {
    switch (selectedRecovery) {
      case 'reduce_units':
        return language === 'he' 
          ? ['נקו את המגש', 'הגדירו 6 יחידות במקום 8', 'התחילו מחזור חדש']
          : ['Clean the tray', 'Set 6 units instead of 8', 'Start new cycle'];
      case 'cancel_end_of_day':
        return language === 'he'
          ? ['מחזור סוף היום בוטל', 'המדפסת תיעצר ב-17:30', 'המשיכו כרגיל מחר']
          : ['End-of-day cycle cancelled', 'Printer will stop at 17:30', 'Continue normally tomorrow'];
      case 'overtime':
        return language === 'he'
          ? ['הארכנו את יום העבודה עד 20:00', 'הוסיפו מחזור נוסף', 'זכרו לדווח בסיום']
          : ['Extended workday until 20:00', 'Add one more cycle', 'Remember to report when done'];
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

        {/* Step 1: Select Printer (Global entry) */}
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

        {/* Step 3: Any units printed? */}
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
                  </div>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setUnitsPrinted(unitsPrinted + 1)}
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
                {language === 'he' ? 'המשך' : 'Continue'}
              </Button>
            )}
          </div>
        )}

        {/* Step 4: Recovery options */}
        {step === 4 && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center">
              <div className="text-lg font-semibold mb-1">
                {language === 'he' ? 'איך נפתור את זה?' : 'How should we fix this?'}
              </div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'בחרו אפשרות התאוששות' : 'Choose a recovery option'}
              </div>
            </div>
            
            <div className="space-y-2">
              {recoveryOptions.slice(0, 3).map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleSelectRecovery(option.id)}
                    className="w-full p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-accent transition-all text-start"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">
                          {language === 'he' ? option.title : option.titleEn}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {language === 'he' ? option.description : option.descriptionEn}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
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
