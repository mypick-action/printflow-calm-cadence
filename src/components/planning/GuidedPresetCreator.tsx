// GuidedPresetCreator Component
// Creates a new plate preset with live constraint validation
// The system validates if the preset fits - it NEVER suggests how many units

import React, { useState, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Check, 
  X, 
  Clock, 
  Package, 
  Shield, 
  Moon,
  Lightbulb,
  Target,
} from 'lucide-react';
import { 
  PlanningConstraints,
  validateNewPreset,
  formatHoursToHuman,
} from '@/services/constraintCalculator';
import { PlatePreset, Product, getProducts } from '@/services/storage';

interface GuidedPresetCreatorProps {
  constraints: PlanningConstraints;
  product: Product;
  onSave: (preset: PlatePreset) => void;
  onCancel: () => void;
}

const generatePresetId = () => `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const GuidedPresetCreator: React.FC<GuidedPresetCreatorProps> = ({
  constraints,
  product,
  onSave,
  onCancel,
}) => {
  const { language } = useLanguage();
  
  const [formData, setFormData] = useState({
    name: language === 'he' ? 'מהיר' : 'Quick',
    unitsPerPlate: 4,
    cycleHours: 1.5,
    riskLevel: 'low' as 'low' | 'medium' | 'high',
    allowedForNightCycle: true,
  });
  
  // Live validation
  const validation = useMemo(() => {
    return validateNewPreset(
      formData.unitsPerPlate,
      formData.cycleHours,
      formData.riskLevel,
      formData.allowedForNightCycle,
      product.gramsPerUnit,
      constraints
    );
  }, [formData, product.gramsPerUnit, constraints]);
  
  const gramsPerCycle = product.gramsPerUnit * formData.unitsPerPlate;
  
  const handleSave = () => {
    const preset: PlatePreset = {
      id: generatePresetId(),
      name: formData.name,
      unitsPerPlate: formData.unitsPerPlate,
      cycleHours: formData.cycleHours,
      riskLevel: formData.riskLevel,
      allowedForNightCycle: formData.allowedForNightCycle,
      isRecommended: false,
    };
    onSave(preset);
  };
  
  const StatusIcon = ({ fits }: { fits: boolean }) => (
    fits 
      ? <Check className="w-4 h-4 text-success" />
      : <X className="w-4 h-4 text-destructive" />
  );
  
  return (
    <div className="space-y-4">
      {/* Target Constraints Box - Always visible at top */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            {language === 'he' ? 'יעד: דרישות להיום' : 'Target: Today\'s Requirements'}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {language === 'he' ? 'זמן מחזור' : 'Cycle time'}
              </span>
              <Badge variant="outline" className="font-mono">
                ≤ {formatHoursToHuman(constraints.maxCycleHours)}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {language === 'he' ? 'חומר' : 'Filament'}
              </span>
              <Badge variant="outline" className="font-mono">
                ≤ {constraints.maxFilamentGrams}g
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Guidance note */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-sm">
        <Lightbulb className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
        <p className="text-muted-foreground">
          {language === 'he' 
            ? 'הזינו את הנתונים מהסלייסר או מניסיון קודם. המערכת תאמת אם הפריסה מתאימה.'
            : 'Enter values from your slicer or experience. The system will validate if the preset fits.'
          }
        </p>
      </div>
      
      {/* Form */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              {language === 'he' ? 'שם הפריסה' : 'Preset Name'}
            </Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              {language === 'he' ? 'יחידות בפלטה' : 'Units per Plate'}
            </Label>
            <Input
              type="number"
              min={1}
              value={formData.unitsPerPlate}
              onChange={(e) => setFormData({ ...formData, unitsPerPlate: parseInt(e.target.value) || 1 })}
              className="h-9"
            />
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              {language === 'he' ? 'שעות מחזור (מהסלייסר)' : 'Cycle Hours (from slicer)'}
            </Label>
            <Input
              type="number"
              min={0.5}
              step={0.25}
              value={formData.cycleHours}
              onChange={(e) => setFormData({ ...formData, cycleHours: parseFloat(e.target.value) || 0.5 })}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              {language === 'he' ? 'רמת סיכון' : 'Risk Level'}
            </Label>
            <Select 
              value={formData.riskLevel} 
              onValueChange={(v) => setFormData({ ...formData, riskLevel: v as 'low' | 'medium' | 'high' })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg">
                <SelectItem value="low">{language === 'he' ? 'נמוך' : 'Low'}</SelectItem>
                <SelectItem value="medium">{language === 'he' ? 'בינוני' : 'Medium'}</SelectItem>
                <SelectItem value="high">{language === 'he' ? 'גבוה' : 'High'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Switch
            checked={formData.allowedForNightCycle}
            onCheckedChange={(v) => setFormData({ ...formData, allowedForNightCycle: v })}
          />
          <Label className="text-sm">
            {language === 'he' ? 'מותר להדפסת לילה' : 'Allowed for night printing'}
          </Label>
        </div>
      </div>
      
      {/* Live Validation Results */}
      <Card className={validation.fits ? 'border-success/50 bg-success/5' : 'border-destructive/50 bg-destructive/5'}>
        <CardContent className="py-3">
          <div className="flex items-center gap-2 mb-3">
            {validation.fits 
              ? <Check className="w-5 h-5 text-success" />
              : <X className="w-5 h-5 text-destructive" />
            }
            <span className="font-medium">
              {validation.fits 
                ? (language === 'he' ? 'מתאים לדרישות היום' : 'Fits today\'s requirements')
                : (language === 'he' ? 'לא עומד בדרישות' : 'Does not meet requirements')
              }
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <StatusIcon fits={validation.fitsTime} />
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{formatHoursToHuman(formData.cycleHours)}</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon fits={validation.fitsFilament} />
              <Package className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{gramsPerCycle}g</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon fits={validation.fitsRisk} />
              <Shield className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{language === 'he' 
                ? (formData.riskLevel === 'low' ? 'נמוך' : formData.riskLevel === 'medium' ? 'בינוני' : 'גבוה')
                : formData.riskLevel
              }</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon fits={validation.fitsNight} />
              <Moon className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{formData.allowedForNightCycle 
                ? (language === 'he' ? 'מותר' : 'Allowed')
                : (language === 'he' ? 'לא מותר' : 'Not allowed')
              }</span>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">
          {language === 'he' ? 'ביטול' : 'Cancel'}
        </Button>
        <Button 
          onClick={handleSave}
          disabled={!formData.name.trim()}
          className="flex-1"
        >
          {language === 'he' ? 'שמור פריסה' : 'Save Preset'}
        </Button>
      </div>
      
      <p className="text-xs text-muted-foreground text-center">
        {language === 'he' 
          ? 'אתה בוחר את הפריסה – אנחנו מאמתים שהיא מתאימה'
          : 'You decide the layout – we verify it fits'
        }
      </p>
    </div>
  );
};
