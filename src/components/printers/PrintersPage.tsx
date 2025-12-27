import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Printer as PrinterIcon, Settings2, CircleDot, Box, Layers, Plus, AlertTriangle, Power, PowerOff, RefreshCw, Package, ArrowRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { cn } from '@/lib/utils';
import { 
  getPrinters, 
  updatePrinter,
  createPrinter,
  getSpools,
  updateSpool,
  getPlannedCycles,
  updatePlannedCycle,
  getNextPrinterNumber,
  getFactorySettings,
  markCapacityChanged,
  setLoadedSpoolsInitialized,
  FilamentEstimate,
  AMSSlotState,
  Printer, 
  Spool,
  PlannedCycle,
} from '@/services/storage';

export const PrintersPage: React.FC = () => {
  const { language } = useLanguage();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [spools, setSpools] = useState<Spool[]>([]);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  
  // Add printer dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newPrinter, setNewPrinter] = useState({
    printerNumber: 1,
    name: '',
    hasAMS: false,
    amsSlots: 4,
    amsMode: 'backup_same_color' as 'backup_same_color' | 'multi_color',
  });
  
  // Disable printer dialog
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [printerToDisable, setPrinterToDisable] = useState<Printer | null>(null);
  const [disableReason, setDisableReason] = useState<'breakdown' | 'maintenance' | 'retired'>('maintenance');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  
  // Cycle reassignment alert
  const [cycleAlertOpen, setCycleAlertOpen] = useState(false);
  const [affectedCycles, setAffectedCycles] = useState<PlannedCycle[]>([]);
  
  // Load spool dialog
  const [loadSpoolDialogOpen, setLoadSpoolDialogOpen] = useState(false);
  const [loadSpoolPrinter, setLoadSpoolPrinter] = useState<Printer | null>(null);
  const [loadSpoolMode, setLoadSpoolMode] = useState<'color' | 'spool'>('color');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSpoolId, setSelectedSpoolId] = useState('');
  const [selectedEstimate, setSelectedEstimate] = useState<FilamentEstimate>('medium');
  const [loadSlotIndex, setLoadSlotIndex] = useState<number | null>(null); // null = main spool, number = AMS slot

  useEffect(() => {
    refreshData();
  }, []);

  const refreshData = () => {
    setPrinters(getPrinters());
    setSpools(getSpools());
    const settings = getFactorySettings();
    if (settings?.colors) {
      setAvailableColors(settings.colors);
    }
  };

  const handleEditPrinter = (printer: Printer) => {
    setEditingPrinter({ ...printer });
    setSheetOpen(true);
  };

  const handleSavePrinter = () => {
    if (!editingPrinter) return;
    
    updatePrinter(editingPrinter.id, editingPrinter);
    refreshData();
    setSheetOpen(false);
    setEditingPrinter(null);
    
    toast({
      title: language === 'he' ? 'מדפסת עודכנה' : 'Printer updated',
      description: editingPrinter.name,
    });
  };

  const handleOpenAddDialog = () => {
    const nextNumber = getNextPrinterNumber();
    setNewPrinter({
      printerNumber: nextNumber,
      name: language === 'he' ? `מדפסת ${nextNumber}` : `Printer ${nextNumber}`,
      hasAMS: false,
      amsSlots: 4,
      amsMode: 'backup_same_color',
    });
    setAddDialogOpen(true);
  };

  const handleAddPrinter = () => {
    const printer = createPrinter({
      printerNumber: newPrinter.printerNumber,
      name: newPrinter.name || (language === 'he' ? `מדפסת ${newPrinter.printerNumber}` : `Printer ${newPrinter.printerNumber}`),
      active: true,
      status: 'active',
      hasAMS: newPrinter.hasAMS,
      amsSlots: newPrinter.hasAMS ? newPrinter.amsSlots : undefined,
      amsMode: newPrinter.hasAMS ? newPrinter.amsMode : undefined,
    });
    
    // Mark capacity as changed
    markCapacityChanged(language === 'he' ? 'נוספה מדפסת חדשה' : 'New printer added');
    
    refreshData();
    setAddDialogOpen(false);
    
    toast({
      title: language === 'he' ? 'מדפסת נוספה' : 'Printer added',
      description: printer.name,
    });
  };

  const handleOpenDisableDialog = (printer: Printer) => {
    setPrinterToDisable(printer);
    setDisableReason('maintenance');
    setExpectedReturnDate('');
    
    // Check for planned cycles
    const cycles = getPlannedCycles().filter(
      c => c.printerId === printer.id && (c.status === 'planned' || c.status === 'in_progress')
    );
    
    if (cycles.length > 0) {
      setAffectedCycles(cycles);
      setCycleAlertOpen(true);
    } else {
      setDisableDialogOpen(true);
    }
  };

  const handleConfirmDisable = (reassignCycles: boolean) => {
    if (!printerToDisable) return;
    
    // Disable the printer
    updatePrinter(printerToDisable.id, {
      status: 'out_of_service',
      active: false,
      disableReason,
      disabledAt: new Date().toISOString(),
      expectedReturnDate: expectedReturnDate || undefined,
    });
    
    // Handle cycles if needed
    if (reassignCycles && affectedCycles.length > 0) {
      const activePrinters = printers.filter(
        p => p.id !== printerToDisable.id && p.status === 'active'
      );
      
      affectedCycles.forEach((cycle, idx) => {
        if (activePrinters.length > 0) {
          const targetPrinter = activePrinters[idx % activePrinters.length];
          updatePlannedCycle(cycle.id, { printerId: targetPrinter.id });
        }
      });
      
      toast({
        title: language === 'he' ? 'מחזורים הועברו' : 'Cycles reassigned',
        description: language === 'he' 
          ? `${affectedCycles.length} מחזורים הועברו למדפסות אחרות`
          : `${affectedCycles.length} cycles moved to other printers`,
      });
    }
    
    // Mark capacity as changed
    markCapacityChanged(language === 'he' ? 'מדפסת הושבתה' : 'Printer disabled');
    
    refreshData();
    setDisableDialogOpen(false);
    setCycleAlertOpen(false);
    setPrinterToDisable(null);
    setAffectedCycles([]);
    
    toast({
      title: language === 'he' ? 'מדפסת הושבתה' : 'Printer disabled',
      description: printerToDisable.name,
    });
  };

  const handleReactivatePrinter = (printer: Printer) => {
    updatePrinter(printer.id, {
      status: 'active',
      active: true,
      disableReason: undefined,
      disabledAt: undefined,
      expectedReturnDate: undefined,
    });
    
    // Mark capacity as changed
    markCapacityChanged(language === 'he' ? 'מדפסת הופעלה מחדש' : 'Printer reactivated');
    
    refreshData();
    
    toast({
      title: language === 'he' ? 'מדפסת הופעלה מחדש' : 'Printer reactivated',
      description: printer.name,
    });
  };

  const getAssignedSpools = (printerId: string) => {
    return spools.filter(s => s.assignedPrinterId === printerId && s.state !== 'empty');
  };

  // Open load spool dialog
  const handleOpenLoadSpoolDialog = (printer: Printer, slotIndex?: number) => {
    setLoadSpoolPrinter(printer);
    setLoadSlotIndex(slotIndex ?? null);
    setLoadSpoolMode('color');
    setSelectedColor(printer.currentColor || '');
    setSelectedSpoolId('');
    setSelectedEstimate('medium');
    setLoadSpoolDialogOpen(true);
  };

  // Handle loading a spool onto a printer
  const handleLoadSpool = () => {
    if (!loadSpoolPrinter) return;

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
        s.assignedPrinterId === loadSpoolPrinter.id && 
        (loadSlotIndex === null || s.amsSlotIndex === loadSlotIndex)
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
        location: loadSlotIndex !== null ? 'ams' : 'printer',
        assignedPrinterId: loadSpoolPrinter.id,
        amsSlotIndex: loadSlotIndex ?? undefined,
      }, true);
    }

    if (loadSpoolPrinter.hasAMS && loadSlotIndex !== null) {
      // Update AMS slot
      const currentSlots = loadSpoolPrinter.amsSlotStates || [];
      const existingSlotIdx = currentSlots.findIndex(s => s.slotIndex === loadSlotIndex);
      
      let newSlots: AMSSlotState[];
      const newSlot: AMSSlotState = {
        slotIndex: loadSlotIndex,
        spoolId: loadSpoolMode === 'spool' ? selectedSpoolId : null,
        color,
        estimate: selectedEstimate,
      };

      if (existingSlotIdx >= 0) {
        newSlots = [...currentSlots];
        newSlots[existingSlotIdx] = newSlot;
      } else {
        newSlots = [...currentSlots, newSlot];
      }

      updatePrinter(loadSpoolPrinter.id, { 
        amsSlotStates: newSlots,
        currentColor: newSlots[0]?.color || color,
      });
    } else {
      // Update main spool
      updatePrinter(loadSpoolPrinter.id, {
        mountedSpoolId: loadSpoolMode === 'spool' ? selectedSpoolId : null,
        mountedColor: color,
        mountedEstimate: selectedEstimate,
        currentColor: color,
      });
    }

    // Mark loaded spools as initialized
    setLoadedSpoolsInitialized(true);

    refreshData();
    setLoadSpoolDialogOpen(false);

    toast({
      title: language === 'he' ? 'גליל נטען' : 'Spool loaded',
      description: `${color} → ${loadSpoolPrinter.name}`,
    });
  };

  // Clear loaded spool from printer
  const handleUnloadSpool = (printer: Printer, slotIndex?: number) => {
    // Return spool to stock
    const spoolsToUnload = spools.filter(s => 
      s.assignedPrinterId === printer.id && 
      (slotIndex === undefined || s.amsSlotIndex === slotIndex)
    );
    spoolsToUnload.forEach(s => {
      updateSpool(s.id, { 
        location: 'stock', 
        assignedPrinterId: undefined,
        amsSlotIndex: undefined 
      }, true);
    });

    if (printer.hasAMS && slotIndex !== undefined) {
      // Remove AMS slot
      const newSlots = (printer.amsSlotStates || []).filter(s => s.slotIndex !== slotIndex);
      updatePrinter(printer.id, { amsSlotStates: newSlots });
    } else {
      // Clear main spool
      updatePrinter(printer.id, {
        mountedSpoolId: null,
        mountedColor: undefined,
        mountedEstimate: undefined,
        currentColor: undefined,
      });
    }

    refreshData();
    toast({
      title: language === 'he' ? 'גליל הוסר' : 'Spool unloaded',
    });
  };

  // Get available spools for loading (not already on a printer)
  const getAvailableSpools = () => {
    return spools.filter(s => 
      s.state !== 'empty' && 
      s.location === 'stock' &&
      (!selectedColor || s.color.toLowerCase() === selectedColor.toLowerCase())
    );
  };

  // Get loaded state display for a printer
  const getLoadedSpoolDisplay = (printer: Printer) => {
    if (printer.hasAMS && printer.amsSlotStates && printer.amsSlotStates.length > 0) {
      return printer.amsSlotStates;
    }
    if (printer.mountedColor) {
      return { color: printer.mountedColor, estimate: printer.mountedEstimate };
    }
    return null;
  };

  const getAmsModeBadge = (printer: Printer) => {
    if (!printer.hasAMS) return null;
    
    const config = {
      backup_same_color: { 
        label: language === 'he' ? 'גיבוי צבע' : 'Backup', 
        className: 'bg-primary/10 text-primary border-primary/20' 
      },
      multi_color: { 
        label: language === 'he' ? 'רב-צבעי' : 'Multi-color', 
        className: 'bg-secondary/80 text-secondary-foreground' 
      },
    };
    
    const mode = printer.amsMode || 'backup_same_color';
    return (
      <Badge variant="outline" className={config[mode].className}>
        {config[mode].label}
      </Badge>
    );
  };

  const getStatusBadge = (printer: Printer) => {
    const config = {
      active: { 
        label: language === 'he' ? 'פעילה' : 'Active', 
        className: 'bg-success/10 text-success border-success/20' 
      },
      out_of_service: { 
        label: language === 'he' ? 'מושבתת' : 'Out of Service', 
        className: 'bg-error/10 text-error border-error/20' 
      },
      archived: { 
        label: language === 'he' ? 'בארכיון' : 'Archived', 
        className: 'bg-muted text-muted-foreground' 
      },
    };
    const status = printer.status || 'active';
    return <Badge variant="outline" className={config[status].className}>{config[status].label}</Badge>;
  };

  const getDisableReasonLabel = (reason?: string) => {
    const labels = {
      breakdown: language === 'he' ? 'תקלה' : 'Breakdown',
      maintenance: language === 'he' ? 'תחזוקה' : 'Maintenance',
      retired: language === 'he' ? 'יצא משימוש' : 'Retired',
    };
    return reason ? labels[reason as keyof typeof labels] || reason : '';
  };

  const activePrinters = printers.filter(p => p.status === 'active');
  const inactivePrinters = printers.filter(p => p.status !== 'active');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <PrinterIcon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {language === 'he' ? 'מדפסות' : 'Printers'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {language === 'he' 
                ? `${activePrinters.length} פעילות, ${inactivePrinters.length} מושבתות`
                : `${activePrinters.length} active, ${inactivePrinters.length} inactive`}
            </p>
          </div>
        </div>
        
        <Button onClick={handleOpenAddDialog} className="gap-2">
          <Plus className="w-4 h-4" />
          {language === 'he' ? 'הוסף מדפסת' : 'Add Printer'}
        </Button>
      </div>

      {/* Active Printers */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {activePrinters.map((printer) => {
          const assignedSpools = getAssignedSpools(printer.id);
          const loadedState = getLoadedSpoolDisplay(printer);
          
          return (
            <Card key={printer.id} className="transition-all hover:shadow-md">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <PrinterIcon className="w-5 h-5 text-primary" />
                    {printer.name}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0"
                      onClick={() => handleEditPrinter(printer)}
                    >
                      <Settings2 className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 text-error hover:text-error"
                      onClick={() => handleOpenDisableDialog(printer)}
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
                        onClick={() => handleOpenLoadSpoolDialog(printer)}
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
                        return (
                          <div 
                            key={i} 
                            className={cn(
                              "p-2 rounded-lg border text-center cursor-pointer transition-colors",
                              slot?.color 
                                ? "bg-primary/5 border-primary/30 hover:bg-primary/10" 
                                : "bg-muted/30 border-dashed hover:bg-muted/50"
                            )}
                            onClick={() => handleOpenLoadSpoolDialog(printer, i)}
                          >
                            {slot?.color ? (
                              <div className="flex flex-col items-center gap-1">
                                <SpoolIcon color={getSpoolColor(slot.color)} size={24} />
                                <span className="text-xs font-medium">{slot.color}</span>
                                <Badge variant="outline" className="text-[10px] h-4">
                                  {slot.estimate === 'low' ? '🔴' : slot.estimate === 'medium' ? '🟡' : slot.estimate === 'high' ? '🟢' : '❓'}
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
                            <span className="font-medium">{loadedState.color}</span>
                            <div className="text-xs text-muted-foreground">
                              {loadedState.estimate === 'low' 
                                ? (language === 'he' ? 'כמות נמוכה' : 'Low amount')
                                : loadedState.estimate === 'medium'
                                  ? (language === 'he' ? 'כמות בינונית' : 'Medium amount')
                                  : loadedState.estimate === 'high'
                                    ? (language === 'he' ? 'כמות גבוהה' : 'High amount')
                                    : (language === 'he' ? 'לא ידוע' : 'Unknown')}
                            </div>
                          </div>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-muted-foreground hover:text-error"
                          onClick={() => handleUnloadSpool(printer)}
                        >
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <div 
                        className="p-4 rounded-lg border border-dashed text-center text-muted-foreground cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => handleOpenLoadSpoolDialog(printer)}
                      >
                        <Package className="w-6 h-6 mx-auto mb-1 opacity-50" />
                        <span className="text-sm">{language === 'he' ? 'לחץ לטעינת גליל' : 'Click to load spool'}</span>
                      </div>
                    )
                  )}
                </div>
                
                {/* AMS Status Badge */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Box className="w-4 h-4 text-muted-foreground" />
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
        })}
      </div>

      {activePrinters.length === 0 && (
        <Card className="p-8 text-center">
          <PrinterIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold mb-2">
            {language === 'he' ? 'אין מדפסות פעילות' : 'No active printers'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {language === 'he' ? 'הוסיפו מדפסת חדשה או הפעילו מחדש מדפסת קיימת' : 'Add a new printer or reactivate an existing one'}
          </p>
          <Button onClick={handleOpenAddDialog}>
            <Plus className="w-4 h-4 mr-2" />
            {language === 'he' ? 'הוסף מדפסת' : 'Add Printer'}
          </Button>
        </Card>
      )}

      {/* Inactive Printers Section */}
      {inactivePrinters.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-muted-foreground">
            {language === 'he' ? 'מדפסות לא פעילות' : 'Inactive Printers'}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inactivePrinters.map((printer) => (
              <Card key={printer.id} className="opacity-70 border-dashed">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2 text-muted-foreground">
                      <PrinterIcon className="w-5 h-5" />
                      {printer.name}
                    </CardTitle>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="gap-1"
                      onClick={() => handleReactivatePrinter(printer)}
                    >
                      <RefreshCw className="w-3 h-3" />
                      {language === 'he' ? 'הפעל' : 'Reactivate'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(printer)}
                    {printer.disableReason && (
                      <span className="text-sm text-muted-foreground">
                        ({getDisableReasonLabel(printer.disableReason)})
                      </span>
                    )}
                  </div>
                  {printer.disabledAt && (
                    <p className="text-xs text-muted-foreground">
                      {language === 'he' ? 'הושבת ב-' : 'Disabled on '}
                      {format(new Date(printer.disabledAt), 'dd/MM/yyyy')}
                    </p>
                  )}
                  {printer.expectedReturnDate && (
                    <p className="text-xs text-muted-foreground">
                      {language === 'he' ? 'צפי לחזרה: ' : 'Expected return: '}
                      {format(new Date(printer.expectedReturnDate), 'dd/MM/yyyy')}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Add Printer Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              {language === 'he' ? 'הוסף מדפסת חדשה' : 'Add New Printer'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{language === 'he' ? 'מספר מדפסת' : 'Printer Number'}</Label>
                <Input
                  type="number"
                  min={1}
                  value={newPrinter.printerNumber}
                  onChange={(e) => setNewPrinter({ ...newPrinter, printerNumber: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'he' ? 'שם (אופציונלי)' : 'Name (optional)'}</Label>
                <Input
                  value={newPrinter.name}
                  onChange={(e) => setNewPrinter({ ...newPrinter, name: e.target.value })}
                  placeholder={language === 'he' ? `מדפסת ${newPrinter.printerNumber}` : `Printer ${newPrinter.printerNumber}`}
                />
              </div>
            </div>

            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center justify-between">
                <Label>AMS</Label>
                <Switch
                  checked={newPrinter.hasAMS}
                  onCheckedChange={(v) => setNewPrinter({ ...newPrinter, hasAMS: v })}
                />
              </div>

              {newPrinter.hasAMS && (
                <>
                  <div className="space-y-2">
                    <Label>{language === 'he' ? 'מספר משבצות' : 'AMS Slots'}</Label>
                    <Select 
                      value={String(newPrinter.amsSlots)} 
                      onValueChange={(v) => setNewPrinter({ ...newPrinter, amsSlots: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border shadow-lg">
                        <SelectItem value="4">4 slots</SelectItem>
                        <SelectItem value="8">8 slots</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{language === 'he' ? 'מצב AMS' : 'AMS Mode'}</Label>
                    <Select 
                      value={newPrinter.amsMode} 
                      onValueChange={(v) => setNewPrinter({ ...newPrinter, amsMode: v as typeof newPrinter.amsMode })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border shadow-lg">
                        <SelectItem value="backup_same_color">
                          {language === 'he' ? 'גיבוי אותו צבע' : 'Backup same-color'}
                        </SelectItem>
                        <SelectItem value="multi_color">
                          {language === 'he' ? 'רב-צבעי' : 'Multi-color'}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button onClick={handleAddPrinter}>
              {language === 'he' ? 'הוסף מדפסת' : 'Add Printer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable Printer Dialog */}
      <Dialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-error">
              <PowerOff className="w-5 h-5" />
              {language === 'he' ? 'השבתת מדפסת' : 'Disable Printer'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {language === 'he' 
                ? `המדפסת "${printerToDisable?.name}" תוסר מהתכנון והדשבורד.`
                : `Printer "${printerToDisable?.name}" will be removed from planning and dashboard.`}
            </p>
            
            <div className="space-y-2">
              <Label>{language === 'he' ? 'סיבת השבתה' : 'Reason'}</Label>
              <Select value={disableReason} onValueChange={(v) => setDisableReason(v as typeof disableReason)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border shadow-lg">
                  <SelectItem value="breakdown">{language === 'he' ? 'תקלה' : 'Breakdown'}</SelectItem>
                  <SelectItem value="maintenance">{language === 'he' ? 'תחזוקה' : 'Maintenance'}</SelectItem>
                  <SelectItem value="retired">{language === 'he' ? 'יצא משימוש' : 'Retired'}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{language === 'he' ? 'תאריך חזרה צפוי (אופציונלי)' : 'Expected Return (optional)'}</Label>
              <Input
                type="date"
                value={expectedReturnDate}
                onChange={(e) => setExpectedReturnDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button variant="destructive" onClick={() => handleConfirmDisable(false)}>
              {language === 'he' ? 'השבת מדפסת' : 'Disable Printer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cycle Reassignment Alert */}
      <AlertDialog open={cycleAlertOpen} onOpenChange={setCycleAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              {language === 'he' ? 'מחזורים מתוכננים' : 'Planned Cycles'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'he' 
                ? `למדפסת זו יש ${affectedCycles.length} מחזורים מתוכננים. מה לעשות איתם?`
                : `This printer has ${affectedCycles.length} planned cycles. What should happen to them?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </AlertDialogCancel>
            <Button 
              variant="outline"
              onClick={() => {
                setCycleAlertOpen(false);
                setDisableDialogOpen(true);
              }}
            >
              {language === 'he' ? 'השאר לא מוקצים' : 'Leave unassigned'}
            </Button>
            <AlertDialogAction onClick={() => {
              setCycleAlertOpen(false);
              setDisableDialogOpen(true);
              // Will reassign on confirm
              setTimeout(() => handleConfirmDisable(true), 100);
            }}>
              {language === 'he' ? 'העבר למדפסות אחרות' : 'Reassign to other printers'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Printer Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <PrinterIcon className="w-5 h-5 text-primary" />
              {language === 'he' ? 'עריכת מדפסת' : 'Edit Printer'}
            </SheetTitle>
          </SheetHeader>
          
          {editingPrinter && (
            <div className="space-y-6 py-6">
              {/* Printer Name */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'שם המדפסת' : 'Printer Name'}</Label>
                <Input
                  value={editingPrinter.name}
                  onChange={(e) => setEditingPrinter({ ...editingPrinter, name: e.target.value })}
                />
              </div>

              {/* Current Color */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'צבע נוכחי' : 'Current Color'}</Label>
                <Select 
                  value={editingPrinter.currentColor || 'none'} 
                  onValueChange={(v) => setEditingPrinter({ ...editingPrinter, currentColor: v === 'none' ? undefined : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחר צבע' : 'Select color'} />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg">
                    <SelectItem value="none">{language === 'he' ? 'לא מוגדר' : 'Not set'}</SelectItem>
                    {availableColors.filter(c => c && c.trim()).map((color) => (
                      <SelectItem key={color} value={color}>{color}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Current Material */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'חומר נוכחי' : 'Current Material'}</Label>
                <Select 
                  value={editingPrinter.currentMaterial || 'none'} 
                  onValueChange={(v) => setEditingPrinter({ ...editingPrinter, currentMaterial: v === 'none' ? undefined : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחר חומר' : 'Select material'} />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg">
                    <SelectItem value="none">{language === 'he' ? 'לא מוגדר' : 'Not set'}</SelectItem>
                    <SelectItem value="PLA">PLA</SelectItem>
                    <SelectItem value="PETG">PETG</SelectItem>
                    <SelectItem value="ABS">ABS</SelectItem>
                    <SelectItem value="TPU">TPU</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* AMS Section */}
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <h3 className="font-semibold flex items-center gap-2">
                  <Box className="w-4 h-4" />
                  AMS {language === 'he' ? 'הגדרות' : 'Settings'}
                </h3>
                
                <div className="flex items-center justify-between">
                  <Label>{language === 'he' ? 'יש AMS?' : 'Has AMS?'}</Label>
                  <Switch
                    checked={editingPrinter.hasAMS}
                    onCheckedChange={(v) => setEditingPrinter({ 
                      ...editingPrinter, 
                      hasAMS: v,
                      amsSlots: v ? (editingPrinter.amsSlots || 4) : undefined,
                      amsMode: v ? (editingPrinter.amsMode || 'backup_same_color') : undefined,
                    })}
                  />
                </div>

                {editingPrinter.hasAMS && (
                  <>
                    <div className="space-y-2">
                      <Label>{language === 'he' ? 'מספר משבצות' : 'Number of Slots'}</Label>
                      <Select 
                        value={String(editingPrinter.amsSlots || 4)} 
                        onValueChange={(v) => setEditingPrinter({ ...editingPrinter, amsSlots: parseInt(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background border shadow-lg">
                          <SelectItem value="4">4 {language === 'he' ? 'משבצות' : 'slots'}</SelectItem>
                          <SelectItem value="8">8 {language === 'he' ? 'משבצות' : 'slots'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{language === 'he' ? 'מצב AMS' : 'AMS Mode'}</Label>
                      <Select 
                        value={editingPrinter.amsMode || 'backup_same_color'} 
                        onValueChange={(v) => setEditingPrinter({ 
                          ...editingPrinter, 
                          amsMode: v as 'backup_same_color' | 'multi_color' 
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background border shadow-lg">
                          <SelectItem value="backup_same_color">
                            {language === 'he' ? 'גיבוי אותו צבע' : 'Backup same-color'}
                          </SelectItem>
                          <SelectItem value="multi_color">
                            {language === 'he' ? 'הדפסה רב-צבעית' : 'Multi-color printing'}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {editingPrinter.amsMode === 'backup_same_color' && (
                      <div className="space-y-2 pt-2 border-t">
                        <Label className="text-sm">
                          {language === 'he' ? 'גלילים מוקצים' : 'Assigned Spools'}
                        </Label>
                        {(() => {
                          const assignedSpools = getAssignedSpools(editingPrinter.id);
                          if (assignedSpools.length === 0) {
                            return (
                              <p className="text-sm text-muted-foreground">
                                {language === 'he' 
                                  ? 'אין גלילים מוקצים. הקצו גלילים מדף המלאי.'
                                  : 'No spools assigned. Assign spools from Inventory.'}
                              </p>
                            );
                          }
                          return (
                            <div className="space-y-2">
                              {assignedSpools.map((spool) => (
                                <div key={spool.id} className="flex items-center justify-between p-2 bg-background rounded border">
                                  <div className="flex items-center gap-2">
                                    <CircleDot className="w-4 h-4" />
                                    <span className="text-sm">{spool.color}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {spool.gramsRemainingEst}g
                                    </span>
                                  </div>
                                  <Badge variant="outline" className="text-xs">
                                    Slot {(spool.amsSlotIndex ?? 0) + 1}
                                  </Badge>
                                </div>
                              ))}
                              <p className="text-xs text-muted-foreground">
                                {language === 'he' 
                                  ? `סה"כ: ${assignedSpools.reduce((sum, s) => sum + s.gramsRemainingEst, 0)}g זמינים`
                                  : `Total: ${assignedSpools.reduce((sum, s) => sum + s.gramsRemainingEst, 0)}g available`}
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Max Spool Weight */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'משקל גליל מקסימלי' : 'Max Spool Weight'}</Label>
                <Select 
                  value={String(editingPrinter.maxSpoolWeight || 1000)} 
                  onValueChange={(v) => setEditingPrinter({ ...editingPrinter, maxSpoolWeight: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg">
                    <SelectItem value="1000">1kg</SelectItem>
                    <SelectItem value="2000">2kg</SelectItem>
                    <SelectItem value="5000">5kg</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Save Button */}
              <div className="flex gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setSheetOpen(false)} className="flex-1">
                  {language === 'he' ? 'ביטול' : 'Cancel'}
                </Button>
                <Button onClick={handleSavePrinter} className="flex-1">
                  {language === 'he' ? 'שמור' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Load Spool Dialog */}
      <Dialog open={loadSpoolDialogOpen} onOpenChange={setLoadSpoolDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              {language === 'he' ? 'טעינת גליל' : 'Load Spool'}
              {loadSpoolPrinter && (
                <span className="text-muted-foreground font-normal">
                  → {loadSpoolPrinter.name}
                  {loadSlotIndex !== null && ` (Slot ${loadSlotIndex + 1})`}
                </span>
              )}
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

            {/* Spool Selection (if mode is spool) */}
            {loadSpoolMode === 'spool' && selectedColor && (
              <div className="space-y-2">
                <Label>{language === 'he' ? 'בחר גליל מהמלאי' : 'Select spool from inventory'}</Label>
                {getAvailableSpools().length > 0 ? (
                  <Select value={selectedSpoolId} onValueChange={setSelectedSpoolId}>
                    <SelectTrigger>
                      <SelectValue placeholder={language === 'he' ? 'בחר גליל' : 'Select spool'} />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
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

            {/* Estimate */}
            <div className="space-y-2">
              <Label>{language === 'he' ? 'כמה נשאר בערך?' : 'How much is left?'}</Label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: 'unknown' as FilamentEstimate, labelHe: 'לא יודע', labelEn: "Don't know" },
                  { value: 'low' as FilamentEstimate, labelHe: 'מעט', labelEn: 'Low' },
                  { value: 'medium' as FilamentEstimate, labelHe: 'בינוני', labelEn: 'Medium' },
                  { value: 'high' as FilamentEstimate, labelHe: 'הרבה', labelEn: 'High' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedEstimate(opt.value)}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded-lg transition-colors",
                      selectedEstimate === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80"
                    )}
                  >
                    {language === 'he' ? opt.labelHe : opt.labelEn}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadSpoolDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button onClick={handleLoadSpool} disabled={!selectedColor}>
              <ArrowRight className="w-4 h-4 mr-1" />
              {language === 'he' ? 'טען גליל' : 'Load Spool'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
