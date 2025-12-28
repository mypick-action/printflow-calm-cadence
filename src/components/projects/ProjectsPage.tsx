import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
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
  Project, 
  Product,
  calculatePriorityFromDueDate,
  calculateDaysRemaining,
  getColorInventory,
  getFactorySettings,
  getCyclesForProject,
  PlannedCycle,
} from '@/services/storage';
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

const defaultColors = ['Black', 'White', 'Gray', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink'];

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableColors, setAvailableColors] = useState<string[]>(defaultColors);
  const [manualOverrideOpen, setManualOverrideOpen] = useState(false);
  const [productSearchText, setProductSearchText] = useState('');
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [reportIssueProjectId, setReportIssueProjectId] = useState<string | undefined>(undefined);
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [productEditorInitialName, setProductEditorInitialName] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  
  // Filter state - Status filter (primary, default to in_progress only)
  const [statusFilters, setStatusFilters] = useState<Record<ProjectStatus, boolean>>({
    pending: false,
    in_progress: true, // Default ON - "What are we working on now?"
    on_hold: false,
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
    color: '', // Will be set to first available color from inventory
    manualUrgency: null as ProjectPriority | null,
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

  const confirmDeleteProject = () => {
    if (projectToDelete) {
      deleteProject(projectToDelete.id);
      setProjects(getProjects());
      toast({
        title: language === 'he' ? 'הפרויקט נמחק' : 'Project deleted',
        description: projectToDelete.name,
      });
    }
    setDeleteDialogOpen(false);
    setProjectToDelete(null);
  };

  const refreshData = () => {
    setProjects(getProjects());
    setProducts(getProducts());
    
    // Get colors from inventory and factory settings
    const inventory = getColorInventory();
    const inventoryColors = inventory.map(item => item.color);
    const settings = getFactorySettings();
    const settingsColors = settings?.colors || [];
    
    // Combine all unique colors: inventory colors + settings colors + defaults
    const allColors = new Set([...inventoryColors, ...settingsColors, ...defaultColors]);
    const colorsArray = Array.from(allColors);
    setAvailableColors(colorsArray);
    
    // Set default color to first inventory color if available
    if (inventoryColors.length > 0 && !newProject.color) {
      setNewProject(prev => ({ ...prev, color: inventoryColors[0] }));
    }
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
      // Status filter (primary)
      const statusMatch = statusFilters[project.status];
      if (!statusMatch) return false;
      
      // Priority filter (secondary)
      if (priorityFilter !== 'all' && project.urgency !== priorityFilter) {
        return false;
      }
      
      // Material shortage filter
      if (materialShortageFilter) {
        const materialStatus = projectMaterialStatuses.get(project.id);
        if (!materialStatus || materialStatus.status === 'full') {
          return false;
        }
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
    
    const createdProject = createProject({
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
    });
    
    setProjects(getProjects());
    setDialogOpen(false);
    setManualOverrideOpen(false);
    setNewProject({
      name: '',
      productId: '',
      preferredPresetId: '',
      quantityTarget: 100,
      dueDate: '',
      color: availableColors[0] || '', // Use first available color from inventory
      manualUrgency: null,
    });
    setProductSearchText('');
    
    // Validate and show detailed toast
    const validationResult = validateProjectForPlanning(createdProject);
    const summary = getValidationSummary(validationResult, language);
    
    toast({
      title: summary.title,
      description: summary.description,
      variant: summary.variant,
    });
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
        onBack={() => {
          setSelectedProjectId(null);
          // Refresh data when coming back from details
          setProjects(getProjects());
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
                  value={newProject.color} 
                  onValueChange={(value) => setNewProject({ ...newProject, color: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableColors.filter(c => c && c.trim()).map((color) => (
                      <SelectItem key={color} value={color}>
                        {color}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-background border shadow-lg">
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

      {/* Report Issue Modal */}
      <ReportIssueFlow
        isOpen={reportIssueOpen}
        onClose={() => {
          setReportIssueOpen(false);
          setReportIssueProjectId(undefined);
        }}
        preselectedProjectId={reportIssueProjectId}
      />
    </div>
  );
};
