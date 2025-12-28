import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  LayoutDashboard, 
  Package, 
  AlertTriangle, 
  Moon,
  Calendar,
  Clock,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { 
  computeWeeklyStats, 
  computeProjectCoverage,
  ProjectCoverage,
  WeeklyStats
} from '@/services/weeklyPlanningService';
import { format, formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';

interface OperationalDashboardProps {
  onNavigateToProject?: (projectId: string) => void;
  onNavigateToWeekly?: () => void;
}

export const OperationalDashboard: React.FC<OperationalDashboardProps> = ({
  onNavigateToProject,
  onNavigateToWeekly,
}) => {
  const { language } = useLanguage();
  const [stats, setStats] = useState<WeeklyStats>(() => computeWeeklyStats());
  const [coverage, setCoverage] = useState<ProjectCoverage[]>(() => computeProjectCoverage());

  const refreshData = () => {
    setStats(computeWeeklyStats());
    setCoverage(computeProjectCoverage());
  };

  const atRiskProjects = coverage.filter(c => c.status === 'at_risk' || c.status === 'unscheduled');

  const getStatusBadge = (status: ProjectCoverage['status']) => {
    switch (status) {
      case 'on_track':
        return (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-300">
            <CheckCircle className="w-3 h-3" />
            {language === 'he' ? 'במסלול' : 'On Track'}
          </Badge>
        );
      case 'at_risk':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="w-3 h-3" />
            {language === 'he' ? 'בסיכון' : 'At Risk'}
          </Badge>
        );
      case 'unscheduled':
        return (
          <Badge variant="secondary" className="gap-1">
            <XCircle className="w-3 h-3" />
            {language === 'he' ? 'לא מתוכנן' : 'Unscheduled'}
          </Badge>
        );
    }
  };

  const formatReplanTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return formatDistanceToNow(date, { 
        addSuffix: true,
        locale: language === 'he' ? he : undefined 
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">
              {language === 'he' ? 'לוח בקרה תפעולי' : 'Operational Dashboard'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {language === 'he' ? 'סקירה שבועית' : 'Weekly Overview'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refreshData}>
          <RefreshCw className="w-4 h-4 me-2" />
          {language === 'he' ? 'רענן' : 'Refresh'}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {/* This Week Output */}
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="w-4 h-4" />
              {language === 'he' ? 'תפוקה השבוע' : 'This Week Output'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-4">
              <div>
                <span className="text-3xl font-bold">{stats.totalCycles}</span>
                <span className="text-muted-foreground text-sm ms-1">
                  {language === 'he' ? 'מחזורים' : 'cycles'}
                </span>
              </div>
              <div>
                <span className="text-2xl font-semibold text-muted-foreground">{stats.totalUnits}</span>
                <span className="text-muted-foreground text-sm ms-1">
                  {language === 'he' ? 'יחידות' : 'units'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* At Risk */}
        <Card className={stats.atRiskProjects > 0 ? 'border-destructive/50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {language === 'he' ? 'בסיכון' : 'At Risk'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{stats.atRiskProjects}</div>
            <div className="text-xs text-muted-foreground">
              {language === 'he' ? 'פרויקטים' : 'projects'}
            </div>
          </CardContent>
        </Card>

        {/* Crossing Deadline */}
        <Card className={stats.cyclesCrossingDeadline > 0 ? 'border-red-500/50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {language === 'he' ? 'חוצים דדליין' : 'Cross Deadline'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${stats.cyclesCrossingDeadline > 0 ? 'text-red-500' : ''}`}>
              {stats.cyclesCrossingDeadline}
            </div>
            <div className="text-xs text-muted-foreground">
              {language === 'he' ? 'מחזורים' : 'cycles'}
            </div>
          </CardContent>
        </Card>

        {/* Overnight */}
        <Card className={stats.overnightCycles > 0 ? 'border-purple-500/50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Moon className="w-4 h-4" />
              {language === 'he' ? 'לילה' : 'Overnight'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${stats.overnightCycles > 0 ? 'text-purple-500' : ''}`}>
              {stats.overnightCycles}
            </div>
            <div className="text-xs text-muted-foreground">
              {language === 'he' ? 'מחזורים' : 'cycles'}
            </div>
          </CardContent>
        </Card>

        {/* Unscheduled */}
        <Card className={stats.unscheduledProjects > 0 ? 'border-amber-500/50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="w-4 h-4" />
              {language === 'he' ? 'לא מתוכננים' : 'Unscheduled'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${stats.unscheduledProjects > 0 ? 'text-amber-500' : ''}`}>
              {stats.unscheduledProjects}
            </div>
            <div className="text-xs text-muted-foreground">
              {language === 'he' ? 'פרויקטים' : 'projects'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last Replan Info */}
      {stats.lastReplan && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {language === 'he' ? 'תכנון מחדש אחרון' : 'Last Replan'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">{language === 'he' ? 'זמן: ' : 'Time: '}</span>
                <span className="font-medium">{formatReplanTime(stats.lastReplan.timestamp)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">{language === 'he' ? 'שינוי: ' : 'Change: '}</span>
                {stats.lastReplan.cyclesChanged >= 0 ? (
                  <span className="font-medium text-green-600 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    +{stats.lastReplan.cyclesChanged}
                  </span>
                ) : (
                  <span className="font-medium text-red-600 flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    {stats.lastReplan.cyclesChanged}
                  </span>
                )}
                <span className="text-muted-foreground ms-1">
                  {language === 'he' ? 'מחזורים' : 'cycles'}
                </span>
              </div>
              {stats.lastReplan.warnings > 0 && (
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  <span className="font-medium text-amber-600">{stats.lastReplan.warnings}</span>
                  <span className="text-muted-foreground">
                    {language === 'he' ? 'אזהרות' : 'warnings'}
                  </span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">{language === 'he' ? 'משך: ' : 'Duration: '}</span>
                <span className="font-medium">{stats.lastReplan.durationMs}ms</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* At Risk Projects Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            {language === 'he' ? 'פרויקטים בסיכון' : 'At Risk Projects'}
            {atRiskProjects.length > 0 && (
              <Badge variant="destructive">{atRiskProjects.length}</Badge>
            )}
          </CardTitle>
          {onNavigateToWeekly && (
            <Button variant="outline" size="sm" onClick={onNavigateToWeekly}>
              <Calendar className="w-4 h-4 me-2" />
              {language === 'he' ? 'תכנון שבועי' : 'Weekly View'}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {atRiskProjects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
              <p>{language === 'he' ? 'כל הפרויקטים במסלול!' : 'All projects on track!'}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'he' ? 'פרויקט' : 'Project'}</TableHead>
                  <TableHead>{language === 'he' ? 'סטטוס' : 'Status'}</TableHead>
                  <TableHead>{language === 'he' ? 'יעד' : 'Target'}</TableHead>
                  <TableHead>{language === 'he' ? 'התקדמות' : 'Progress'}</TableHead>
                  <TableHead>{language === 'he' ? 'מתוכנן' : 'Planned'}</TableHead>
                  <TableHead>{language === 'he' ? 'פער' : 'Gap'}</TableHead>
                  <TableHead>{language === 'he' ? 'דדליין' : 'Deadline'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {atRiskProjects.map(project => {
                  const progress = project.quantityTarget > 0 
                    ? Math.round((project.quantityGood / project.quantityTarget) * 100) 
                    : 0;
                  
                  return (
                    <TableRow 
                      key={project.projectId}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onNavigateToProject?.(project.projectId)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {project.color && (
                            <div 
                              className="w-3 h-3 rounded-full border border-border"
                              style={{ backgroundColor: project.color }}
                            />
                          )}
                          <div>
                            <div className="font-medium">{project.projectName}</div>
                            <div className="text-xs text-muted-foreground">{project.productName}</div>
                          </div>
                          {project.isRecovery && (
                            <Badge variant="outline" className="text-xs">
                              {language === 'he' ? 'השלמה' : 'Recovery'}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(project.status)}</TableCell>
                      <TableCell>{project.quantityTarget}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={progress} className="w-16 h-2" />
                          <span className="text-xs">{project.quantityGood}/{project.quantityTarget}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={project.plannedUnits > 0 ? 'text-green-600' : 'text-muted-foreground'}>
                          {project.plannedUnits}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={project.uncoveredUnits > 0 ? 'text-destructive font-medium' : ''}>
                          {project.uncoveredUnits > 0 ? `-${project.uncoveredUnits}` : '0'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {format(new Date(project.dueDate), 'dd/MM')}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* All Projects Coverage (collapsed by default, showing summary) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            {language === 'he' ? 'כיסוי פרויקטים' : 'Project Coverage'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {coverage.filter(c => c.status === 'on_track').length}
              </div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'במסלול' : 'On Track'}
              </div>
            </div>
            <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {coverage.filter(c => c.status === 'at_risk').length}
              </div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'בסיכון' : 'At Risk'}
              </div>
            </div>
            <div className="p-4 bg-amber-50 dark:bg-amber-950 rounded-lg">
              <div className="text-2xl font-bold text-amber-600">
                {coverage.filter(c => c.status === 'unscheduled').length}
              </div>
              <div className="text-sm text-muted-foreground">
                {language === 'he' ? 'לא מתוכננים' : 'Unscheduled'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
