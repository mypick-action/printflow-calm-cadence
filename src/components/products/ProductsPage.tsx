import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Package, Pencil, Star, Check } from 'lucide-react';
import { 
  getProducts, 
  Product, 
  getGramsPerCycle,
} from '@/services/storage';
import { ProductEditorModal } from './ProductEditorModal';

export const ProductsPage: React.FC = () => {
  const { language } = useLanguage();
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  useEffect(() => {
    setProducts(getProducts());
  }, []);

  const handleOpenDialog = (product?: Product) => {
    setEditingProduct(product || null);
    setDialogOpen(true);
  };

  const handleProductSaved = () => {
    setProducts(getProducts());
    setEditingProduct(null);
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
        
        <Button className="gap-2" onClick={() => handleOpenDialog()}>
          <Plus className="w-4 h-4" />
          {language === 'he' ? 'מוצר חדש' : 'New Product'}
        </Button>
      </div>

      {/* Product Editor Modal */}
      <ProductEditorModal
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingProduct={editingProduct}
        onProductSaved={handleProductSaved}
      />

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
