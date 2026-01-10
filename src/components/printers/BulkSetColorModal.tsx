import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Printer as PrinterIcon, Palette, Moon, AlertTriangle } from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { Printer } from '@/services/storage';

interface BulkSetColorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  printers: Printer[];
  availableColors: string[];
  language: 'he' | 'en';
  onApply: (printerIds: string[], color: string) => void;
}

export const BulkSetColorModal: React.FC<BulkSetColorModalProps> = ({
  open,
  onOpenChange,
  printers,
  availableColors,
  language,
  onApply,
}) => {
  const [selectedPrinterIds, setSelectedPrinterIds] = useState<Set<string>>(new Set());
  const [selectedColor, setSelectedColor] = useState('');

  // Filter to show only printers that need color assignment (no AMS, no mountedColor)
  const eligiblePrinters = useMemo(() => {
    return printers.filter(p => 
      p.status === 'active' && 
      !p.hasAMS && 
      !p.mountedColor
    );
  }, [printers]);

  // Also show printers that already have color (for reference)
  const printersWithColor = useMemo(() => {
    return printers.filter(p => 
      p.status === 'active' && 
      !p.hasAMS && 
      p.mountedColor
    );
  }, [printers]);

  const handleTogglePrinter = (printerId: string) => {
    setSelectedPrinterIds(prev => {
      const next = new Set(prev);
      if (next.has(printerId)) {
        next.delete(printerId);
      } else {
        next.add(printerId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPrinterIds.size === eligiblePrinters.length) {
      setSelectedPrinterIds(new Set());
    } else {
      setSelectedPrinterIds(new Set(eligiblePrinters.map(p => p.id)));
    }
  };

  const handleApply = () => {
    if (selectedPrinterIds.size > 0 && selectedColor) {
      onApply(Array.from(selectedPrinterIds), selectedColor);
      // Reset state
      setSelectedPrinterIds(new Set());
      setSelectedColor('');
      onOpenChange(false);
    }
  };

  const handleClose = () => {
    setSelectedPrinterIds(new Set());
    setSelectedColor('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            {language === 'he' ? 'הגדרת צבע פיזי למדפסות' : 'Bulk Set Mounted Color'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Info Banner */}
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
            <div className="flex gap-2">
              <Moon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">
                  {language === 'he' 
                    ? 'נדרש להפעלת מחזורי לילה' 
                    : 'Required for Night Cycles'}
                </p>
                <p className="text-muted-foreground mt-1">
                  {language === 'he'
                    ? 'מדפסות ללא צבע מוגדר לא ייכללו בתכנון הלילה. הגדר את הצבע שטעון כרגע במדפסת.'
                    : 'Printers without a mounted color are excluded from night planning. Set the color currently loaded on each printer.'}
                </p>
              </div>
            </div>
          </div>

          {/* Color Selection */}
          <div className="space-y-2">
            <Label>{language === 'he' ? 'בחר צבע להגדרה' : 'Select color to set'}</Label>
            <Select value={selectedColor} onValueChange={setSelectedColor}>
              <SelectTrigger>
                <SelectValue placeholder={language === 'he' ? 'בחר צבע' : 'Select color'} />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
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

          {/* Printers without color */}
          {eligiblePrinters.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  {language === 'he' 
                    ? `מדפסות ללא צבע (${eligiblePrinters.length})`
                    : `Printers without color (${eligiblePrinters.length})`}
                </Label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleSelectAll}
                  className="h-7 text-xs"
                >
                  {selectedPrinterIds.size === eligiblePrinters.length
                    ? (language === 'he' ? 'בטל בחירה' : 'Deselect All')
                    : (language === 'he' ? 'בחר הכל' : 'Select All')}
                </Button>
              </div>
              
              <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
                {eligiblePrinters.map(printer => (
                  <label 
                    key={printer.id}
                    className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedPrinterIds.has(printer.id)}
                      onCheckedChange={() => handleTogglePrinter(printer.id)}
                    />
                    <PrinterIcon className="w-4 h-4 text-muted-foreground" />
                    <span className="flex-1">{printer.name}</span>
                    <Badge variant="outline" className="text-warning border-warning/30">
                      {language === 'he' ? 'ללא צבע' : 'No color'}
                    </Badge>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-success/5 border border-success/20 text-center">
              <p className="text-success font-medium">
                {language === 'he' 
                  ? '✓ כל המדפסות הפשוטות מוגדרות עם צבע' 
                  : '✓ All non-AMS printers have a color set'}
              </p>
            </div>
          )}

          {/* Printers with color (read-only reference) */}
          {printersWithColor.length > 0 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {language === 'he' 
                  ? `מדפסות עם צבע מוגדר (${printersWithColor.length})`
                  : `Printers with color set (${printersWithColor.length})`}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {printersWithColor.map(printer => (
                  <div 
                    key={printer.id}
                    className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-sm"
                  >
                    <SpoolIcon color={getSpoolColor(printer.mountedColor!)} size={16} />
                    <span className="truncate">{printer.name}</span>
                    <span className="text-muted-foreground text-xs">({printer.mountedColor})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {language === 'he' ? 'ביטול' : 'Cancel'}
          </Button>
          <Button 
            onClick={handleApply} 
            disabled={selectedPrinterIds.size === 0 || !selectedColor}
          >
            <Palette className="w-4 h-4 mr-1" />
            {language === 'he' 
              ? `הגדר צבע ל-${selectedPrinterIds.size} מדפסות`
              : `Set color for ${selectedPrinterIds.size} printers`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
