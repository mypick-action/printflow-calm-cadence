import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Play, Clock } from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { 
  getColorInventoryItem,
  getPrinter,
  loadSpoolOnPrinter,
  startPrinterJob,
  updatePlannedCycle,
} from '@/services/storage';
import { scheduleAutoReplan } from '@/services/autoReplan';
import { syncCycleOperation } from '@/services/cycleOperationSync';
import { toast } from '@/hooks/use-toast';

interface StartPrintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycle: {
    id: string;
    projectId: string;
    projectName: string;
    productName: string;
    color: string;
    material: string;
    gramsPerCycle: number;
    units: number;
    cycleHours?: number;
  };
  printerId: string;
  sequenceGrams?: number;
  onConfirm: () => void;
}

type SpoolType = 'new_1kg' | 'new_2kg' | 'new_5kg' | 'open';

export const StartPrintModal: React.FC<StartPrintModalProps> = ({
  open,
  onOpenChange,
  cycle,
  printerId,
  sequenceGrams,
  onConfirm,
}) => {
  const { language } = useLanguage();
  const [spoolType, setSpoolType] = useState<SpoolType>('open');
  const [openSpoolGrams, setOpenSpoolGrams] = useState<string>('');
  const [manualStartTime, setManualStartTime] = useState<string>('');

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setManualStartTime('');
    }
  }, [open]);

  // Get current inventory state
  const inventoryItem = useMemo(() => {
    return getColorInventoryItem(cycle.color, cycle.material);
  }, [cycle.color, cycle.material, open]);

  // Get current printer state
  const printer = useMemo(() => {
    return getPrinter(printerId);
  }, [printerId, open]);

  const currentOpenGrams = inventoryItem?.openTotalGrams ?? 0;
  const closedCount = inventoryItem?.closedCount ?? 0;
  const printerMountedColor = printer?.mountedColor;
  const printerLoadedGrams = printer?.loadedGramsEstimate ?? 0;

  // Check if printer already has the correct color loaded
  const hasSameColorLoaded = printerMountedColor?.toLowerCase() === cycle.color.toLowerCase();

  // Calculate available grams based on selection
  const getNewSpoolGrams = (): number => {
    switch (spoolType) {
      case 'new_1kg': return 1000;
      case 'new_2kg': return 2000;
      case 'new_5kg': return 5000;
      default: return 0;
    }
  };

  const willHaveGrams = useMemo(() => {
    if (spoolType === 'open') {
      const inputGrams = parseInt(openSpoolGrams, 10);
      // If printer has same color, use printer's loaded grams as base
      if (hasSameColorLoaded) {
        return isNaN(inputGrams) ? printerLoadedGrams : inputGrams;
      }
      return isNaN(inputGrams) ? currentOpenGrams : inputGrams;
    } else {
      // New spool
      return getNewSpoolGrams();
    }
  }, [spoolType, openSpoolGrams, currentOpenGrams, hasSameColorLoaded, printerLoadedGrams]);

  const gramsNeeded = cycle.gramsPerCycle;
  const hasEnoughMaterial = willHaveGrams >= gramsNeeded;
  const gramsMissing = gramsNeeded - willHaveGrams;

  const handleConfirm = async () => {
    // Determine start time - use manual input if provided, otherwise use current time
    let startDate: Date;
    if (manualStartTime) {
      const [hours, minutes] = manualStartTime.split(':').map(Number);
      startDate = new Date();
      startDate.setHours(hours, minutes, 0, 0);
    } else {
      startDate = new Date();
    }
    
    const startTimeIso = startDate.toISOString();
    const cycleHours = cycle.cycleHours || 2;
    const endTime = new Date(startDate.getTime() + cycleHours * 60 * 60 * 1000);
    const endTimeIso = endTime.toISOString();

    // Determine grams estimate and source
    let gramsEstimate: number;
    let source: 'open' | 'closed';

    if (spoolType === 'open') {
      const inputGrams = parseInt(openSpoolGrams, 10);
      gramsEstimate = isNaN(inputGrams) 
        ? (hasSameColorLoaded ? printerLoadedGrams : currentOpenGrams)
        : inputGrams;
      source = 'open';
    } else {
      gramsEstimate = getNewSpoolGrams();
      source = 'closed';
    }

    // Only load spool if printer doesn't have the same color or needs new spool
    if (!hasSameColorLoaded || source === 'closed') {
      const loaded = loadSpoolOnPrinter(printerId, cycle.color, gramsEstimate, source);
      if (!loaded) {
        console.warn('[StartPrintModal] Failed to load spool on printer');
        // Continue anyway - the spool might already be loaded
      }
    }

    // CRITICAL FIX: Always update mountedColor + currentColor + confirmedSpoolColor
    // confirmedSpoolColor is the MOST RELIABLE source for night planning
    const { updatePrinter } = await import('@/services/storage');
    const now = new Date().toISOString();
    updatePrinter(printerId, {
      mountedColor: cycle.color,
      currentColor: cycle.color,
      confirmedSpoolColor: cycle.color,
      confirmedSpoolAt: now,
    });
    console.log('[StartPrintModal] 🔒 Updated printer colors (including confirmedSpoolColor):', {
      printerId,
      newMountedColor: cycle.color,
      newCurrentColor: cycle.color,
      confirmedSpoolColor: cycle.color,
      confirmedSpoolAt: now,
    });

    // Start the printer job (mountState = 'in_use')
    startPrinterJob(printerId);

    // Update the planned cycle to in_progress (local)
    updatePlannedCycle(cycle.id, {
      status: 'in_progress',
      startTime: startTimeIso,
      endTime: endTimeIso,
    });

    // IMMEDIATELY sync cycle status to cloud via unified service
    const syncResult = await syncCycleOperation('start_print', {
      cycleId: cycle.id,
      projectId: cycle.projectId || '', // Will be resolved in service
      printerId,
      status: 'in_progress',
      startTime: startTimeIso,
      endTime: endTimeIso,
    });
    
    if (syncResult.cloudSynced) {
      console.log('[StartPrintModal] Cycle synced to cloud');
    } else if (syncResult.error) {
      toast({
        title: 'סנכרון לענן נכשל',
        description: syncResult.error,
        variant: 'destructive',
      });
    }

    // Schedule replan for planning updates
    scheduleAutoReplan('cycle_started');

    onConfirm();
    onOpenChange(false);
  };

  const canConfirm = hasEnoughMaterial || (spoolType === 'open' && openSpoolGrams === '' && hasSameColorLoaded);

  // Determine default placeholder for open spool input
  const openSpoolPlaceholder = hasSameColorLoaded 
    ? printerLoadedGrams.toString() 
    : currentOpenGrams.toString();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir={language === 'he' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="w-5 h-5 text-primary" />
            {language === 'he' ? 'התחל הדפסה' : 'Start Print'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Cycle Info */}
          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 border">
            <SpoolIcon color={getSpoolColor(cycle.color)} size={40} />
            <div className="flex-1">
              <div className="font-medium">{cycle.projectName}</div>
              <div className="text-sm text-muted-foreground">
                {cycle.productName} • {cycle.color} • {cycle.material}
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{cycle.units}</div>
              <div className="text-xs text-muted-foreground">
                {language === 'he' ? 'יחידות' : 'units'}
              </div>
            </div>
          </div>

          {/* Current Printer State */}
          {printerMountedColor && (
            <div className={`p-3 rounded-lg border ${
              hasSameColorLoaded 
                ? 'bg-success/10 border-success/30' 
                : 'bg-warning/10 border-warning/30'
            }`}>
              <div className="flex items-center gap-2">
                {!hasSameColorLoaded && <AlertTriangle className="w-4 h-4 text-warning" />}
                <span className="text-sm">
                  {language === 'he' 
                    ? `המדפסת מוזנת כרגע ב: ${printerMountedColor} (${printerLoadedGrams}g)` 
                    : `Printer loaded with: ${printerMountedColor} (${printerLoadedGrams}g)`
                  }
                </span>
              </div>
              {!hasSameColorLoaded && (
                <div className="text-xs text-muted-foreground mt-1">
                  {language === 'he'
                    ? `צריך להחליף ל-${cycle.color}`
                    : `Need to change to ${cycle.color}`
                  }
                </div>
              )}
            </div>
          )}

          {/* Grams Required */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/20">
            <span className="text-sm font-medium">
              {language === 'he' ? 'גרמים נדרשים למחזור:' : 'Grams needed for cycle:'}
            </span>
            <Badge variant="secondary" className="text-base">
              {gramsNeeded}g
            </Badge>
          </div>

          {sequenceGrams && sequenceGrams > gramsNeeded && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/50">
              <span className="text-xs text-muted-foreground">
                {language === 'he' ? 'סה״כ רצף היום:' : 'Total sequence today:'}
              </span>
              <span className="text-sm font-medium">{sequenceGrams}g</span>
            </div>
          )}

          {/* Spool Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              {language === 'he' ? 'מה טענת למדפסת?' : 'What did you load?'}
            </Label>
            
            <RadioGroup 
              value={spoolType} 
              onValueChange={(val) => setSpoolType(val as SpoolType)}
              className="grid gap-2"
            >
              <div className="flex items-center space-x-2 rtl:space-x-reverse p-3 rounded-lg border bg-background hover:bg-muted/30 cursor-pointer">
                <RadioGroupItem value="new_1kg" id="new_1kg" />
                <Label htmlFor="new_1kg" className="flex-1 cursor-pointer">
                  <span className="font-medium">
                    {language === 'he' ? 'גליל חדש 1 ק״ג' : 'New spool 1kg'}
                  </span>
                  {closedCount > 0 && (
                    <span className="text-xs text-muted-foreground mx-2">
                      ({closedCount} {language === 'he' ? 'במלאי' : 'in stock'})
                    </span>
                  )}
                </Label>
              </div>

              <div className="flex items-center space-x-2 rtl:space-x-reverse p-3 rounded-lg border bg-background hover:bg-muted/30 cursor-pointer">
                <RadioGroupItem value="new_2kg" id="new_2kg" />
                <Label htmlFor="new_2kg" className="flex-1 cursor-pointer font-medium">
                  {language === 'he' ? 'גליל חדש 2 ק״ג' : 'New spool 2kg'}
                </Label>
              </div>

              <div className="flex items-center space-x-2 rtl:space-x-reverse p-3 rounded-lg border bg-background hover:bg-muted/30 cursor-pointer">
                <RadioGroupItem value="new_5kg" id="new_5kg" />
                <Label htmlFor="new_5kg" className="flex-1 cursor-pointer font-medium">
                  {language === 'he' ? 'גליל חדש 5 ק״ג' : 'New spool 5kg'}
                </Label>
              </div>

              <div className="flex items-center space-x-2 rtl:space-x-reverse p-3 rounded-lg border bg-background hover:bg-muted/30 cursor-pointer">
                <RadioGroupItem value="open" id="open" />
                <Label htmlFor="open" className="flex-1 cursor-pointer">
                  <span className="font-medium">
                    {language === 'he' ? 'גליל פתוח' : 'Open spool'}
                  </span>
                  <span className="text-xs text-muted-foreground mx-2">
                    ({language === 'he' ? 'מלאי:' : 'stock:'} {currentOpenGrams}g)
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {/* Grams input for open spool */}
            {spoolType === 'open' && (
              <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
                <Label htmlFor="grams" className="text-sm font-medium">
                  {language === 'he' ? 'כמה גרם יש על הגליל הזה עכשיו?' : 'How many grams on this spool now?'}
                </Label>
                <Input
                  id="grams"
                  type="number"
                  placeholder={hasSameColorLoaded ? printerLoadedGrams.toString() : ''}
                  value={openSpoolGrams}
                  onChange={(e) => setOpenSpoolGrams(e.target.value)}
                  className="text-lg"
                  min={0}
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'he' 
                    ? 'הזן את כמות הגרמים הנוכחית על הגליל שאתה מזין למדפסת'
                    : 'Enter the current grams on the spool you are loading'}
                </p>
              </div>
            )}

            {/* Manual Start Time - Optional */}
            <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
              <Label htmlFor="startTime" className="text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4" />
                {language === 'he' ? 'שעת התחלה בפועל (אופציונלי)' : 'Actual start time (optional)'}
              </Label>
              <Input
                id="startTime"
                type="time"
                value={manualStartTime}
                onChange={(e) => setManualStartTime(e.target.value)}
                className="text-lg"
              />
              <p className="text-xs text-muted-foreground">
                {language === 'he' 
                  ? 'השאר ריק אם אתה מתחיל עכשיו. מלא אם התחלת בשעה אחרת'
                  : 'Leave empty if starting now. Fill in if you started at a different time'}
              </p>
            </div>
          </div>

          {/* Warning if not enough material */}
          {!hasEnoughMaterial && spoolType === 'open' && openSpoolGrams !== '' && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">
                  {language === 'he' ? 'חסר חומר!' : 'Not enough material!'}
                </div>
                <div className="text-sm">
                  {language === 'he' 
                    ? `חסרים ${gramsMissing} גרם. פתח גליל חדש או החלף גליל.`
                    : `Missing ${gramsMissing}g. Open a new spool or change spool.`
                  }
                </div>
              </div>
            </div>
          )}

          {/* Success state */}
          {hasEnoughMaterial && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-success/10 border border-success/30 text-success">
              <span className="text-sm font-medium">
                {language === 'he' ? 'יש מספיק חומר' : 'Enough material available'}
              </span>
              <span className="font-medium">{willHaveGrams}g ✓</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {language === 'he' ? 'ביטול' : 'Cancel'}
          </Button>
          <Button 
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="gap-2"
          >
            <Play className="w-4 h-4" />
            {language === 'he' ? 'אישור והתחל' : 'Confirm & Start'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
