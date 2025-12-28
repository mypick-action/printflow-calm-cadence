import React, { useState, useMemo } from 'react';
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
import { AlertTriangle, Play } from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { 
  getColorInventoryItem, 
  openNewSpool, 
  setOpenTotalGrams,
  adjustOpenTotalGrams,
} from '@/services/storage';

interface StartPrintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycle: {
    id: string;
    projectName: string;
    productName: string;
    color: string;
    material: string;
    gramsPerCycle: number;
    units: number;
  };
  sequenceGrams?: number; // Total grams for remaining sequence on this printer
  onConfirm: () => void;
}

type SpoolType = 'new_1kg' | 'new_2kg' | 'new_5kg' | 'open';

export const StartPrintModal: React.FC<StartPrintModalProps> = ({
  open,
  onOpenChange,
  cycle,
  sequenceGrams,
  onConfirm,
}) => {
  const { language } = useLanguage();
  const [spoolType, setSpoolType] = useState<SpoolType>('open');
  const [openSpoolGrams, setOpenSpoolGrams] = useState<string>('');

  // Get current inventory state
  const inventoryItem = useMemo(() => {
    return getColorInventoryItem(cycle.color, cycle.material);
  }, [cycle.color, cycle.material, open]);

  const currentOpenGrams = inventoryItem?.openTotalGrams ?? 0;
  const closedCount = inventoryItem?.closedCount ?? 0;

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
      return isNaN(inputGrams) ? currentOpenGrams : inputGrams;
    } else {
      // New spool: add to current open grams
      return currentOpenGrams + getNewSpoolGrams();
    }
  }, [spoolType, openSpoolGrams, currentOpenGrams]);

  const gramsNeeded = cycle.gramsPerCycle;
  const hasEnoughMaterial = willHaveGrams >= gramsNeeded;
  const gramsMissing = gramsNeeded - willHaveGrams;

  const handleConfirm = () => {
    // Update inventory based on selection
    if (spoolType === 'open') {
      const inputGrams = parseInt(openSpoolGrams, 10);
      if (!isNaN(inputGrams) && inputGrams !== currentOpenGrams) {
        setOpenTotalGrams(cycle.color, cycle.material, inputGrams);
      }
    } else {
      // Open new spool
      const newSpoolGrams = getNewSpoolGrams();
      if (closedCount > 0) {
        openNewSpool(cycle.color, cycle.material, newSpoolGrams);
      } else {
        // No closed spools, just add the grams (assume user loaded a new spool they had)
        adjustOpenTotalGrams(cycle.color, cycle.material, newSpoolGrams);
      }
    }

    onConfirm();
    onOpenChange(false);
  };

  const canConfirm = hasEnoughMaterial || (spoolType === 'open' && openSpoolGrams === '');

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
                    ({language === 'he' ? 'עכשיו:' : 'current:'} {currentOpenGrams}g)
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {/* Grams input for open spool */}
            {spoolType === 'open' && (
              <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
                <Label htmlFor="grams" className="text-sm">
                  {language === 'he' ? 'כמה גרם יש על הגליל?' : 'How many grams on the spool?'}
                </Label>
                <Input
                  id="grams"
                  type="number"
                  placeholder={currentOpenGrams.toString()}
                  value={openSpoolGrams}
                  onChange={(e) => setOpenSpoolGrams(e.target.value)}
                  className="text-lg"
                  min={0}
                />
              </div>
            )}
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
            disabled={!hasEnoughMaterial && spoolType === 'open' && openSpoolGrams !== ''}
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
