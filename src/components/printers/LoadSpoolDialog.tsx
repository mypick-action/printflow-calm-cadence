import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Package, ArrowRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { 
  getPrinters, 
  updatePrinter,
  getSpools,
  updateSpool,
  getFactorySettings,
  setLoadedSpoolsInitialized,
  AMSSlotState,
  Printer, 
  Spool,
} from '@/services/storage';
import { notifyInventoryChanged } from '@/services/inventoryEvents';

interface LoadSpoolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  printer: Printer | null;
  slotIndex?: number | null;
  preSelectedColor?: string;
  suggestedSpoolIds?: string[];
  onComplete?: () => void;
}

export const LoadSpoolDialog: React.FC<LoadSpoolDialogProps> = ({
  open,
  onOpenChange,
  printer,
  slotIndex = null,
  preSelectedColor,
  suggestedSpoolIds = [],
  onComplete,
}) => {
  const { language } = useLanguage();
  const [spools, setSpools] = useState<Spool[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [loadSpoolMode, setLoadSpoolMode] = useState<'color' | 'spool'>('spool');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSpoolId, setSelectedSpoolId] = useState('');

  // Refresh data when dialog opens
  useEffect(() => {
    if (open) {
      setSpools(getSpools());
      const settings = getFactorySettings();
      if (settings?.colors) {
        setAvailableColors(settings.colors);
      }
      // Pre-select color if provided
      if (preSelectedColor) {
        setSelectedColor(preSelectedColor);
      }
      // Pre-select suggested spool if available
      if (suggestedSpoolIds.length > 0) {
        setSelectedSpoolId(suggestedSpoolIds[0]);
      }
    }
  }, [open, preSelectedColor, suggestedSpoolIds]);

  // Get available spools for loading (not already on a printer)
  const getAvailableSpools = () => {
    return spools.filter(s => 
      s.state !== 'empty' && 
      s.location === 'stock' &&
      (!selectedColor || s.color.toLowerCase() === selectedColor.toLowerCase())
    );
  };

  const handleLoadSpool = () => {
    if (!printer) return;

    const color = loadSpoolMode === 'spool' && selectedSpoolId 
      ? spools.find(s => s.id === selectedSpoolId)?.color || selectedColor
      : selectedColor;

    if (!color) {
      toast({
        title: language === 'he' ? 'בחר צבע' : 'Select a color',
        variant: 'destructive',
      });
      return;
    }

    // Handle previous spool - return to stock
    if (loadSpoolMode === 'spool' && selectedSpoolId) {
      // Unload previous spool from this printer
      const previousSpools = spools.filter(s => 
        s.assignedPrinterId === printer.id && 
        (slotIndex === null || s.amsSlotIndex === slotIndex)
      );
      previousSpools.forEach(s => {
        updateSpool(s.id, { 
          location: 'stock', 
          assignedPrinterId: undefined,
          amsSlotIndex: undefined 
        }, true);
      });

      // Mount new spool
      updateSpool(selectedSpoolId, {
        location: slotIndex !== null ? 'ams' : 'printer',
        assignedPrinterId: printer.id,
        amsSlotIndex: slotIndex ?? undefined,
      }, true);
    }

    if (printer.hasAMS && slotIndex !== null) {
      // Update AMS slot
      const currentSlots = printer.amsSlotStates || [];
      const existingSlotIdx = currentSlots.findIndex(s => s.slotIndex === slotIndex);
      
      let newSlots: AMSSlotState[];
      const newSlot: AMSSlotState = {
        slotIndex: slotIndex,
        spoolId: loadSpoolMode === 'spool' ? selectedSpoolId : null,
        color,
      };

      if (existingSlotIdx >= 0) {
        newSlots = [...currentSlots];
        newSlots[existingSlotIdx] = newSlot;
      } else {
        newSlots = [...currentSlots, newSlot];
      }

      updatePrinter(printer.id, { 
        amsSlotStates: newSlots,
        currentColor: newSlots[0]?.color || color,
      });
    } else {
      // Update main spool
      updatePrinter(printer.id, {
        mountedSpoolId: loadSpoolMode === 'spool' ? selectedSpoolId : null,
        mountedColor: color,
        currentColor: color,
      });
    }

    // Mark loaded spools as initialized
    setLoadedSpoolsInitialized(true);
    
    // Notify inventory changed to refresh Required Actions
    notifyInventoryChanged();

    onOpenChange(false);
    onComplete?.();

    toast({
      title: language === 'he' ? 'גליל נטען' : 'Spool loaded',
      description: `${color} → ${printer.name}`,
    });
  };

  if (!printer) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md z-[100]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            {language === 'he' ? 'טעינת גליל' : 'Load Spool'}
            <span className="text-muted-foreground font-normal">
              → {printer.name}
              {slotIndex !== null && ` (Slot ${slotIndex + 1})`}
            </span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Mode Selection */}
          <div className="space-y-2">
            <Label>{language === 'he' ? 'בחר לפי' : 'Select by'}</Label>
            <RadioGroup
              value={loadSpoolMode}
              onValueChange={(v) => setLoadSpoolMode(v as 'color' | 'spool')}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <RadioGroupItem value="color" id="mode-color" />
                <Label htmlFor="mode-color" className="cursor-pointer">
                  {language === 'he' ? 'צבע בלבד' : 'Color only'}
                </Label>
              </div>
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <RadioGroupItem value="spool" id="mode-spool" />
                <Label htmlFor="mode-spool" className="cursor-pointer">
                  {language === 'he' ? 'גליל מהמלאי' : 'Spool from inventory'}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Color Selection */}
          <div className="space-y-2">
            <Label>{language === 'he' ? 'צבע' : 'Color'}</Label>
            <Select value={selectedColor} onValueChange={setSelectedColor}>
              <SelectTrigger>
                <SelectValue placeholder={language === 'he' ? 'בחר צבע' : 'Select color'} />
              </SelectTrigger>
              <SelectContent className="bg-popover z-[150]">
                {availableColors.filter(c => c && c.trim()).map(c => (
                  <SelectItem key={c} value={c}>
                    <div className="flex items-center gap-2">
                      <SpoolIcon color={getSpoolColor(c)} size={16} />
                      {c}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Spool Selection (if mode is spool) */}
          {loadSpoolMode === 'spool' && selectedColor && (
            <div className="space-y-2">
              <Label>{language === 'he' ? 'בחר גליל מהמלאי' : 'Select spool from inventory'}</Label>
              {getAvailableSpools().length > 0 ? (
                <Select value={selectedSpoolId} onValueChange={setSelectedSpoolId}>
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחר גליל' : 'Select spool'} />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-[150]">
                    {getAvailableSpools().map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <SpoolIcon color={getSpoolColor(s.color)} size={16} />
                          <span>{s.color}</span>
                          <span className="text-muted-foreground">
                            {s.gramsRemainingEst}g • {s.material}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm text-warning">
                  {language === 'he' 
                    ? `אין גלילים ${selectedColor} זמינים במלאי`
                    : `No ${selectedColor} spools available in inventory`}
                </div>
              )}
            </div>
          )}

          {/* Show selected spool info from inventory */}
          {loadSpoolMode === 'spool' && selectedSpoolId && (
            <div className="space-y-2">
              <Label>{language === 'he' ? 'גליל נבחר' : 'Selected spool'}</Label>
              {(() => {
                const spool = spools.find(s => s.id === selectedSpoolId);
                if (!spool) return null;
                return (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/30">
                    <div className="flex items-center gap-3">
                      <SpoolIcon color={getSpoolColor(spool.color)} size={32} />
                      <div>
                        <span className="font-medium">{spool.color}</span>
                        <div className="text-sm text-muted-foreground">
                          {spool.gramsRemainingEst}g • {spool.material || 'PLA'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {language === 'he' ? 'ביטול' : 'Cancel'}
          </Button>
          <Button onClick={handleLoadSpool} disabled={!selectedColor}>
            <ArrowRight className="w-4 h-4 mr-1" />
            {language === 'he' ? 'טען גליל' : 'Load Spool'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LoadSpoolDialog;
