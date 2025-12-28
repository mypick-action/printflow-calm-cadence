import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Clock, 
  Calendar, 
  Printer, 
  Package, 
  AlertTriangle, 
  Moon,
  Link,
  Palette
} from 'lucide-react';
import { CycleWithDetails } from '@/services/weeklyPlanningService';
import { format } from 'date-fns';

interface CycleDetailsModalProps {
  cycle: CycleWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateToProject?: (projectId: string) => void;
}

export const CycleDetailsModal: React.FC<CycleDetailsModalProps> = ({
  cycle,
  open,
  onOpenChange,
  onNavigateToProject,
}) => {
  const { language } = useLanguage();

  if (!cycle) return null;

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'HH:mm');
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'dd/MM/yyyy');
  };

  const statusLabels: Record<string, { he: string; en: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    planned: { he: 'מתוכנן', en: 'Planned', variant: 'outline' },
    in_progress: { he: 'בביצוע', en: 'In Progress', variant: 'default' },
    completed: { he: 'הושלם', en: 'Completed', variant: 'secondary' },
    failed: { he: 'נכשל', en: 'Failed', variant: 'destructive' },
  };

  const status = statusLabels[cycle.status] || statusLabels.planned;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            {language === 'he' ? 'פרטי מחזור' : 'Cycle Details'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Project name with color */}
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            {cycle.color && (
              <div 
                className="w-4 h-4 rounded-full border border-border"
                style={{ backgroundColor: cycle.color }}
              />
            )}
            <div className="flex-1">
              <p className="font-medium">{cycle.projectName}</p>
              <p className="text-sm text-muted-foreground">{cycle.printerName}</p>
            </div>
            <Badge variant={status.variant}>
              {language === 'he' ? status.he : status.en}
            </Badge>
          </div>

          {/* Risk badges */}
          {(cycle.risk.crossesDeadline || cycle.risk.requiresOvernight || cycle.risk.isRecovery) && (
            <div className="flex flex-wrap gap-2">
              {cycle.risk.crossesDeadline && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {language === 'he' ? 'חוצה דדליין' : 'Crosses Deadline'}
                </Badge>
              )}
              {cycle.risk.requiresOvernight && (
                <Badge variant="secondary" className="gap-1 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                  <Moon className="w-3 h-3" />
                  {language === 'he' ? 'דורש לילה' : 'Overnight'}
                </Badge>
              )}
              {cycle.risk.isRecovery && (
                <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
                  {language === 'he' ? 'השלמה' : 'Recovery'}
                </Badge>
              )}
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>{language === 'he' ? 'תאריך' : 'Date'}</span>
            </div>
            <div className="font-medium">{formatDate(cycle.startTime)}</div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>{language === 'he' ? 'שעות' : 'Time'}</span>
            </div>
            <div className="font-medium">
              {formatTime(cycle.startTime)} - {formatTime(cycle.endTime)}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <Package className="w-4 h-4" />
              <span>{language === 'he' ? 'יחידות' : 'Units'}</span>
            </div>
            <div className="font-medium">{cycle.unitsPlanned}</div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <Printer className="w-4 h-4" />
              <span>{language === 'he' ? 'סוג פלטה' : 'Plate Type'}</span>
            </div>
            <div className="font-medium capitalize">{cycle.plateType}</div>

            {cycle.color && (
              <>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Palette className="w-4 h-4" />
                  <span>{language === 'he' ? 'צבע' : 'Color'}</span>
                </div>
                <div className="flex items-center gap-2 font-medium">
                  <div 
                    className="w-3 h-3 rounded-full border border-border"
                    style={{ backgroundColor: cycle.color }}
                  />
                  {cycle.color}
                </div>
              </>
            )}

            {cycle.risk.projectDueDate && (
              <>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{language === 'he' ? 'דדליין' : 'Deadline'}</span>
                </div>
                <div className={`font-medium ${cycle.risk.crossesDeadline ? 'text-destructive' : ''}`}>
                  {formatDate(cycle.risk.projectDueDate)}
                </div>
              </>
            )}
          </div>

          {/* Link to project */}
          {onNavigateToProject && (
            <Button 
              variant="outline" 
              className="w-full gap-2"
              onClick={() => {
                onNavigateToProject(cycle.projectId);
                onOpenChange(false);
              }}
            >
              <Link className="w-4 h-4" />
              {language === 'he' ? 'עבור לפרויקט' : 'Go to Project'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
