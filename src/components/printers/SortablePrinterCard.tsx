import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GripVertical, Printer as PrinterIcon, Settings2, PowerOff, Package } from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { cn } from '@/lib/utils';
import { Printer, Spool, AMSSlotState } from '@/services/storage';

interface SortablePrinterCardProps {
  printer: Printer;
  spools: Spool[];
  language: 'he' | 'en';
  onEdit: (printer: Printer) => void;
  onDisable: (printer: Printer) => void;
  onLoadSpool: (printer: Printer, slotIndex?: number) => void;
  onUnloadSpool: (printer: Printer, slotIndex?: number) => void;
  getAmsModeBadge: (printer: Printer) => React.ReactNode;
  getStatusBadge: (printer: Printer) => React.ReactNode;
}

export const SortablePrinterCard: React.FC<SortablePrinterCardProps> = ({
  printer,
  spools,
  language,
  onEdit,
  onDisable,
  onLoadSpool,
  onUnloadSpool,
  getAmsModeBadge,
  getStatusBadge,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: printer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const getLoadedSpoolDisplay = (printer: Printer) => {
    if (printer.hasAMS && printer.amsSlotStates && printer.amsSlotStates.length > 0) {
      return printer.amsSlotStates;
    }
    if (printer.mountedColor) {
      return { color: printer.mountedColor, spoolId: printer.mountedSpoolId };
    }
    return null;
  };

  const loadedState = getLoadedSpoolDisplay(printer);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "transition-all hover:shadow-md",
        isDragging && "opacity-50 shadow-lg ring-2 ring-primary"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {/* Drag handle */}
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing p-1 -ml-1 hover:bg-muted rounded touch-none"
              title={language === 'he' ? 'גרור לשינוי סדר' : 'Drag to reorder'}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground" />
            </button>
            <PrinterIcon className="w-5 h-5 text-primary" />
            {printer.name}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0"
              onClick={() => onEdit(printer)}
            >
              <Settings2 className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0 text-error hover:text-error"
              onClick={() => onDisable(printer)}
              title={language === 'he' ? 'השבת מדפסת' : 'Disable printer'}
            >
              <PowerOff className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Loaded Spool Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {language === 'he' ? 'גליל טעון' : 'Loaded Spool'}
            </span>
            {!printer.hasAMS && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs gap-1"
                onClick={() => onLoadSpool(printer)}
              >
                <Package className="w-3 h-3" />
                {loadedState ? (language === 'he' ? 'החלף' : 'Replace') : (language === 'he' ? 'טען' : 'Load')}
              </Button>
            )}
          </div>
          
          {printer.hasAMS ? (
            // AMS Slots Display
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: printer.amsSlots || 4 }, (_, i) => {
                const slot = printer.amsSlotStates?.find(s => s.slotIndex === i);
                const slotSpool = slot?.spoolId ? spools.find(sp => sp.id === slot.spoolId) : null;
                const slotMaterial = slotSpool?.material;
                return (
                  <div 
                    key={i} 
                    className={cn(
                      "p-2 rounded-lg border text-center cursor-pointer transition-colors",
                      slot?.color 
                        ? "bg-primary/5 border-primary/30 hover:bg-primary/10" 
                        : "bg-muted/30 border-dashed hover:bg-muted/50"
                    )}
                    onClick={() => onLoadSpool(printer, i)}
                  >
                    {slot?.color ? (
                      <div className="flex flex-col items-center gap-1">
                        <SpoolIcon color={getSpoolColor(slot.color)} size={24} />
                        <span className="text-xs font-medium">
                          {slot.color} {slotMaterial ? `• ${slotMaterial}` : ''}
                        </span>
                        <Badge variant="outline" className="text-[10px] h-4">
                          {slot.spoolId ? '✓' : '⚠️'}
                        </Badge>
                      </div>
                    ) : (
                      <div className="py-2 text-xs text-muted-foreground">
                        {language === 'he' ? `חריץ ${i + 1}` : `Slot ${i + 1}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            // Single spool display
            loadedState && typeof loadedState === 'object' && 'color' in loadedState ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/30">
                <div className="flex items-center gap-3">
                  <SpoolIcon color={getSpoolColor(loadedState.color)} size={32} />
                  <div>
                    <span className="font-medium">
                      {loadedState.color} {printer.currentMaterial ? `• ${printer.currentMaterial}` : ''}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      {loadedState.spoolId 
                        ? (language === 'he' ? 'גליל מהמלאי' : 'From inventory')
                        : (language === 'he' ? 'צבע בלבד - בחר גליל' : 'Color only - select spool')}
                    </div>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-muted-foreground hover:text-error"
                  onClick={() => onUnloadSpool(printer)}
                >
                  ✕
                </Button>
              </div>
            ) : (
              <div 
                className="p-4 rounded-lg border border-dashed text-center text-muted-foreground cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => onLoadSpool(printer)}
              >
                <Package className="w-6 h-6 mx-auto mb-1 opacity-50" />
                <span className="text-sm">{language === 'he' ? 'לחץ לטעינת גליל' : 'Click to load spool'}</span>
              </div>
            )
          )}
        </div>
        
        {/* AMS Status Badge */}
        <div className="flex items-center gap-2 pt-2 border-t">
          <div className="w-4 h-4 text-muted-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
          </div>
          {printer.hasAMS ? (
            <div className="flex items-center gap-2">
              <span className="text-sm">AMS ({printer.amsSlots || 4})</span>
              {getAmsModeBadge(printer)}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {language === 'he' ? 'ללא AMS' : 'No AMS'}
            </span>
          )}
          <div className="flex-1" />
          {getStatusBadge(printer)}
        </div>
      </CardContent>
    </Card>
  );
};
