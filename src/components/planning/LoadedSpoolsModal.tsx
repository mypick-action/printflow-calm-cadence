import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { Printer, Package, ChevronRight, Check, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getPrinters,
  getSpools,
  getFactorySettings,
  updatePrinter,
  setLoadedSpoolsInitialized,
  setMountedStateUnknown,
  FilamentEstimate,
  AMSSlotState,
  Printer as PrinterType,
  Spool,
} from '@/services/storage';
import { toast } from '@/hooks/use-toast';

interface LoadedSpoolsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

type InitialChoice = 'has_spools' | 'no_spools' | 'skip';

interface PrinterMountState {
  printerId: string;
  color: string;
  estimate: FilamentEstimate;
  spoolId?: string;
  amsMode?: 'backup_same_color' | 'multi_color';
  amsSlots?: Array<{ slotIndex: number; color: string; estimate: FilamentEstimate; spoolId?: string }>;
}

const ESTIMATE_OPTIONS: { value: FilamentEstimate; labelHe: string; labelEn: string }[] = [
  { value: 'unknown', labelHe: 'לא יודע', labelEn: "Don't know" },
  { value: 'low', labelHe: 'מעט', labelEn: 'Low' },
  { value: 'medium', labelHe: 'בינוני', labelEn: 'Medium' },
  { value: 'high', labelHe: 'הרבה', labelEn: 'High' },
];

export const LoadedSpoolsModal: React.FC<LoadedSpoolsModalProps> = ({
  open,
  onOpenChange,
  onComplete,
}) => {
  const { language } = useLanguage();
  const [step, setStep] = useState<'choice' | 'setup'>('choice');
  const [initialChoice, setInitialChoice] = useState<InitialChoice | null>(null);
  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [spools, setSpools] = useState<Spool[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [printerStates, setPrinterStates] = useState<Map<string, PrinterMountState>>(new Map());

  useEffect(() => {
    if (open) {
      const activePrinters = getPrinters().filter(p => p.status === 'active');
      const allSpools = getSpools().filter(s => s.state !== 'empty');
      const settings = getFactorySettings();
      
      setPrinters(activePrinters);
      setSpools(allSpools);
      setColors(settings?.colors || ['Black', 'White', 'Gray', 'Blue', 'Red', 'Green']);
      
      // Initialize printer states
      const states = new Map<string, PrinterMountState>();
      activePrinters.forEach(p => {
        states.set(p.id, {
          printerId: p.id,
          color: p.currentColor || '',
          estimate: 'unknown',
          amsMode: p.hasAMS ? (p.amsMode || 'backup_same_color') : undefined,
          amsSlots: p.hasAMS 
            ? Array.from({ length: p.amsSlots || 4 }, (_, i) => ({
                slotIndex: i,
                color: '',
                estimate: 'unknown' as FilamentEstimate,
              }))
            : undefined,
        });
      });
      setPrinterStates(states);
      setStep('choice');
      setInitialChoice(null);
    }
  }, [open]);

  const handleChoiceSelect = (choice: InitialChoice) => {
    setInitialChoice(choice);
    
    if (choice === 'no_spools') {
      // Mark all printers as empty
      printers.forEach(p => {
        updatePrinter(p.id, {
          mountedSpoolId: null,
          mountedColor: undefined,
          amsSlotStates: p.hasAMS ? [] : undefined,
        });
      });
      setLoadedSpoolsInitialized(true);
      setMountedStateUnknown(false);
      toast({
        title: language === 'he' ? 'נשמר' : 'Saved',
        description: language === 'he' ? 'המדפסות סומנו כריקות' : 'Printers marked as empty',
      });
      onOpenChange(false);
      onComplete?.();
    } else if (choice === 'skip') {
      setLoadedSpoolsInitialized(true);
      setMountedStateUnknown(true);
      toast({
        title: language === 'he' ? 'דילגת' : 'Skipped',
        description: language === 'he' ? 'תוכל לעדכן מאוחר יותר' : 'You can update later',
      });
      onOpenChange(false);
      onComplete?.();
    } else {
      setStep('setup');
    }
  };

  const updatePrinterState = (printerId: string, updates: Partial<PrinterMountState>) => {
    setPrinterStates(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(printerId);
      if (current) {
        newMap.set(printerId, { ...current, ...updates });
      }
      return newMap;
    });
  };

  const updateAMSSlotState = (
    printerId: string, 
    slotIndex: number, 
    updates: Partial<{ color: string; estimate: FilamentEstimate; spoolId?: string }>
  ) => {
    setPrinterStates(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(printerId);
      if (current?.amsSlots) {
        const newSlots = [...current.amsSlots];
        const slotIdx = newSlots.findIndex(s => s.slotIndex === slotIndex);
        if (slotIdx >= 0) {
          newSlots[slotIdx] = { ...newSlots[slotIdx], ...updates };
          newMap.set(printerId, { ...current, amsSlots: newSlots });
        }
      }
      return newMap;
    });
  };

  const handleSave = () => {
    // Save all printer states
    printerStates.forEach((state, printerId) => {
      const printer = printers.find(p => p.id === printerId);
      if (!printer) return;

      if (printer.hasAMS) {
        // Save AMS slots
        const amsSlotStates: AMSSlotState[] = (state.amsSlots || [])
          .filter(s => s.color) // Only save slots with a color selected
          .map(s => ({
            slotIndex: s.slotIndex,
            spoolId: s.spoolId || null,
            color: s.color,
            estimate: s.estimate,
          }));

        updatePrinter(printerId, {
          amsSlotStates,
          amsMode: state.amsMode,
          currentColor: amsSlotStates[0]?.color,
        });
      } else {
        // Save single spool state - v2: require spoolId
        updatePrinter(printerId, {
          mountedSpoolId: state.spoolId || null,
          mountedColor: state.color || undefined,
          currentColor: state.color || undefined,
        });
      }
    });

    setLoadedSpoolsInitialized(true);
    setMountedStateUnknown(false);

    toast({
      title: language === 'he' ? 'נשמר בהצלחה' : 'Saved successfully',
      description: language === 'he' 
        ? 'מצב הגלילים על המדפסות עודכן' 
        : 'Printer spool states updated',
    });

    onOpenChange(false);
    onComplete?.();
  };

  const renderChoiceStep = () => (
    <div className="space-y-4">
      <DialogDescription className="text-center text-base">
        {language === 'he' 
          ? 'כדי לתכנן נכון, נצטרך לדעת מה המצב הנוכחי על המדפסות'
          : 'To plan correctly, we need to know the current state of your printers'}
      </DialogDescription>

      <div className="grid gap-3 pt-4">
        <Button
          variant="outline"
          className={cn(
            "h-auto p-4 justify-start text-start",
            initialChoice === 'has_spools' && "ring-2 ring-primary"
          )}
          onClick={() => handleChoiceSelect('has_spools')}
        >
          <div className="flex items-center gap-4 w-full">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
              <Check className="w-5 h-5 text-success" />
            </div>
            <div className="flex-1">
              <div className="font-medium">
                {language === 'he' ? 'כבר יש גלילים על המדפסות' : 'Spools already loaded on printers'}
              </div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'אעדכן מה על כל מדפסת' : "I'll update what's on each printer"}
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </div>
        </Button>

        <Button
          variant="outline"
          className={cn(
            "h-auto p-4 justify-start text-start",
            initialChoice === 'no_spools' && "ring-2 ring-primary"
          )}
          onClick={() => handleChoiceSelect('no_spools')}
        >
          <div className="flex items-center gap-4 w-full">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <div className="font-medium">
                {language === 'he' ? 'אין גלילים על המדפסות כרגע' : 'No spools loaded currently'}
              </div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'המדפסות ריקות' : 'Printers are empty'}
              </div>
            </div>
          </div>
        </Button>

        <Button
          variant="ghost"
          className="h-auto p-4 justify-start text-start text-muted-foreground"
          onClick={() => handleChoiceSelect('skip')}
        >
          <div className="flex items-center gap-4 w-full">
            <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
              <HelpCircle className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <div className="font-medium">
                {language === 'he' ? 'אדלג בינתיים' : 'Skip for now'}
              </div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'אמשיך עם פחות מידע' : 'Continue with less information'}
              </div>
            </div>
          </div>
        </Button>
      </div>
    </div>
  );

  const renderPrinterSetup = (printer: PrinterType) => {
    const state = printerStates.get(printer.id);
    if (!state) return null;

    if (printer.hasAMS) {
      return (
        <Card key={printer.id} className="overflow-hidden">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-primary" />
                <span className="font-medium">{printer.name}</span>
              </div>
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                AMS
              </Badge>
            </div>

            {/* AMS Mode Selection */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                {language === 'he' ? 'למה משמש ה-AMS?' : 'What is AMS used for?'}
              </Label>
              <RadioGroup
                value={state.amsMode}
                onValueChange={(v) => updatePrinterState(printer.id, { amsMode: v as 'backup_same_color' | 'multi_color' })}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <RadioGroupItem value="backup_same_color" id={`${printer.id}-backup`} />
                  <Label htmlFor={`${printer.id}-backup`} className="text-sm cursor-pointer">
                    {language === 'he' ? 'גיבוי (אותו צבע)' : 'Backup (same color)'}
                  </Label>
                </div>
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <RadioGroupItem value="multi_color" id={`${printer.id}-multi`} />
                  <Label htmlFor={`${printer.id}-multi`} className="text-sm cursor-pointer">
                    {language === 'he' ? 'רב-צבעי' : 'Multi-color'}
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* AMS Slots */}
            <div className="grid grid-cols-2 gap-2">
              {state.amsSlots?.map((slot, idx) => (
                <div key={idx} className="p-3 rounded-lg border bg-muted/30 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {language === 'he' ? `חריץ ${idx + 1}` : `Slot ${idx + 1}`}
                  </div>
                  <Select
                    value={slot.color}
                    onValueChange={(v) => updateAMSSlotState(printer.id, idx, { color: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={language === 'he' ? 'בחר צבע' : 'Select color'} />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="">
                        {language === 'he' ? 'ריק' : 'Empty'}
                      </SelectItem>
                      {colors.map(c => (
                        <SelectItem key={c} value={c}>
                          <div className="flex items-center gap-2">
                            <SpoolIcon color={getSpoolColor(c)} size={16} />
                            {c}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {slot.color && (
                    <div className="flex gap-1 flex-wrap">
                      {ESTIMATE_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => updateAMSSlotState(printer.id, idx, { estimate: opt.value })}
                          className={cn(
                            "px-2 py-0.5 text-xs rounded-full transition-colors",
                            slot.estimate === opt.value
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted hover:bg-muted/80"
                          )}
                        >
                          {language === 'he' ? opt.labelHe : opt.labelEn}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }

    // Non-AMS printer
    return (
      <Card key={printer.id} className="overflow-hidden">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" />
            <span className="font-medium">{printer.name}</span>
          </div>

          <div className="flex items-center gap-3">
            <Select
              value={state.color}
              onValueChange={(v) => updatePrinterState(printer.id, { color: v })}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={language === 'he' ? 'בחר צבע' : 'Select color'} />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="">
                  {language === 'he' ? 'ריק / לא יודע' : 'Empty / Unknown'}
                </SelectItem>
                {colors.map(c => (
                  <SelectItem key={c} value={c}>
                    <div className="flex items-center gap-2">
                      <SpoolIcon color={getSpoolColor(c)} size={16} />
                      {c}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {state.color && (
              <SpoolIcon color={getSpoolColor(state.color)} size={32} />
            )}
          </div>

          {state.color && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                {language === 'he' ? 'כמה נשאר בערך?' : 'How much is left?'}
              </Label>
              <div className="flex gap-2 flex-wrap">
                {ESTIMATE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updatePrinterState(printer.id, { estimate: opt.value })}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded-lg transition-colors",
                      state.estimate === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80"
                    )}
                  >
                    {language === 'he' ? opt.labelHe : opt.labelEn}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderSetupStep = () => (
    <div className="space-y-4">
      <DialogDescription className="text-base">
        {language === 'he' 
          ? 'עדכן את הצבע והכמות המשוערת על כל מדפסת'
          : 'Update the color and estimated amount on each printer'}
      </DialogDescription>

      <div className="max-h-[400px] overflow-y-auto space-y-3 pr-1">
        {printers.map(printer => renderPrinterSetup(printer))}
      </div>

      <div className="flex gap-3 pt-2">
        <Button 
          variant="outline" 
          onClick={() => setStep('choice')}
          className="flex-1"
        >
          {language === 'he' ? 'חזור' : 'Back'}
        </Button>
        <Button 
          onClick={handleSave}
          className="flex-1"
        >
          {language === 'he' ? 'שמור והמשך' : 'Save & Continue'}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {language === 'he' ? 'מה המצב על המדפסות עכשיו?' : "What's loaded on the printers?"}
          </DialogTitle>
        </DialogHeader>

        {step === 'choice' ? renderChoiceStep() : renderSetupStep()}
      </DialogContent>
    </Dialog>
  );
};
