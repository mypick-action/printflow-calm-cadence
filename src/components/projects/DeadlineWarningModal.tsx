// DeadlineWarningModal - Shows planning issues immediately after project creation
// Uses Planning Engine as single source of truth

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertTriangle, 
  Clock, 
  Package,
  Settings,
  ArrowRight,
} from 'lucide-react';
import { BlockingIssue, PlanningWarning } from '@/services/planningEngine';
import { format } from 'date-fns';

interface DeadlineWarningModalProps {
  open: boolean;
  onClose: () => void;
  blockingIssues: BlockingIssue[];
  warnings: PlanningWarning[];
  newProjectId?: string;
  newProjectName?: string;
}

export const DeadlineWarningModal: React.FC<DeadlineWarningModalProps> = ({
  open,
  onClose,
  blockingIssues,
  warnings,
  newProjectId,
  newProjectName,
}) => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  // Filter to deadline and material issues
  const deadlineIssues = blockingIssues.filter(i => i.type === 'deadline_impossible');
  const materialIssues = blockingIssues.filter(i => i.type === 'insufficient_material');
  const otherIssues = blockingIssues.filter(i => 
    i.type !== 'deadline_impossible' && i.type !== 'insufficient_material'
  );

  // Check if the new project is in the issues
  const newProjectAtRisk = deadlineIssues.some(i => i.projectId === newProjectId);

  const handleNavigateToSettings = () => {
    onClose();
    navigate('/settings');
  };

  const handleNavigateToProjects = () => {
    onClose();
    navigate('/projects');
  };

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="w-6 h-6" />
            {language === 'he' ? 'אזהרת קיבולת!' : 'Capacity Warning!'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              {/* New project status */}
              {newProjectName && (
                <Card className={`border ${
                  newProjectAtRisk 
                    ? 'bg-destructive/10 border-destructive/30' 
                    : 'bg-success/10 border-success/30'
                }`}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      {newProjectAtRisk ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {language === 'he' ? 'בסיכון' : 'At Risk'}
                        </Badge>
                      ) : (
                        <Badge className="bg-success/20 text-success gap-1">
                          {language === 'he' ? 'יעמוד בזמנים' : 'On Track'}
                        </Badge>
                      )}
                      <span className="font-medium">{newProjectName}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Context message */}
              {!newProjectAtRisk && blockingIssues.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {language === 'he' 
                    ? 'המערכת כבר הייתה במצב עומס; הפרויקט החדש לא בהכרח גרם לזה.'
                    : 'The system was already at capacity; the new project may not be the cause.'}
                </p>
              )}

              {/* Deadline issues */}
              {deadlineIssues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4 text-destructive" />
                    {language === 'he' 
                      ? `${deadlineIssues.length} פרויקטים לא יעמדו בזמנים:` 
                      : `${deadlineIssues.length} projects won't meet deadlines:`}
                  </h4>
                  <ScrollArea className="max-h-36">
                    <div className="space-y-2">
                      {deadlineIssues.map((issue, idx) => (
                        <Card key={idx} className="bg-destructive/5 border-destructive/20">
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="font-medium text-sm">
                                  {language === 'he' ? issue.message : issue.messageEn}
                                </div>
                                {issue.details && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {language === 'he' 
                                      ? `נדרשות: ${issue.details.required?.toFixed(1)}h | זמינות: ${issue.details.available?.toFixed(1)}h | חסרות: ${issue.details.shortfall?.toFixed(1)}h`
                                      : `Required: ${issue.details.required?.toFixed(1)}h | Available: ${issue.details.available?.toFixed(1)}h | Short: ${issue.details.shortfall?.toFixed(1)}h`}
                                  </div>
                                )}
                              </div>
                              {issue.projectId === newProjectId && (
                                <Badge variant="outline" className="text-xs">
                                  {language === 'he' ? 'חדש' : 'New'}
                                </Badge>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Material issues */}
              {materialIssues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Package className="w-4 h-4 text-warning" />
                    {language === 'he' ? 'חסר חומר:' : 'Material shortage:'}
                  </h4>
                  <div className="space-y-1">
                    {materialIssues.map((issue, idx) => (
                      <div key={idx} className="text-sm p-2 rounded bg-warning/10 border border-warning/20">
                        {language === 'he' ? issue.message : issue.messageEn}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-sm font-medium mb-2">
                  {language === 'he' ? 'מה אפשר לעשות:' : 'What you can do:'}
                </div>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <ArrowRight className="w-3 h-3" />
                    {language === 'he' ? 'הרחב שעות עבודה / ימי עבודה' : 'Extend work hours / workdays'}
                  </li>
                  <li className="flex items-center gap-2">
                    <ArrowRight className="w-3 h-3" />
                    {language === 'he' ? 'הוסף מדפסות' : 'Add printers'}
                  </li>
                  <li className="flex items-center gap-2">
                    <ArrowRight className="w-3 h-3" />
                    {language === 'he' ? 'דחה תאריכי יעד' : 'Push deadlines'}
                  </li>
                  <li className="flex items-center gap-2">
                    <ArrowRight className="w-3 h-3" />
                    {language === 'he' ? 'צמצם כמויות' : 'Reduce quantities'}
                  </li>
                </ul>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleNavigateToSettings} className="gap-2">
            <Settings className="w-4 h-4" />
            {language === 'he' ? 'הגדרות' : 'Settings'}
          </Button>
          <AlertDialogAction onClick={onClose}>
            {language === 'he' ? 'הבנתי' : 'Got it'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
