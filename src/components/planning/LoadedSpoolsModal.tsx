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
  spoolId?: string; // v2: Required for ready state
  color?: string; // Derived from spool
  amsMode?: 'backup_same_color' | 'multi_color';
  amsSlots?: Array<{ slotIndex: number; spoolId?: string; color?: string }>;
}

// Get available spools for a color from inventory
const getAvailableSpoolsForColor = (spools: Spool[], color: string): Spool[] => {
  return spools.filter(s => 
    s.color.toLowerCase() === color.toLowerCase() && 
    s.state !== 'empty' && 
    s.gramsRemainingEst > 0 &&
    s.location === 'stock'
  );
};

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
          spoolId: p.mountedSpoolId || undefined,
          color: p.mountedColor || p.currentColor || undefined,
          amsMode: p.hasAMS ? (p.amsMode || 'backup_same_color') : undefined,
          amsSlots: p.hasAMS 
            ? Array.from({ length: p.amsSlots || 4 }, (_, i) => {
                const existingSlot = p.amsSlotStates?.find(s => s.slotIndex === i);
                return {
                  slotIndex: i,
                  spoolId: existingSlot?.spoolId || undefined,
                  color: existingSlot?.color || undefined,
                };
              })
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
    updates: Partial<{ spoolId?: string; color?: string }>
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
        // Save AMS slots - v2: derive color from spool
        const amsSlotStates: AMSSlotState[] = (state.amsSlots || [])
          .filter(s => s.spoolId) // Only save slots with a spool selected
          .map(s => {
            const spool = spools.find(sp => sp.id === s.spoolId);
            return {
              slotIndex: s.slotIndex,
              spoolId: s.spoolId || null,
              color: spool?.color || s.color,
            };
          });

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

            {/* AMS Slots - v2: Select spool from inventory */}
            <div className="grid grid-cols-2 gap-2">
              {state.amsSlots?.map((slot, idx) => {
                const availableSpools = spools.filter(s => 
                  s.state !== 'empty' && 
                  s.gramsRemainingEst > 0 &&
                  s.location === 'stock'
                );
                const selectedSpool = slot.spoolId ? spools.find(s => s.id === slot.spoolId) : null;
                
                return (
                  <div key={idx} className="p-3 rounded-lg border bg-muted/30 space-y-2">
                    <div className="text-xs text-muted-foreground">
                      {language === 'he' ? `חריץ ${idx + 1}` : `Slot ${idx + 1}`}
                    </div>
                    <Select
                      value={slot.spoolId || ''}
                      onValueChange={(v) => {
                        const spool = spools.find(s => s.id === v);
                        updateAMSSlotState(printer.id, idx, { 
                          spoolId: v || undefined, 
                          color: spool?.color 
                        });
                      }}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={language === 'he' ? 'בחר גליל' : 'Select spool'} />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        <SelectItem value="">
                          {language === 'he' ? 'ריק' : 'Empty'}
                        </SelectItem>
                        {availableSpools.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            <div className="flex items-center gap-2">
                              <SpoolIcon color={getSpoolColor(s.color)} size={16} />
                              <span>{s.color}</span>
                              <span className="text-muted-foreground text-xs">
                                {s.gramsRemainingEst}g
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedSpool && (
                      <div className="text-xs text-muted-foreground">
                        {selectedSpool.gramsRemainingEst}g {selectedSpool.material || 'PLA'}
                      </div>
                    )}
                  </div>
                );
              })}
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

          {/* v2: Select spool from inventory instead of color + estimate */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              {language === 'he' ? 'בחר גליל מהמלאי' : 'Select spool from inventory'}
            </Label>
            {(() => {
              const availableSpools = spools.filter(s => 
                s.state !== 'empty' && 
                s.gramsRemainingEst > 0 &&
                s.location === 'stock'
              );
              const selectedSpool = state.spoolId ? spools.find(s => s.id === state.spoolId) : null;
              
              return (
                <>
                  <Select
                    value={state.spoolId || ''}
                    onValueChange={(v) => {
                      const spool = spools.find(s => s.id === v);
                      updatePrinterState(printer.id, { 
                        spoolId: v || undefined, 
                        color: spool?.color 
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={language === 'he' ? 'בחר גליל' : 'Select spool'} />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="">
                        {language === 'he' ? 'ריק / לא טעון' : 'Empty / Not loaded'}
                      </SelectItem>
                      {availableSpools.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          <div className="flex items-center gap-2">
                            <SpoolIcon color={getSpoolColor(s.color)} size={16} />
                            <span>{s.color}</span>
                            <span className="text-muted-foreground text-xs">
                              {s.gramsRemainingEst}g • {s.material || 'PLA'}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {selectedSpool && (
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/30">
                      <div className="flex items-center gap-3">
                        <SpoolIcon color={getSpoolColor(selectedSpool.color)} size={32} />
                        <div>
                          <span className="font-medium">{selectedSpool.color}</span>
                          <div className="text-sm text-muted-foreground">
                            {selectedSpool.gramsRemainingEst}g • {selectedSpool.material || 'PLA'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {availableSpools.length === 0 && (
                    <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm text-warning">
                      {language === 'he' 
                        ? 'אין גלילים זמינים במלאי'
                        : 'No spools available in inventory'}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSetupStep = () => (
    <div className="space-y-4">
      <DialogDescription className="text-base">
        {language === 'he' 
          ? 'בחר גליל מהמלאי לכל מדפסת'
          : 'Select a spool from inventory for each printer'}
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
