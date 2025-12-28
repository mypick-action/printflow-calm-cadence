import React, { useState, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  Clock, 
  CalendarClock, 
  Merge, 
  XCircle,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Zap,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import {
  DecisionAnalysis,
  DecisionOption,
  DecisionOptionAnalysis,
} from '@/services/impactAnalysis';

interface DecisionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: DecisionAnalysis | null;
  cycleResult: 'completed_with_scrap' | 'failed';
  onDecision: (decision: DecisionOption, mergeCycleId?: string) => void;
}

export const DecisionModal: React.FC<DecisionModalProps> = ({
  open,
  onOpenChange,
  analysis,
  cycleResult,
  onDecision,
}) => {
  const { language } = useLanguage();
  const [selectedOption, setSelectedOption] = useState<DecisionOption | null>(null);
  const [selectedMergeCycle, setSelectedMergeCycle] = useState<string | null>(null);
  const [step, setStep] = useState<'overview' | 'merge_select' | 'confirm'>('overview');

  if (!analysis) return null;

  const getOptionIcon = (option: DecisionOption) => {
    switch (option) {
      case 'complete_now': return Zap;
      case 'defer_to_later': return CalendarClock;
      case 'merge_with_future': return Merge;
      case 'ignore': return XCircle;
    }
  };

  const getOptionColor = (option: DecisionOptionAnalysis) => {
    if (!option.available) return 'border-border/50 bg-muted/30 opacity-60';
    
    switch (option.recommendation) {
      case 'recommended': return 'border-success/30 bg-success/5 hover:bg-success/10';
      case 'neutral': return 'border-border hover:border-primary/50 hover:bg-accent';
      case 'not_recommended': return 'border-warning/30 bg-warning/5 hover:bg-warning/10';
    }
  };

  const getRecommendationBadge = (rec: 'recommended' | 'neutral' | 'not_recommended') => {
    switch (rec) {
      case 'recommended':
        return (
          <Badge variant="outline" className="bg-success/10 text-success border-success/30">
            {language === 'he' ? 'מומלץ' : 'Recommended'}
          </Badge>
        );
      case 'not_recommended':
        return (
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
            {language === 'he' ? 'לא מומלץ' : 'Not Recommended'}
          </Badge>
        );
      default:
        return null;
    }
  };

  const handleOptionSelect = (option: DecisionOption) => {
    if (option === 'merge_with_future' && analysis.mergeCandidates.length > 0) {
      setSelectedOption(option);
      setStep('merge_select');
    } else {
      setSelectedOption(option);
      setStep('confirm');
    }
  };

  const handleConfirm = () => {
    if (selectedOption) {
      onDecision(selectedOption, selectedMergeCycle || undefined);
      onOpenChange(false);
      // Reset state
      setSelectedOption(null);
      setSelectedMergeCycle(null);
      setStep('overview');
    }
  };

  const handleBack = () => {
    if (step === 'merge_select') {
      setStep('overview');
      setSelectedOption(null);
    } else if (step === 'confirm') {
      if (selectedOption === 'merge_with_future') {
        setStep('merge_select');
      } else {
        setStep('overview');
        setSelectedOption(null);
      }
    }
  };

  const renderOverview = () => (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-foreground">
                {cycleResult === 'completed_with_scrap'
                  ? (language === 'he' ? 'המחזור הסתיים עם נפלים' : 'Cycle Completed with Defects')
                  : (language === 'he' ? 'המחזור נכשל' : 'Cycle Failed')
                }
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {language === 'he' 
                  ? `${analysis.unitsToRecover} יחידות דורשות החלטה • ${analysis.gramsWasted}g בוזבזו`
                  : `${analysis.unitsToRecover} units need decision • ${analysis.gramsWasted}g wasted`
                }
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Project Info */}
      <div className="p-3 bg-muted/30 rounded-lg">
        <div className="text-sm text-muted-foreground">
          {language === 'he' ? 'פרויקט:' : 'Project:'}
        </div>
        <div className="font-medium text-foreground">{analysis.originalProject.name}</div>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>
            {language === 'he' ? 'דדליין:' : 'Due:'} {analysis.originalProject.dueDate}
          </span>
        </div>
      </div>

      {/* Decision Options */}
      <div className="space-y-3">
        <div className="text-sm font-medium text-muted-foreground">
          {language === 'he' ? 'מה לעשות עם היחידות החסרות?' : 'What to do with the missing units?'}
        </div>

        {analysis.options.map((option) => {
          const Icon = getOptionIcon(option.option);
          
          return (
            <button
              key={option.option}
              onClick={() => option.available && handleOptionSelect(option.option)}
              disabled={!option.available}
              className={`
                w-full p-4 rounded-xl border-2 text-start transition-all duration-200
                ${getOptionColor(option)}
                ${!option.available ? 'cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-background">
                  <Icon className="w-5 h-5 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">
                      {option.option === 'complete_now' && (language === 'he' ? 'השלם עכשיו' : 'Complete Now')}
                      {option.option === 'defer_to_later' && (language === 'he' ? 'דחה להמשך' : 'Defer to Later')}
                      {option.option === 'merge_with_future' && (language === 'he' ? 'מזג עם מחזור קיים' : 'Merge with Future Cycle')}
                      {option.option === 'ignore' && (language === 'he' ? 'התעלם' : 'Ignore')}
                    </span>
                    {getRecommendationBadge(option.recommendation)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {language === 'he' ? option.descriptionHe : option.description}
                  </div>
                  
                  {/* Warnings */}
                  {option.warnings.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {(language === 'he' ? option.warningsHe : option.warnings).map((warning, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 text-xs text-warning">
                          <AlertCircle className="w-3 h-3" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Impact preview for immediate option */}
                  {option.option === 'complete_now' && option.impact && (
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        +{option.impact.hoursAdded.toFixed(1)}h
                      </span>
                      {option.impact.cyclesPushed > 0 && (
                        <span>{option.impact.cyclesPushed} {language === 'he' ? 'מחזורים יידחו' : 'cycles delayed'}</span>
                      )}
                    </div>
                  )}
                </div>
                {option.available && <ChevronRight className="w-5 h-5 text-muted-foreground" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderMergeSelect = () => (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={handleBack} className="mb-2">
        {language === 'he' ? '← חזרה' : '← Back'}
      </Button>

      <div className="text-sm font-medium text-muted-foreground">
        {language === 'he' 
          ? `בחר מחזור למיזוג ${analysis.unitsToRecover} יחידות:`
          : `Select a cycle to merge ${analysis.unitsToRecover} units:`
        }
      </div>

      <div className="space-y-2">
        {analysis.mergeCandidates.map((candidate) => (
          <button
            key={candidate.cycleId}
            onClick={() => {
              setSelectedMergeCycle(candidate.cycleId);
              setStep('confirm');
            }}
            className={`
              w-full p-4 rounded-xl border-2 text-start transition-all duration-200
              border-border hover:border-primary/50 hover:bg-accent cursor-pointer
            `}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-foreground">{candidate.printerName}</div>
                <div className="text-sm text-muted-foreground">
                  {candidate.scheduledDate} • {candidate.scheduledTime}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {language === 'he' 
                    ? `${candidate.currentUnits} יחידות כרגע • יכול להוסיף עוד ${candidate.canAddUnits}`
                    : `${candidate.currentUnits} units now • Can add ${candidate.canAddUnits} more`
                  }
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const renderConfirm = () => {
    const selectedOptionData = analysis.options.find(o => o.option === selectedOption);
    const selectedMergeData = analysis.mergeCandidates.find(c => c.cycleId === selectedMergeCycle);

    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-2">
          {language === 'he' ? '← חזרה' : '← Back'}
        </Button>

        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              <span className="font-semibold text-foreground">
                {language === 'he' ? 'אישור החלטה' : 'Confirm Decision'}
              </span>
            </div>
            
            <div className="text-sm text-muted-foreground">
              {selectedOption === 'complete_now' && (
                language === 'he' 
                  ? `ייווצר פרויקט השלמה ל-${analysis.unitsToRecover} יחידות ויתוזמן מיידית.`
                  : `A remake project for ${analysis.unitsToRecover} units will be created and scheduled immediately.`
              )}
              {selectedOption === 'defer_to_later' && (
                language === 'he'
                  ? `ייווצר פרויקט השלמה ל-${analysis.unitsToRecover} יחידות ויתוזמן אחרי עבודות קיימות.`
                  : `A remake project for ${analysis.unitsToRecover} units will be created and scheduled after existing work.`
              )}
              {selectedOption === 'merge_with_future' && selectedMergeData && (
                language === 'he'
                  ? `${analysis.unitsToRecover} יחידות יתווספו למחזור ב-${selectedMergeData.printerName} ב-${selectedMergeData.scheduledDate}.`
                  : `${analysis.unitsToRecover} units will be added to the cycle on ${selectedMergeData.printerName} on ${selectedMergeData.scheduledDate}.`
              )}
              {selectedOption === 'ignore' && (
                language === 'he'
                  ? `${analysis.unitsToRecover} יחידות יירשמו כנפלים. לא ייווצר פרויקט השלמה.`
                  : `${analysis.unitsToRecover} units will be recorded as scrap. No remake project will be created.`
              )}
            </div>

            {/* Show warnings one more time */}
            {selectedOptionData && selectedOptionData.warnings.length > 0 && (
              <div className="mt-3 p-2 bg-warning/10 rounded-lg">
                {(language === 'he' ? selectedOptionData.warningsHe : selectedOptionData.warnings).map((warning, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-xs text-warning">
                    <AlertCircle className="w-3 h-3" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Button 
          onClick={handleConfirm}
          className="w-full h-12 text-lg gap-2"
        >
          {language === 'he' ? 'אישור' : 'Confirm'}
          <ArrowRight className="w-5 h-5" />
        </Button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'overview' && (language === 'he' ? 'החלטה נדרשת' : 'Decision Required')}
            {step === 'merge_select' && (language === 'he' ? 'בחירת מחזור למיזוג' : 'Select Cycle to Merge')}
            {step === 'confirm' && (language === 'he' ? 'אישור החלטה' : 'Confirm Decision')}
          </DialogTitle>
          <DialogDescription>
            {step === 'overview' && (
              language === 'he' 
                ? 'בחרו כיצד לטפל ביחידות החסרות'
                : 'Choose how to handle the missing units'
            )}
          </DialogDescription>
        </DialogHeader>

        {step === 'overview' && renderOverview()}
        {step === 'merge_select' && renderMergeSelect()}
        {step === 'confirm' && renderConfirm()}
      </DialogContent>
    </Dialog>
  );
};
