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
import { ScrollArea } from '@/components/ui/scroll-area';
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
  Printer,
  Timer,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  DecisionAnalysis,
  DecisionOption,
  DecisionOptionAnalysis,
  DominoCycle,
  MergeCandidate,
  DeferImpact,
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
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

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

  // Format date for display
  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return `${date.toLocaleDateString()} ${date.toTimeString().slice(0, 5)}`;
  };

  // Risk level badge colors
  const getRiskBadge = (level: 'low' | 'medium' | 'high' | 'critical') => {
    const colors = {
      low: 'bg-success/10 text-success border-success/30',
      medium: 'bg-warning/10 text-warning border-warning/30',
      high: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
      critical: 'bg-destructive/10 text-destructive border-destructive/30',
    };
    const labels = {
      low: language === 'he' ? 'סיכון נמוך' : 'Low Risk',
      medium: language === 'he' ? 'סיכון בינוני' : 'Medium Risk',
      high: language === 'he' ? 'סיכון גבוה' : 'High Risk',
      critical: language === 'he' ? 'סיכון קריטי' : 'Critical Risk',
    };
    return (
      <Badge variant="outline" className={colors[level]}>
        {labels[level]}
      </Badge>
    );
  };

  // Render domino effect table for Complete Now
  const renderDominoTable = (dominoEffect: DominoCycle[]) => {
    if (!dominoEffect || dominoEffect.length === 0) {
      return (
        <div className="text-sm text-muted-foreground p-2 bg-muted/30 rounded">
          {language === 'he' ? 'אין השפעת דומינו - אין מחזורים שיידחו' : 'No domino effect - no cycles will be pushed'}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-2 text-start">{language === 'he' ? 'מדפסת' : 'Printer'}</th>
              <th className="p-2 text-start">{language === 'he' ? 'פרויקט' : 'Project'}</th>
              <th className="p-2 text-start">{language === 'he' ? 'מקורי' : 'Original'}</th>
              <th className="p-2 text-start">{language === 'he' ? 'חדש' : 'New'}</th>
              <th className="p-2 text-center">{language === 'he' ? 'איחור' : 'Delay'}</th>
              <th className="p-2 text-center">{language === 'he' ? 'דדליין' : 'Deadline'}</th>
            </tr>
          </thead>
          <tbody>
            {dominoEffect.map((cycle, idx) => (
              <tr key={cycle.cycleId} className={`border-b border-border/50 ${cycle.crossesDeadline ? 'bg-destructive/5' : ''}`}>
                <td className="p-2 flex items-center gap-1">
                  <Printer className="w-3 h-3 text-muted-foreground" />
                  {cycle.printerName}
                </td>
                <td className="p-2 font-medium">{cycle.projectName}</td>
                <td className="p-2 text-muted-foreground">{formatDateTime(cycle.originalStart)}</td>
                <td className="p-2">{formatDateTime(cycle.newStart)}</td>
                <td className="p-2 text-center">
                  <Badge variant="outline" className="text-warning border-warning/30">
                    +{cycle.delayHours.toFixed(1)}h
                  </Badge>
                </td>
                <td className="p-2 text-center">
                  {cycle.crossesDeadline ? (
                    <Badge variant="destructive" className="text-xs">
                      {language === 'he' ? 'חוצה!' : 'Crosses!'}
                    </Badge>
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Render defer analysis details
  const renderDeferDetails = (deferAnalysis: DeferImpact) => {
    return (
      <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">
              {language === 'he' ? 'התחלה מאוחרת ביותר' : 'Latest Start'}
            </div>
            <div className="font-medium">{deferAnalysis.latestStart || '-'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">
              {language === 'he' ? 'התחלה משוערת' : 'Estimated Start'}
            </div>
            <div className="font-medium">{deferAnalysis.estimatedStart || '-'}</div>
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {language === 'he' ? 'רמת סיכון:' : 'Risk Level:'}
          </span>
          {getRiskBadge(deferAnalysis.riskLevel)}
        </div>
        
        {(deferAnalysis.reason || deferAnalysis.reasonHe) && (
          <div className="text-sm p-2 bg-warning/10 rounded border border-warning/20">
            {language === 'he' ? deferAnalysis.reasonHe : deferAnalysis.reason}
          </div>
        )}
        
        {deferAnalysis.willMissDeadline && (
          <div className="text-sm p-2 bg-destructive/10 rounded border border-destructive/20 text-destructive">
            <AlertTriangle className="w-4 h-4 inline mr-1" />
            {language === 'he' 
              ? `הדדליין ייפסח ב-${deferAnalysis.daysAtRisk} ימים!`
              : `Deadline will be missed by ${deferAnalysis.daysAtRisk} days!`}
          </div>
        )}
      </div>
    );
  };

  // Render merge candidate with extension impact
  const renderMergeWithExtension = (candidate: MergeCandidate) => {
    const ext = candidate.extensionImpact;
    return (
      <div className="space-y-2 p-3 bg-muted/30 rounded-lg text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-muted-foreground text-xs">
              {language === 'he' ? 'זמן סיום חדש' : 'New End Time'}
            </div>
            <div className="font-medium">{formatDateTime(ext.newEndTime)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">
              {language === 'he' ? 'זמן פנוי' : 'Available Time'}
            </div>
            <div className="font-medium">{candidate.availableTimeHours.toFixed(1)}h</div>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          {ext.wouldCrossDeadline && (
            <Badge variant="destructive" className="text-xs">
              {language === 'he' ? 'חוצה דדליין' : 'Crosses Deadline'}
            </Badge>
          )}
          {ext.wouldRequireOvernight && (
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
              {language === 'he' ? 'דורש לילה' : 'Requires Overnight'}
            </Badge>
          )}
          {ext.affectedCycles.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {language === 'he' 
                ? `${ext.affectedCycles.length} מחזורים מושפעים`
                : `${ext.affectedCycles.length} cycles affected`}
            </Badge>
          )}
        </div>
      </div>
    );
  };

  const renderOverview = () => {
    const completeNowOption = analysis.options.find(o => o.option === 'complete_now');
    const dominoEffect = completeNowOption?.impact?.dominoEffect || [];

    return (
      <ScrollArea className="max-h-[70vh]">
        <div className="space-y-4 pr-4">
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

          {/* Decision Options with Computed Impact */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">
              {language === 'he' ? 'מה לעשות עם היחידות החסרות?' : 'What to do with the missing units?'}
            </div>

            {analysis.options.map((option) => {
              const Icon = getOptionIcon(option.option);
              const isExpanded = expandedSection === option.option;
              const hasDomino = option.option === 'complete_now' && dominoEffect.length > 0;
              const hasDefer = option.option === 'defer_to_later';
              const hasMerge = option.option === 'merge_with_future' && analysis.mergeCandidates.length > 0;
              const hasDetails = hasDomino || hasDefer || hasMerge;
              
              return (
                <div key={option.option} className="space-y-0">
                  <button
                    onClick={() => option.available && handleOptionSelect(option.option)}
                    disabled={!option.available}
                    className={`
                      w-full p-4 rounded-xl border-2 text-start transition-all duration-200
                      ${getOptionColor(option)}
                      ${!option.available ? 'cursor-not-allowed' : 'cursor-pointer'}
                      ${hasDetails && isExpanded ? 'rounded-b-none' : ''}
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

                  {/* Expand button for detailed view */}
                  {option.available && hasDetails && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedSection(isExpanded ? null : option.option);
                      }}
                      className="w-full p-2 border-2 border-t-0 border-border rounded-b-xl bg-muted/30 hover:bg-muted/50 flex items-center justify-center gap-2 text-xs text-muted-foreground"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      {language === 'he' ? 'הצג חישוב מפורט' : 'Show Computed Details'}
                    </button>
                  )}

                  {/* Expanded computed details */}
                  {isExpanded && option.option === 'complete_now' && (
                    <div className="border-2 border-t-0 border-border rounded-b-xl p-3 bg-background">
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        {language === 'he' ? 'אפקט דומינו (מדפסת זהה בלבד):' : 'Domino Effect (same printer only):'}
                      </div>
                      {renderDominoTable(dominoEffect)}
                    </div>
                  )}

                  {isExpanded && option.option === 'defer_to_later' && (
                    <div className="border-2 border-t-0 border-border rounded-b-xl p-3 bg-background">
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        {language === 'he' ? 'ניתוח דחייה:' : 'Defer Analysis:'}
                      </div>
                      {renderDeferDetails(analysis.deferAnalysis)}
                    </div>
                  )}

                  {isExpanded && option.option === 'merge_with_future' && (
                    <div className="border-2 border-t-0 border-border rounded-b-xl p-3 bg-background space-y-3">
                      <div className="text-xs font-medium text-muted-foreground">
                        {language === 'he' ? 'מועמדים למיזוג עם השפעה:' : 'Merge Candidates with Extension Impact:'}
                      </div>
                      {analysis.mergeCandidates.map((candidate, idx) => (
                        <div key={candidate.cycleId} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={idx === 0 ? 'default' : 'outline'} className="text-xs">
                              {candidate.printerName}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {candidate.scheduledDate} • {candidate.currentUnits}/{candidate.maxUnits} {language === 'he' ? 'יחידות' : 'units'}
                            </span>
                          </div>
                          {renderMergeWithExtension(candidate)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    );
  };

  const renderMergeSelect = () => (
    <ScrollArea className="max-h-[70vh]">
      <div className="space-y-4 pr-4">
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-2">
          {language === 'he' ? '← חזרה' : '← Back'}
        </Button>

        <div className="text-sm font-medium text-muted-foreground">
          {language === 'he' 
            ? `בחר מחזור למיזוג ${analysis.unitsToRecover} יחידות:`
            : `Select a cycle to merge ${analysis.unitsToRecover} units:`
          }
        </div>

        <div className="space-y-4">
          {analysis.mergeCandidates.map((candidate, index) => (
            <div key={candidate.cycleId} className="space-y-0">
              <button
                onClick={() => {
                  setSelectedMergeCycle(candidate.cycleId);
                  setStep('confirm');
                }}
                className={`
                  w-full p-4 rounded-xl border-2 text-start transition-all duration-200
                  ${index === 0 
                    ? 'border-success/30 bg-success/5 hover:bg-success/10' 
                    : 'border-border hover:border-primary/50 hover:bg-accent'
                  } cursor-pointer
                `}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{candidate.printerName}</span>
                      {index === 0 && (
                        <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                          {language === 'he' ? 'מומלץ' : 'Recommended'}
                        </Badge>
                      )}
                    </div>
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
              
              {/* Extension Impact Details */}
              <div className="border-2 border-t-0 border-border rounded-b-xl p-3 bg-muted/20">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  {language === 'he' ? 'השפעת הרחבה:' : 'Extension Impact:'}
                </div>
                {renderMergeWithExtension(candidate)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
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
