// PlanningConflictResolver Component
// Main flow for handling planning conflicts with 3 clear options
// NEVER guesses units - only validates user-defined presets

import React, { useState, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  AlertTriangle,
  Clock,
  XCircle,
  Plus,
  CheckCircle,
  ChevronRight,
  Star,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { ConstraintAlert } from './ConstraintAlert';
import { GuidedPresetCreator } from './GuidedPresetCreator';
import { 
  PlanningConstraints,
  checkPresetFitsConstraints,
  generateProblemDescription,
  findFittingPresets,
  formatHoursToHuman,
} from '@/services/constraintCalculator';
import { 
  Product, 
  PlatePreset, 
  updateProduct, 
  PlannedCycle,
} from '@/services/storage';

type ResolverStep = 'problem' | 'options' | 'select_preset' | 'create_preset' | 'extend_hours' | 'resolved';

interface PlanningConflictResolverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  currentPreset: PlatePreset;
  constraints: PlanningConstraints;
  onResolve: (action: {
    type: 'cancel_cycle' | 'extend_hours' | 'switch_preset' | 'create_preset';
    newPreset?: PlatePreset;
    extendedEndTime?: string;
  }) => void;
}

export const PlanningConflictResolver: React.FC<PlanningConflictResolverProps> = ({
  open,
  onOpenChange,
  product,
  currentPreset,
  constraints,
  onResolve,
}) => {
  const { language } = useLanguage();
  const [step, setStep] = useState<ResolverStep>('problem');
  const [selectedPreset, setSelectedPreset] = useState<PlatePreset | null>(null);
  
  // Find existing presets that fit
  const presetAnalysis = useMemo(() => {
    return findFittingPresets(product, constraints);
  }, [product, constraints]);
  
  const fittingPresets = presetAnalysis.filter(p => p.result.fits);
  const hasFittingPresets = fittingPresets.length > 0;
  
  // Problem description
  const problem = useMemo(() => {
    return generateProblemDescription(constraints, currentPreset, product, language);
  }, [constraints, currentPreset, product, language]);
  
  const handleSelectPreset = (preset: PlatePreset) => {
    setSelectedPreset(preset);
    onResolve({ type: 'switch_preset', newPreset: preset });
    toast({
      title: language === 'he' ? 'פריסה הוחלפה' : 'Preset switched',
      description: preset.name,
    });
    onOpenChange(false);
  };
  
  const handleCreatePreset = (preset: PlatePreset) => {
    // Save preset to product using storage helper (triggers auto-replan)
    updateProduct(product.id, {
      platePresets: [...product.platePresets, preset],
    });
    
    // Resolve with new preset
    onResolve({ type: 'create_preset', newPreset: preset });
    toast({
      title: language === 'he' ? 'פריסה נשמרה והוחלה' : 'Preset saved and applied',
      description: preset.name,
    });
    onOpenChange(false);
  };
  
  const handleCancelCycle = () => {
    onResolve({ type: 'cancel_cycle' });
    toast({
      title: language === 'he' ? 'מחזור בוטל' : 'Cycle cancelled',
      description: language === 'he' ? 'המחזור האחרון של היום בוטל' : 'Today\'s last cycle was cancelled',
    });
    onOpenChange(false);
  };
  
  const handleExtendHours = () => {
    // For now, just add 2 hours
    const [h, m] = constraints.maxCycleHours.toString().split('.').map(Number);
    const newEndHour = Math.min(23, Math.floor(constraints.maxCycleHours) + 2);
    onResolve({ type: 'extend_hours', extendedEndTime: `${newEndHour}:00` });
    toast({
      title: language === 'he' ? 'שעות הורחבו' : 'Hours extended',
      description: language === 'he' ? 'שעות העבודה הורחבו לסיום המחזור' : 'Work hours extended to complete the cycle',
    });
    onOpenChange(false);
  };
  
  const renderProblemStep = () => (
    <div className="space-y-4">
      <ConstraintAlert
        title={problem.title}
        description={problem.description}
        constraints={constraints}
        violations={checkPresetFitsConstraints(currentPreset, product, constraints).violations}
      />
      
      <Button 
        onClick={() => setStep('options')} 
        className="w-full"
      >
        {language === 'he' ? 'ראה אפשרויות' : 'View Options'}
        <ChevronRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
  
  const renderOptionsStep = () => (
    <div className="space-y-3">
      {/* Option 1: Use existing preset (if available) */}
      {hasFittingPresets && (
        <Card 
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setStep('select_preset')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-full bg-success/10">
              <CheckCircle className="w-5 h-5 text-success" />
            </div>
            <div className="flex-1">
              <p className="font-medium">
                {language === 'he' ? 'השתמש בפריסה קיימת' : 'Use existing preset'}
              </p>
              <p className="text-sm text-muted-foreground">
                {language === 'he' 
                  ? `${fittingPresets.length} פריסות מתאימות זמינות`
                  : `${fittingPresets.length} fitting presets available`
                }
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>
      )}
      
      {/* Option 2: Create new preset (recommended if no fitting exists) */}
      <Card 
        className={`cursor-pointer hover:border-primary/50 transition-colors ${!hasFittingPresets ? 'border-primary/30' : ''}`}
        onClick={() => setStep('create_preset')}
      >
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/10">
            <Plus className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">
                {language === 'he' ? 'צור פריסה חדשה' : 'Create new preset'}
              </p>
              {!hasFittingPresets && (
                <Badge variant="outline" className="text-xs">
                  {language === 'he' ? 'מומלץ' : 'Recommended'}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {language === 'he' 
                ? 'הגדר פריסה קצרה יותר מהסלייסר'
                : 'Define a shorter layout from your slicer'
              }
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </CardContent>
      </Card>
      
      {/* Option 3: Cancel today's cycle */}
      <Card 
        className="cursor-pointer hover:border-warning/50 transition-colors"
        onClick={handleCancelCycle}
      >
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-full bg-warning/10">
            <XCircle className="w-5 h-5 text-warning" />
          </div>
          <div className="flex-1">
            <p className="font-medium">
              {language === 'he' ? 'בטל את המחזור האחרון' : 'Cancel today\'s last cycle'}
            </p>
            <p className="text-sm text-muted-foreground">
              {language === 'he' 
                ? 'המשך מחר במקום'
                : 'Continue tomorrow instead'
              }
            </p>
          </div>
        </CardContent>
      </Card>
      
      {/* Option 4: Extend hours (if applicable) */}
      <Card 
        className="cursor-pointer hover:border-muted-foreground/50 transition-colors"
        onClick={handleExtendHours}
      >
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-full bg-muted">
            <Clock className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <p className="font-medium">
              {language === 'he' ? 'הרחב שעות עבודה' : 'Extend working hours'}
            </p>
            <p className="text-sm text-muted-foreground">
              {language === 'he' 
                ? 'הישאר יותר מאוחר לסיום המחזור'
                : 'Stay later to finish the cycle'
              }
            </p>
          </div>
        </CardContent>
      </Card>
      
      <Button 
        variant="ghost" 
        onClick={() => setStep('problem')}
        className="w-full text-muted-foreground"
      >
        {language === 'he' ? 'חזרה' : 'Back'}
      </Button>
    </div>
  );
  
  const renderSelectPresetStep = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {language === 'he' 
          ? 'בחר פריסה שמתאימה לזמן הנותר:'
          : 'Select a preset that fits the remaining time:'
        }
      </p>
      
      <div className="space-y-2">
        {presetAnalysis.map(({ preset, result }) => (
          <Card 
            key={preset.id}
            className={`cursor-pointer transition-colors ${
              result.fits 
                ? 'hover:border-success/50' 
                : 'opacity-50 cursor-not-allowed'
            }`}
            onClick={() => result.fits && handleSelectPreset(preset)}
          >
            <CardContent className="p-3 flex items-center gap-3">
              {result.fits 
                ? <CheckCircle className="w-4 h-4 text-success" />
                : <XCircle className="w-4 h-4 text-destructive" />
              }
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {preset.isRecommended && <Star className="w-3 h-3 text-warning fill-warning" />}
                  <span className="font-medium">{preset.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {preset.unitsPerPlate} {language === 'he' ? 'יחידות' : 'units'} • {formatHoursToHuman(preset.cycleHours)}
                </p>
              </div>
              {result.fits && (
                <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                  {language === 'he' ? 'מתאים' : 'Fits'}
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      
      <Button 
        variant="ghost" 
        onClick={() => setStep('options')}
        className="w-full text-muted-foreground"
      >
        {language === 'he' ? 'חזרה' : 'Back'}
      </Button>
    </div>
  );
  
  const renderCreatePresetStep = () => (
    <div className="space-y-4">
      <GuidedPresetCreator
        constraints={constraints}
        product={product}
        onSave={handleCreatePreset}
        onCancel={() => setStep('options')}
      />
    </div>
  );
  
  const renderContent = () => {
    switch (step) {
      case 'problem':
        return renderProblemStep();
      case 'options':
        return renderOptionsStep();
      case 'select_preset':
        return renderSelectPresetStep();
      case 'create_preset':
        return renderCreatePresetStep();
      default:
        return null;
    }
  };
  
  const getTitle = () => {
    switch (step) {
      case 'problem':
        return language === 'he' ? 'בעיה בתכנון' : 'Planning Issue';
      case 'options':
        return language === 'he' ? 'בחר פתרון' : 'Choose Solution';
      case 'select_preset':
        return language === 'he' ? 'בחר פריסה' : 'Select Preset';
      case 'create_preset':
        return language === 'he' ? 'צור פריסה חדשה' : 'Create New Preset';
      default:
        return '';
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            {getTitle()}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
};
