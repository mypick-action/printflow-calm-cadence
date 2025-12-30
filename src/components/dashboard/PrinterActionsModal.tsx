// PrinterActionsModal - Manual printer state management
// "What's the actual state of the printer?"

import React, { useState, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Clock, 
  XCircle, 
  Play,
  AlertTriangle,
  ChevronLeft,
} from 'lucide-react';
import { 
  getPlannedCycles, 
  updatePlannedCycle, 
  updatePrinter,
  getPrinter,
  getProject,
  PlannedCycle,
} from '@/services/storage';
import { scheduleAutoReplan } from '@/services/autoReplan';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

interface PrinterActionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  printerId: string;
  onComplete: () => void;
}

type ModalView = 'menu' | 'forgot_start' | 'remove_job';

export const PrinterActionsModal: React.FC<PrinterActionsModalProps> = ({
  open,
  onOpenChange,
  printerId,
  onComplete,
}) => {
  const { language } = useLanguage();
  const [view, setView] = useState<ModalView>('menu');
  const [startTime, setStartTime] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [gramsConsumed, setGramsConsumed] = useState(0);

  // Get the correct cycle for this printer:
  // 1. If there's an in_progress cycle, that's the current one
  // 2. Otherwise, get the planned cycle with earliest startTime
  const { currentCycle, printer, project } = useMemo(() => {
    const cycles = getPlannedCycles();
    const printerObj = getPrinter(printerId);
    
    // First check for in_progress
    const inProgressCycle = cycles.find(c => 
      c.printerId === printerId && c.status === 'in_progress'
    );
    
    if (inProgressCycle) {
      const proj = getProject(inProgressCycle.projectId);
      return { currentCycle: inProgressCycle, printer: printerObj, project: proj };
    }
    
    // Otherwise find earliest planned cycle
    const plannedCycles = cycles
      .filter(c => c.printerId === printerId && c.status === 'planned')
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    const cycle = plannedCycles[0] || null;
    const proj = cycle ? getProject(cycle.projectId) : undefined;
    
    return { currentCycle: cycle, printer: printerObj, project: proj };
  }, [printerId, open]);

  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setView('menu');
      setConfirmCancel(false);
      setGramsConsumed(0);
      setStartTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    }
  }, [open]);

  const handleForgotStart = () => {
    if (!currentCycle) return;
    
    const actualStart = new Date(startTime);
    const cycleHours = extractCycleHours(currentCycle);
    const end = new Date(actualStart.getTime() + cycleHours * 60 * 60 * 1000);
    
    // Update cycle with both startTime and actualStartTime
    updatePlannedCycle(currentCycle.id, {
      status: 'in_progress',
      actualStartTime: actualStart.toISOString(),
      startTime: actualStart.toISOString(),
      endTime: end.toISOString(),
    });
    
    // Update printer state
    updatePrinter(printerId, { 
      mountState: 'in_use',
      // Don't touch mountedColor - keep existing
    });
    
    scheduleAutoReplan('forgot_to_start');
    
    toast.success(
      language === 'he' ? 'המדפסת סומנה כפעילה' : 'Printer marked as active',
      { description: language === 'he' 
        ? `התחלה: ${format(actualStart, 'HH:mm')} | סיום משוער: ${format(end, 'HH:mm')}`
        : `Started: ${format(actualStart, 'HH:mm')} | Est. end: ${format(end, 'HH:mm')}`
      }
    );
    
    onComplete();
    onOpenChange(false);
  };

  const handleRemoveJob = () => {
    if (!currentCycle) return;
    
    const isInProgress = currentCycle.status === 'in_progress';
    
    // Require confirmation for in_progress cycles
    if (isInProgress && !confirmCancel) {
      return;
    }
    
    // Cancel the cycle
    updatePlannedCycle(currentCycle.id, {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelReason: isInProgress ? 'manual_removal_in_progress' : 'manual_removal',
    });
    
    // Check if there are other cycles on this printer
    const remainingCycles = getPlannedCycles().filter(c => 
      c.printerId === printerId && 
      c.id !== currentCycle.id &&
      c.status !== 'cancelled' && 
      c.status !== 'completed' && 
      c.status !== 'failed'
    );
    
    // Update printer state
    updatePrinter(printerId, { 
      mountState: remainingCycles.length === 0 ? 'idle' : undefined,
      // Don't touch mountedColor - keep existing
    });
    
    scheduleAutoReplan('cycle_removed');
    
    toast.success(
      language === 'he' ? 'העבודה בוטלה' : 'Job cancelled',
      { description: language === 'he' 
        ? 'המערכת מתכננת מחדש'
        : 'System is replanning'
      }
    );
    
    onComplete();
    onOpenChange(false);
  };

  // Extract cycle hours from cycle data
  const extractCycleHours = (cycle: PlannedCycle): number => {
    if (cycle.startTime && cycle.endTime) {
      const start = parseISO(cycle.startTime);
      const end = parseISO(cycle.endTime);
      return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    }
    return 2; // Default fallback
  };

  const isInProgress = currentCycle?.status === 'in_progress';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view !== 'menu' && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 -ms-2"
                onClick={() => setView('menu')}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
            )}
            {printer?.name || (language === 'he' ? 'מדפסת' : 'Printer')}
          </DialogTitle>
        </DialogHeader>

        {/* Menu View */}
        {view === 'menu' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {language === 'he' 
                ? 'מה המצב בפועל של המדפסת?' 
                : "What's the actual state of the printer?"}
            </p>
            
            {currentCycle ? (
              <>
                {/* Current job info */}
                <Card variant="glass" className="border-primary/20">
                  <CardContent className="p-3">
                    <div className="text-sm text-muted-foreground">
                      {language === 'he' ? 'עבודה נוכחית/הבאה:' : 'Current/Next job:'}
                    </div>
                    <div className="font-medium">{project?.name || currentCycle.projectId}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {currentCycle.unitsPlanned} {language === 'he' ? 'יחידות' : 'units'}
                      {' • '}
                      {currentCycle.requiredColor}
                      {isInProgress && (
                        <Badge className="ms-2 bg-success/20 text-success">
                          {language === 'he' ? 'פעיל' : 'Active'}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Action cards */}
                <Card 
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => setView('forgot_start')}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                      <Play className="w-5 h-5 text-success" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">
                        {language === 'he' ? 'היא מדפיסה עכשיו' : "It's printing now"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {language === 'he' 
                          ? 'שכחתי להתחיל במערכת - עדכן שעת התחלה'
                          : 'Forgot to start in system - update start time'}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card 
                  className="cursor-pointer hover:border-destructive/50 transition-colors"
                  onClick={() => setView('remove_job')}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                      <XCircle className="w-5 h-5 text-destructive" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">
                        {language === 'he' ? 'היא לא מדפיסה' : "It's not printing"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {language === 'he' 
                          ? 'הורד את העבודה מהמדפסת'
                          : 'Remove job from printer'}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                {language === 'he' 
                  ? 'אין עבודות מתוכננות למדפסת זו'
                  : 'No jobs planned for this printer'}
              </div>
            )}
          </div>
        )}

        {/* Forgot to Start View */}
        {view === 'forgot_start' && currentCycle && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {language === 'he' 
                ? 'מתי ההדפסה התחילה בפועל?'
                : 'When did the print actually start?'}
            </p>

            <div className="space-y-2">
              <Label>
                {language === 'he' ? 'שעת התחלה' : 'Start time'}
              </Label>
              <Input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                {language === 'he' ? 'זמן מחזור:' : 'Cycle time:'}{' '}
                {extractCycleHours(currentCycle).toFixed(1)} {language === 'he' ? 'שעות' : 'hours'}
              </div>
              <div className="mt-1 text-muted-foreground">
                {language === 'he' ? 'סיום משוער:' : 'Est. end:'}{' '}
                {format(
                  new Date(new Date(startTime).getTime() + extractCycleHours(currentCycle) * 60 * 60 * 1000),
                  'HH:mm'
                )}
              </div>
            </div>

            <Button 
              onClick={handleForgotStart} 
              className="w-full gap-2"
            >
              <Play className="w-4 h-4" />
              {language === 'he' ? 'סמן כפעיל' : 'Mark as Active'}
            </Button>
          </div>
        )}

        {/* Remove Job View */}
        {view === 'remove_job' && currentCycle && (
          <div className="space-y-4">
            {isInProgress && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="text-sm text-destructive">
                  {language === 'he' 
                    ? 'העבודה מסומנת כפעילה! ביטול אומר שההדפסה נעצרה בפועל.'
                    : 'This job is marked as active! Cancelling means the print has stopped.'}
                </div>
              </div>
            )}

            <Card variant="glass">
              <CardContent className="p-3">
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'עבודה שתבוטל:' : 'Job to cancel:'}
                </div>
                <div className="font-medium">{project?.name || currentCycle.projectId}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {currentCycle.unitsPlanned} {language === 'he' ? 'יחידות' : 'units'}
                  {' • '}
                  {currentCycle.requiredColor}
                </div>
              </CardContent>
            </Card>

            {isInProgress && (
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <Checkbox 
                  id="confirm-cancel" 
                  checked={confirmCancel}
                  onCheckedChange={(checked) => setConfirmCancel(checked === true)}
                />
                <Label htmlFor="confirm-cancel" className="text-sm cursor-pointer">
                  {language === 'he' 
                    ? 'אני מאשר שההדפסה נעצרה בפועל'
                    : 'I confirm the print has actually stopped'}
                </Label>
              </div>
            )}

            <Button 
              variant="destructive"
              onClick={handleRemoveJob}
              disabled={isInProgress && !confirmCancel}
              className="w-full gap-2"
            >
              <XCircle className="w-4 h-4" />
              {language === 'he' ? 'בטל עבודה' : 'Cancel Job'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
