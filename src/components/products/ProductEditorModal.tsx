import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, PackagePlus, Trash2, Star, Moon } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  createProduct,
  updateProduct,
  getProducts,
  Product, 
  PlatePreset,
} from '@/services/storage';

const generatePresetId = () => `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

interface ProductEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProduct?: Product | null;
  initialName?: string;
  onProductSaved?: (product: Product) => void;
}

export const ProductEditorModal: React.FC<ProductEditorModalProps> = ({
  open,
  onOpenChange,
  editingProduct = null,
  initialName = '',
  onProductSaved,
}) => {
  const { language } = useLanguage();
  
  const [formData, setFormData] = useState({
    name: '',
    gramsPerUnit: 50,
    platePresets: [] as PlatePreset[],
  });
  
  const [newPreset, setNewPreset] = useState<Partial<PlatePreset> & { cycleHoursInput: number; cycleMinutesInput: number }>({
    name: initialName || '',
    unitsPerPlate: 8,
    cycleHours: 2,
    cycleHoursInput: 2,
    cycleMinutesInput: 0,
    riskLevel: 'low',
    allowedForNightCycle: true,
    isRecommended: false,
    notes: '',
  });

  const [errors, setErrors] = useState<{ name?: string; gramsPerUnit?: string; presets?: string }>({});

  // Initialize form when dialog opens
  useEffect(() => {
    if (open) {
      if (editingProduct) {
        setFormData({
          name: editingProduct.name,
          gramsPerUnit: editingProduct.gramsPerUnit,
          platePresets: [...editingProduct.platePresets],
        });
      } else {
        setFormData({
          name: initialName,
          gramsPerUnit: 50,
          platePresets: [],
        });
        // Also set the initial preset name to the project name
        setNewPreset(prev => ({
          ...prev,
          name: initialName || '',
        }));
      }
      setErrors({});
    }
  }, [open, editingProduct, initialName]);

  const handleAddPreset = () => {
    if (!newPreset.name || !newPreset.unitsPerPlate) return;
    
    // Calculate total hours from hours + minutes
    const totalHours = (newPreset.cycleHoursInput || 0) + (newPreset.cycleMinutesInput || 0) / 60;
    if (totalHours <= 0) return;
    
    const preset: PlatePreset = {
      id: generatePresetId(),
      name: newPreset.name,
      unitsPerPlate: newPreset.unitsPerPlate,
      cycleHours: totalHours,
      riskLevel: newPreset.riskLevel as 'low' | 'medium' | 'high',
      allowedForNightCycle: newPreset.allowedForNightCycle ?? true,
      isRecommended: formData.platePresets.length === 0, // First preset is recommended by default
      notes: newPreset.notes,
    };
    
    setFormData({
      ...formData,
      platePresets: [...formData.platePresets, preset],
    });
    
    setNewPreset({
      name: '',
      unitsPerPlate: 8,
      cycleHours: 2,
      cycleHoursInput: 2,
      cycleMinutesInput: 0,
      riskLevel: 'low',
      allowedForNightCycle: true,
      isRecommended: false,
      notes: '',
    });

    // Clear presets error if we have at least one now
    if (errors.presets) {
      setErrors({ ...errors, presets: undefined });
    }
  };

  const handleRemovePreset = (presetId: string) => {
    setFormData({
      ...formData,
      platePresets: formData.platePresets.filter(p => p.id !== presetId),
    });
  };

  const handleSetRecommended = (presetId: string) => {
    setFormData({
      ...formData,
      platePresets: formData.platePresets.map(p => ({
        ...p,
        isRecommended: p.id === presetId,
      })),
    });
  };

  const hasUnaddedPreset = () => {
    // Check if user has started filling in the preset form but hasn't added it
    return !!(newPreset.name && newPreset.name.trim());
  };

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};
    
    if (!formData.name.trim()) {
      newErrors.name = language === 'he' ? 'חסר שם מוצר' : 'Missing product name';
    }
    if (formData.gramsPerUnit <= 0) {
      newErrors.gramsPerUnit = language === 'he' ? 'חסר גרמים ליחידה' : 'Missing grams per unit';
    }
    if (formData.platePresets.length === 0) {
      // Check if user has started filling a preset but hasn't clicked Add
      if (hasUnaddedPreset()) {
        newErrors.presets = language === 'he' 
          ? 'לחצו על כפתור "הוסף" כדי להוסיף את הפריסה' 
          : 'Click the "Add" button to add the preset';
      } else {
        newErrors.presets = language === 'he' ? 'הוסיפו לפחות פריסת פלטה אחת' : 'Add at least one plate preset';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveProduct = () => {
    if (!validateForm()) return;

    // Ensure at least one preset is recommended
    let presets = formData.platePresets;
    if (!presets.some(p => p.isRecommended)) {
      presets = presets.map((p, idx) => ({ ...p, isRecommended: idx === 0 }));
    }

    if (editingProduct) {
      // Update existing product using storage helper (triggers auto-replan)
      const updated = updateProduct(editingProduct.id, {
        name: formData.name,
        gramsPerUnit: formData.gramsPerUnit,
        platePresets: presets,
      });
      
      if (updated) {
        toast({
          title: language === 'he' ? 'מוצר עודכן' : 'Product updated',
          description: formData.name,
        });
        
        onProductSaved?.(updated);
      }
    } else {
      // Create new product
      const created = createProduct({
        name: formData.name,
        gramsPerUnit: formData.gramsPerUnit,
        platePresets: presets,
      });
      
      toast({
        title: language === 'he' ? 'מוצר נוצר בהצלחה' : 'Product created successfully',
        description: `${created.name} (${created.gramsPerUnit}g)`,
      });
      
      onProductSaved?.(created);
    }

    onOpenChange(false);
  };

  const getRiskBadge = (level: 'low' | 'medium' | 'high') => {
    const config = {
      low: { label: language === 'he' ? 'נמוך' : 'Low', className: 'bg-success/10 text-success border-success/20' },
      medium: { label: language === 'he' ? 'בינוני' : 'Medium', className: 'bg-warning/10 text-warning border-warning/20' },
      high: { label: language === 'he' ? 'גבוה' : 'High', className: 'bg-error/10 text-error border-error/20' },
    };
    return <Badge variant="outline" className={config[level].className}>{config[level].label}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-primary" />
            {editingProduct 
              ? (language === 'he' ? 'עריכת מוצר' : 'Edit Product')
              : (language === 'he' ? 'הוספת מוצר חדש' : 'Add New Product')
            }
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Basic product info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'he' ? 'שם המוצר' : 'Product Name'} *</Label>
              <Input
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (errors.name) setErrors({ ...errors, name: undefined });
                }}
                placeholder={language === 'he' ? 'לדוגמה: מעמד לטלפון' : 'e.g. Phone Stand'}
                className={errors.name ? 'border-error' : ''}
              />
              {errors.name && (
                <p className="text-xs text-error">{errors.name}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{language === 'he' ? 'גרמים ליחידה' : 'Grams per Unit'} *</Label>
              <Input
                type="number"
                min={0.1}
                step="0.1"
                value={formData.gramsPerUnit}
                onChange={(e) => {
                  setFormData({ ...formData, gramsPerUnit: parseFloat(e.target.value) || 0 });
                  if (errors.gramsPerUnit) setErrors({ ...errors, gramsPerUnit: undefined });
                }}
                className={errors.gramsPerUnit ? 'border-error' : ''}
              />
              {errors.gramsPerUnit && (
                <p className="text-xs text-error">{errors.gramsPerUnit}</p>
              )}
            </div>
          </div>

          {/* Plate Presets Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">
                {language === 'he' ? 'פריסות פלטה' : 'Plate Presets'}
              </Label>
              <span className="text-xs text-muted-foreground">
                {language === 'he' ? 'לפחות פריסה אחת נדרשת' : 'At least one preset required'}
              </span>
            </div>

            {errors.presets && (
              <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg animate-pulse">
                <span className="text-warning text-lg">👆</span>
                <p className="text-sm font-medium text-warning">{errors.presets}</p>
              </div>
            )}

            {/* Existing presets */}
            {formData.platePresets.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">{language === 'he' ? 'שם' : 'Name'}</TableHead>
                      <TableHead className="w-[80px]">{language === 'he' ? 'יחידות' : 'Units'}</TableHead>
                      <TableHead className="w-[80px]">{language === 'he' ? 'זמן (שעה:דק)' : 'Time (h:m)'}</TableHead>
                      <TableHead className="w-[100px]">{language === 'he' ? 'גרם/מחזור' : 'g/cycle'}</TableHead>
                      <TableHead className="w-[80px]">{language === 'he' ? 'סיכון' : 'Risk'}</TableHead>
                      <TableHead className="w-[60px]">{language === 'he' ? 'לילה' : 'Night'}</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formData.platePresets.map((preset) => (
                      <TableRow key={preset.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1">
                            {preset.isRecommended && <Star className="w-3 h-3 text-warning fill-warning" />}
                            {preset.name}
                          </div>
                        </TableCell>
                        <TableCell>{preset.unitsPerPlate}</TableCell>
                        <TableCell>
                          {Math.floor(preset.cycleHours)}:{String(Math.round((preset.cycleHours % 1) * 60)).padStart(2, '0')}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formData.gramsPerUnit * preset.unitsPerPlate}g
                        </TableCell>
                        <TableCell>{getRiskBadge(preset.riskLevel)}</TableCell>
                        <TableCell>
                          {preset.allowedForNightCycle 
                            ? <Moon className="w-4 h-4 text-primary" />
                            : <span className="text-muted-foreground">—</span>
                          }
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {!preset.isRecommended && (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-7 w-7 p-0"
                                onClick={() => handleSetRecommended(preset.id)}
                                title={language === 'he' ? 'הגדר כברירת מחדל' : 'Set as recommended'}
                              >
                                <Star className="w-3 h-3" />
                              </Button>
                            )}
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-7 w-7 p-0 text-error hover:text-error"
                              onClick={() => handleRemovePreset(preset.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Add new preset form */}
            <Card className="border-dashed">
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {language === 'he' ? 'הוסף פריסה חדשה' : 'Add New Preset'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{language === 'he' ? 'שם הפריסה' : 'Preset Name'}</Label>
                    <Input
                      value={newPreset.name}
                      onChange={(e) => setNewPreset({ ...newPreset, name: e.target.value })}
                      placeholder="Full, Safe, Night..."
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{language === 'he' ? 'יחידות בפלטה' : 'Units/Plate'}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={newPreset.unitsPerPlate}
                      onChange={(e) => setNewPreset({ ...newPreset, unitsPerPlate: parseInt(e.target.value) || 0 })}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{language === 'he' ? 'שעות' : 'Hours'}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={newPreset.cycleHoursInput}
                      onChange={(e) => setNewPreset({ ...newPreset, cycleHoursInput: parseInt(e.target.value) || 0 })}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{language === 'he' ? 'דקות' : 'Minutes'}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      step={5}
                      value={newPreset.cycleMinutesInput}
                      onChange={(e) => setNewPreset({ ...newPreset, cycleMinutesInput: parseInt(e.target.value) || 0 })}
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 space-y-1">
                    <Label className="text-xs">{language === 'he' ? 'רמת סיכון' : 'Risk Level'}</Label>
                    <Select 
                      value={newPreset.riskLevel} 
                      onValueChange={(v) => setNewPreset({ ...newPreset, riskLevel: v as 'low' | 'medium' | 'high' })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border shadow-lg">
                        <SelectItem value="low">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-success" />
                            {language === 'he' ? 'נמוך - מותר בלילה' : 'Low - Night allowed'}
                          </span>
                        </SelectItem>
                        <SelectItem value="medium">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-warning" />
                            {language === 'he' ? 'בינוני - יופיע כאזהרה' : 'Medium - Shows warning'}
                          </span>
                        </SelectItem>
                        <SelectItem value="high">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-error" />
                            {language === 'he' ? 'גבוה - לא מומלץ ללילה' : 'High - Not for night'}
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">
                      {language === 'he' 
                        ? 'סיכון גבוה/בינוני מוגבל בלילה ומופיע עם אזהרה' 
                        : 'Medium/High risk is restricted at night'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={newPreset.allowedForNightCycle}
                        onCheckedChange={(v) => setNewPreset({ ...newPreset, allowedForNightCycle: v })}
                      />
                      <Label className="text-sm">{language === 'he' ? 'מותר בלילה' : 'Night allowed'}</Label>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={handleAddPreset}
                    disabled={!newPreset.name || !newPreset.unitsPerPlate || ((newPreset.cycleHoursInput || 0) + (newPreset.cycleMinutesInput || 0)) <= 0}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    {language === 'he' ? 'הוסף' : 'Add'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Save buttons */}
          <div className="flex gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button 
              onClick={handleSaveProduct} 
              className="flex-1"
            >
              {editingProduct 
                ? (language === 'he' ? 'שמור שינויים' : 'Save Changes')
                : (language === 'he' ? 'צור מוצר' : 'Create Product')
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
