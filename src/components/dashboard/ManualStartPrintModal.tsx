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
  updatePrinter,
  getPrinters,
} from '@/services/storage';
import { format, addHours } from 'date-fns';
import { scheduleAutoReplan } from '@/services/autoReplan';
import { upsertPlannedCycleCloud } from '@/services/cloudStorage';
import { supabase } from '@/integrations/supabase/client';

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

  // Reset preset when project changes
  useEffect(() => {
    setSelectedPresetId('');
    setEstimatedHours('');
    setUnitsPlanned('');
  }, [selectedProjectId]);

  const defaultHours = selectedPreset?.cycleHours || 2;
  const defaultUnits = selectedPreset?.unitsPerPlate || 1;
  const gramsPerUnit = selectedProduct?.gramsPerUnit || 10;

  const printerIsBusy = useMemo(() => {
    if (!selectedPrinterId) return false;
    const cycles = getPlannedCycles();
    return cycles.some(c => c.printerId === selectedPrinterId && c.status === 'in_progress');
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
    const end = addHours(start, hours);

    const spoolGramsNum = parseInt(spoolGrams) || undefined;

    // Generate a proper UUID for cloud compatibility
    const cycleId = crypto.randomUUID();

    const newCycle: PlannedCycle = {
      id: cycleId,
      projectId: selectedProjectId,
      printerId: selectedPrinterId,
      unitsPlanned: units,
      gramsPlanned: units * gramsPerUnit,
      plateType: 'full',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      shift: 'day',
      status: 'in_progress',
      source: 'manual',
      locked: true,
      actualStartTime: start.toISOString(),
      readinessState: 'ready',
      requiredColor: selectedProject.color,
      requiredMaterial: 'PLA',
      requiredGrams: units * gramsPerUnit,
      spoolStartGrams: spoolGramsNum,
      // Preset selection fields
      presetId: selectedPreset?.id,
      presetName: selectedPreset?.name,
      presetSelectionReason: 'manual_selection',
    };

    // Save to local storage
    addManualCycle(newCycle);
    
    // Also update the printer's mounted color to reflect reality
    const printer = getPrinters().find(p => p.id === selectedPrinterId);
    if (printer) {
      updatePrinter(selectedPrinterId, {
        mountedColor: selectedProject.color,
        currentMaterial: 'PLA',
      });
    }

    // IMMEDIATELY sync cycle to cloud (don't wait for debounced replan)
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('current_workspace_id')
          .eq('user_id', user.id)
          .single();
        
        if (profile?.current_workspace_id) {
          // Map local project ID to cloud UUID if needed
          const projectUuid = (selectedProject as any).cloudId || 
                              (selectedProject as any).cloudUuid || 
                              selectedProjectId;
          
          await upsertPlannedCycleCloud(profile.current_workspace_id, {
            id: cycleId,
            legacy_id: null,
            project_id: projectUuid,
            printer_id: selectedPrinterId,
            preset_id: selectedPreset?.id || null,
            scheduled_date: format(start, 'yyyy-MM-dd'),
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            units_planned: units,
            status: 'in_progress',
            cycle_index: 0,
          });
          console.log('[ManualStartPrintModal] Cycle synced to cloud');
        }
      }
    } catch (err) {
      console.error('[ManualStartPrintModal] Failed to sync cycle to cloud:', err);
      // Continue anyway - local state is saved, will sync on next replan
    }
    
    // Schedule replan for planning updates
    scheduleAutoReplan('manual_cycle_added');
    
    setSelectedProjectId(defaultProjectId || '');
    setSelectedPrinterId(defaultPrinterId || '');
    setSelectedPresetId('');
    setStartTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setEstimatedHours('');
    setUnitsPlanned('');
    setSpoolGrams('');
    
    onComplete();
    onOpenChange(false);
  };

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
              <Label>{language === 'he' ? 'משך משוער (שעות)' : 'Est. Duration (hours)'}</Label>
              <Input type="number" placeholder={defaultHours.toString()} value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} min={0.5} step={0.5} />
            </div>
            <div className="space-y-2">
              <Label>{language === 'he' ? 'יחידות' : 'Units'}</Label>
              <Input type="number" placeholder={defaultUnits.toString()} value={unitsPlanned} onChange={(e) => setUnitsPlanned(e.target.value)} min={1} />
            </div>
          </div>

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
