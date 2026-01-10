import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
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
import { Printer as PrinterIcon, Settings2, CircleDot, Box, Layers, Plus, AlertTriangle, Power, PowerOff, RefreshCw, Package, ArrowRight, Palette } from 'lucide-react';
import { BulkSetColorModal } from './BulkSetColorModal';
import { toast } from '@/hooks/use-toast';

import { format } from 'date-fns';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { cn } from '@/lib/utils';

// Drag and drop
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortablePrinterCard } from './SortablePrinterCard';

// Cloud storage for persistence
import { 
  getPrinters as getCloudPrinters,
  createPrinter as createCloudPrinter,
  updatePrinter as updateCloudPrinter,
  updatePrintersOrder,
  DbPrinter,
} from '@/services/cloudStorage';
import { hydrateLocalFromCloud } from '@/services/cloudBridge';

// Local storage for legacy compatibility (spools, cycles, settings)
import { 
  getPrinters, 
  updatePrinter,
  getSpools,
  updateSpool,
  getPlannedCycles,
  updatePlannedCycle,
  getNextPrinterNumber,
  getFactorySettings,
  markCapacityChanged,
  setLoadedSpoolsInitialized,
  AMSSlotState,
  Printer, 
  Spool,
  PlannedCycle,
} from '@/services/storage';
import { notifyInventoryChanged } from '@/services/inventoryEvents';

export const PrintersPage: React.FC = () => {
  const { language } = useLanguage();
  const { workspaceId } = useAuth();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [spools, setSpools] = useState<Spool[]>([]);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  
  // Add printer dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newPrinter, setNewPrinter] = useState({
    printerNumber: 1,
    count: 1, // Number of printers to add
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
  
  // Bulk set color modal
  const [bulkColorModalOpen, setBulkColorModalOpen] = useState(false);
  const [loadSlotIndex, setLoadSlotIndex] = useState<number | null>(null); // null = main spool, number = AMS slot

  useEffect(() => {
    const init = async () => {
      // Hydrate localStorage from cloud before refreshing data
      if (workspaceId) {
        await hydrateLocalFromCloud(workspaceId, { force: false, source: 'PrintersPage-init' });
      }
      refreshData();
    };
    init();
  }, [workspaceId]);

  // Listen for printer changes (e.g., when loading spools from LoadRecommendationsPanel)
  useEffect(() => {
    const onPrintersChanged = () => {
      refreshData();
    };
    window.addEventListener('printflow:printers-changed', onPrintersChanged);
    return () => window.removeEventListener('printflow:printers-changed', onPrintersChanged);
  }, []);

  const refreshData = async () => {
    // Refresh from localStorage (for legacy compatibility with engines)
    setPrinters(getPrinters());
    setSpools(getSpools());
    const settings = getFactorySettings();
    // Hebrew predefined colors (same as InventoryPage)
    const hebrewColors = ['שחור', 'לבן', 'אפור', 'אדום', 'כחול', 'ירוק', 'צהוב', 'כתום', 'סגול', 'ורוד', 'חום'];
    // Combine predefined + settings colors
    const settingsColors = settings?.colors || [];
    const allColors = new Set([...hebrewColors, ...settingsColors]);
    setAvailableColors(Array.from(allColors));
  };

  const handleEditPrinter = (printer: Printer) => {
    setEditingPrinter({ ...printer });
    setSheetOpen(true);
  };

  const handleSavePrinter = async () => {
    if (!editingPrinter || !workspaceId) return;
    
    // Update in cloud
    await updateCloudPrinter(editingPrinter.id, {
      name: editingPrinter.name,
      status: editingPrinter.status,
      has_ams: editingPrinter.hasAMS,
      ams_slots: editingPrinter.amsSlots ?? null,
      ams_backup_mode: editingPrinter.amsModes?.backupSameColor ?? editingPrinter.amsMode === 'backup_same_color',
      ams_multi_color: editingPrinter.amsModes?.multiColor ?? editingPrinter.amsMode === 'multi_color',
      mounted_spool_id: editingPrinter.mountedSpoolId ?? null,
      notes: (editingPrinter as any).notes ?? null,
      physical_plate_capacity: editingPrinter.physicalPlateCapacity ?? 5,
      can_start_new_cycles_after_hours: editingPrinter.canStartNewCyclesAfterHours ?? false,
    });
    
    // Also update local storage for spools/slot states (which aren't in cloud schema)
    updatePrinter(editingPrinter.id, editingPrinter);
    
    // Sync localStorage from cloud
    await hydrateLocalFromCloud(workspaceId, { force: false, source: 'PrintersPage-savePrinter' });
    
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
      count: 1,
      name: '',
      hasAMS: false,
      amsSlots: 4,
      amsMode: 'backup_same_color',
    });
    setAddDialogOpen(true);
  };

  const handleAddPrinter = async () => {
    if (!workspaceId) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'לא נמצא מזהה workspace' : 'Workspace ID not found',
        variant: 'destructive',
      });
      return;
    }

    const count = Math.max(1, Math.min(20, newPrinter.count)); // Limit 1-20
    const addedPrinters: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const printerNum = newPrinter.printerNumber + i;
      // If count > 1, always use auto-generated names; if count === 1 and user provided a name, use it
      const printerName = count === 1 && newPrinter.name
        ? newPrinter.name
        : (language === 'he' ? `מדפסת ${printerNum}` : `Printer ${printerNum}`);
      
      // Save to cloud (Supabase)
      const cloudPrinter = await createCloudPrinter(workspaceId, {
        name: printerName,
        status: 'active',
        has_ams: newPrinter.hasAMS,
        ams_slots: newPrinter.hasAMS ? newPrinter.amsSlots : null,
        ams_backup_mode: newPrinter.hasAMS && newPrinter.amsMode === 'backup_same_color',
        ams_multi_color: newPrinter.hasAMS && newPrinter.amsMode === 'multi_color',
      });
      
      if (cloudPrinter) {
        addedPrinters.push(cloudPrinter.name);
      }
    }
    
    // Sync localStorage from cloud to keep engines in sync
    await hydrateLocalFromCloud(workspaceId, { force: false, source: 'PrintersPage-addPrinter' });
    
    // Mark capacity as changed
    markCapacityChanged(language === 'he' 
      ? (count > 1 ? `נוספו ${count} מדפסות חדשות` : 'נוספה מדפסת חדשה')
      : (count > 1 ? `${count} new printers added` : 'New printer added'));
    
    refreshData();
    setAddDialogOpen(false);
    
    toast({
      title: language === 'he' 
        ? (addedPrinters.length > 1 ? `${addedPrinters.length} מדפסות נוספו` : 'מדפסת נוספה')
        : (addedPrinters.length > 1 ? `${addedPrinters.length} printers added` : 'Printer added'),
      description: addedPrinters.length > 1 
        ? addedPrinters.slice(0, 3).join(', ') + (addedPrinters.length > 3 ? '...' : '')
        : addedPrinters[0],
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

  const handleConfirmDisable = async (reassignCycles: boolean) => {
    if (!printerToDisable || !workspaceId) return;
    
    // Disable the printer in cloud
    await updateCloudPrinter(printerToDisable.id, {
      status: 'out_of_service',
    });
    
    // Also update local storage with additional fields
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
    
    // Sync localStorage from cloud
    await hydrateLocalFromCloud(workspaceId, { force: false, source: 'PrintersPage-confirmDisable' });
    
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

  const handleReactivatePrinter = async (printer: Printer) => {
    if (!workspaceId) return;
    
    // Update in cloud
    await updateCloudPrinter(printer.id, {
      status: 'active',
    });
    
    // Also update local storage with additional fields
    updatePrinter(printer.id, {
      status: 'active',
      active: true,
      disableReason: undefined,
      disabledAt: undefined,
      expectedReturnDate: undefined,
    });
    
    // Sync localStorage from cloud
    await hydrateLocalFromCloud(workspaceId, { force: false, source: 'PrintersPage-reactivate' });
    
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
    setLoadSpoolMode('spool'); // v2: default to spool mode
    setSelectedColor(printer.currentColor || '');
    setSelectedSpoolId('');
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
        currentColor: color,
      });
    }

    // Mark loaded spools as initialized
    setLoadedSpoolsInitialized(true);

    // Notify inventory changed to refresh Required Actions panel
    notifyInventoryChanged();
    
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
        currentColor: undefined,
      });
    }

    // Explicitly notify to ensure UI components refresh material alerts
    notifyInventoryChanged();
    
    refreshData();
    toast({
      title: language === 'he' ? 'גליל הוסר' : 'Spool unloaded',
    });
  };

  // Bulk set mounted color for multiple printers
  const handleBulkSetColor = async (printerIds: string[], color: string) => {
    if (!workspaceId) return;
    
    let updated = 0;
    for (const printerId of printerIds) {
      // Update local storage
      updatePrinter(printerId, {
        mountedColor: color,
        currentColor: color,
      });
      
      // Also update cloud
      await updateCloudPrinter(printerId, {});
      updated++;
    }
    
    // Sync from cloud
    await hydrateLocalFromCloud(workspaceId, { force: false, source: 'PrintersPage-bulkSetColor' });
    
    // Notify and refresh
    notifyInventoryChanged();
    refreshData();
    
    toast({
      title: language === 'he' ? 'צבעים עודכנו' : 'Colors updated',
      description: language === 'he' 
        ? `${updated} מדפסות עודכנו ל-${color}`
        : `${updated} printers set to ${color}`,
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
      return { color: printer.mountedColor, spoolId: printer.mountedSpoolId };
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

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id || !workspaceId) return;
    
    const oldIndex = activePrinters.findIndex(p => p.id === active.id);
    const newIndex = activePrinters.findIndex(p => p.id === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;
    
    // Reorder the array
    const reordered = arrayMove(activePrinters, oldIndex, newIndex);
    
    // Update local state immediately for smooth UX
    setPrinters(prev => {
      const inactive = prev.filter(p => p.status !== 'active');
      return [...reordered, ...inactive];
    });
    
    // Save to cloud
    const orderUpdates = reordered.map((p, idx) => ({
      id: p.id,
      display_order: idx + 1,
    }));
    
    const success = await updatePrintersOrder(orderUpdates);
    
    if (success) {
      // Sync localStorage
      await hydrateLocalFromCloud(workspaceId, { force: false, source: 'PrintersPage-updateOrder' });
      
      toast({
        title: language === 'he' ? 'הסדר עודכן' : 'Order updated',
      });
    } else {
      // Revert on failure
      refreshData();
      toast({
        title: language === 'he' ? 'שגיאה בעדכון הסדר' : 'Error updating order',
        variant: 'destructive',
      });
    }
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
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkColorModalOpen(true)} className="gap-2">
            <Palette className="w-4 h-4" />
            {language === 'he' ? 'הגדר צבעים' : 'Set Colors'}
          </Button>
          <Button onClick={handleOpenAddDialog} className="gap-2">
            <Plus className="w-4 h-4" />
            {language === 'he' ? 'הוסף מדפסת' : 'Add Printer'}
          </Button>
        </div>
      </div>


      {/* Active Printers - Sortable Grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={activePrinters.map(p => p.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activePrinters.map((printer) => (
              <SortablePrinterCard
                key={printer.id}
                printer={printer}
                spools={spools}
                language={language}
                onEdit={handleEditPrinter}
                onDisable={handleOpenDisableDialog}
                onLoadSpool={handleOpenLoadSpoolDialog}
                onUnloadSpool={handleUnloadSpool}
                getAmsModeBadge={getAmsModeBadge}
                getStatusBadge={getStatusBadge}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

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
                <Label>{language === 'he' ? 'כמות מדפסות' : 'Number of Printers'}</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={newPrinter.count}
                  onChange={(e) => setNewPrinter({ ...newPrinter, count: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'he' ? 'מספר התחלה' : 'Starting Number'}</Label>
                <Input
                  type="number"
                  min={1}
                  value={newPrinter.printerNumber}
                  onChange={(e) => setNewPrinter({ ...newPrinter, printerNumber: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>
            
            {/* Preview of printer names */}
            {newPrinter.count > 0 && (
              <div className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-md">
                <span className="font-medium">{language === 'he' ? 'יווצרו: ' : 'Will create: '}</span>
                {Array.from({ length: Math.min(newPrinter.count, 5) }, (_, i) => 
                  language === 'he' 
                    ? `מדפסת ${newPrinter.printerNumber + i}`
                    : `Printer ${newPrinter.printerNumber + i}`
                ).join(', ')}
                {newPrinter.count > 5 && (language === 'he' ? ` ועוד ${newPrinter.count - 5}...` : ` and ${newPrinter.count - 5} more...`)}
              </div>
            )}
            
            {/* Custom name - only for single printer */}
            {newPrinter.count === 1 && (
              <div className="space-y-2">
                <Label>{language === 'he' ? 'שם מותאם (אופציונלי)' : 'Custom Name (optional)'}</Label>
                <Input
                  value={newPrinter.name}
                  onChange={(e) => setNewPrinter({ ...newPrinter, name: e.target.value })}
                  placeholder={language === 'he' ? `מדפסת ${newPrinter.printerNumber}` : `Printer ${newPrinter.printerNumber}`}
                />
              </div>
            )}

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
              {newPrinter.count > 1
                ? (language === 'he' ? `הוסף ${newPrinter.count} מדפסות` : `Add ${newPrinter.count} Printers`)
                : (language === 'he' ? 'הוסף מדפסת' : 'Add Printer')}
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

              {/* Physical Plate Capacity (FIXED hardware limit) */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'קיבולת פלטות (חומרה)' : 'Plate Capacity (Hardware)'}</Label>
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
                  <Package className="h-5 w-5 text-muted-foreground" />
                  <span className="font-semibold">8 {language === 'he' ? 'פלטות' : 'plates'}</span>
                  <Badge variant="secondary" className="mr-auto">
                    {language === 'he' ? 'קבוע' : 'Fixed'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {language === 'he' 
                    ? 'קיבולת פיזית קבועה. כמות הפלטות ללילה נקבעת לפי מלאי הפלטות המפעלי (50).'
                    : 'Fixed hardware capacity. Night plate count is determined by global factory inventory (50).'}
                </p>
              </div>

              {/* Night/Weekend Operation Toggle */}
              <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="space-y-1 flex-1">
                    <Label>{language === 'he' ? 'מאפשר התחלת מחזורים בלילה' : 'Allow starting new cycles after hours'}</Label>
                    <p className="text-xs text-muted-foreground">
                      {language === 'he' 
                        ? 'במצב FULL_AUTOMATION: מאפשר לפתוח פלטה חדשה ולהתחיל מחזור בלילה/סופ"ש ללא מגע אדם'
                        : 'In FULL_AUTOMATION mode: allows opening new plate and starting cycle during night/weekend without human touch'}
                    </p>
                  </div>
                  <Switch
                    checked={editingPrinter.canStartNewCyclesAfterHours ?? false}
                    onCheckedChange={(v) => setEditingPrinter({ 
                      ...editingPrinter, 
                      canStartNewCyclesAfterHours: v 
                    })}
                  />
                </div>
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

            {/* v2: Show selected spool info from inventory */}
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

      {/* Bulk Set Color Modal */}
      <BulkSetColorModal
        open={bulkColorModalOpen}
        onOpenChange={setBulkColorModalOpen}
        printers={printers}
        availableColors={availableColors}
        language={language}
        onApply={handleBulkSetColor}
      />
    </div>
  );
};
