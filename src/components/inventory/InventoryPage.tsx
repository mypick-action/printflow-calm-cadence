import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Package, Plus, Minus, AlertTriangle, Edit2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { 
  getColorInventory,
  upsertColorInventoryItem,
  adjustClosedCount,
  setOpenTotalGrams,
  getFactorySettings,
  ColorInventoryItem,
  getTotalGrams,
} from '@/services/storage';
import { subscribeToInventoryChanges } from '@/services/inventoryEvents';

export const InventoryPage: React.FC = () => {
  const { language } = useLanguage();
  const [inventory, setInventory] = useState<ColorInventoryItem[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>(['Black', 'White', 'Gray', 'Red', 'Blue', 'Green']);
  
  // Quick add states
  const [quickAddColor, setQuickAddColor] = useState('Black');
  const [quickAddMaterial, setQuickAddMaterial] = useState('PLA');
  const [quickAddCount, setQuickAddCount] = useState(1);
  const [quickAddSpoolSize, setQuickAddSpoolSize] = useState(1000);
  
  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ColorInventoryItem | null>(null);
  const [editOpenGrams, setEditOpenGrams] = useState(0);

  useEffect(() => {
    refreshData();
    const unsubscribe = subscribeToInventoryChanges(refreshData);
    return unsubscribe;
  }, []);

  const refreshData = () => {
    setInventory(getColorInventory());
    const settings = getFactorySettings();
    const defaultColors = ['Black', 'White', 'Gray', 'Red', 'Blue', 'Green'];
    const colors = settings?.colors?.length > 0 ? settings.colors : defaultColors;
    setAvailableColors(colors);
  };

  const handleAddClosedSpools = () => {
    if (!quickAddColor || quickAddCount <= 0) return;
    
    const existing = inventory.find(i => 
      i.color.toLowerCase() === quickAddColor.toLowerCase() && 
      i.material.toLowerCase() === quickAddMaterial.toLowerCase()
    );
    
    if (existing) {
      adjustClosedCount(quickAddColor, quickAddMaterial, quickAddCount);
    } else {
      upsertColorInventoryItem({
        color: quickAddColor,
        material: quickAddMaterial,
        closedCount: quickAddCount,
        closedSpoolSizeGrams: quickAddSpoolSize,
        openTotalGrams: 0,
        reorderPointGrams: 2000,
      });
    }
    
    refreshData();
    setQuickAddCount(1);
    
    toast({
      title: language === 'he' ? 'גלילים נוספו' : 'Spools added',
      description: `+${quickAddCount} ${quickAddColor} ${quickAddMaterial}`,
    });
  };

  const handleAdjustClosed = (item: ColorInventoryItem, delta: number) => {
    if (item.closedCount + delta < 0) return;
    adjustClosedCount(item.color, item.material, delta);
    refreshData();
  };

  const handleOpenEditDialog = (item: ColorInventoryItem) => {
    setEditingItem(item);
    setEditOpenGrams(item.openTotalGrams);
    setEditDialogOpen(true);
  };

  const handleSaveOpenGrams = () => {
    if (!editingItem) return;
    setOpenTotalGrams(editingItem.color, editingItem.material, editOpenGrams);
    refreshData();
    setEditDialogOpen(false);
    setEditingItem(null);
    toast({
      title: language === 'he' ? 'מלאי עודכן' : 'Inventory updated',
    });
  };

  // Note: Opening new spools happens only via Load flow, not from inventory page


  // Sort inventory by total grams descending
  const sortedInventory = [...inventory].sort((a, b) => getTotalGrams(b) - getTotalGrams(a));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-xl">
          <Package className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {language === 'he' ? 'מלאי חומרים' : 'Material Inventory'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {language === 'he' 
              ? `${inventory.length} סוגי חומרים` 
              : `${inventory.length} material types`}
          </p>
        </div>
      </div>

      {/* Quick Add Closed Spools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {language === 'he' ? 'הוסף גלילים סגורים' : 'Add Closed Spools'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{language === 'he' ? 'צבע' : 'Color'}</Label>
              <Select value={quickAddColor} onValueChange={setQuickAddColor}>
                <SelectTrigger className="w-28 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border shadow-lg">
                  {availableColors.filter(c => c && c.trim()).map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{language === 'he' ? 'חומר' : 'Material'}</Label>
              <Select value={quickAddMaterial} onValueChange={setQuickAddMaterial}>
                <SelectTrigger className="w-24 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border shadow-lg">
                  <SelectItem value="PLA">PLA</SelectItem>
                  <SelectItem value="PETG">PETG</SelectItem>
                  <SelectItem value="ABS">ABS</SelectItem>
                  <SelectItem value="TPU">TPU</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{language === 'he' ? 'גודל' : 'Size'}</Label>
              <Select 
                value={String(quickAddSpoolSize)} 
                onValueChange={(v) => setQuickAddSpoolSize(parseInt(v))}
              >
                <SelectTrigger className="w-20 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border shadow-lg">
                  <SelectItem value="1000">1kg</SelectItem>
                  <SelectItem value="2000">2kg</SelectItem>
                  <SelectItem value="5000">5kg</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{language === 'he' ? 'כמות' : 'Qty'}</Label>
              <Input 
                type="number" 
                min={1} 
                value={quickAddCount} 
                onChange={(e) => setQuickAddCount(parseInt(e.target.value) || 1)}
                className="w-16 h-9"
              />
            </div>
            <Button onClick={handleAddClosedSpools} size="sm" className="h-9">
              <Plus className="w-4 h-4 mr-1" />
              {language === 'he' ? 'הוסף' : 'Add'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sortedInventory.map(item => {
          const totalGrams = getTotalGrams(item);
          const isLowStock = item.reorderPointGrams && totalGrams < item.reorderPointGrams;
          
          return (
            <Card 
              key={item.id} 
              className={isLowStock ? 'border-warning/50 bg-warning/5' : ''}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SpoolIcon color={getSpoolColor(item.color)} size={24} />
                    <div>
                      <CardTitle className="text-base">{item.color}</CardTitle>
                      <p className="text-xs text-muted-foreground">{item.material}</p>
                    </div>
                  </div>
                  {isLowStock && (
                    <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      {language === 'he' ? 'מלאי נמוך' : 'Low'}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Total Grams */}
                <div className="text-center p-2 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">
                    {(totalGrams / 1000).toFixed(1)}kg
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {language === 'he' ? 'סה"כ' : 'Total'}
                  </div>
                </div>

                {/* Closed Spools */}
                <div className="flex items-center justify-between p-2 bg-background rounded border">
                  <div>
                    <div className="text-sm font-medium">
                      {language === 'he' ? 'סגורים' : 'Closed'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.closedCount} × {item.closedSpoolSizeGrams / 1000}kg
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => handleAdjustClosed(item, -1)}
                      disabled={item.closedCount <= 0}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="w-8 text-center font-medium">{item.closedCount}</span>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => handleAdjustClosed(item, 1)}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Open Spools Total */}
                <div className="flex items-center justify-between p-2 bg-background rounded border">
                  <div>
                    <div className="text-sm font-medium">
                      {language === 'he' ? 'פתוחים' : 'Open'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {language === 'he' ? 'סה"כ גרמים' : 'Total grams'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.openTotalGrams}g</span>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => handleOpenEditDialog(item)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Note: Opening new spools happens only via Load flow */}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Empty State */}
      {inventory.length === 0 && (
        <Card className="p-8 text-center">
          <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="font-medium mb-2">
            {language === 'he' ? 'אין מלאי' : 'No Inventory'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {language === 'he' 
              ? 'הוסף גלילים סגורים למעלה כדי להתחיל'
              : 'Add closed spools above to get started'}
          </p>
        </Card>
      )}

      {/* Edit Open Grams Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'he' ? 'עדכן גרמים בפתוחים' : 'Update Open Grams'}
            </DialogTitle>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 mb-4">
                <SpoolIcon color={getSpoolColor(editingItem.color)} size={24} />
                <span className="font-medium">{editingItem.color} {editingItem.material}</span>
              </div>
              <div className="space-y-2">
                <Label>
                  {language === 'he' ? 'סה"כ גרמים בגלילים פתוחים' : 'Total grams in open spools'}
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={editOpenGrams}
                  onChange={(e) => setEditOpenGrams(parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'he' 
                    ? 'הזן את הסה"כ המשוער של כל הגלילים הפתוחים מצבע זה'
                    : 'Enter the estimated total of all open spools of this color'}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button onClick={handleSaveOpenGrams}>
              {language === 'he' ? 'שמור' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InventoryPage;
