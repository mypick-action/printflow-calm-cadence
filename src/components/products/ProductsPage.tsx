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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Package, Pencil, Trash2, Star, AlertTriangle, Moon, Check } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getProducts, 
  createProduct,
  Product, 
  PlatePreset,
  getGramsPerCycle,
} from '@/services/storage';

const generatePresetId = () => `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const ProductsPage: React.FC = () => {
  const { language } = useLanguage();
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    gramsPerUnit: 50,
    platePresets: [] as PlatePreset[],
  });
  
  const [newPreset, setNewPreset] = useState<Partial<PlatePreset>>({
    name: '',
    unitsPerPlate: 8,
    cycleHours: 2,
    riskLevel: 'low',
    allowedForNightCycle: true,
    isRecommended: false,
    notes: '',
  });

  useEffect(() => {
    setProducts(getProducts());
  }, []);

  const handleOpenDialog = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        gramsPerUnit: product.gramsPerUnit,
        platePresets: [...product.platePresets],
      });
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        gramsPerUnit: 50,
        platePresets: [],
      });
    }
    setDialogOpen(true);
  };

  const handleAddPreset = () => {
    if (!newPreset.name || !newPreset.unitsPerPlate || !newPreset.cycleHours) return;
    
    const preset: PlatePreset = {
      id: generatePresetId(),
      name: newPreset.name,
      unitsPerPlate: newPreset.unitsPerPlate,
      cycleHours: newPreset.cycleHours,
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
      riskLevel: 'low',
      allowedForNightCycle: true,
      isRecommended: false,
      notes: '',
    });
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

  const handleSaveProduct = () => {
    if (!formData.name || formData.gramsPerUnit <= 0 || formData.platePresets.length === 0) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'יש למלא את כל השדות ולהוסיף לפחות פריסת פלטה אחת' : 'Please fill all fields and add at least one plate preset',
        variant: 'destructive',
      });
      return;
    }

    // Ensure at least one preset is recommended
    let presets = formData.platePresets;
    if (!presets.some(p => p.isRecommended)) {
      presets = presets.map((p, idx) => ({ ...p, isRecommended: idx === 0 }));
    }

    if (editingProduct) {
      // Update existing product
      const allProducts = getProducts();
      const updatedProducts = allProducts.map(p => 
        p.id === editingProduct.id 
          ? { ...p, name: formData.name, gramsPerUnit: formData.gramsPerUnit, platePresets: presets }
          : p
      );
      localStorage.setItem('printflow_products', JSON.stringify(updatedProducts));
      setProducts(updatedProducts);
      toast({
        title: language === 'he' ? 'מוצר עודכן' : 'Product updated',
        description: formData.name,
      });
    } else {
      // Create new product
      const created = createProduct({
        name: formData.name,
        gramsPerUnit: formData.gramsPerUnit,
        platePresets: presets,
      });
      setProducts(getProducts());
      toast({
        title: language === 'he' ? 'מוצר נוצר' : 'Product created',
        description: created.name,
      });
    }

    setDialogOpen(false);
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <Package className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {language === 'he' ? 'מוצרים ופריסות' : 'Products & Presets'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {language === 'he' ? 'ניהול מוצרים ותצורות הדפסה' : 'Manage products and print configurations'}
            </p>
          </div>
        </div>
        
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => handleOpenDialog()}>
              <Plus className="w-4 h-4" />
              {language === 'he' ? 'מוצר חדש' : 'New Product'}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
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
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={language === 'he' ? 'לדוגמה: מעמד לטלפון' : 'e.g. Phone Stand'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'he' ? 'גרמים ליחידה' : 'Grams per Unit'} *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={formData.gramsPerUnit}
                    onChange={(e) => setFormData({ ...formData, gramsPerUnit: parseInt(e.target.value) || 0 })}
                  />
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

                {/* Existing presets */}
                {formData.platePresets.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[120px]">{language === 'he' ? 'שם' : 'Name'}</TableHead>
                          <TableHead className="w-[80px]">{language === 'he' ? 'יחידות' : 'Units'}</TableHead>
                          <TableHead className="w-[80px]">{language === 'he' ? 'שעות' : 'Hours'}</TableHead>
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
                            <TableCell>{preset.cycleHours}h</TableCell>
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
                        <Label className="text-xs">{language === 'he' ? 'שעות מחזור' : 'Cycle Hours'}</Label>
                        <Input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={newPreset.cycleHours}
                          onChange={(e) => setNewPreset({ ...newPreset, cycleHours: parseFloat(e.target.value) || 0 })}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{language === 'he' ? 'רמת סיכון' : 'Risk Level'}</Label>
                        <Select 
                          value={newPreset.riskLevel} 
                          onValueChange={(v) => setNewPreset({ ...newPreset, riskLevel: v as 'low' | 'medium' | 'high' })}
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
                        disabled={!newPreset.name || !newPreset.unitsPerPlate || !newPreset.cycleHours}
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
                <Button variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                  {language === 'he' ? 'ביטול' : 'Cancel'}
                </Button>
                <Button 
                  onClick={handleSaveProduct} 
                  className="flex-1"
                  disabled={!formData.name || formData.gramsPerUnit <= 0 || formData.platePresets.length === 0}
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
      </div>

      {/* Products List */}
      <div className="space-y-4">
        {products.map((product) => (
          <Card key={product.id} className="overflow-hidden">
            <div 
              className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => setExpandedProductId(expandedProductId === product.id ? null : product.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Package className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{product.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {product.gramsPerUnit}g {language === 'he' ? 'ליחידה' : 'per unit'} • {product.platePresets.length} {language === 'he' ? 'פריסות' : 'presets'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={(e) => { e.stopPropagation(); handleOpenDialog(product); }}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
            
            {expandedProductId === product.id && (
              <div className="border-t bg-muted/30 p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{language === 'he' ? 'פריסה' : 'Preset'}</TableHead>
                      <TableHead className="text-center">{language === 'he' ? 'יחידות/פלטה' : 'Units/Plate'}</TableHead>
                      <TableHead className="text-center">{language === 'he' ? 'שעות' : 'Hours'}</TableHead>
                      <TableHead className="text-center">{language === 'he' ? 'גרם/מחזור' : 'g/cycle'}</TableHead>
                      <TableHead className="text-center">{language === 'he' ? 'סיכון' : 'Risk'}</TableHead>
                      <TableHead className="text-center">{language === 'he' ? 'לילה' : 'Night'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.platePresets.map((preset) => (
                      <TableRow key={preset.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {preset.isRecommended && (
                              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs">
                                <Star className="w-3 h-3 mr-1 fill-warning" />
                                {language === 'he' ? 'מומלץ' : 'Recommended'}
                              </Badge>
                            )}
                            <span className="font-medium">{preset.name}</span>
                          </div>
                          {preset.notes && (
                            <p className="text-xs text-muted-foreground mt-1">{preset.notes}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{preset.unitsPerPlate}</TableCell>
                        <TableCell className="text-center">{preset.cycleHours}h</TableCell>
                        <TableCell className="text-center font-medium">
                          {getGramsPerCycle(product, preset)}g
                        </TableCell>
                        <TableCell className="text-center">{getRiskBadge(preset.riskLevel)}</TableCell>
                        <TableCell className="text-center">
                          {preset.allowedForNightCycle 
                            ? <Check className="w-4 h-4 text-success mx-auto" />
                            : <span className="text-muted-foreground">—</span>
                          }
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        ))}

        {products.length === 0 && (
          <Card className="p-8 text-center">
            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold mb-2">
              {language === 'he' ? 'אין מוצרים עדיין' : 'No products yet'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {language === 'he' ? 'הוסיפו את המוצר הראשון כדי להתחיל' : 'Add your first product to get started'}
            </p>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="w-4 h-4 mr-2" />
              {language === 'he' ? 'מוצר חדש' : 'New Product'}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
};
