import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import { Plus, FolderKanban, Calendar, Package, AlertTriangle, Pencil, ChevronDown, PackagePlus, MoreHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import { 
  getProjects, 
  getProducts, 
  createProject,
  Project, 
  Product,
  calculatePriorityFromDueDate,
  calculateDaysRemaining,
} from '@/services/storage';
import { ReportIssueFlow } from '@/components/report-issue/ReportIssueFlow';
import { ProductEditorModal } from '@/components/products/ProductEditorModal';

const availableColors = ['Black', 'White', 'Gray', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink'];

export const ProjectsPage: React.FC = () => {
  const { language } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manualOverrideOpen, setManualOverrideOpen] = useState(false);
  const [productSearchText, setProductSearchText] = useState('');
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [reportIssueProjectId, setReportIssueProjectId] = useState<string | undefined>(undefined);
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [productEditorInitialName, setProductEditorInitialName] = useState('');
  const [newProject, setNewProject] = useState({
    name: '',
    productId: '',
    preferredPresetId: '', // optional preset override
    quantityTarget: 100,
    dueDate: '',
    color: 'Black',
    manualUrgency: null as 'normal' | 'urgent' | 'critical' | null,
  });

  const handleReportIssue = (projectId: string) => {
    setReportIssueProjectId(projectId);
    setReportIssueOpen(true);
  };

  useEffect(() => {
    setProjects(getProjects());
    setProducts(getProducts());
  }, []);

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
    
    createProject({
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
      color: 'Black',
      manualUrgency: null,
    });
    setProductSearchText('');
  };

  const handleOpenProductEditor = () => {
    // Pre-fill with search text if user typed something
    setProductEditorInitialName(productSearchText);
    setProductEditorOpen(true);
  };

  const handleProductCreated = (product: Product) => {
    // Refresh products
    setProducts(getProducts());
    
    // Auto-select the newly created product
    setNewProject({ 
      ...newProject, 
      productId: product.id,
      // Auto-select the recommended preset
      preferredPresetId: product.platePresets.find(p => p.isRecommended)?.id || product.platePresets[0]?.id || '',
    });
    
    setProductSearchText('');
  };

  const getStatusBadge = (status: Project['status']) => {
    const statusConfig = {
      pending: { 
        label: language === 'he' ? 'ממתין' : 'Pending', 
        variant: 'secondary' as const 
      },
      in_progress: { 
        label: language === 'he' ? 'בתהליך' : 'In Progress', 
        variant: 'default' as const 
      },
      completed: { 
        label: language === 'he' ? 'הושלם' : 'Completed', 
        variant: 'outline' as const 
      },
      on_hold: { 
        label: language === 'he' ? 'מושהה' : 'On Hold', 
        variant: 'destructive' as const 
      },
    };
    const config = statusConfig[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getUrgencyBadge = (urgency: Project['urgency'], isManual?: boolean) => {
    const urgencyConfig = {
      normal: { 
        label: language === 'he' ? 'רגיל' : 'Normal', 
        className: 'bg-success/10 text-success border-success/20' 
      },
      urgent: { 
        label: language === 'he' ? 'דחוף' : 'Urgent', 
        className: 'bg-warning/10 text-warning border-warning/20' 
      },
      critical: { 
        label: language === 'he' ? 'קריטי' : 'Critical', 
        className: 'bg-error/10 text-error border-error/20' 
      },
    };
    const config = urgencyConfig[urgency];
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className={config.className}>{config.label}</Badge>
        {isManual && (
          <Pencil className="w-3 h-3 text-muted-foreground" />
        )}
      </div>
    );
  };

  const getUrgencyBadgeWithDays = (project: Project) => {
    const days = calculateDaysRemaining(project.dueDate);
    const urgencyConfig = {
      normal: { 
        label: language === 'he' ? 'רגיל' : 'Normal', 
        className: 'bg-success/10 text-success border-success/20' 
      },
      urgent: { 
        label: language === 'he' ? 'דחוף' : 'Urgent', 
        className: 'bg-warning/10 text-warning border-warning/20' 
      },
      critical: { 
        label: language === 'he' ? 'קריטי' : 'Critical', 
        className: 'bg-error/10 text-error border-error/20' 
      },
    };
    const config = urgencyConfig[project.urgency];
    const daysText = days < 0 
      ? (language === 'he' ? `${Math.abs(days)}- ימים` : `${Math.abs(days)}d late`)
      : (language === 'he' ? `${days} ימים` : `${days}d`);
    
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-1">
          <Badge variant="outline" className={config.className}>
            {config.label}
          </Badge>
          {project.urgencyManualOverride && (
            <span title={language === 'he' ? 'עדיפות ידנית' : 'Manual priority'}>
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </span>
          )}
        </div>
        <span className={`text-xs ${days < 0 ? 'text-error' : 'text-muted-foreground'}`}>
          ({daysText})
        </span>
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
                    {/* Search/filter input */}
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
                    {/* Filtered products */}
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
                    {/* Add new product option */}
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
              
              {/* Product Editor Modal */}
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
                    manualUrgency: null // Reset manual override when date changes
                  })}
                />
              </div>
              
              {/* Auto-calculated Priority Display */}
              {newProject.dueDate && (
                <div className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {language === 'he' ? 'עדיפות:' : 'Priority:'}
                    </span>
                    <div className="flex items-center gap-2">
                      {effectivePriority && getUrgencyBadge(effectivePriority, newProject.manualUrgency !== null)}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {getDaysRemainingText()}
                  </div>
                  
                  {/* Manual Override Section */}
                  <Collapsible open={manualOverrideOpen} onOpenChange={setManualOverrideOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-between text-xs h-8 mt-1">
                        <span className="flex items-center gap-1">
                          <Pencil className="w-3 h-3" />
                          {language === 'he' ? 'שנה עדיפות ידנית' : 'Change priority manually'}
                        </span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${manualOverrideOpen ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <div className="flex gap-2">
                        {(['normal', 'urgent', 'critical'] as const).map((urgency) => {
                          const isSelected = newProject.manualUrgency === urgency;
                          const urgencyLabels = {
                            normal: language === 'he' ? 'רגיל' : 'Normal',
                            urgent: language === 'he' ? 'דחוף' : 'Urgent',
                            critical: language === 'he' ? 'קריטי' : 'Critical',
                          };
                          const urgencyColors = {
                            normal: isSelected ? 'bg-success text-success-foreground' : 'bg-success/10 text-success border-success/30',
                            urgent: isSelected ? 'bg-warning text-warning-foreground' : 'bg-warning/10 text-warning border-warning/30',
                            critical: isSelected ? 'bg-error text-error-foreground' : 'bg-error/10 text-error border-error/30',
                          };
                          return (
                            <Button
                              key={urgency}
                              variant="outline"
                              size="sm"
                              onClick={() => setNewProject({ 
                                ...newProject, 
                                manualUrgency: isSelected ? null : urgency 
                              })}
                              className={`flex-1 ${urgencyColors[urgency]}`}
                            >
                              {urgencyLabels[urgency]}
                            </Button>
                          );
                        })}
                      </div>
                      {newProject.manualUrgency && (
                        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                          <Pencil className="w-3 h-3" />
                          {language === 'he' ? 'עדיפות ידנית - תסומן בפרויקט' : 'Manual priority - will be marked'}
                        </p>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
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

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="glass">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-foreground">{projects.length}</div>
            <div className="text-sm text-muted-foreground">
              {language === 'he' ? 'סה"כ פרויקטים' : 'Total Projects'}
            </div>
          </CardContent>
        </Card>
        <Card variant="glass">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-primary">
              {projects.filter(p => p.status === 'in_progress').length}
            </div>
            <div className="text-sm text-muted-foreground">
              {language === 'he' ? 'בתהליך' : 'In Progress'}
            </div>
          </CardContent>
        </Card>
        <Card variant="glass">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-success">
              {projects.filter(p => p.status === 'completed').length}
            </div>
            <div className="text-sm text-muted-foreground">
              {language === 'he' ? 'הושלמו' : 'Completed'}
            </div>
          </CardContent>
        </Card>
        <Card variant="glass">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-warning">
              {projects.filter(p => p.urgency !== 'normal' && p.status !== 'completed').length}
            </div>
            <div className="text-sm text-muted-foreground">
              {language === 'he' ? 'דחופים' : 'Urgent'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Projects Table */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            {language === 'he' ? 'רשימת פרויקטים' : 'Projects List'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'he' ? 'שם הפרויקט' : 'Project Name'}</TableHead>
                  <TableHead>{language === 'he' ? 'מוצר' : 'Product'}</TableHead>
                  <TableHead>{language === 'he' ? 'התקדמות' : 'Progress'}</TableHead>
                  <TableHead>{language === 'he' ? 'תאריך יעד' : 'Due Date'}</TableHead>
                  <TableHead>{language === 'he' ? 'עדיפות' : 'Priority'}</TableHead>
                  <TableHead>{language === 'he' ? 'סטטוס' : 'Status'}</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id} className="cursor-pointer hover:bg-accent/50">
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
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className={isOverdue(project) ? 'text-error font-medium' : ''}>
                          {format(new Date(project.dueDate), 'dd/MM/yyyy')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{getUrgencyBadgeWithDays(project)}</TableCell>
                    <TableCell>{getStatusBadge(project.status)}</TableCell>
                    <TableCell>
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
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {projects.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <FolderKanban className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{language === 'he' ? 'אין פרויקטים עדיין' : 'No projects yet'}</p>
              <p className="text-sm mt-1">
                {language === 'he' ? 'לחצו על "פרויקט חדש" כדי להתחיל' : 'Click "New Project" to get started'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Report Issue Modal - Contextual Entry */}
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
