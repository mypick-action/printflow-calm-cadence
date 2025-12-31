import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { ProjectDetailsPage } from './ProjectDetailsPage';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Plus, 
  FolderKanban, 
  Calendar, 
  Package, 
  AlertTriangle, 
  Pencil, 
  ChevronDown, 
  PackagePlus, 
  MoreHorizontal,
  Clock,
  Pause,
  CheckCircle,
  PlayCircle,
  Filter,
  Flame,
  Trash2,
  CircleDot,
  CircleSlash,
  Circle,
  Printer,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import { 
  getProjects, 
  getProducts, 
  createProject,
  deleteProject,
  updateProject,
  Project, 
  Product,
  calculatePriorityFromDueDate,
  calculateDaysRemaining,
  getColorInventory,
  getFactorySettings,
  saveFactorySettings,
  getCyclesForProject,
  PlannedCycle,
  hasActivePrintForProject,
  forceCompleteProject,
} from '@/services/storage';
import { Switch } from '@/components/ui/switch';
import { validateProjectForPlanning, getValidationSummary } from '@/services/projectValidation';
import { 
  getProjectMaterialStatus, 
  getMaterialStatusForColor,
  formatMaterialStatus, 
  generateOrderRecommendationText,
  calculateSpoolsNeeded,
  ProjectMaterialStatus,
  MaterialStatusType,
} from '@/services/materialStatus';
import { ReportIssueFlow } from '@/components/report-issue/ReportIssueFlow';
import { ProductEditorModal } from '@/components/products/ProductEditorModal';
import { AssignmentChoiceModal } from './AssignmentChoiceModal';
import { DeadlineWarningModal } from './DeadlineWarningModal';
import { ManualStartPrintModal } from '@/components/dashboard/ManualStartPrintModal';
import { scheduleAutoReplan } from '@/services/autoReplan';
import { runReplanNow } from '@/services/planningRecalculator';
import { BlockingIssue, PlanningWarning } from '@/services/planningEngine';
import { subscribeToInventoryChanges } from '@/services/inventoryEvents';

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

// Hebrew predefined colors (same as inventory page)
const predefinedColors = ['שחור', 'לבן', 'אפור', 'אדום', 'כחול', 'ירוק', 'צהוב', 'כתום', 'סגול', 'ורוד', 'חום'];

// Status type definitions
type ProjectStatus = 'pending' | 'in_progress' | 'on_hold' | 'completed';
type ProjectPriority = 'normal' | 'urgent' | 'critical';

// Material Status Preview Component (PRD: immediate feedback on project creation)
const MaterialStatusPreview: React.FC<{
  productId: string;
  color: string;
  quantity: number;
  language: 'he' | 'en';
  products: Product[];
}> = ({ productId, color, quantity, language, products }) => {
  const product = products.find(p => p.id === productId);
  if (!product || !product.gramsPerUnit) return null;
  
  const requiredGrams = product.gramsPerUnit * quantity;
  const materialStatus = getMaterialStatusForColor(color, requiredGrams);
  const { label, className } = formatMaterialStatus(materialStatus.status, language);
  
  // Calculate spool recommendation if needed
  let spoolsToOrder = 0;
  if (materialStatus.missingGrams > 0) {
    const { spoolsNeeded } = calculateSpoolsNeeded(materialStatus.missingGrams);
    spoolsToOrder = spoolsNeeded;
  }
  
  const icon = materialStatus.status === 'full' 
    ? <CircleDot className="w-4 h-4" />
    : materialStatus.status === 'partial'
    ? <Circle className="w-4 h-4" />
    : <CircleSlash className="w-4 h-4" />;
  
  return (
    <div className={`p-3 rounded-lg border ${className}`}>
      <div className="flex items-center gap-2 font-medium">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between">
          <span>{language === 'he' ? 'נדרש:' : 'Required:'}</span>
          <span className="font-medium">{Math.ceil(requiredGrams)}g</span>
        </div>
        <div className="flex justify-between">
          <span>{language === 'he' ? 'זמין:' : 'Available:'}</span>
          <span className="font-medium">{Math.ceil(materialStatus.availableGrams)}g</span>
        </div>
        {materialStatus.missingGrams > 0 && (
          <>
            <div className="flex justify-between text-error">
              <span>{language === 'he' ? 'חסר:' : 'Missing:'}</span>
              <span className="font-medium">{Math.ceil(materialStatus.missingGrams)}g</span>
            </div>
            <div className="pt-2 border-t mt-2">
              <div className="flex justify-between font-medium">
                <span>{language === 'he' ? 'הזמנה מומלצת:' : 'Recommended order:'}</span>
                <span>
                  {spoolsToOrder} {language === 'he' ? 'גלילים' : 'spool(s)'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {language === 'he' 
                  ? `לפי סף ביטחון של 150g` 
                  : `Based on 150g safety threshold`}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const ProjectsPage: React.FC = () => {
  const { language } = useLanguage();
  const { workspaceId } = useAuth();
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableColors, setAvailableColors] = useState<string[]>(predefinedColors);
  const [manualOverrideOpen, setManualOverrideOpen] = useState(false);
  const [productSearchText, setProductSearchText] = useState('');
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [reportIssueProjectId, setReportIssueProjectId] = useState<string | undefined>(undefined);
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [productEditorInitialName, setProductEditorInitialName] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  
  // Force complete state
  const [forceCompleteDialogOpen, setForceCompleteDialogOpen] = useState(false);
  const [projectToComplete, setProjectToComplete] = useState<Project | null>(null);
  const [hasActivePrint, setHasActivePrint] = useState(false);
  const [confirmNoActivePrint, setConfirmNoActivePrint] = useState(false);
  
  // Assignment choice modal state
  const [assignmentChoiceOpen, setAssignmentChoiceOpen] = useState(false);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [manualStartOpen, setManualStartOpen] = useState(false);
  
  // Deadline warning modal state
  const [deadlineWarningOpen, setDeadlineWarningOpen] = useState(false);
  const [planningIssues, setPlanningIssues] = useState<{
    blockingIssues: BlockingIssue[];
    warnings: PlanningWarning[];
    newProjectId?: string;
    newProjectName?: string;
  } | null>(null);
  
  // Custom color state
  const [useCustomColor, setUseCustomColor] = useState(false);
  const [customColorName, setCustomColorName] = useState('');
  
  // Filter state - Status filter (primary, default to pending + in_progress + on_hold)
  const [statusFilters, setStatusFilters] = useState<Record<ProjectStatus, boolean>>({
    pending: true, // Default ON - "מתוכנן"
    in_progress: true, // Default ON - "בתהליך"
    on_hold: true, // Default ON - "ממתין"
    completed: false,
  });
  
  // Priority filter (secondary)
  const [priorityFilter, setPriorityFilter] = useState<'all' | ProjectPriority>('all');
  
  // Material shortage filter
  const [materialShortageFilter, setMaterialShortageFilter] = useState(false);
  
  const [newProject, setNewProject] = useState({
    name: '',
    productId: '',
    preferredPresetId: '',
    quantityTarget: 100,
    dueDate: '',
    color: predefinedColors[0], // Default to first predefined color
    manualUrgency: null as ProjectPriority | null,
    includeInPlanning: true, // Default: include in planning
  });

  // Get earliest planned print date for a project
  const getPlannedPrintDate = (projectId: string): string | null => {
    const cycles = getCyclesForProject(projectId);
    const plannedCycles = cycles.filter(c => c.status === 'planned' || c.status === 'in_progress');
    if (plannedCycles.length === 0) return null;
    
    // Sort by startTime and get the earliest
    plannedCycles.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return plannedCycles[0].startTime;
  };

  const handleReportIssue = (projectId: string) => {
    setReportIssueProjectId(projectId);
    setReportIssueOpen(true);
  };

  const handleDeleteProject = (project: Project) => {
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteProject = async () => {
    if (projectToDelete) {
      deleteProject(projectToDelete.id);
      const projectsData = await getProjects();
      setProjects(projectsData);
      toast({
        title: language === 'he' ? 'הפרויקט נמחק' : 'Project deleted',
        description: projectToDelete.name,
      });
    }
    setDeleteDialogOpen(false);
    setProjectToDelete(null);
  };

  // Force complete handlers
  const handleForceComplete = (project: Project) => {
    const hasActive = hasActivePrintForProject(project.id);
    setProjectToComplete(project);
    setHasActivePrint(hasActive);
    setConfirmNoActivePrint(false);
    setForceCompleteDialogOpen(true);
  };

  const confirmForceComplete = () => {
    if (!projectToComplete) return;
    
    const result = forceCompleteProject(
      projectToComplete.id, 
      hasActivePrint ? confirmNoActivePrint : true
    );
    
    if (result.success) {
      toast({
        title: language === 'he' ? 'הפרויקט הסתיים' : 'Project Completed',
        description: language === 'he' 
          ? `${result.finalQuantity} יחידות הושלמו. ${result.cancelledCycles} מחזורים בוטלו.`
          : `${result.finalQuantity} units completed. ${result.cancelledCycles} cycles cancelled.`,
      });
      refreshData();
    } else if (result.error) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: result.error,
        variant: 'destructive',
      });
    }
    
    setForceCompleteDialogOpen(false);
    setProjectToComplete(null);
    setHasActivePrint(false);
    setConfirmNoActivePrint(false);
  };

  const refreshData = async () => {
    // Load projects from cloud (async, cloud-first)
    const projectsData = await getProjects();
    setProjects(projectsData);
    setProducts(getProducts());
    
    // Get colors from inventory and settings
    const inventory = getColorInventory();
    const inventoryColors = inventory.map(item => item.color);
    const settings = getFactorySettings();
    const settingsColors = settings?.colors || [];
    
    // Combine predefined colors + inventory colors + settings colors (all unique)
    const allColors = new Set([...predefinedColors, ...inventoryColors, ...settingsColors]);
    setAvailableColors(Array.from(allColors));
  };

  useEffect(() => {
    refreshData();
    // Subscribe to inventory changes to update material status
    const unsubscribe = subscribeToInventoryChanges(refreshData);
    return unsubscribe;
  }, []);


  // Status configuration with Hebrew-first labels
  const statusConfig: Record<ProjectStatus, { 
    label: string; 
    labelEn: string; 
    icon: React.ReactNode;
    className: string;
  }> = {
    pending: { 
      label: 'מתוכנן', 
      labelEn: 'Planned',
      icon: <Clock className="w-3.5 h-3.5" />,
      className: 'bg-muted text-muted-foreground border-muted-foreground/20' 
    },
    in_progress: { 
      label: 'בתהליך', 
      labelEn: 'In Progress',
      icon: <PlayCircle className="w-3.5 h-3.5" />,
      className: 'bg-primary/10 text-primary border-primary/20' 
    },
    on_hold: { 
      label: 'ממתין', 
      labelEn: 'Waiting',
      icon: <Pause className="w-3.5 h-3.5" />,
      className: 'bg-warning/10 text-warning border-warning/20' 
    },
    completed: { 
      label: 'הושלם', 
      labelEn: 'Completed',
      icon: <CheckCircle className="w-3.5 h-3.5" />,
      className: 'bg-success/10 text-success border-success/20' 
    },
  };

  // Priority configuration
  const priorityConfig: Record<ProjectPriority, { 
    label: string; 
    labelEn: string; 
    className: string;
  }> = {
    normal: { 
      label: 'רגיל', 
      labelEn: 'Normal',
      className: 'bg-success/10 text-success border-success/20' 
    },
    urgent: { 
      label: 'דחוף', 
      labelEn: 'Urgent',
      className: 'bg-warning/10 text-warning border-warning/20' 
    },
    critical: { 
      label: 'קריטי', 
      labelEn: 'Critical',
      className: 'bg-error/10 text-error border-error/20' 
    },
  };

  // Material status for each project (PRD: 3-state status) - must be before filteredProjects
  const projectMaterialStatuses = useMemo(() => {
    const statuses = new Map<string, ProjectMaterialStatus>();
    for (const project of projects) {
      if (project.status !== 'completed') {
        statuses.set(project.id, getProjectMaterialStatus(project));
      }
    }
    return statuses;
  }, [projects]);

  // Filtered projects based on status, priority, and material shortage
  const filteredProjects = useMemo(() => {
    return projects.filter(project => {
      // Material shortage filter - when active, show ALL projects with shortage (ignore status filter)
      if (materialShortageFilter) {
        const materialStatus = projectMaterialStatuses.get(project.id);
        // Show project if it has material shortage (partial or none), skip completed
        if (project.status === 'completed') return false;
        return materialStatus && materialStatus.status !== 'full';
      }
      
      // Status filter (primary)
      const statusMatch = statusFilters[project.status];
      if (!statusMatch) return false;
      
      // Priority filter (secondary)
      if (priorityFilter !== 'all' && project.urgency !== priorityFilter) {
        return false;
      }
      
      return true;
    });
  }, [projects, statusFilters, priorityFilter, materialShortageFilter, projectMaterialStatuses]);

  // Summary counts
  const statusCounts = useMemo(() => ({
    pending: projects.filter(p => p.status === 'pending').length,
    in_progress: projects.filter(p => p.status === 'in_progress').length,
    on_hold: projects.filter(p => p.status === 'on_hold').length,
    completed: projects.filter(p => p.status === 'completed').length,
  }), [projects]);

  const attentionCounts = useMemo(() => {
    const active = projects.filter(p => p.status !== 'completed');
    return {
      urgent: active.filter(p => p.urgency === 'urgent').length,
      critical: active.filter(p => p.urgency === 'critical').length,
    };
  }, [projects]);

  // Count projects with material shortage
  const materialShortageCount = useMemo(() => {
    let count = 0;
    projectMaterialStatuses.forEach((status) => {
      if (status.status !== 'full') {
        count++;
      }
    });
    return count;
  }, [projectMaterialStatuses]);

  // Helper to get material status badge
  const getMaterialStatusBadge = (projectId: string) => {
    const materialStatus = projectMaterialStatuses.get(projectId);
    if (!materialStatus) return null;
    
    const { label, className } = formatMaterialStatus(materialStatus.status, language);
    const icon = materialStatus.status === 'full' 
      ? <CircleDot className="w-3 h-3" />
      : materialStatus.status === 'partial'
      ? <Circle className="w-3 h-3" />
      : <CircleSlash className="w-3 h-3" />;
    
    return (
      <div className="space-y-1">
        <Badge variant="outline" className={`gap-1 ${className}`}>
          {icon}
          {label}
        </Badge>
        {materialStatus.orderRecommendation && materialStatus.orderRecommendation.spoolsToOrder > 0 && (
          <div className="text-xs text-muted-foreground">
            {generateOrderRecommendationText(materialStatus.orderRecommendation, language)}
          </div>
        )}
      </div>
    );
  };

  // Calculate auto-priority when due date changes
  const getCalculatedPriority = () => {
    if (!newProject.dueDate) return null;
    return calculatePriorityFromDueDate(newProject.dueDate);
  };

  const getDaysRemainingText = () => {
    if (!newProject.dueDate) return '';
    const days = calculateDaysRemaining(newProject.dueDate);
    if (days < 0) {
      return language === 'he' ? `באיחור של ${Math.abs(days)} ימים` : `${Math.abs(days)} days overdue`;
    }
    return language === 'he' ? `${days} ימים נותרו` : `${days} days remaining`;
  };

  const handleAddProject = () => {
    if (!newProject.name || !newProject.productId || !newProject.dueDate) return;
    
    const product = products.find(p => p.id === newProject.productId);
    if (!product) return;

    const calculatedUrgency = calculatePriorityFromDueDate(newProject.dueDate);
    const finalUrgency = newProject.manualUrgency || calculatedUrgency;
    
    // If using a custom color, save it to factory settings for future use
    if (useCustomColor && customColorName.trim()) {
      const settings = getFactorySettings();
      if (settings) {
        const existingColors = settings.colors || [];
        if (!existingColors.includes(customColorName.trim())) {
          const updatedColors = [...existingColors, customColorName.trim()];
          saveFactorySettings({ ...settings, colors: updatedColors });
        }
      }
    }
    
    const newCreatedProject = createProject({
      name: newProject.name,
      productId: newProject.productId,
      productName: product.name,
      preferredPresetId: newProject.preferredPresetId || undefined,
      quantityTarget: newProject.quantityTarget,
      dueDate: newProject.dueDate,
      urgency: finalUrgency,
      urgencyManualOverride: newProject.manualUrgency !== null,
      status: 'pending',
      color: newProject.color,
      includeInPlanning: newProject.includeInPlanning,
    });
    
    // refreshData() below will update projects from cloud
    setDialogOpen(false);
    setManualOverrideOpen(false);
    setNewProject({
      name: '',
      productId: '',
      preferredPresetId: '',
      quantityTarget: 100,
      dueDate: '',
      color: predefinedColors[0], // Reset to first predefined color
      manualUrgency: null,
      includeInPlanning: true,
    });
    setUseCustomColor(false);
    setCustomColorName('');
    setProductSearchText('');
    
    // Refresh to include the new color
    refreshData();
    
    // Show assignment choice modal
    setCreatedProject(newCreatedProject);
    setAssignmentChoiceOpen(true);
  };

  const handleManualAssignment = () => {
    // Open the manual start modal with the created project
    setManualStartOpen(true);
  };

  const handleAutomaticAssignment = () => {
    // Run immediate replan and get full result
    const result = runReplanNow('project_created');
    
    // Debug log - show what came back from planning
    console.log('[ProjectsPage] Replan result:', {
      success: result.success,
      cyclesModified: result.cyclesModified,
      blockingIssues: result.blockingIssues,
      warnings: result.warnings,
    });
    
    if (createdProject) {
      // Check for blocking issues (deadline_impossible, insufficient_material)
      const criticalIssues = result.blockingIssues.filter(i => 
        i.type === 'deadline_impossible' || i.type === 'insufficient_material'
      );
      
      console.log('[ProjectsPage] Critical issues found:', criticalIssues);
      
      if (criticalIssues.length > 0) {
        // Show warning modal
        setPlanningIssues({
          blockingIssues: criticalIssues,
          warnings: result.warnings,
          newProjectId: createdProject.id,
          newProjectName: createdProject.name,
        });
        setDeadlineWarningOpen(true);
      } else {
        // Success - show simple toast
        toast({
          title: language === 'he' ? 'פרויקט נוצר בהצלחה' : 'Project created',
          description: result.summaryHe || result.summary,
        });
      }
    }
    
    setCreatedProject(null);
  };

  const handleOpenProductEditor = () => {
    // Use project name as default for new product, fallback to search text
    setProductEditorInitialName(newProject.name || productSearchText);
    setProductEditorOpen(true);
  };

  const handleProductCreated = (product: Product) => {
    setProducts(getProducts());
    setNewProject({ 
      ...newProject, 
      productId: product.id,
      preferredPresetId: product.platePresets.find(p => p.isRecommended)?.id || product.platePresets[0]?.id || '',
    });
    setProductSearchText('');
  };

  const toggleStatusFilter = (status: ProjectStatus) => {
    setStatusFilters(prev => ({ ...prev, [status]: !prev[status] }));
  };

  const getStatusBadge = (status: ProjectStatus) => {
    const config = statusConfig[status];
    return (
      <Badge variant="outline" className={`gap-1.5 ${config.className}`}>
        {config.icon}
        {language === 'he' ? config.label : config.labelEn}
      </Badge>
    );
  };

  const getPriorityBadge = (urgency: ProjectPriority, isManual?: boolean) => {
    const config = priorityConfig[urgency];
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className={config.className}>
          {language === 'he' ? config.label : config.labelEn}
        </Badge>
        {isManual && (
          <Pencil className="w-3 h-3 text-muted-foreground" />
        )}
      </div>
    );
  };

  const getPriorityWithDays = (project: Project) => {
    const days = calculateDaysRemaining(project.dueDate);
    const config = priorityConfig[project.urgency];
    const daysText = days < 0 
      ? (language === 'he' ? `${Math.abs(days)} ימים באיחור` : `${Math.abs(days)}d late`)
      : (language === 'he' ? `${days} ימים ליעד` : `${days}d to go`);
    
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={config.className}>
          {language === 'he' ? config.label : config.labelEn}
        </Badge>
        <span className={`text-xs ${days < 0 ? 'text-error font-medium' : 'text-muted-foreground'}`}>
          ({daysText})
        </span>
        {project.urgencyManualOverride && (
          <span title={language === 'he' ? 'עדיפות ידנית' : 'Manual priority'}>
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </span>
        )}
      </div>
    );
  };

  const calculateProgress = (project: Project) => {
    return Math.round((project.quantityGood / project.quantityTarget) * 100);
  };

  const isOverdue = (project: Project) => {
    return project.status !== 'completed' && new Date(project.dueDate) < new Date();
  };

  const calculatedPriority = getCalculatedPriority();
  const effectivePriority = newProject.manualUrgency || calculatedPriority;

  // Check if any status filter is active
  const hasActiveStatusFilter = Object.values(statusFilters).some(v => v);

  // If a project is selected, show the details page
  if (selectedProjectId) {
    return (
      <ProjectDetailsPage
        projectId={selectedProjectId}
        onBack={async () => {
          setSelectedProjectId(null);
          // Refresh data when coming back from details
          await refreshData();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <FolderKanban className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {language === 'he' ? 'פרויקטים' : 'Projects'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {language === 'he' ? 'ניהול הזמנות וייצור' : 'Manage orders and production'}
            </p>
          </div>
        </div>
        
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              {language === 'he' ? 'פרויקט חדש' : 'New Project'}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {language === 'he' ? 'הוספת פרויקט חדש' : 'Add New Project'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Project Name */}
              <div className="space-y-2">
                <Label htmlFor="name">
                  {language === 'he' ? 'שם הפרויקט' : 'Project Name'}
                </Label>
                <Input
                  id="name"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  placeholder={language === 'he' ? 'הזינו שם לפרויקט' : 'Enter project name'}
                />
              </div>
              
              {/* Product Selection */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'מוצר' : 'Product'}</Label>
                <Select 
                  value={newProject.productId} 
                  onValueChange={(value) => {
                    if (value === '__new__') {
                      handleOpenProductEditor();
                    } else {
                      setNewProject({ ...newProject, productId: value });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחרו מוצר' : 'Select product'} />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg">
                    <div className="p-2 border-b">
                      <Input
                        placeholder={language === 'he' ? 'חפשו או הקלידו שם מוצר...' : 'Search or type product name...'}
                        value={productSearchText}
                        onChange={(e) => setProductSearchText(e.target.value)}
                        className="h-8"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                    {products
                      .filter(p => 
                        productSearchText === '' || 
                        p.name.toLowerCase().includes(productSearchText.toLowerCase())
                      )
                      .map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} ({product.gramsPerUnit}g)
                        </SelectItem>
                      ))}
                    <div className="border-t mt-1 pt-1">
                      <SelectItem value="__new__" className="text-primary font-medium">
                        <div className="flex items-center gap-2">
                          <PackagePlus className="w-4 h-4" />
                          {language === 'he' ? '+ הוסף מוצר חדש...' : '+ Add new product...'}
                        </div>
                      </SelectItem>
                    </div>
                  </SelectContent>
                </Select>
              </div>
              
              <ProductEditorModal
                open={productEditorOpen}
                onOpenChange={setProductEditorOpen}
                initialName={productEditorInitialName}
                onProductSaved={handleProductCreated}
              />
              
              {/* Color Selection */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'צבע' : 'Color'}</Label>
                <Select 
                  value={useCustomColor ? '__custom__' : newProject.color} 
                  onValueChange={(value) => {
                    if (value === '__custom__') {
                      setUseCustomColor(true);
                    } else {
                      setUseCustomColor(false);
                      setNewProject({ ...newProject, color: value });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg">
                    {availableColors.filter(c => c && c.trim()).map((color) => (
                      <SelectItem key={color} value={color}>
                        {color}
                      </SelectItem>
                    ))}
                    <div className="border-t mt-1 pt-1">
                      <SelectItem value="__custom__" className="text-primary font-medium">
                        <div className="flex items-center gap-2">
                          <Plus className="w-4 h-4" />
                          {language === 'he' ? '+ צבע חדש' : '+ New color'}
                        </div>
                      </SelectItem>
                    </div>
                  </SelectContent>
                </Select>
                
                {/* Custom Color Input */}
                {useCustomColor && (
                  <Input 
                    value={customColorName}
                    onChange={(e) => {
                      setCustomColorName(e.target.value);
                      setNewProject({ ...newProject, color: e.target.value });
                    }}
                    placeholder={language === 'he' ? 'הזינו שם צבע...' : 'Enter color name...'}
                    className="mt-2"
                  />
                )}
              </div>
              
              {/* Quantity */}
              <div className="space-y-2">
                <Label htmlFor="quantity">
                  {language === 'he' ? 'כמות יעד' : 'Target Quantity'}
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  value={newProject.quantityTarget}
                  onChange={(e) => setNewProject({ ...newProject, quantityTarget: parseInt(e.target.value) || 0 })}
                />
              </div>
              
              {/* Due Date */}
              <div className="space-y-2">
                <Label htmlFor="dueDate">
                  {language === 'he' ? 'תאריך יעד' : 'Due Date'}
                </Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={newProject.dueDate}
                  onChange={(e) => setNewProject({ 
                    ...newProject, 
                    dueDate: e.target.value,
                    manualUrgency: null
                  })}
                />
              </div>
              
              {/* Auto-calculated Priority Display */}
              {newProject.dueDate && (
                <div className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {language === 'he' ? 'דחיפות:' : 'Priority:'}
                    </span>
                    <div className="flex items-center gap-2">
                      {effectivePriority && getPriorityBadge(effectivePriority, newProject.manualUrgency !== null)}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {getDaysRemainingText()}
                  </div>
                  
                  <Collapsible open={manualOverrideOpen} onOpenChange={setManualOverrideOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-between text-xs h-8 mt-1">
                        <span className="flex items-center gap-1">
                          <Pencil className="w-3 h-3" />
                          {language === 'he' ? 'שנה דחיפות ידנית' : 'Change priority manually'}
                        </span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${manualOverrideOpen ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <div className="flex gap-2">
                        {(['normal', 'urgent', 'critical'] as const).map((urgency) => {
                          const isSelected = newProject.manualUrgency === urgency;
                          const config = priorityConfig[urgency];
                          return (
                            <Button
                              key={urgency}
                              variant="outline"
                              size="sm"
                              onClick={() => setNewProject({ 
                                ...newProject, 
                                manualUrgency: isSelected ? null : urgency 
                              })}
                              className={`flex-1 ${isSelected ? config.className : ''}`}
                            >
                              {language === 'he' ? config.label : config.labelEn}
                            </Button>
                          );
                        })}
                      </div>
                      {newProject.manualUrgency && (
                        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                          <Pencil className="w-3 h-3" />
                          {language === 'he' ? 'דחיפות ידנית - תסומן בפרויקט' : 'Manual priority - will be marked'}
                        </p>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}
              
              {/* Material Status Preview (PRD: immediate feedback) */}
              {newProject.productId && newProject.color && newProject.quantityTarget > 0 && (
                <MaterialStatusPreview
                  productId={newProject.productId}
                  color={newProject.color}
                  quantity={newProject.quantityTarget}
                  language={language}
                  products={products}
                />
              )}
              
              {/* Include in Planning Toggle */}
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="includeInPlanning" className="text-sm font-medium">
                    {language === 'he' ? 'שלב בלוח עבודה' : 'Include in Schedule'}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {language === 'he' 
                      ? 'כאשר פעיל, הפרויקט יתוכנן אוטומטית' 
                      : 'When enabled, project will be automatically scheduled'}
                  </p>
                </div>
                <Switch
                  id="includeInPlanning"
                  checked={newProject.includeInPlanning}
                  onCheckedChange={(checked) => setNewProject({ ...newProject, includeInPlanning: checked })}
                />
              </div>
              
              <Button 
                onClick={handleAddProject} 
                className="w-full"
                disabled={!newProject.name || !newProject.productId || !newProject.dueDate}
              >
                {language === 'he' ? 'הוסף פרויקט' : 'Add Project'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Row 1: Status Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card 
          variant="glass" 
          className={`cursor-pointer transition-all ${statusFilters.in_progress ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-border'}`}
          onClick={() => toggleStatusFilter('in_progress')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-primary">{statusCounts.in_progress}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'בתהליך' : 'In Progress'}
                </div>
              </div>
              <PlayCircle className="w-8 h-8 text-primary/30" />
            </div>
          </CardContent>
        </Card>
        
        <Card 
          variant="glass" 
          className={`cursor-pointer transition-all ${statusFilters.pending ? 'ring-2 ring-muted-foreground' : 'hover:ring-1 hover:ring-border'}`}
          onClick={() => toggleStatusFilter('pending')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-muted-foreground">{statusCounts.pending}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'מתוכננים' : 'Planned'}
                </div>
              </div>
              <Clock className="w-8 h-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        
        <Card 
          variant="glass" 
          className={`cursor-pointer transition-all ${statusFilters.on_hold ? 'ring-2 ring-warning' : 'hover:ring-1 hover:ring-border'}`}
          onClick={() => toggleStatusFilter('on_hold')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-warning">{statusCounts.on_hold}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'ממתינים' : 'Waiting'}
                </div>
              </div>
              <Pause className="w-8 h-8 text-warning/30" />
            </div>
          </CardContent>
        </Card>
        
        <Card 
          variant="glass" 
          className={`cursor-pointer transition-all ${statusFilters.completed ? 'ring-2 ring-success' : 'hover:ring-1 hover:ring-border'}`}
          onClick={() => toggleStatusFilter('completed')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-success">{statusCounts.completed}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'הושלמו' : 'Completed'}
                </div>
              </div>
              <CheckCircle className="w-8 h-8 text-success/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Attention Indicators */}
      <div className="flex gap-3 flex-wrap">
        {attentionCounts.critical > 0 && (
          <div 
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${
              priorityFilter === 'critical' 
                ? 'bg-error/20 border-error text-error' 
                : 'bg-error/5 border-error/30 text-error hover:bg-error/10'
            }`}
            onClick={() => setPriorityFilter(priorityFilter === 'critical' ? 'all' : 'critical')}
          >
            <Flame className="w-4 h-4" />
            <span className="font-medium">{attentionCounts.critical}</span>
            <span className="text-sm">
              {language === 'he' ? 'קריטיים' : 'Critical'}
            </span>
          </div>
        )}
        {attentionCounts.urgent > 0 && (
          <div 
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${
              priorityFilter === 'urgent' 
                ? 'bg-warning/20 border-warning text-warning' 
                : 'bg-warning/5 border-warning/30 text-warning hover:bg-warning/10'
            }`}
            onClick={() => setPriorityFilter(priorityFilter === 'urgent' ? 'all' : 'urgent')}
          >
            <AlertTriangle className="w-4 h-4" />
            <span className="font-medium">{attentionCounts.urgent}</span>
            <span className="text-sm">
              {language === 'he' ? 'דחופים' : 'Urgent'}
            </span>
          </div>
        )}
        {materialShortageCount > 0 && (
          <div 
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${
              materialShortageFilter 
                ? 'bg-error/20 border-error text-error' 
                : 'bg-error/5 border-error/30 text-error hover:bg-error/10'
            }`}
            onClick={() => setMaterialShortageFilter(!materialShortageFilter)}
          >
            <Package className="w-4 h-4" />
            <span className="font-medium">{materialShortageCount}</span>
            <span className="text-sm">
              {language === 'he' ? 'חסר חומר' : 'Missing Material'}
            </span>
          </div>
        )}
        {(priorityFilter !== 'all' || materialShortageFilter) && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => {
              setPriorityFilter('all');
              setMaterialShortageFilter(false);
            }}
            className="text-muted-foreground"
          >
            {language === 'he' ? 'נקה סינונים' : 'Clear filters'}
          </Button>
        )}
      </div>

      {/* Projects Table */}
      <Card variant="elevated">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            {language === 'he' ? 'רשימת פרויקטים' : 'Projects List'}
            <Badge variant="secondary" className="ml-2">
              {filteredProjects.length}
            </Badge>
          </CardTitle>
          
          {/* Filter summary */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="w-4 h-4" />
            {Object.entries(statusFilters)
              .filter(([_, active]) => active)
              .map(([status]) => language === 'he' ? statusConfig[status as ProjectStatus].label : statusConfig[status as ProjectStatus].labelEn)
              .join(', ') || (language === 'he' ? 'ללא סינון' : 'No filter')}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'he' ? 'שם הפרויקט' : 'Project Name'}</TableHead>
                  <TableHead>{language === 'he' ? 'מוצר' : 'Product'}</TableHead>
                  <TableHead>{language === 'he' ? 'חומר' : 'Material'}</TableHead>
                  <TableHead>{language === 'he' ? 'התקדמות' : 'Progress'}</TableHead>
                  <TableHead>{language === 'he' ? 'הדפסה מתוכננת' : 'Planned Print'}</TableHead>
                  <TableHead>{language === 'he' ? 'תאריך יעד' : 'Due Date'}</TableHead>
                  <TableHead>{language === 'he' ? 'מצב' : 'Status'}</TableHead>
                  <TableHead>{language === 'he' ? 'דחיפות' : 'Priority'}</TableHead>
                  <TableHead>{language === 'he' ? 'בלוח עבודה' : 'In Schedule'}</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.map((project) => (
                  <TableRow 
                    key={project.id} 
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isOverdue(project) && (
                          <AlertTriangle className="w-4 h-4 text-error" />
                        )}
                        <div>
                          <div className="font-medium">{project.name}</div>
                          <div className="text-xs text-muted-foreground">{project.color}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{project.productName}</TableCell>
                    <TableCell>
                      {project.status !== 'completed' ? getMaterialStatusBadge(project.id) : (
                        <Badge variant="outline" className="bg-muted text-muted-foreground">
                          {language === 'he' ? 'הושלם' : 'Done'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>
                            {project.quantityGood} / {project.quantityTarget}
                          </span>
                          <span className="text-muted-foreground">
                            {calculateProgress(project)}%
                          </span>
                        </div>
                        <Progress value={calculateProgress(project)} className="h-2" />
                        {project.quantityScrap > 0 && (
                          <div className="text-xs text-error">
                            {language === 'he' ? 'פסולת:' : 'Scrap:'} {project.quantityScrap}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const plannedDate = getPlannedPrintDate(project.id);
                        if (plannedDate) {
                          return (
                            <div className="flex items-center gap-2 text-primary">
                              <Printer className="w-4 h-4" />
                              <span className="font-medium">
                                {format(parseISO(plannedDate), 'dd/MM/yyyy')}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <span className="text-muted-foreground text-sm">
                            {language === 'he' ? 'לא מתוכנן' : 'Not scheduled'}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className={isOverdue(project) ? 'text-error font-medium' : ''}>
                          {format(new Date(project.dueDate), 'dd/MM/yyyy')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(project.status)}</TableCell>
                    <TableCell>{getPriorityWithDays(project)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={project.includeInPlanning !== false}
                        onCheckedChange={(checked) => {
                          updateProject(project.id, { includeInPlanning: checked });
                          refreshData();
                          toast({
                            title: checked 
                              ? (language === 'he' ? 'הפרויקט שולב בלוח העבודה' : 'Project added to schedule')
                              : (language === 'he' ? 'הפרויקט הוסר מלוח העבודה' : 'Project removed from schedule'),
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-background border shadow-lg">
                          {/* Force Complete option - only for non-completed projects */}
                          {project.status !== 'completed' && (
                            <DropdownMenuItem onClick={() => handleForceComplete(project)}>
                              <CheckCircle className="w-4 h-4 mr-2 text-success" />
                              {language === 'he' ? 'סיים פרויקט' : 'Complete Project'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleReportIssue(project.id)}>
                            <AlertTriangle className="w-4 h-4 mr-2 text-warning" />
                            {language === 'he' ? 'דווח על בעיה' : 'Report Issue'}
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDeleteProject(project)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {language === 'he' ? 'מחק פרויקט' : 'Delete Project'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {filteredProjects.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <FolderKanban className="w-12 h-12 mx-auto mb-4 opacity-50" />
              {hasActiveStatusFilter ? (
                <>
                  <p>{language === 'he' ? 'אין פרויקטים התואמים לסינון' : 'No projects match the filter'}</p>
                  <Button 
                    variant="link" 
                    onClick={() => setStatusFilters({ pending: true, in_progress: true, on_hold: true, completed: true })}
                    className="mt-2"
                  >
                    {language === 'he' ? 'הצג את כל הפרויקטים' : 'Show all projects'}
                  </Button>
                </>
              ) : (
                <>
                  <p>{language === 'he' ? 'אין פרויקטים עדיין' : 'No projects yet'}</p>
                  <p className="text-sm mt-1">
                    {language === 'he' ? 'לחצו על "פרויקט חדש" כדי להתחיל' : 'Click "New Project" to get started'}
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'he' ? 'מחיקת פרויקט' : 'Delete Project'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'he' 
                ? `האם אתה בטוח שברצונך למחוק את "${projectToDelete?.name}"?` 
                : `Are you sure you want to delete "${projectToDelete?.name}"?`}
              <br />
              <span className="text-destructive">
                {language === 'he' ? 'פעולה זו לא ניתנת לביטול.' : 'This action cannot be undone.'}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteProject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {language === 'he' ? 'מחק' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Force Complete Confirmation Dialog */}
      <AlertDialog open={forceCompleteDialogOpen} onOpenChange={setForceCompleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'he' ? 'סיום פרויקט מוקדם' : 'Complete Project Early'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {language === 'he' 
                    ? `האם אתה בטוח שברצונך לסיים את "${projectToComplete?.name}"?` 
                    : `Are you sure you want to complete "${projectToComplete?.name}"?`}
                </p>
                
                {projectToComplete && (
                  <div className="bg-muted p-3 rounded-lg space-y-1 text-sm">
                    <p>
                      <strong>{language === 'he' ? 'יעד:' : 'Target:'}</strong> {projectToComplete.quantityTarget}
                    </p>
                    <p>
                      <strong>{language === 'he' ? 'בפועל:' : 'Actual:'}</strong> {projectToComplete.quantityGood}
                    </p>
                    {projectToComplete.quantityTarget > projectToComplete.quantityGood && (
                      <p className="text-warning">
                        {language === 'he' 
                          ? `חסרות ${projectToComplete.quantityTarget - projectToComplete.quantityGood} יחידות`
                          : `Missing ${projectToComplete.quantityTarget - projectToComplete.quantityGood} units`}
                      </p>
                    )}
                  </div>
                )}

                {/* Warning if there's an active print */}
                {hasActivePrint && (
                  <div className="bg-destructive/10 border border-destructive p-3 rounded-lg">
                    <div className="flex items-center gap-2 text-destructive font-medium mb-2">
                      <AlertTriangle className="w-5 h-5" />
                      {language === 'he' ? 'יש הדפסה פעילה!' : 'Active Print Running!'}
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {language === 'he' 
                        ? 'יש מחזור שרץ כרגע על מדפסת. וודא שהמדפסת לא באמצע הדפסה לפני שממשיך.'
                        : 'A cycle is currently in progress. Make sure the printer is not mid-print before continuing.'}
                    </p>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox 
                        checked={confirmNoActivePrint}
                        onCheckedChange={(checked) => setConfirmNoActivePrint(!!checked)}
                      />
                      <span className="text-sm">
                        {language === 'he' 
                          ? 'אני מאשר שאין הדפסה רצה כרגע'
                          : 'I confirm no print is currently running'}
                      </span>
                    </label>
                  </div>
                )}

                <p className="text-warning font-medium">
                  {language === 'he' 
                    ? 'כל ההדפסות המתוכננות יבוטלו והמדפסות יתפנו.'
                    : 'All planned prints will be cancelled and printers freed.'}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmForceComplete}
              disabled={hasActivePrint && !confirmNoActivePrint}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {language === 'he' ? 'סיים פרויקט' : 'Complete Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Report Issue Modal */}
      <ReportIssueFlow
        isOpen={reportIssueOpen}
        onClose={() => {
          setReportIssueOpen(false);
          setReportIssueProjectId(undefined);
        }}
        preselectedProjectId={reportIssueProjectId}
      />

      {/* Assignment Choice Modal */}
      <AssignmentChoiceModal
        open={assignmentChoiceOpen}
        onOpenChange={setAssignmentChoiceOpen}
        project={createdProject}
        onManualAssignment={handleManualAssignment}
        onAutomaticAssignment={handleAutomaticAssignment}
      />

      {/* Manual Start Modal */}
      <ManualStartPrintModal
        open={manualStartOpen}
        onOpenChange={(open) => {
          setManualStartOpen(open);
          if (!open) {
            setCreatedProject(null);
          }
        }}
        onComplete={() => {
          setManualStartOpen(false);
          setCreatedProject(null);
          refreshData();
          toast({
            title: language === 'he' ? 'הדפסה התחילה' : 'Print Started',
            description: language === 'he' ? 'המחזור הידני נוסף בהצלחה' : 'Manual cycle added successfully',
          });
        }}
        defaultProjectId={createdProject?.id}
      />

      {/* Deadline Warning Modal */}
      {planningIssues && (
        <DeadlineWarningModal
          open={deadlineWarningOpen}
          onClose={() => {
            setDeadlineWarningOpen(false);
            setPlanningIssues(null);
          }}
          blockingIssues={planningIssues.blockingIssues}
          warnings={planningIssues.warnings}
          newProjectId={planningIssues.newProjectId}
          newProjectName={planningIssues.newProjectName}
        />
      )}
    </div>
  );
};
