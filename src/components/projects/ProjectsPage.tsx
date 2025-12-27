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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, FolderKanban, Calendar, Package, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { 
  getProjects, 
  getProducts, 
  createProject, 
  Project, 
  Product,
  getFactorySettings 
} from '@/services/storage';

const availableColors = ['Black', 'White', 'Gray', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink'];

export const ProjectsPage: React.FC = () => {
  const { language } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    productId: '',
    quantityTarget: 100,
    dueDate: '',
    urgency: 'normal' as 'normal' | 'urgent' | 'critical',
    color: 'Black',
  });

  useEffect(() => {
    setProjects(getProjects());
    setProducts(getProducts());
  }, []);

  const handleAddProject = () => {
    if (!newProject.name || !newProject.productId || !newProject.dueDate) return;
    
    const product = products.find(p => p.id === newProject.productId);
    if (!product) return;
    
    createProject({
      name: newProject.name,
      productId: newProject.productId,
      productName: product.name,
      quantityTarget: newProject.quantityTarget,
      dueDate: newProject.dueDate,
      urgency: newProject.urgency,
      status: 'pending',
      color: newProject.color,
    });
    
    setProjects(getProjects());
    setDialogOpen(false);
    setNewProject({
      name: '',
      productId: '',
      quantityTarget: 100,
      dueDate: '',
      urgency: 'normal',
      color: 'Black',
    });
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

  const getUrgencyBadge = (urgency: Project['urgency']) => {
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
    return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
  };

  const calculateProgress = (project: Project) => {
    return Math.round((project.quantityGood / project.quantityTarget) * 100);
  };

  const isOverdue = (project: Project) => {
    return project.status !== 'completed' && new Date(project.dueDate) < new Date();
  };

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
                  onValueChange={(value) => setNewProject({ ...newProject, productId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחרו מוצר' : 'Select product'} />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} ({product.gramsPerUnit}g)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
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
                    {availableColors.map((color) => (
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
                  onChange={(e) => setNewProject({ ...newProject, dueDate: e.target.value })}
                />
              </div>
              
              {/* Urgency */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'דחיפות' : 'Urgency'}</Label>
                <Select 
                  value={newProject.urgency} 
                  onValueChange={(value: 'normal' | 'urgent' | 'critical') => 
                    setNewProject({ ...newProject, urgency: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">
                      {language === 'he' ? 'רגיל' : 'Normal'}
                    </SelectItem>
                    <SelectItem value="urgent">
                      {language === 'he' ? 'דחוף' : 'Urgent'}
                    </SelectItem>
                    <SelectItem value="critical">
                      {language === 'he' ? 'קריטי' : 'Critical'}
                    </SelectItem>
                  </SelectContent>
                </Select>
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
                  <TableHead>{language === 'he' ? 'דחיפות' : 'Urgency'}</TableHead>
                  <TableHead>{language === 'he' ? 'סטטוס' : 'Status'}</TableHead>
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
                          {format(project.dueDate, 'dd/MM/yyyy')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{getUrgencyBadge(project.urgency)}</TableCell>
                    <TableCell>{getStatusBadge(project.status)}</TableCell>
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
    </div>
  );
};
