import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { 
  Clock, 
  Package, 
  ArrowRight,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

export type MaterialAvailability = 'enough' | 'need_new_spool' | 'unknown';

export interface RecoveryInputData {
  estimatedPrintHours: number;
  materialAvailability: MaterialAvailability;
  needsSpoolChange: boolean;
}

interface RecoveryInputStepProps {
  unitsToRecover: number;
  gramsPerUnit: number;
  color: string;
  onSubmit: (data: RecoveryInputData) => void;
  onBack: () => void;
}

export const RecoveryInputStep: React.FC<RecoveryInputStepProps> = ({
  unitsToRecover,
  gramsPerUnit,
  color,
  onSubmit,
  onBack,
}) => {
  const { language } = useLanguage();
  const [estimatedHours, setEstimatedHours] = useState<number>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(0);
  const [materialStatus, setMaterialStatus] = useState<MaterialAvailability>('unknown');
  
  // Calculate estimated material needed
  const gramsNeeded = unitsToRecover * gramsPerUnit;
  
  // Calculate total hours
  const totalHours = estimatedHours + (estimatedMinutes / 60);
  
  const isValid = totalHours > 0 && materialStatus !== 'unknown';

  const handleSubmit = () => {
    if (!isValid) return;
    
    onSubmit({
      estimatedPrintHours: totalHours,
      materialAvailability: materialStatus,
      needsSpoolChange: materialStatus === 'need_new_spool',
    });
  };

  return (
    <Card variant="elevated" className="animate-fade-in">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="w-5 h-5 text-primary" />
            {language === 'he' ? 'נתוני השלמה' : 'Recovery Details'}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onBack}>
            {language === 'he' ? 'חזרה' : 'Back'}
          </Button>
        </div>
        <CardDescription>
          {language === 'he' 
            ? `לפני חישוב ההשפעה על הלו״ז, נדרשים נתונים נוספים`
            : `Before calculating schedule impact, we need additional data`}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Summary of what needs to be recovered */}
        <div className="p-4 bg-warning/10 border border-warning/30 rounded-xl">
          <div className="flex items-center gap-2 text-warning font-medium mb-2">
            <AlertCircle className="w-4 h-4" />
            {language === 'he' ? 'יחידות להשלמה' : 'Units to Recover'}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {language === 'he' ? 'כמות:' : 'Quantity:'}
            </span>
            <span className="font-bold text-foreground">{unitsToRecover} {language === 'he' ? 'יחידות' : 'units'}</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-muted-foreground">
              {language === 'he' ? 'חומר נדרש:' : 'Material needed:'}
            </span>
            <span className="font-bold text-foreground">~{gramsNeeded}g ({color})</span>
          </div>
        </div>

        {/* Question 1: Estimated print time */}
        <div className="space-y-3">
          <Label className="text-base font-medium flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            {language === 'he' 
              ? 'כמה זמן ייקח להדפיס את יחידות ההשלמה?' 
              : 'How long will it take to print the recovery units?'}
          </Label>
          <p className="text-sm text-muted-foreground">
            {language === 'he' 
              ? 'הערכה שלך – לא חייב להיות מדויק' 
              : 'Your estimate – doesn\'t need to be exact'}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label className="text-sm text-muted-foreground mb-1 block">
                {language === 'he' ? 'שעות' : 'Hours'}
              </Label>
              <Input
                type="number"
                min={0}
                max={24}
                value={estimatedHours || ''}
                onChange={(e) => setEstimatedHours(parseInt(e.target.value) || 0)}
                className="h-12 text-center text-lg"
                placeholder="0"
              />
            </div>
            <span className="text-2xl text-muted-foreground pt-5">:</span>
            <div className="flex-1">
              <Label className="text-sm text-muted-foreground mb-1 block">
                {language === 'he' ? 'דקות' : 'Minutes'}
              </Label>
              <Input
                type="number"
                min={0}
                max={59}
                step={15}
                value={estimatedMinutes || ''}
                onChange={(e) => setEstimatedMinutes(parseInt(e.target.value) || 0)}
                className="h-12 text-center text-lg"
                placeholder="0"
              />
            </div>
          </div>
          {/* Quick time buttons */}
          <div className="flex gap-2 flex-wrap">
            {[
              { label: '30 דק׳', hours: 0, minutes: 30 },
              { label: '1 שעה', hours: 1, minutes: 0 },
              { label: '2 שעות', hours: 2, minutes: 0 },
              { label: '3 שעות', hours: 3, minutes: 0 },
              { label: '5 שעות', hours: 5, minutes: 0 },
            ].map((preset) => (
              <Button
                key={preset.label}
                variant={estimatedHours === preset.hours && estimatedMinutes === preset.minutes ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setEstimatedHours(preset.hours);
                  setEstimatedMinutes(preset.minutes);
                }}
              >
                {language === 'he' ? preset.label : `${preset.hours}h ${preset.minutes}m`}
              </Button>
            ))}
          </div>
        </div>

        {/* Question 2: Material availability */}
        <div className="space-y-3">
          <Label className="text-base font-medium flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            {language === 'he' 
              ? 'האם יש מספיק חומר גלם על הגליל הנוכחי?' 
              : 'Is there enough material on the current spool?'}
          </Label>
          
          <RadioGroup 
            value={materialStatus} 
            onValueChange={(v) => setMaterialStatus(v as MaterialAvailability)}
            className="space-y-2"
          >
            <div 
              className={`
                flex items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer
                ${materialStatus === 'enough' 
                  ? 'border-success bg-success/10' 
                  : 'border-border hover:border-success/50'}
              `}
              onClick={() => setMaterialStatus('enough')}
            >
              <RadioGroupItem value="enough" id="enough" />
              <CheckCircle2 className={`w-5 h-5 ${materialStatus === 'enough' ? 'text-success' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <Label htmlFor="enough" className="font-medium cursor-pointer">
                  {language === 'he' ? 'כן, יש מספיק' : 'Yes, there\'s enough'}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {language === 'he' 
                    ? 'לא צריך להחליף גליל' 
                    : 'No spool change needed'}
                </p>
              </div>
            </div>
            
            <div 
              className={`
                flex items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer
                ${materialStatus === 'need_new_spool' 
                  ? 'border-warning bg-warning/10' 
                  : 'border-border hover:border-warning/50'}
              `}
              onClick={() => setMaterialStatus('need_new_spool')}
            >
              <RadioGroupItem value="need_new_spool" id="need_new_spool" />
              <Package className={`w-5 h-5 ${materialStatus === 'need_new_spool' ? 'text-warning' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <Label htmlFor="need_new_spool" className="font-medium cursor-pointer">
                  {language === 'he' ? 'לא, צריך גליל חדש' : 'No, need a new spool'}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {language === 'he' 
                    ? 'יש להכין גליל נוסף' 
                    : 'Another spool needs to be prepared'}
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>

        {/* Summary before continuing */}
        {isValid && (
          <div className="p-4 bg-primary/10 border border-primary/30 rounded-xl space-y-2">
            <div className="font-medium text-primary">
              {language === 'he' ? 'סיכום ההערכה שלך:' : 'Your estimate summary:'}
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {language === 'he' ? 'זמן הדפסה:' : 'Print time:'}
                </span>
                <span className="font-medium">
                  {estimatedHours > 0 && `${estimatedHours} ${language === 'he' ? 'שעות' : 'h'}`}
                  {estimatedHours > 0 && estimatedMinutes > 0 && ' '}
                  {estimatedMinutes > 0 && `${estimatedMinutes} ${language === 'he' ? 'דקות' : 'm'}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {language === 'he' ? 'החלפת גליל:' : 'Spool change:'}
                </span>
                <span className="font-medium">
                  {materialStatus === 'enough' 
                    ? (language === 'he' ? 'לא נדרשת' : 'Not needed')
                    : (language === 'he' ? 'נדרשת' : 'Needed')
                  }
                </span>
              </div>
            </div>
          </div>
        )}

        <Button 
          onClick={handleSubmit} 
          className="w-full h-14 text-lg gap-2"
          disabled={!isValid}
        >
          {language === 'he' ? 'המשך לחישוב השפעה' : 'Continue to Impact Analysis'}
          <ArrowRight className="w-5 h-5" />
        </Button>
      </CardContent>
    </Card>
  );
};
