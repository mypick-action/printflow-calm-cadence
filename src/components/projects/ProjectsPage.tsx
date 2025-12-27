import React, { useState } from 'react';
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

export interface Project {
  id: string;
  name: string;
  product: string;
  quantityTarget: number;
  quantityGood: number;
  quantityScrap: number;
  dueDate: Date;
  urgency: 'normal' | 'urgent' | 'critical';
  status: 'pending' | 'in_progress' | 'completed' | 'on_hold';
  color: string;
}

// Mock products for selection
const mockProducts = [
  { id: '1', name: 'Phone Stand', gramsPerUnit: 45 },
  { id: '2', name: 'Cable Organizer', gramsPerUnit: 12 },
  { id: '3', name: 'Pen Holder', gramsPerUnit: 85 },
  { id: '4', name: 'Wall Hook', gramsPerUnit: 18 },
  { id: '5', name: 'Coaster Set', gramsPerUnit: 32 },
];

// Mock initial projects
const initialProjects: Project[] = [
  {
    id: '1',
    name: 'Phone Stands - Batch A',
    product: 'Phone Stand',
    quantityTarget: 100,
    quantityGood: 65,
    quantityScrap: 3,
    dueDate: new Date('2025-01-02'),
    urgency: 'normal',
    status: 'in_progress',
    color: 'Black',
  },
  {
    id: '2',
    name: 'Cable Organizers - Client B',
    product: 'Cable Organizer',
    quantityTarget: 250,
    quantityGood: 180,
    quantityScrap: 8,
    dueDate: new Date('2024-12-30'),
    urgency: 'urgent',
    status: 'in_progress',
    color: 'White',
  },
  {
    id: '3',
    name: 'Pen Holders - Office Supply',
    product: 'Pen Holder',
    quantityTarget: 50,
    quantityGood: 50,
    quantityScrap: 2,
    dueDate: new Date('2024-12-25'),
    urgency: 'normal',
    status: 'completed',
    color: 'Gray',
  },
  {
    id: '4',
    name: 'Wall Hooks - Custom Order',
    product: 'Wall Hook',
    quantityTarget: 200,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: new Date('2025-01-15'),
    urgency: 'critical',
    status: 'pending',
    color: 'Blue',
  },
];

const availableColors = ['Black', 'White', 'Gray', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink'];

export const ProjectsPage: React.FC = () => {
  const { t, language } = useLanguage();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    product: '',
    quantityTarget: 100,
    dueDate: '',
    urgency: 'normal' as 'normal' | 'urgent' | 'critical',
    color: 'Black',
  });

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

  const handleAddProject = () => {
    if (!newProject.name || !newProject.product || !newProject.dueDate) return;
    
    const project: Project = {
      id: Date.now().toString(),
      name: newProject.name,
      product: newProject.product,
      quantityTarget: newProject.quantityTarget,
      quantityGood: 0,
      quantityScrap: 0,
      dueDate: new Date(newProject.dueDate),
      urgency: newProject.urgency,
      status: 'pending',
      color: newProject.color,
    };
    
    setProjects([...projects, project]);
    setDialogOpen(false);
    setNewProject({
      name: '',
      product: '',
      quantityTarget: 100,
      dueDate: '',
      urgency: 'normal',
      color: 'Black',
    });
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
                  value={newProject.product} 
                  onValueChange={(value) => setNewProject({ ...newProject, product: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחרו מוצר' : 'Select product'} />
                  </SelectTrigger>
                  <SelectContent>
                    {mockProducts.map((product) => (
                      <SelectItem key={product.id} value={product.name}>
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
                disabled={!newProject.name || !newProject.product || !newProject.dueDate}
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
                    <TableCell>{project.product}</TableCell>
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
