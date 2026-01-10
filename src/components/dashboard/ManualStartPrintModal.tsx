// ManualStartPrintModal - Allow users to start a manual print job
// Creates a locked cycle that the planning engine will respect

import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Play, Printer, Package, Clock, AlertTriangle, Layers } from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import {
  getActiveProjects,
  getActivePrinters,
  getProducts,
  getProject,
  getProduct,
  PlannedCycle,
  PlatePreset,
  addManualCycle,
  getPlannedCycles,
  deletePlannedCycle,
  updatePrinter,
  getPrinters,
  cleanupStaleCycles,
} from '@/services/storage';
import { format, addHours } from 'date-fns';
import { scheduleAutoReplan } from '@/services/autoReplan';
import { syncCycleOperation } from '@/services/cycleOperationSync';
import { toast } from '@/hooks/use-toast';

interface ManualStartPrintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  defaultPrinterId?: string;
  defaultProjectId?: string;
}

export const ManualStartPrintModal: React.FC<ManualStartPrintModalProps> = ({
  open,
  onOpenChange,
  onComplete,
  defaultPrinterId,
  defaultProjectId,
}) => {
  const { language } = useLanguage();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(defaultProjectId || '');
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>(defaultPrinterId || '');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [startTime, setStartTime] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [estimatedHours, setEstimatedHours] = useState<string>('');
  const [unitsPlanned, setUnitsPlanned] = useState<string>('');
  const [spoolGrams, setSpoolGrams] = useState<string>('');
  const [plateCount, setPlateCount] = useState<string>('1');
  const projects = useMemo(() => getActiveProjects(), [open]);
  const printers = useMemo(() => getActivePrinters(), [open]);
  const products = useMemo(() => getProducts(), [open]);

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return getProject(selectedProjectId);
  }, [selectedProjectId]);

  const selectedProduct = useMemo(() => {
    if (!selectedProject?.productId) return null;
    return getProduct(selectedProject.productId);
  }, [selectedProject]);

  // Get available presets for the selected product
  const availablePresets = useMemo(() => {
    return selectedProduct?.platePresets || [];
  }, [selectedProduct]);

  // Get selected preset (default to recommended or first)
  const selectedPreset = useMemo((): PlatePreset | undefined => {
    if (selectedPresetId && availablePresets.length > 0) {
      return availablePresets.find(p => p.id === selectedPresetId);
    }
    // Default: recommended or first preset
    return availablePresets.find(p => p.isRecommended) || availablePresets[0];
  }, [selectedPresetId, availablePresets]);

  // Reset state when modal opens, and set defaults from props
  useEffect(() => {
    if (open) {
      // Cleanup stale cycles first (async - fire and forget for modal open)
      cleanupStaleCycles().then(cleaned => {
        if (cleaned.length > 0) {
          console.log(`[ManualStartPrintModal] Auto-completed ${cleaned.length} stale cycles`);
        }
      });
      
      // Set defaults from props
      if (defaultPrinterId) {
        setSelectedPrinterId(defaultPrinterId);
      }
      if (defaultProjectId) {
        setSelectedProjectId(defaultProjectId);
      }
      
      // Reset time to now
      setStartTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    }
  }, [open, defaultPrinterId, defaultProjectId]);

  // Reset preset when project changes
  useEffect(() => {
    setSelectedPresetId('');
    setEstimatedHours('');
    setUnitsPlanned('');
    setPlateCount('1');
  }, [selectedProjectId]);

  const defaultHours = selectedPreset?.cycleHours || 2;
  const defaultUnits = selectedPreset?.unitsPerPlate || 1;
  const gramsPerUnit = selectedProduct?.gramsPerUnit || 10;

  // Check if the printer has an in_progress cycle that wasn't cancelled
  // Note: If user came from PrinterActionsModal, the cycle should already be cancelled
  const printerIsBusy = useMemo(() => {
    if (!selectedPrinterId) return false;
    const cycles = getPlannedCycles();
    return cycles.some(c => 
      c.printerId === selectedPrinterId && 
      c.status === 'in_progress'
    );
  }, [selectedPrinterId, open]);

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedPresetId(''); // Reset preset when project changes
  };

  const handleSubmit = async () => {
    if (!selectedProjectId || !selectedPrinterId || !selectedProject) return;

    const start = new Date(startTime);
    const hours = parseFloat(estimatedHours) || defaultHours;
    const units = parseInt(unitsPlanned) || defaultUnits;
    const rawPlateCount = parseInt(plateCount) || 1;
    const plates = Math.max(1, Math.min(10, rawPlateCount));
    const spoolGramsNum = parseInt(spoolGrams) || undefined;
    
    console.log(`[ManualStartPrintModal] 🔵 handleSubmit called - plateCount state: "${plateCount}", parsed: ${rawPlateCount}, final plates: ${plates}`);
    
    // Calculate estimated end time for conflict detection
    const manualEndTime = addHours(start, plates * hours);
    
    // Remove conflicting scheduled cycles on this printer BEFORE creating manual cycles
    const existingCycles = getPlannedCycles();
    const conflictingCycles = existingCycles.filter(c => 
      c.printerId === selectedPrinterId && 
      c.status === 'planned' && // Only auto-planned, not in_progress or completed
      c.source !== 'manual' && // Don't delete other manual cycles
      c.startTime && 
      new Date(c.startTime) >= start && 
      new Date(c.startTime) < manualEndTime
    );
    
    // Delete conflicting cycles locally and sync deletions to cloud
    for (const conflict of conflictingCycles) {
      console.log('[ManualStartPrintModal] Removing conflicting cycle:', conflict.id);
      deletePlannedCycle(conflict.id);
      
      // Sync deletion to cloud
      await syncCycleOperation('cancel', {
        cycleId: conflict.id,
        projectId: conflict.projectId,
        printerId: conflict.printerId,
        status: 'cancelled',
      });
    }
    
    if (conflictingCycles.length > 0) {
      console.log(`[ManualStartPrintModal] Removed ${conflictingCycles.length} conflicting cycles`);
    }

    // Create multiple cycles based on plate count
    const cyclesToCreate: PlannedCycle[] = [];
    
    console.log(`[ManualStartPrintModal] ⭐ Creating ${plates} plates for printer ${selectedPrinterId}, plateCount input: "${plateCount}", parsed: ${parseInt(plateCount) || 1}`);
    
    for (let i = 0; i < plates; i++) {
      const cycleStart = addHours(start, i * hours);
      const cycleEnd = addHours(cycleStart, hours);
      const cycleId = crypto.randomUUID();

      const cycle: PlannedCycle = {
        id: cycleId,
        projectId: selectedProjectId,
        printerId: selectedPrinterId,
        unitsPlanned: units,
        gramsPlanned: units * gramsPerUnit,
        plateType: 'full',
        startTime: cycleStart.toISOString(),
        endTime: cycleEnd.toISOString(),
        shift: 'day',
        status: i === 0 ? 'in_progress' : 'planned', // Only first is in_progress
        source: 'manual',
        locked: true,
        actualStartTime: i === 0 ? cycleStart.toISOString() : undefined,
        readinessState: 'ready', // All manual cycles are ready
        requiredColor: selectedProject.color,
        requiredMaterial: 'PLA',
        requiredGrams: units * gramsPerUnit,
        spoolStartGrams: i === 0 ? spoolGramsNum : undefined,
        plateIndex: i + 1, // 1, 2, 3, ...
        // Preset selection fields
        presetId: selectedPreset?.id,
        presetName: selectedPreset?.name,
        presetSelectionReason: 'manual_selection',
      };

      console.log(`[ManualStartPrintModal] Created cycle ${i + 1}/${plates}: ${cycle.id}, status: ${cycle.status}`);
      cyclesToCreate.push(cycle);
    }

    // Save all cycles to local storage and sync to cloud
    for (const cycle of cyclesToCreate) {
      addManualCycle(cycle);
      
      const syncResult = await syncCycleOperation('manual_start', {
        cycleId: cycle.id,
        projectId: selectedProjectId,
        printerId: selectedPrinterId,
        status: cycle.status as 'in_progress' | 'planned' | 'completed' | 'cancelled',
        startTime: cycle.startTime,
        endTime: cycle.endTime,
        presetId: selectedPreset?.id || null,
        unitsPlanned: units,
        scheduledDate: format(new Date(cycle.startTime), 'yyyy-MM-dd'),
        cycleIndex: cycle.plateIndex ? cycle.plateIndex - 1 : 0,
      });
      
      if (syncResult.error) {
        console.error('[ManualStartPrintModal] Sync failed for cycle:', cycle.id, syncResult.error);
      }
    }

    // CRITICAL FIX: Update the printer's mounted color + currentColor
    // This ensures physicalLockedColor is correctly set for night planning
    const printer = getPrinters().find(p => p.id === selectedPrinterId);
    if (printer) {
      updatePrinter(selectedPrinterId, {
        mountedColor: selectedProject.color,
        currentColor: selectedProject.color,
        currentMaterial: 'PLA',
      });
      console.log('[ManualStartPrintModal] 🔒 Updated printer mountedColor + currentColor:', {
        printerId: selectedPrinterId,
        newMountedColor: selectedProject.color,
        newCurrentColor: selectedProject.color,
      });
    }

    // Calculate how many plates are today vs tomorrow
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const platesToday = cyclesToCreate.filter(c => format(new Date(c.startTime), 'yyyy-MM-dd') === todayStr).length;
    const platesTomorrow = plates - platesToday;
    
    let toastDescription: string;
    if (platesTomorrow > 0) {
      toastDescription = language === 'he'
        ? `${plates} פלטות נוספו (${platesToday} היום, ${platesTomorrow} מחר) - ${plates * units} יחידות`
        : `${plates} plates added (${platesToday} today, ${platesTomorrow} tomorrow) - ${plates * units} units`;
    } else {
      toastDescription = language === 'he' 
        ? `${plates} פלטות נוספו לתור (${plates * units} יחידות)`
        : `${plates} plates added to queue (${plates * units} units)`;
    }
    
    toast({
      title: language === 'he' ? 'הדפסה התחילה' : 'Print started',
      description: toastDescription,
    });
    
    // Schedule replan for planning updates
    scheduleAutoReplan('manual_cycle_added');
    
    setSelectedProjectId(defaultProjectId || '');
    setSelectedPrinterId(defaultPrinterId || '');
    setSelectedPresetId('');
    setStartTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setEstimatedHours('');
    setUnitsPlanned('');
    setSpoolGrams('');
    setPlateCount('1');
    
    onComplete();
    onOpenChange(false);
  };

  // Calculate total info for display
  const totalPlates = Math.max(1, Math.min(10, parseInt(plateCount) || 1));
  const hoursPerPlate = parseFloat(estimatedHours) || defaultHours;
  const unitsPerPlate = parseInt(unitsPlanned) || defaultUnits;
  const totalHours = totalPlates * hoursPerPlate;
  const totalUnits = totalPlates * unitsPerPlate;
  const totalGrams = totalUnits * gramsPerUnit;
  const estimatedEndTime = addHours(new Date(startTime), totalHours);

  const canSubmit = selectedProjectId && selectedPrinterId && !printerIsBusy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" dir={language === 'he' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="w-5 h-5 text-primary" />
            {language === 'he' ? 'התחל הדפסה ידנית' : 'Start Manual Print'}
          </DialogTitle>
          <DialogDescription>
            {language === 'he' 
              ? 'הזן עבודה שכבר רצה או שאתה מתחיל עכשיו על מדפסת'
              : 'Enter a job that is already running or starting now on a printer'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Project Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Package className="w-4 h-4 text-muted-foreground" />
              {language === 'he' ? 'פרויקט' : 'Project'}
            </Label>
          <Select value={selectedProjectId} onValueChange={handleProjectChange}>
              <SelectTrigger>
                <SelectValue placeholder={language === 'he' ? 'בחר פרויקט' : 'Select project'} />
              </SelectTrigger>
              <SelectContent>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>
                    <div className="flex items-center gap-2">
                      <SpoolIcon color={getSpoolColor(project.color)} size={16} />
                      <span>{project.name}</span>
                      <span className="text-muted-foreground text-xs">
                        ({project.quantityTarget - project.quantityGood} {language === 'he' ? 'נותרו' : 'left'})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Preset Selection - only show if multiple presets available */}
          {availablePresets.length > 1 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                {language === 'he' ? 'פריסה' : 'Preset'}
              </Label>
              <Select value={selectedPresetId || selectedPreset?.id || ''} onValueChange={setSelectedPresetId}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'he' ? 'בחר פריסה' : 'Select preset'} />
                </SelectTrigger>
                <SelectContent>
                  {availablePresets.map(preset => (
                    <SelectItem key={preset.id} value={preset.id}>
                      <div className="flex items-center gap-2">
                        <span>{preset.name}</span>
                        <span className="text-muted-foreground text-xs">
                          ({preset.unitsPerPlate} {language === 'he' ? 'יח׳' : 'units'} × {preset.cycleHours} {language === 'he' ? 'ש׳' : 'hrs'})
                        </span>
                        {preset.isRecommended && (
                          <Badge variant="secondary" className="text-xs">
                            {language === 'he' ? 'מומלץ' : 'Recommended'}
                          </Badge>
                        )}
                        {preset.riskLevel === 'high' && (
                          <Badge variant="destructive" className="text-xs">
                            {language === 'he' ? 'סיכון גבוה' : 'High Risk'}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPreset && (
                <p className="text-xs text-muted-foreground">
                  {language === 'he' 
                    ? `גרמים למחזור: ${selectedPreset.unitsPerPlate * gramsPerUnit}g`
                    : `Grams per cycle: ${selectedPreset.unitsPerPlate * gramsPerUnit}g`}
                </p>
              )}
            </div>
          )}

          {/* Printer Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Printer className="w-4 h-4 text-muted-foreground" />
              {language === 'he' ? 'מדפסת' : 'Printer'}
            </Label>
            <Select value={selectedPrinterId} onValueChange={setSelectedPrinterId}>
              <SelectTrigger>
                <SelectValue placeholder={language === 'he' ? 'בחר מדפסת' : 'Select printer'} />
              </SelectTrigger>
              <SelectContent>
                {printers.map(printer => (
                  <SelectItem key={printer.id} value={printer.id}>
                    <div className="flex items-center gap-2">
                      <span>{printer.name}</span>
                      {printer.hasAMS && <Badge variant="outline" className="text-xs">AMS</Badge>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {printerIsBusy && (
              <div className="flex items-center gap-2 text-warning text-sm">
                <AlertTriangle className="w-4 h-4" />
                {language === 'he' ? 'מדפסת זו כבר בעבודה' : 'This printer is already busy'}
              </div>
            )}
          </div>

          {/* Start Time */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              {language === 'he' ? 'זמן התחלה' : 'Start Time'}
            </Label>
            <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>

          {/* Duration & Units */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'he' ? 'משך לפלטה (שעות)' : 'Duration per plate (hours)'}</Label>
              <Input type="number" placeholder={defaultHours.toString()} value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} min={0.5} step={0.5} />
            </div>
            <div className="space-y-2">
              <Label>{language === 'he' ? 'יחידות לפלטה' : 'Units per plate'}</Label>
              <Input type="number" placeholder={defaultUnits.toString()} value={unitsPlanned} onChange={(e) => setUnitsPlanned(e.target.value)} min={1} />
            </div>
          </div>

          {/* Plate Count */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-muted-foreground" />
              {language === 'he' ? 'מספר פלטות' : 'Number of Plates'}
            </Label>
            <Input 
              type="number" 
              value={plateCount} 
              onChange={(e) => setPlateCount(e.target.value)} 
              min={1}
              max={10}
            />
            <p className="text-xs text-muted-foreground">
              {language === 'he' 
                ? 'פלטה אחת = העבודה הנוכחית. פלטות נוספות יתווספו לתור אחרי הראשונה'
                : 'One plate = current job. Additional plates will be queued after the first one'}
            </p>
          </div>

          {/* Total Summary */}
          {totalPlates > 1 && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
              <div className="text-sm font-medium text-primary">
                {language === 'he' 
                  ? `סה״כ: ${totalPlates} פלטות × ${hoursPerPlate} שעות = ${totalHours} שעות עבודה`
                  : `Total: ${totalPlates} plates × ${hoursPerPlate} hrs = ${totalHours} hrs of work`}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {language === 'he' 
                  ? `${totalUnits} יחידות • ${totalGrams}g • סיום משוער: ${format(estimatedEndTime, 'HH:mm dd/MM')}`
                  : `${totalUnits} units • ${totalGrams}g • Est. completion: ${format(estimatedEndTime, 'MM/dd HH:mm')}`}
              </div>
            </div>
          )}

          {/* Spool Grams */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <SpoolIcon color={selectedProject ? getSpoolColor(selectedProject.color) : '#888'} size={16} />
              {language === 'he' ? 'גרמים על הגליל' : 'Grams on Spool'}
            </Label>
            <Input 
              type="number" 
              placeholder={language === 'he' ? 'לדוגמה: 800' : 'e.g. 800'} 
              value={spoolGrams} 
              onChange={(e) => setSpoolGrams(e.target.value)} 
              min={0}
              max={1500}
            />
            <p className="text-xs text-muted-foreground">
              {language === 'he' 
                ? 'כמה גרם יש כרגע על הגליל? המערכת תקזז את השימוש בסוף המחזור'
                : 'How many grams are currently on the spool? System will deduct usage after cycle'}
            </p>
          </div>

          {/* Selected Project Info */}
          {selectedProject && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
              <SpoolIcon color={getSpoolColor(selectedProject.color)} size={36} />
              <div className="flex-1">
                <div className="font-medium">{selectedProject.name}</div>
                <div className="text-sm text-muted-foreground">
                  {selectedProduct?.name || ''} • {selectedProject.color}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {language === 'he' ? 'ביטול' : 'Cancel'}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2">
            <Play className="w-4 h-4" />
            {language === 'he' ? 'התחל עבודה' : 'Start Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
