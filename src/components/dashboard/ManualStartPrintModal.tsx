// ManualStartPrintModal - Allow users to start a manual print job
// Creates a locked cycle that the planning engine will respect

import React, { useState, useMemo } from 'react';
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
import { Play, Printer, Package, Clock, AlertTriangle } from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import {
  getActiveProjects,
  getActivePrinters,
  getProducts,
  getProject,
  getProduct,
  PlannedCycle,
  addManualCycle,
  getPlannedCycles,
  updatePrinter,
  getPrinters,
} from '@/services/storage';
import { format, addHours } from 'date-fns';
import { scheduleAutoReplan } from '@/services/autoReplan';

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
  const [startTime, setStartTime] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [estimatedHours, setEstimatedHours] = useState<string>('');
  const [unitsPlanned, setUnitsPlanned] = useState<string>('');

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

  // Get preset from product
  const preset = selectedProduct?.platePresets?.[0];
  const defaultHours = preset?.cycleHours || 2;
  const defaultUnits = preset?.unitsPerPlate || 1;
  const gramsPerUnit = selectedProduct?.gramsPerUnit || 10;

  const printerIsBusy = useMemo(() => {
    if (!selectedPrinterId) return false;
    const cycles = getPlannedCycles();
    return cycles.some(c => c.printerId === selectedPrinterId && c.status === 'in_progress');
  }, [selectedPrinterId, open]);

  const handleSubmit = () => {
    if (!selectedProjectId || !selectedPrinterId || !selectedProject) return;

    const start = new Date(startTime);
    const hours = parseFloat(estimatedHours) || defaultHours;
    const units = parseInt(unitsPlanned) || defaultUnits;
    const end = addHours(start, hours);

    const newCycle: PlannedCycle = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
    };

    addManualCycle(newCycle);
    
    // Also update the printer's mounted color to reflect reality
    const printer = getPrinters().find(p => p.id === selectedPrinterId);
    if (printer) {
      updatePrinter(selectedPrinterId, {
        mountedColor: selectedProject.color,
        currentMaterial: 'PLA',
      });
    }
    
    scheduleAutoReplan('manual_cycle_added');
    
    setSelectedProjectId(defaultProjectId || '');
    setSelectedPrinterId(defaultPrinterId || '');
    setStartTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setEstimatedHours('');
    setUnitsPlanned('');
    
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
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
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
