import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RefreshCw, Calendar, Lock, AlertCircle } from 'lucide-react';
import { RecalculateScope, recalculatePlan, getPlannedCycles } from '@/services/storage';
import { toast } from 'sonner';

interface RecalculateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecalculated?: () => void;
}

export const RecalculateModal: React.FC<RecalculateModalProps> = ({
  open,
  onOpenChange,
  onRecalculated,
}) => {
  const { language } = useLanguage();
  const [scope, setScope] = useState<RecalculateScope>('from_now');
  const [lockStarted, setLockStarted] = useState(true);
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Calculate stats for summary
  const cycles = getPlannedCycles();
  const plannedCycles = cycles.filter(c => c.status === 'planned').length;
  const inProgressCycles = cycles.filter(c => c.status === 'in_progress').length;

  const handleRecalculate = async () => {
    setIsRecalculating(true);
    
    // Simulate a small delay for UX
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const result = recalculatePlan(scope, lockStarted);
    
    setIsRecalculating(false);
    
    if (result.success) {
      toast.success(
        language === 'he' 
          ? `התוכנית חושבה מחדש - ${result.cyclesModified} מחזורים עודכנו`
          : `Plan recalculated - ${result.cyclesModified} cycles updated`
      );
      onOpenChange(false);
      onRecalculated?.();
    } else {
      toast.error(
        language === 'he' 
          ? 'שגיאה בחישוב התוכנית'
          : 'Error recalculating plan'
      );
    }
  };

  const scopeOptions = [
    {
      value: 'from_now' as RecalculateScope,
      label: language === 'he' ? 'מעכשיו והלאה' : 'From now forward',
      description: language === 'he' 
        ? 'עדכון מחזורים עתידיים מרגע זה'
        : 'Update future cycles from this moment',
    },
    {
      value: 'from_tomorrow' as RecalculateScope,
      label: language === 'he' ? 'מחר והלאה' : 'From tomorrow',
      description: language === 'he'
        ? 'שמור על היום הנוכחי, עדכן החל ממחר'
        : 'Keep today as-is, update from tomorrow',
    },
    {
      value: 'whole_week' as RecalculateScope,
      label: language === 'he' ? 'כל השבוע' : 'Whole week',
      description: language === 'he'
        ? 'חשב מחדש את כל השבוע'
        : 'Recalculate the entire week',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" />
            {language === 'he' ? 'חישוב מחדש של התוכנית' : 'Recalculate Planning'}
          </DialogTitle>
          <DialogDescription>
            {language === 'he'
              ? 'בנה מחדש את לוח הזמנים בהתבסס על הקיבולת הנוכחית'
              : 'Rebuild the schedule based on current capacity'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Summary */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {language === 'he' ? 'סטטוס נוכחי:' : 'Current status:'}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">
                  {language === 'he' ? 'מחזורים מתוכננים:' : 'Planned cycles:'}
                </span>
                <span className="font-medium ml-1">{plannedCycles}</span>
              </div>
              <div>
                <span className="text-muted-foreground">
                  {language === 'he' ? 'בתהליך:' : 'In progress:'}
                </span>
                <span className="font-medium ml-1">{inProgressCycles}</span>
              </div>
            </div>
          </div>

          {/* Scope Selection */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {language === 'he' ? 'טווח החישוב' : 'Recalculation Scope'}
            </Label>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as RecalculateScope)}>
              {scopeOptions.map((option) => (
                <div
                  key={option.value}
                  className="flex items-start space-x-3 space-x-reverse p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setScope(option.value)}
                >
                  <RadioGroupItem value={option.value} id={option.value} className="mt-0.5" />
                  <div className="flex-1">
                    <Label htmlFor={option.value} className="font-medium cursor-pointer">
                      {option.label}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {option.description}
                    </p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Safety Option */}
          <div className="flex items-start space-x-3 space-x-reverse p-3 bg-warning/5 rounded-lg border border-warning/20">
            <Checkbox
              id="lockStarted"
              checked={lockStarted}
              onCheckedChange={(checked) => setLockStarted(checked === true)}
            />
            <div className="flex-1">
              <Label htmlFor="lockStarted" className="flex items-center gap-2 font-medium cursor-pointer">
                <Lock className="w-4 h-4 text-warning" />
                {language === 'he' ? 'נעל מחזורים שכבר התחילו' : 'Lock already-started cycles'}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {language === 'he'
                  ? 'מחזורים בסטטוס "בתהליך" לא ישתנו'
                  : 'Cycles with "in progress" status will not be modified'}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {language === 'he' ? 'ביטול' : 'Cancel'}
          </Button>
          <Button onClick={handleRecalculate} disabled={isRecalculating} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isRecalculating ? 'animate-spin' : ''}`} />
            {isRecalculating
              ? (language === 'he' ? 'מחשב...' : 'Calculating...')
              : (language === 'he' ? 'חשב מחדש' : 'Recalculate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
