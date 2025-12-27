import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OnboardingData } from './OnboardingWizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, Plus, Info } from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Step3Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
}

export const Step3Materials: React.FC<Step3Props> = ({ data, updateData }) => {
  const { t } = useLanguage();
  const [newColor, setNewColor] = useState('');
  
  const handleAddColor = () => {
    if (newColor.trim() && !data.colors.includes(newColor.trim())) {
      updateData({ colors: [...data.colors, newColor.trim()] });
      setNewColor('');
    }
  };
  
  const handleRemoveColor = (colorToRemove: string) => {
    updateData({ colors: data.colors.filter(c => c !== colorToRemove) });
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddColor();
    }
  };
  
  return (
    <div className="space-y-8">
      {/* Colors */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Label className="text-base font-medium">{t('onboarding.step3.colors')}</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{t('onboarding.step3.tooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        
        <div className="flex flex-wrap gap-2 p-4 bg-muted/50 rounded-xl min-h-[100px]">
          {data.colors.map((color) => (
            <div
              key={color}
              className="group flex items-center gap-2 px-3 py-2 bg-card rounded-lg border border-border shadow-sm transition-all hover:shadow-md"
            >
              <SpoolIcon color={getSpoolColor(color)} size={24} />
              <span className="text-sm font-medium">{color}</span>
              <button
                onClick={() => handleRemoveColor(color)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-destructive-light rounded"
              >
                <X className="w-3.5 h-3.5 text-destructive" />
              </button>
            </div>
          ))}
        </div>
        
        <div className="flex gap-2">
          <Input
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('onboarding.step3.addColor')}
            className="flex-1"
          />
          <Button variant="soft" onClick={handleAddColor} disabled={!newColor.trim()}>
            <Plus className="w-4 h-4" />
            {t('common.add')}
          </Button>
        </div>
      </div>
      
      {/* Spool weight */}
      <div className="space-y-3">
        <Label className="text-base font-medium">{t('onboarding.step3.spoolWeight')}</Label>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            value={data.spoolWeight}
            onChange={(e) => updateData({ spoolWeight: parseInt(e.target.value) || 1000 })}
            className="w-32"
            min={100}
            max={5000}
            step={100}
          />
          <span className="text-muted-foreground">g</span>
        </div>
      </div>
      
      {/* Delivery days */}
      <div className="space-y-3">
        <Label className="text-base font-medium">{t('onboarding.step3.deliveryDays')}</Label>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            value={data.deliveryDays}
            onChange={(e) => updateData({ deliveryDays: parseInt(e.target.value) || 1 })}
            className="w-24"
            min={1}
            max={30}
          />
        </div>
      </div>
    </div>
  );
};
