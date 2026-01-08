// SplitOrderPanel - Split a project order by deadline
// Creates multiple sub-projects with different quantities and deadlines

import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calendar, Plus, Trash2, Split, AlertTriangle } from 'lucide-react';
import { format, addDays } from 'date-fns';

export interface SplitPart {
  id: string;
  quantity: number;
  dueDate: string;
  label: string; // e.g., "שבוע הבא", "עוד שבועיים"
}

interface SplitOrderPanelProps {
  totalQuantity: number;
  initialDueDate: string;
  onSplitsChange: (splits: SplitPart[]) => void;
  onCancel: () => void;
}

const generateId = () => crypto.randomUUID().slice(0, 8);

export const SplitOrderPanel: React.FC<SplitOrderPanelProps> = ({
  totalQuantity,
  initialDueDate,
  onSplitsChange,
  onCancel,
}) => {
  const { language } = useLanguage();
  
  // Initialize with two parts
  const [splits, setSplits] = useState<SplitPart[]>(() => {
    const halfQty = Math.ceil(totalQuantity / 2);
    const nextWeek = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const twoWeeks = format(addDays(new Date(), 14), 'yyyy-MM-dd');
    
    return [
      { 
        id: generateId(), 
        quantity: halfQty, 
        dueDate: initialDueDate || nextWeek,
        label: language === 'he' ? 'חלק ראשון' : 'Part 1'
      },
      { 
        id: generateId(), 
        quantity: totalQuantity - halfQty, 
        dueDate: twoWeeks,
        label: language === 'he' ? 'חלק שני' : 'Part 2'
      },
    ];
  });

  // Calculate remaining/excess quantity
  const allocatedQuantity = splits.reduce((sum, s) => sum + s.quantity, 0);
  const remainingQuantity = totalQuantity - allocatedQuantity;
  const isValid = remainingQuantity === 0 && splits.every(s => s.quantity > 0 && s.dueDate);

  // Update parent when splits change
  useEffect(() => {
    if (isValid) {
      onSplitsChange(splits);
    }
  }, [splits, isValid, onSplitsChange]);

  const updateSplit = (id: string, field: keyof SplitPart, value: string | number) => {
    setSplits(prev => prev.map(s => 
      s.id === id ? { ...s, [field]: value } : s
    ));
  };

  const addSplit = () => {
    if (splits.length >= 5) return; // Max 5 parts
    setSplits(prev => [...prev, {
      id: generateId(),
      quantity: 0,
      dueDate: format(addDays(new Date(), 7 * (prev.length + 1)), 'yyyy-MM-dd'),
      label: language === 'he' ? `חלק ${prev.length + 1}` : `Part ${prev.length + 1}`,
    }]);
  };

  const removeSplit = (id: string) => {
    if (splits.length <= 2) return; // Minimum 2 parts
    setSplits(prev => prev.filter(s => s.id !== id));
  };

  const autoDistribute = () => {
    const perPart = Math.floor(totalQuantity / splits.length);
    const remainder = totalQuantity % splits.length;
    
    setSplits(prev => prev.map((s, i) => ({
      ...s,
      quantity: perPart + (i === 0 ? remainder : 0),
    })));
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Split className="w-4 h-4 text-primary" />
          <span className="font-medium">
            {language === 'he' ? 'פיצול לפי דדליין' : 'Split by Deadline'}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {language === 'he' ? 'ביטול פיצול' : 'Cancel Split'}
        </Button>
      </div>

      {/* Quantity Status */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {language === 'he' ? `סה״כ: ${totalQuantity} יחידות` : `Total: ${totalQuantity} units`}
        </span>
        {remainingQuantity !== 0 && (
          <Badge variant={remainingQuantity > 0 ? 'outline' : 'destructive'} className="gap-1">
            <AlertTriangle className="w-3 h-3" />
            {remainingQuantity > 0 
              ? (language === 'he' ? `${remainingQuantity} לא מחולקות` : `${remainingQuantity} unallocated`)
              : (language === 'he' ? `${Math.abs(remainingQuantity)} חריגה` : `${Math.abs(remainingQuantity)} over`)
            }
          </Badge>
        )}
        {remainingQuantity === 0 && (
          <Badge variant="secondary" className="bg-success/10 text-success">
            {language === 'he' ? 'מחולק בשלמות' : 'Fully allocated'}
          </Badge>
        )}
      </div>

      {/* Split Parts */}
      <div className="space-y-3">
        {splits.map((split, index) => (
          <div key={split.id} className="flex items-end gap-2 p-3 bg-background rounded-lg border">
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">
                {language === 'he' ? 'תווית' : 'Label'}
              </Label>
              <Input
                value={split.label}
                onChange={(e) => updateSplit(split.id, 'label', e.target.value)}
                placeholder={language === 'he' ? 'חלק 1' : 'Part 1'}
                className="h-8"
              />
            </div>
            <div className="w-24 space-y-1">
              <Label className="text-xs text-muted-foreground">
                {language === 'he' ? 'כמות' : 'Qty'}
              </Label>
              <Input
                type="number"
                min={1}
                max={totalQuantity}
                value={split.quantity}
                onChange={(e) => updateSplit(split.id, 'quantity', parseInt(e.target.value) || 0)}
                className="h-8"
              />
            </div>
            <div className="w-36 space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {language === 'he' ? 'דדליין' : 'Deadline'}
              </Label>
              <Input
                type="date"
                value={split.dueDate}
                onChange={(e) => updateSplit(split.id, 'dueDate', e.target.value)}
                className="h-8"
              />
            </div>
            {splits.length > 2 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => removeSplit(split.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {splits.length < 5 && (
          <Button variant="outline" size="sm" onClick={addSplit} className="gap-1">
            <Plus className="w-3 h-3" />
            {language === 'he' ? 'הוסף חלק' : 'Add Part'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={autoDistribute}>
          {language === 'he' ? 'חלק שווה' : 'Distribute Evenly'}
        </Button>
      </div>

      {/* Help Text */}
      <p className="text-xs text-muted-foreground">
        {language === 'he' 
          ? 'כל חלק ייווצר כפרויקט נפרד עם הדדליין שלו. התכנון יתעדף לפי דחיפות.'
          : 'Each part will be created as a separate project with its own deadline. Planning will prioritize by urgency.'}
      </p>
    </div>
  );
};
