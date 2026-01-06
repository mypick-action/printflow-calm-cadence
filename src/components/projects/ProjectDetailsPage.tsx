import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Calendar,
  Package,
  Printer,
  Clock,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  XCircle,
  ClipboardCheck,
  RefreshCw,
  FolderKanban,
  Timer,
  AlertCircle,
  Pencil,
  Palette,
  Plus,
  Truck,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import {
  getProject,
  getProduct,
  getCyclesForProject,
  getCycleLogs,
  getPlannedCycles,
  getPrinter,
  getPlanningMeta,
  updateProject,
  Project,
  Product,
  PlannedCycle,
  CycleLog,
  calculateDaysRemaining,
  getColorInventory,
  consumeFromColorInventory,
  getColorInventoryItem,
} from '@/services/storage';
import { Switch } from '@/components/ui/switch';
import { EndCycleLog } from '@/components/end-cycle/EndCycleLog';
import { ReportIssueFlow } from '@/components/report-issue/ReportIssueFlow';
import { RecalculateModal } from '@/components/planning/RecalculateModal';
import { DeadlineWarningModal } from '@/components/projects/DeadlineWarningModal';
import { runReplanNow } from '@/services/planningRecalculator';
import { BlockingIssue, PlanningWarning } from '@/services/planningEngine';

interface ProjectDetailsPageProps {
  projectId: string;
  onBack: () => void;
}

type CycleStatus = 'planned' | 'in_progress' | 'completed' | 'completed_with_scrap' | 'failed';

interface UnifiedCycle {
  id: string;
  cycleIndex: number;
  printerId: string;
  printerName: string;
  plannedDate: string;
  startTime: string;
  endTime: string;
  unitsPlanned: number;
  unitsProduced: number;
  unitsScrap: number;
  status: CycleStatus;
  plannedCycleId?: string;
  cycleLogId?: string;
  timestamp?: string;
}

export const ProjectDetailsPage: React.FC<ProjectDetailsPageProps> = ({
  projectId,
  onBack,
}) => {
  const { language } = useLanguage();
  const [project, setProject] = useState<Project | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Loading state to distinguish from "not found"
  const [endCycleOpen, setEndCycleOpen] = useState(false);
  const [selectedPrinterIdForEndCycle, setSelectedPrinterIdForEndCycle] = useState<string | undefined>(undefined);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [reportIssueCycleId, setReportIssueCycleId] = useState<string | undefined>(undefined);
  const [recalculateOpen, setRecalculateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dueDatePopoverOpen, setDueDatePopoverOpen] = useState(false);
  
  // Quantity editing state
  const [quantityPopoverOpen, setQuantityPopoverOpen] = useState(false);
  const [newQuantity, setNewQuantity] = useState<string>('');
  
  // Color editing state
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  
  // External units state
  const [externalUnitsPopoverOpen, setExternalUnitsPopoverOpen] = useState(false);
  const [externalUnits, setExternalUnits] = useState<string>('');
  const [externalNotes, setExternalNotes] = useState<string>('');
  const [isMyMaterial, setIsMyMaterial] = useState(false);
  
  // Warning modal state
  const [planningIssues, setPlanningIssues] = useState<{
    blockingIssues: BlockingIssue[];
    warnings: PlanningWarning[];
  } | null>(null);

  useEffect(() => {
    loadData();
    // Load available colors from inventory
    const inventory = getColorInventory();
    const colorsFromInventory = inventory.map(item => item.color);
    const predefinedColors = ['שחור', 'לבן', 'אפור', 'אדום', 'כחול', 'ירוק', 'צהוב', 'כתום', 'סגול', 'ורוד', 'חום'];
    const allColors = [...new Set([...predefinedColors, ...colorsFromInventory])];
    setAvailableColors(allColors);
  }, [projectId, refreshKey]);

  const loadData = () => {
    setIsLoading(true);
    const proj = getProject(projectId);
    setProject(proj || null);
    if (proj) {
      const prod = getProduct(proj.productId);
      setProduct(prod || null);
    }
    setIsLoading(false);
  };

  const handleColorChange = async (newColor: string) => {
    if (!project || newColor === project.color) return;
    
    const updated = updateProject(project.id, { color: newColor });
    
    if (updated) {
      setProject(updated);
      setColorPopoverOpen(false);
      
      // Run replan and check for issues
      const result = await runReplanNow('project_color_changed');
      
      // Check for blocking issues related to material
      const criticalIssues = result.blockingIssues.filter(i => 
        i.type === 'insufficient_material'
      );
      
      if (criticalIssues.length > 0) {
        setPlanningIssues({
          blockingIssues: result.blockingIssues,
          warnings: result.warnings,
        });
      } else {
        toast({
          title: language === 'he' ? 'צבע עודכן' : 'Color updated',
          description: language === 'he' 
            ? `הצבע שונה ל-${newColor}. התכנון עודכן.` 
            : `Color changed to ${newColor}. Planning updated.`,
        });
      }
      
      loadData();
      setRefreshKey(k => k + 1);
    }
  };

  const handleDueDateChange = (date: Date | undefined) => {
    if (!date || !project) return;
    
    const newDueDate = format(date, 'yyyy-MM-dd');
    const updated = updateProject(project.id, { dueDate: newDueDate });
    
    if (updated) {
      setProject(updated);
      setDueDatePopoverOpen(false);
      toast({
        title: language === 'he' ? 'תאריך יעד עודכן' : 'Due date updated',
        description: format(date, 'dd/MM/yyyy'),
      });
    }
  };

  const handleQuantityChange = async () => {
    const qty = Number(newQuantity.trim());
    if (!Number.isInteger(qty) || qty < 1 || !project) return;
    
    // Validation: cannot set below completed quantity
    if (qty < project.quantityGood) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' 
          ? 'לא ניתן להגדיר כמות יעד נמוכה מהכמות שכבר הושלמה' 
          : 'Cannot set target below completed quantity',
        variant: 'destructive',
      });
      return;
    }
    
    // Update project - triggers auto replan via storage.ts
    const updated = updateProject(project.id, { quantityTarget: qty });
    
    if (updated) {
      setProject(updated);
      setQuantityPopoverOpen(false);
      
      // Run replan and check for issues
      const result = await runReplanNow('project_quantity_updated');
      
      // Check for blocking issues
      const criticalIssues = result.blockingIssues.filter(i => 
        i.type === 'deadline_impossible' || i.type === 'insufficient_material'
      );
      
      // Check for deadline_risk warning
      const hasDeadlineRisk = result.warnings.some(w => w.type === 'deadline_risk');
      
      if (criticalIssues.length > 0) {
        // Show warning modal for blocking issues
        setPlanningIssues({
          blockingIssues: result.blockingIssues,
          warnings: result.warnings,
        });
      } else if (hasDeadlineRisk) {
        // Show toast for deadline risk (not blocking)
        toast({
          title: language === 'he' ? 'אזהרה' : 'Warning',
          description: language === 'he' 
            ? 'יש סיכון לדדליין - בדוק את התכנון' 
            : 'Deadline at risk - check planning',
          variant: 'destructive',
        });
      } else {
        // Success toast
        toast({
          title: language === 'he' ? 'כמות יעד עודכנה' : 'Target quantity updated',
          description: language === 'he' 
            ? 'התכנון עודכן בהצלחה' 
            : 'Planning updated successfully',
        });
      }
      
      // Refresh data after replan
      loadData();
      setRefreshKey(k => k + 1);
    }
  };

  // Handle adding external units (from external supplier)
  const handleAddExternalUnits = async () => {
    const units = Number(externalUnits.trim());
    if (!Number.isInteger(units) || units < 1 || !project || !product) return;
    
    const remaining = project.quantityTarget - project.quantityGood;
    
    // Calculate how much goes to quantityGood and how much to overage
    let newQuantityGood = project.quantityGood;
    let newOverage = project.quantityOverage || 0;
    
    if (units <= remaining) {
      // All units go toward the target
      newQuantityGood = project.quantityGood + units;
    } else {
      // Fill up to target, rest goes to overage
      newQuantityGood = project.quantityTarget;
      newOverage = (project.quantityOverage || 0) + (units - remaining);
    }
    
    // Handle material consumption if it's our material
    let materialConsumed = 0;
    if (isMyMaterial && project.color) {
      const gramsToConsume = units * product.gramsPerUnit;
      const result = consumeFromColorInventory(
        project.color,
        'PLA', // Default material
        gramsToConsume
      );
      materialConsumed = result.consumed;
      
      if (result.consumed < gramsToConsume) {
        console.warn(`[ExternalUnits] Partial material consumption: ${result.consumed}g of ${gramsToConsume}g needed`);
      }
    }
    
    // Check if project is now completed
    const isNowCompleted = newQuantityGood >= project.quantityTarget;
    
    // Update project (skipAutoReplan since we'll run replan AFTER loadData)
    const updated = updateProject(project.id, {
      quantityGood: newQuantityGood,
      quantityOverage: newOverage > 0 ? newOverage : undefined,
      status: isNowCompleted ? 'completed' : project.status,
    }, true);
    
    if (updated) {
      setProject(updated);
      setExternalUnitsPopoverOpen(false);
      setExternalUnits('');
      setExternalNotes('');
      setIsMyMaterial(false);
      
      // CRITICAL FIX: Reload data FIRST to ensure projects are hydrated,
      // THEN run replan. This prevents orphaned project detection.
      loadData();
      setRefreshKey(k => k + 1);
      
      // Run replan AFTER loadData to prevent race condition
      const result = await runReplanNow('external_units_added');
      
      // Build toast description
      const materialSuffix = isMyMaterial && materialConsumed > 0
        ? (language === 'he' 
            ? `. קוזז ${materialConsumed.toLocaleString()}g פילמנט ${project.color}` 
            : `. Deducted ${materialConsumed.toLocaleString()}g ${project.color} filament`)
        : '';
      
      // Show appropriate toast
      if (isNowCompleted) {
        toast({
          title: language === 'he' ? 'הפרויקט הושלם!' : 'Project completed!',
          description: language === 'he' 
            ? `נוספו ${units} יחידות מספק חיצוני${newOverage > 0 ? ` (${newOverage} עודף)` : ''}${materialSuffix}` 
            : `Added ${units} units from external supplier${newOverage > 0 ? ` (${newOverage} excess)` : ''}${materialSuffix}`,
        });
      } else {
        toast({
          title: language === 'he' ? 'יחידות נוספו' : 'Units added',
          description: language === 'he' 
            ? `נוספו ${units} יחידות. נותרו ${project.quantityTarget - newQuantityGood} יחידות${materialSuffix}.` 
            : `Added ${units} units. ${project.quantityTarget - newQuantityGood} remaining${materialSuffix}.`,
        });
      }
    }
  };

  // Merge planned cycles and cycle logs into unified timeline
  const unifiedCycles = useMemo((): UnifiedCycle[] => {
    if (!project) return [];

    const plannedCycles = getCyclesForProject(projectId);
    const allCycleLogs = getCycleLogs().filter(log => log.projectId === projectId);

    const cycles: UnifiedCycle[] = [];
    let cycleIndex = 1;

    // First, add all planned cycles
    plannedCycles.forEach(pc => {
      const printer = getPrinter(pc.printerId);
      const matchingLog = allCycleLogs.find(log => log.plannedCycleId === pc.id);

      let status: CycleStatus = pc.status as CycleStatus;
      let unitsProduced = 0;
      let unitsScrap = 0;

      if (matchingLog) {
        status = matchingLog.result === 'completed' 
          ? 'completed' 
          : matchingLog.result === 'completed_with_scrap' 
            ? 'completed_with_scrap' 
            : 'failed';
        unitsProduced = matchingLog.unitsCompleted;
        unitsScrap = matchingLog.unitsScrap;
      }

      cycles.push({
        id: pc.id,
        cycleIndex: cycleIndex++,
        printerId: pc.printerId,
        printerName: printer?.name || `Printer ${pc.printerId.slice(-4)}`,
        plannedDate: pc.startTime.split('T')[0],
        startTime: pc.startTime,
        endTime: pc.endTime,
        unitsPlanned: pc.unitsPlanned,
        unitsProduced,
        unitsScrap,
        status,
        plannedCycleId: pc.id,
        cycleLogId: matchingLog?.id,
        timestamp: matchingLog?.timestamp,
      });
    });

    // Add any orphan logs (logs without matching planned cycles)
    allCycleLogs.forEach(log => {
      if (!log.plannedCycleId || !plannedCycles.find(pc => pc.id === log.plannedCycleId)) {
        const printer = getPrinter(log.printerId);
        cycles.push({
          id: log.id,
          cycleIndex: cycleIndex++,
          printerId: log.printerId,
          printerName: printer?.name || `Printer ${log.printerId.slice(-4)}`,
          plannedDate: log.timestamp.split('T')[0],
          startTime: log.timestamp,
          endTime: log.timestamp,
          unitsPlanned: log.unitsCompleted + log.unitsScrap,
          unitsProduced: log.unitsCompleted,
          unitsScrap: log.unitsScrap,
          status: log.result === 'completed' 
            ? 'completed' 
            : log.result === 'completed_with_scrap' 
              ? 'completed_with_scrap' 
              : 'failed',
          cycleLogId: log.id,
          timestamp: log.timestamp,
        });
      }
    });

    // Sort by date/time
    cycles.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Re-index after sorting
    return cycles.map((c, i) => ({ ...c, cycleIndex: i + 1 }));
  }, [project, projectId, refreshKey]);

  const planningMeta = getPlanningMeta();
  const hasOutdatedPlanning = planningMeta && unifiedCycles.length === 0;

  const handleEndCycle = (printerId: string) => {
    setSelectedPrinterIdForEndCycle(printerId);
    setEndCycleOpen(true);
  };

  const handleEndCycleComplete = () => {
    setEndCycleOpen(false);
    setSelectedPrinterIdForEndCycle(undefined);
    setRefreshKey(k => k + 1);
    loadData();
  };

  const handleReportIssue = (cycleId?: string) => {
    setReportIssueCycleId(cycleId);
    setReportIssueOpen(true);
  };

  const handleRecalculateComplete = () => {
    setRecalculateOpen(false);
    setRefreshKey(k => k + 1);
    loadData();
  };

  const getStatusConfig = (status: CycleStatus) => {
    switch (status) {
      case 'planned':
        return {
          icon: Clock,
          label: language === 'he' ? 'מתוכנן' : 'Planned',
          className: 'bg-muted text-muted-foreground border-muted-foreground/20',
        };
      case 'in_progress':
        return {
          icon: PlayCircle,
          label: language === 'he' ? 'בתהליך' : 'In Progress',
          className: 'bg-primary/10 text-primary border-primary/20',
        };
      case 'completed':
        return {
          icon: CheckCircle2,
          label: language === 'he' ? 'הושלם' : 'Completed',
          className: 'bg-success/10 text-success border-success/20',
        };
      case 'completed_with_scrap':
        return {
          icon: AlertTriangle,
          label: language === 'he' ? 'הושלם עם נפלים' : 'Completed with Scrap',
          className: 'bg-warning/10 text-warning border-warning/20',
        };
      case 'failed':
        return {
          icon: XCircle,
          label: language === 'he' ? 'נכשל' : 'Failed',
          className: 'bg-error/10 text-error border-error/20',
        };
      default:
        return {
          icon: Clock,
          label: language === 'he' ? 'לא ידוע' : 'Unknown',
          className: 'bg-muted text-muted-foreground border-muted-foreground/20',
        };
    }
  };

  const getProjectStatusConfig = (project: Project) => {
    const daysRemaining = calculateDaysRemaining(project.dueDate);
    if (project.status === 'completed') {
      return { label: language === 'he' ? 'הושלם' : 'Completed', className: 'bg-success/10 text-success' };
    }
    if (project.urgency === 'critical') {
      return { label: language === 'he' ? 'קריטי' : 'Critical', className: 'bg-error/10 text-error' };
    }
    if (project.urgency === 'urgent') {
      return { label: language === 'he' ? 'דחוף' : 'Urgent', className: 'bg-warning/10 text-warning' };
    }
    if (project.status === 'on_hold') {
      return { label: language === 'he' ? 'ממתין' : 'On Hold', className: 'bg-muted text-muted-foreground' };
    }
    return { label: language === 'he' ? 'בתהליך' : 'In Progress', className: 'bg-primary/10 text-primary' };
  };

  // Show loading state during hydration instead of "not found"
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <RefreshCw className="w-12 h-12 text-muted-foreground/50 animate-spin" />
        <p className="text-muted-foreground">
          {language === 'he' ? 'טוען...' : 'Loading...'}
        </p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <FolderKanban className="w-12 h-12 text-muted-foreground/50" />
        <p className="text-muted-foreground">
          {language === 'he' ? 'הפרויקט לא נמצא' : 'Project not found'}
        </p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {language === 'he' ? 'חזרה לרשימה' : 'Back to List'}
        </Button>
      </div>
    );
  }

  const remaining = project.quantityTarget - project.quantityGood;
  const progressPercent = Math.round((project.quantityGood / project.quantityTarget) * 100);
  const daysRemaining = calculateDaysRemaining(project.dueDate);
  const projectStatus = getProjectStatusConfig(project);

  const completedCycles = unifiedCycles.filter(c => c.status === 'completed' || c.status === 'completed_with_scrap');
  const inProgressCycles = unifiedCycles.filter(c => c.status === 'in_progress');
  const plannedCycles = unifiedCycles.filter(c => c.status === 'planned');

  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            {product?.name || project.productName} • {project.color}
          </p>
        </div>
        <Badge variant="outline" className={projectStatus.className}>
          {projectStatus.label}
        </Badge>
      </div>

      {/* Project Summary Section */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="w-5 h-5 text-primary" />
            {language === 'he' ? 'סיכום פרויקט' : 'Project Summary'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* Total Quantity - Editable */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {language === 'he' ? 'כמות יעד' : 'Target Qty'}
              </p>
              <Popover open={quantityPopoverOpen} onOpenChange={(open) => {
                setQuantityPopoverOpen(open);
                if (open && project) setNewQuantity(project.quantityTarget.toString());
              }}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 p-1.5 -m-1.5 rounded-lg hover:bg-muted transition-colors group cursor-pointer">
                    <span className="text-2xl font-bold">{project.quantityTarget}</span>
                    <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48" align="start">
                  <div className="space-y-3">
                    <Label>{language === 'he' ? 'כמות יעד חדשה' : 'New target quantity'}</Label>
                    <Input
                      type="number"
                      min={project.quantityGood || 1}
                      value={newQuantity}
                      onChange={(e) => setNewQuantity(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleQuantityChange()}
                    />
                    <Button size="sm" onClick={handleQuantityChange} className="w-full">
                      {language === 'he' ? 'עדכן' : 'Update'}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Produced - with external units button */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {language === 'he' ? 'הופק' : 'Produced'}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-success">{project.quantityGood}</span>
                {project.quantityOverage && project.quantityOverage > 0 && (
                  <span className="text-sm text-muted-foreground">
                    (+{project.quantityOverage} {language === 'he' ? 'עודף' : 'extra'})
                  </span>
                )}
                <Popover open={externalUnitsPopoverOpen} onOpenChange={(open) => {
                  setExternalUnitsPopoverOpen(open);
                  if (!open) {
                    setExternalUnits('');
                    setExternalNotes('');
                    setIsMyMaterial(false);
                  }
                }}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title={language === 'he' ? 'הוסף יחידות מספק חיצוני' : 'Add external supplier units'}>
                      <Truck className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72" align="start">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Truck className="h-4 w-4" />
                        {language === 'he' ? 'יחידות מספק חיצוני' : 'External supplier units'}
                      </div>
                      <div className="space-y-1">
                        <Label>{language === 'he' ? 'כמות' : 'Quantity'}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={externalUnits}
                          onChange={(e) => setExternalUnits(e.target.value)}
                          placeholder="100"
                        />
                      </div>
                      
                      {/* My Material Toggle */}
                      <div className="flex items-center justify-between py-2 border-t border-b border-border">
                        <Label htmlFor="my-material" className="text-sm cursor-pointer">
                          {language === 'he' ? 'חומר הגלם שלי' : 'My material'}
                        </Label>
                        <Switch
                          id="my-material"
                          checked={isMyMaterial}
                          onCheckedChange={setIsMyMaterial}
                        />
                      </div>
                      
                      {/* Material Deduction Info */}
                      {isMyMaterial && product && externalUnits && Number(externalUnits) > 0 && (
                        <div className="p-2 rounded-md bg-muted text-sm space-y-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{language === 'he' ? 'יקוזז:' : 'Deduct:'}</span>
                            <span className="font-medium">
                              {(Number(externalUnits) * product.gramsPerUnit).toLocaleString()}g
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{language === 'he' ? 'צבע:' : 'Color:'}</span>
                            <span>{project.color}</span>
                          </div>
                          {(() => {
                            const inventoryItem = getColorInventoryItem(project.color || '', 'PLA');
                            const gramsNeeded = Number(externalUnits) * product.gramsPerUnit;
                            const available = inventoryItem?.openTotalGrams || 0;
                            if (gramsNeeded > available) {
                              return (
                                <div className="text-warning text-xs flex items-center gap-1 mt-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {language === 'he' 
                                    ? `זמין רק ${available.toLocaleString()}g` 
                                    : `Only ${available.toLocaleString()}g available`}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}
                      
                      <div className="space-y-1">
                        <Label>{language === 'he' ? 'הערה (אופציונלי)' : 'Note (optional)'}</Label>
                        <Input
                          value={externalNotes}
                          onChange={(e) => setExternalNotes(e.target.value)}
                          placeholder={language === 'he' ? 'שם ספק...' : 'Supplier name...'}
                        />
                      </div>
                      <Button 
                        onClick={handleAddExternalUnits}
                        disabled={!externalUnits || Number(externalUnits) < 1}
                        className="w-full"
                        size="sm"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {language === 'he' ? 'הוסף יחידות' : 'Add Units'}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Scrap/Failed - Always visible */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {language === 'he' ? 'נפלים' : 'Failed'}
              </p>
              <p className={`text-2xl font-bold ${project.quantityScrap > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
                {project.quantityScrap}
              </p>
            </div>

            {/* Remaining */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {language === 'he' ? 'נותר' : 'Remaining'}
              </p>
              <p className="text-2xl font-bold text-primary">{remaining}</p>
            </div>

            {/* Due Date - Editable */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {language === 'he' ? 'תאריך יעד' : 'Due Date'}
              </p>
              <Popover open={dueDatePopoverOpen} onOpenChange={setDueDatePopoverOpen}>
                <PopoverTrigger asChild>
                  <button 
                    className={`flex items-center gap-2 p-1.5 -m-1.5 rounded-lg hover:bg-muted transition-colors group cursor-pointer ${daysRemaining < 0 ? 'text-error' : ''}`}
                  >
                    <Calendar className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                    <span className="font-medium">
                      {format(parseISO(project.dueDate), 'dd/MM/yyyy')}
                    </span>
                    <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={parseISO(project.dueDate)}
                    onSelect={handleDueDateChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <p className={`text-xs ${daysRemaining < 0 ? 'text-error' : 'text-muted-foreground'}`}>
                {daysRemaining < 0 
                  ? (language === 'he' ? `${Math.abs(daysRemaining)} ימים באיחור` : `${Math.abs(daysRemaining)} days overdue`)
                  : (language === 'he' ? `${daysRemaining} ימים נותרו` : `${daysRemaining} days left`)
                }
              </p>
            </div>
          </div>

          {/* Color Section - Editable */}
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? 'צבע הדפסה' : 'Print Color'}
              </span>
            </div>
            <Popover open={colorPopoverOpen} onOpenChange={setColorPopoverOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted transition-colors group cursor-pointer border border-border">
                  <span className="font-medium">{project.color}</span>
                  <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="end">
                <div className="space-y-3">
                  <Label>{language === 'he' ? 'בחר צבע חדש' : 'Select new color'}</Label>
                  <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                    {availableColors.map((color) => (
                      <button
                        key={color}
                        onClick={() => handleColorChange(color)}
                        className={`px-2 py-1.5 text-sm rounded-md border transition-colors ${
                          color === project.color 
                            ? 'bg-primary text-primary-foreground border-primary' 
                            : 'hover:bg-muted border-border'
                        }`}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {language === 'he' 
                      ? 'שינוי הצבע ישפיע על התכנון והחומרים הנדרשים' 
                      : 'Changing color will affect planning and required materials'}
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {language === 'he' ? 'התקדמות' : 'Progress'}
              </span>
              <span className="font-medium">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-3" />
          </div>

        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        {inProgressCycles.length > 0 && (
          <Button onClick={() => handleEndCycle(inProgressCycles[0].printerId)} className="gap-2">
            <ClipboardCheck className="w-4 h-4" />
            {language === 'he' ? 'דווח סיום מחזור' : 'Report Cycle End'}
          </Button>
        )}
        <Button variant="outline" onClick={() => handleReportIssue()} className="gap-2">
          <AlertTriangle className="w-4 h-4" />
          {language === 'he' ? 'דווח על בעיה' : 'Report Issue'}
        </Button>
        <Button variant="outline" onClick={() => setRecalculateOpen(true)} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          {language === 'he' ? 'חשב מחדש' : 'Recalculate'}
        </Button>
      </div>

      {/* Cycles Timeline Section */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg">
              <Timer className="w-5 h-5 text-primary" />
              {language === 'he' ? 'ציר זמן מחזורים' : 'Cycles Timeline'}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{completedCycles.length} {language === 'he' ? 'הושלמו' : 'done'}</Badge>
              <Badge variant="secondary">{inProgressCycles.length} {language === 'he' ? 'פעילים' : 'active'}</Badge>
              <Badge variant="secondary">{plannedCycles.length} {language === 'he' ? 'מתוכננים' : 'planned'}</Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unifiedCycles.length === 0 ? (
            <div className="text-center py-12 space-y-4">
              <div className="inline-flex p-4 bg-muted rounded-full">
                <Clock className="w-8 h-8 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  {language === 'he' 
                    ? 'אין מחזורים מתוכננים עדיין' 
                    : 'No planned cycles yet'}
                </p>
                {hasOutdatedPlanning && (
                  <p className="text-sm text-warning flex items-center justify-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {language === 'he' 
                      ? 'התכנון מיושן – בוצעו שינויים מאז החישוב האחרון'
                      : 'Planning is outdated – changes detected since last calculation'}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <Button onClick={() => setRecalculateOpen(true)} className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  {language === 'he' ? 'חשב תכנון' : 'Calculate Planning'}
                </Button>
                <Button variant="outline" onClick={onBack} className="gap-2">
                  <FolderKanban className="w-4 h-4" />
                  {language === 'he' ? 'לך לפרויקטים בתהליך' : 'Go to Active Projects'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {unifiedCycles.map((cycle) => {
                const statusConfig = getStatusConfig(cycle.status);
                const StatusIcon = statusConfig.icon;
                const canEndCycle = cycle.status === 'in_progress' || cycle.status === 'planned';
                
                return (
                  <div
                    key={cycle.id}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors"
                  >
                    {/* Cycle Index */}
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-sm font-bold text-muted-foreground">
                        #{cycle.cycleIndex}
                      </span>
                    </div>

                    {/* Cycle Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{cycle.printerName}</span>
                        <Badge variant="outline" className={`gap-1 ${statusConfig.className}`}>
                          <StatusIcon className="w-3 h-3" />
                          {statusConfig.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {format(parseISO(cycle.plannedDate), 'dd/MM/yyyy')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {format(parseISO(cycle.startTime), 'HH:mm')} - {format(parseISO(cycle.endTime), 'HH:mm')}
                        </span>
                      </div>
                    </div>

                    {/* Units Info */}
                    <div className="text-right flex-shrink-0">
                      <div className="font-medium">
                        {cycle.status === 'planned' || cycle.status === 'in_progress' 
                          ? cycle.unitsPlanned 
                          : cycle.unitsProduced
                        } {language === 'he' ? 'יח\'' : 'units'}
                      </div>
                      {cycle.unitsScrap > 0 && (
                        <div className="text-xs text-warning">
                          {language === 'he' ? 'פסולת:' : 'Scrap:'} {cycle.unitsScrap}
                        </div>
                      )}
                      {(cycle.status === 'completed' || cycle.status === 'completed_with_scrap') && (
                        <div className="text-xs text-muted-foreground">
                          {language === 'he' ? 'מתוכנן:' : 'Planned:'} {cycle.unitsPlanned}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0 flex gap-2">
                      {canEndCycle && (
                        <Button
                          size="sm"
                          variant={cycle.status === 'in_progress' ? 'default' : 'outline'}
                          onClick={() => handleEndCycle(cycle.printerId)}
                          className="gap-1"
                        >
                          <ClipboardCheck className="w-4 h-4" />
                          {language === 'he' ? 'סיום' : 'End'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReportIssue(cycle.id)}
                        className="gap-1"
                      >
                        <AlertTriangle className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* End Cycle Dialog */}
      <Dialog open={endCycleOpen} onOpenChange={setEndCycleOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {language === 'he' ? 'דיווח סיום מחזור' : 'End Cycle Report'}
            </DialogTitle>
          </DialogHeader>
          <EndCycleLog
            preSelectedPrinterId={selectedPrinterIdForEndCycle}
            onComplete={handleEndCycleComplete}
          />
        </DialogContent>
      </Dialog>

      {/* Report Issue Flow */}
      <ReportIssueFlow
        isOpen={reportIssueOpen}
        onClose={() => {
          setReportIssueOpen(false);
          setReportIssueCycleId(undefined);
          setRefreshKey(k => k + 1);
        }}
        preselectedProjectId={projectId}
      />

      {/* Recalculate Modal */}
      <RecalculateModal
        open={recalculateOpen}
        onOpenChange={(open) => {
          if (!open) handleRecalculateComplete();
        }}
        onRecalculated={handleRecalculateComplete}
      />

      {/* Warning Modal for planning issues */}
      {planningIssues && (
        <DeadlineWarningModal
          open={!!planningIssues}
          onClose={() => setPlanningIssues(null)}
          blockingIssues={planningIssues.blockingIssues}
          warnings={planningIssues.warnings}
          newProjectId={project?.id}
          newProjectName={project?.name}
        />
      )}
    </div>
  );
};
