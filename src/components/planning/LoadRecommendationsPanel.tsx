import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { 
  Package, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  XCircle,
  ChevronDown,
  ChevronUp,
  Printer as PrinterIcon,
} from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { generateLoadRecommendations, LoadRecommendationsResult, getActionSummary } from '@/services/loadRecommendations';
import { getSpools, getPrinters, LoadRecommendation, MaterialShortage, mountSpool, Spool, Printer } from '@/services/storage';
import { subscribeToInventoryChanges, notifyInventoryChanged } from '@/services/inventoryEvents';
import { useToast } from '@/hooks/use-toast';

interface LoadRecommendationsPanelProps {
  onRefresh?: () => void;
}

export const LoadRecommendationsPanel: React.FC<LoadRecommendationsPanelProps> = ({ onRefresh }) => {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [result, setResult] = useState<LoadRecommendationsResult | null>(null);
  const [expanded, setExpanded] = useState(true);
  
  // Load spool dialog state
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<LoadRecommendation | null>(null);
  const [selectedSpoolId, setSelectedSpoolId] = useState<string>('');
  const [availableSpools, setAvailableSpools] = useState<Spool[]>([]);
  const [targetPrinter, setTargetPrinter] = useState<Printer | null>(null);

  const refreshRecommendations = useCallback(() => {
    const recommendations = generateLoadRecommendations();
    setResult(recommendations);
    onRefresh?.();
  }, [onRefresh]);

  // Refresh on mount
  useEffect(() => {
    refreshRecommendations();
  }, [refreshRecommendations]);

  // Subscribe to inventory changes - refresh immediately when inventory updates
  useEffect(() => {
    const unsubscribe = subscribeToInventoryChanges(() => {
      refreshRecommendations();
    });
    return unsubscribe;
  }, [refreshRecommendations]);

  // Open load spool dialog for a recommendation
  const handleOpenLoadDialog = (rec: LoadRecommendation) => {
    const printer = getPrinters().find(p => p.id === rec.printerId);
    const spools = getSpools().filter(s => 
      s.color.toLowerCase() === rec.color.toLowerCase() && 
      s.state !== 'empty' &&
      s.location === 'stock'
    );
    
    setSelectedRecommendation(rec);
    setTargetPrinter(printer || null);
    setAvailableSpools(spools);
    setSelectedSpoolId(rec.suggestedSpoolIds[0] || '');
    setLoadDialogOpen(true);
  };

  // Handle mounting spool
  const handleMountSpool = () => {
    if (!selectedSpoolId || !targetPrinter) {
      toast({
        title: language === 'he' ? 'בחר גליל' : 'Select a spool',
        variant: 'destructive',
      });
      return;
    }
    
    mountSpool(targetPrinter.id, selectedSpoolId);
    notifyInventoryChanged();
    
    toast({
      title: language === 'he' ? 'גליל נטען!' : 'Spool loaded!',
      description: `${selectedRecommendation?.color} → ${targetPrinter.name}`,
    });
    
    setLoadDialogOpen(false);
    refreshRecommendations();
  };

  if (!result) return null;

  const { recommendations, materialShortages, summary } = result;
  const actionSummary = getActionSummary(result);

  // If all cycles are ready, show a minimal success state
  if (!actionSummary.hasActions && summary.totalCycles > 0) {
    return (
      <Alert className="border-success/30 bg-success/5">
        <CheckCircle className="h-4 w-4 text-success" />
        <AlertTitle className="text-success">
          {language === 'he' ? 'מוכן לביצוע' : 'Ready to Execute'}
        </AlertTitle>
        <AlertDescription>
          {language === 'he' ? actionSummary.message : actionSummary.messageEn}
        </AlertDescription>
      </Alert>
    );
  }

  if (summary.totalCycles === 0) {
    return null; // No cycles, no panel
  }

  return (
    <>
      <Card variant="elevated" className="border-warning/30">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-warning" />
              <CardTitle className="text-base">
                {language === 'he' ? 'פעולות נדרשות' : 'Required Actions'}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {/* Summary badges */}
              <div className="flex items-center gap-1">
                {summary.cyclesReady > 0 && (
                  <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-xs">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    {summary.cyclesReady}
                  </Badge>
                )}
                {summary.cyclesWaitingForSpool > 0 && (
                  <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    {summary.cyclesWaitingForSpool}
                  </Badge>
                )}
                {summary.cyclesBlockedInventory > 0 && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-xs">
                    <XCircle className="w-3 h-3 mr-1" />
                    {summary.cyclesBlockedInventory}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="p-4 pt-2 space-y-4">
            {/* Material Shortages - Critical alerts first */}
            {materialShortages.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  {language === 'he' ? 'חסר חומר גלם' : 'Material Shortage'}
                </h4>
                {materialShortages.map((shortage, idx) => (
                  <ShortageAlert key={idx} shortage={shortage} language={language} />
                ))}
              </div>
            )}

            {/* Load Recommendations */}
            {recommendations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-warning flex items-center gap-1">
                  <Package className="w-4 h-4" />
                  {language === 'he' ? 'הנחיות טעינה' : 'Load Instructions'}
                </h4>
                {recommendations.map((rec) => (
                  <RecommendationCard 
                    key={rec.id} 
                    recommendation={rec} 
                    language={language}
                    onClick={() => handleOpenLoadDialog(rec)}
                  />
                ))}
              </div>
            )}

            {/* Summary Stats */}
            <div className="flex items-center justify-between pt-2 border-t text-sm text-muted-foreground">
              <span>
                {language === 'he' 
                  ? `${summary.totalCycles} מחזורים מתוכננים`
                  : `${summary.totalCycles} cycles planned`}
              </span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-success" />
                  {summary.cyclesReady} {language === 'he' ? 'מוכנים' : 'ready'}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-warning" />
                  {summary.cyclesWaitingForSpool} {language === 'he' ? 'ממתינים' : 'waiting'}
                </span>
                {summary.cyclesBlockedInventory > 0 && (
                  <span className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-destructive" />
                    {summary.cyclesBlockedInventory} {language === 'he' ? 'חסומים' : 'blocked'}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Load Spool Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {language === 'he' ? 'טען גליל למדפסת' : 'Load Spool to Printer'}
            </DialogTitle>
            <DialogDescription>
              {targetPrinter && (
                <span className="flex items-center gap-2 mt-2">
                  <PrinterIcon className="w-4 h-4" />
                  <span className="font-medium">{targetPrinter.name}</span>
                  <span className="text-muted-foreground">←</span>
                  <SpoolIcon color={getSpoolColor(selectedRecommendation?.color || '')} size={16} />
                  <span>{selectedRecommendation?.color}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {availableSpools.length > 0 ? (
              <RadioGroup value={selectedSpoolId} onValueChange={setSelectedSpoolId}>
                <div className="space-y-2">
                  {availableSpools.map((spool) => (
                    <div 
                      key={spool.id} 
                      className={cn(
                        "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        selectedSpoolId === spool.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"
                      )}
                      onClick={() => setSelectedSpoolId(spool.id)}
                    >
                      <RadioGroupItem value={spool.id} id={spool.id} />
                      <Label htmlFor={spool.id} className="flex-1 cursor-pointer">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <SpoolIcon color={getSpoolColor(spool.color)} size={20} />
                            <span className="font-medium">{spool.color}</span>
                            <Badge variant="secondary" className="text-xs">
                              {spool.packageSize === 1000 ? '1kg' : spool.packageSize === 2000 ? '2kg' : '5kg'}
                            </Badge>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            ~{Math.ceil(spool.gramsRemainingEst)}g
                          </span>
                        </div>
                      </Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {language === 'he' ? 'אין גלילים זמינים' : 'No spools available'}
                </AlertTitle>
                <AlertDescription>
                  {language === 'he' 
                    ? `אין גלילים בצבע ${selectedRecommendation?.color} במלאי`
                    : `No ${selectedRecommendation?.color} spools in stock`}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button 
              onClick={handleMountSpool}
              disabled={!selectedSpoolId || availableSpools.length === 0}
            >
              {language === 'he' ? 'טען גליל' : 'Load Spool'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Sub-components

const ShortageAlert: React.FC<{ shortage: MaterialShortage; language: string }> = ({ shortage, language }) => {
  return (
    <Alert variant="destructive" className="py-2">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm">
        {language === 'he' 
          ? `חסר ${shortage.color}` 
          : `${shortage.color} shortage`}
      </AlertTitle>
      <AlertDescription className="text-xs space-y-1">
        <div>
          {language === 'he'
            ? `נדרש: ${Math.ceil(shortage.requiredGrams)}g | זמין: ${Math.ceil(shortage.availableGrams)}g | חסר: ${Math.ceil(shortage.shortfallGrams)}g`
            : `Required: ${Math.ceil(shortage.requiredGrams)}g | Available: ${Math.ceil(shortage.availableGrams)}g | Short: ${Math.ceil(shortage.shortfallGrams)}g`}
        </div>
        <div className="text-muted-foreground">
          {language === 'he' ? 'פרויקטים מושפעים: ' : 'Affected projects: '}
          {shortage.affectedProjectNames.join(', ')}
        </div>
      </AlertDescription>
    </Alert>
  );
};

interface RecommendationCardProps {
  recommendation: LoadRecommendation;
  language: string;
  onClick?: () => void;
}

const RecommendationCard: React.FC<RecommendationCardProps> = ({ recommendation, language, onClick }) => {
  const spools = getSpools();
  const suggestedSpools = spools.filter(s => recommendation.suggestedSpoolIds.includes(s.id));

  const handleClick = () => {
    onClick?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div 
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors select-none cursor-pointer",
        recommendation.priority === 'high' && "border-warning/50 bg-warning/5",
        recommendation.priority === 'medium' && "border-muted bg-muted/30",
        recommendation.priority === 'low' && "border-border bg-background",
        "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-primary"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <PrinterIcon className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{recommendation.printerName}</span>
        </div>
        <Badge 
          variant="outline" 
          className={cn(
            "text-xs",
            recommendation.priority === 'high' && "bg-warning/10 text-warning border-warning/30",
            recommendation.priority === 'medium' && "bg-muted text-muted-foreground",
            recommendation.priority === 'low' && "bg-background text-muted-foreground",
          )}
        >
          {recommendation.priority === 'high' && (language === 'he' ? 'דחוף' : 'Urgent')}
          {recommendation.priority === 'medium' && (language === 'he' ? 'רגיל' : 'Normal')}
          {recommendation.priority === 'low' && (language === 'he' ? 'נמוך' : 'Low')}
        </Badge>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <SpoolIcon color={getSpoolColor(recommendation.color)} size={16} />
        <span className="text-sm">
          {language === 'he' 
            ? recommendation.message 
            : recommendation.messageEn}
        </span>
      </div>

      {/* Suggested spools from inventory */}
      {suggestedSpools.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed">
          <span className="text-xs text-muted-foreground">
            {language === 'he' ? 'גלילים מומלצים מהמלאי:' : 'Suggested spools from inventory:'}
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {suggestedSpools.map(spool => (
              <Badge key={spool.id} variant="secondary" className="text-xs">
            {spool.color} ({Math.ceil(spool.gramsRemainingEst)}g)
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 text-xs text-muted-foreground">
        {language === 'he' 
          ? `משפיע על ${recommendation.affectedCycleIds.length} מחזורים`
          : `Affects ${recommendation.affectedCycleIds.length} cycles`}
        {recommendation.affectedProjectNames.length > 0 && (
          <span> • {recommendation.affectedProjectNames.slice(0, 2).join(', ')}</span>
        )}
      </div>
      
      <div className="mt-2 text-[10px] opacity-50">
        BUILD_STAMP: RA_DIALOG_V1
      </div>
    </div>
  );
};

export default LoadRecommendationsPanel;
