import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  adjustOpenTotalGrams,
  renameColorInventoryItem,
  getFactorySettings,
  ColorInventoryItem,
  getTotalGrams,
} from '@/services/storage';
import { subscribeToInventoryChanges } from '@/services/inventoryEvents';

export const InventoryPage: React.FC = () => {
  const { language } = useLanguage();
  const [inventory, setInventory] = useState<ColorInventoryItem[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>(['Black', 'White', 'Gray', 'Red', 'Blue', 'Green']);
  
  // Add mode: 'closed' or 'open'
  const [addMode, setAddMode] = useState<'closed' | 'open'>('closed');
  
  // Quick add states
  const [quickAddColor, setQuickAddColor] = useState('Black');
  const [quickAddCustomColor, setQuickAddCustomColor] = useState('');
  const [useCustomColor, setUseCustomColor] = useState(false);
  const [quickAddMaterial, setQuickAddMaterial] = useState('PLA');
  const [quickAddCount, setQuickAddCount] = useState(1);
  const [quickAddSpoolSize, setQuickAddSpoolSize] = useState(1000);
  const [quickAddOpenGrams, setQuickAddOpenGrams] = useState(100);
  
  // Edit dialog for open spools
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ColorInventoryItem | null>(null);
  const [editOpenGrams, setEditOpenGrams] = useState(0);
  const [editOpenSpoolCount, setEditOpenSpoolCount] = useState(0);
  
  // Color rename dialog
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingItem, setRenamingItem] = useState<ColorInventoryItem | null>(null);
  const [newColorName, setNewColorName] = useState('');

  useEffect(() => {
    refreshData();
    const unsubscribe = subscribeToInventoryChanges(refreshData);
    return unsubscribe;
  }, []);

  const refreshData = () => {
    const inv = getColorInventory();
    setInventory(inv);
    const settings = getFactorySettings();
    // Hebrew predefined colors (same as ProjectsPage)
    const hebrewColors = ['שחור', 'לבן', 'אפור', 'אדום', 'כחול', 'ירוק', 'צהוב', 'כתום', 'סגול', 'ורוד', 'חום'];
    // Combine predefined + settings colors + inventory colors
    const settingsColors = settings?.colors || [];
    // Also include all colors from current inventory
    const inventoryColors = inv.map(item => item.color);
    const allColors = new Set([...hebrewColors, ...settingsColors, ...inventoryColors]);
    setAvailableColors(Array.from(allColors).filter(c => c && c.trim()));
  };

  const getSelectedColor = () => {
    return useCustomColor ? quickAddCustomColor.trim() : quickAddColor;
  };

  const handleAddClosedSpools = () => {
    const color = getSelectedColor();
    if (!color || quickAddCount <= 0) return;
    
    const existing = inventory.find(i => 
      i.color.toLowerCase() === color.toLowerCase() && 
      i.material.toLowerCase() === quickAddMaterial.toLowerCase()
    );
    
    if (existing) {
      adjustClosedCount(color, quickAddMaterial, quickAddCount);
    } else {
      upsertColorInventoryItem({
        color,
        material: quickAddMaterial,
        closedCount: quickAddCount,
        closedSpoolSizeGrams: quickAddSpoolSize,
        openTotalGrams: 0,
        reorderPointGrams: 2000,
      });
    }
    
    refreshData();
    setQuickAddCount(1);
    if (useCustomColor) {
      setQuickAddCustomColor('');
      setUseCustomColor(false);
    }
    
    toast({
      title: language === 'he' ? 'גלילים נוספו' : 'Spools added',
      description: `+${quickAddCount} ${color} ${quickAddMaterial}`,
    });
  };

  const handleAddOpenGrams = () => {
    const color = getSelectedColor();
    if (!color || quickAddOpenGrams <= 0) return;
    
    const existing = inventory.find(i => 
      i.color.toLowerCase() === color.toLowerCase() && 
      i.material.toLowerCase() === quickAddMaterial.toLowerCase()
    );
    
    if (existing) {
      adjustOpenTotalGrams(color, quickAddMaterial, quickAddOpenGrams);
    } else {
      upsertColorInventoryItem({
        color,
        material: quickAddMaterial,
        closedCount: 0,
        closedSpoolSizeGrams: quickAddSpoolSize,
        openTotalGrams: quickAddOpenGrams,
        reorderPointGrams: 2000,
      });
    }
    
    refreshData();
    setQuickAddOpenGrams(100);
    if (useCustomColor) {
      setQuickAddCustomColor('');
      setUseCustomColor(false);
    }
    
    toast({
      title: language === 'he' ? 'גרמים נוספו' : 'Grams added',
      description: `+${quickAddOpenGrams}g ${color} ${quickAddMaterial}`,
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
    setEditOpenSpoolCount(item.openSpoolCount || 0);
    setEditDialogOpen(true);
  };

  const handleSaveOpenSpools = () => {
    if (!editingItem) return;
    // Update both openTotalGrams and openSpoolCount
    const items = getColorInventory();
    const index = items.findIndex(i => i.id === editingItem.id);
    if (index >= 0) {
      items[index] = {
        ...items[index],
        openTotalGrams: editOpenGrams,
        openSpoolCount: editOpenSpoolCount,
        updatedAt: new Date().toISOString(),
      };
      // Save to localStorage directly
      localStorage.setItem('printflow_color_inventory', JSON.stringify(items));
    }
    refreshData();
    setEditDialogOpen(false);
    setEditingItem(null);
    toast({
      title: language === 'he' ? 'מלאי עודכן' : 'Inventory updated',
    });
  };

  const handleOpenRenameDialog = (item: ColorInventoryItem) => {
    setRenamingItem(item);
    setNewColorName(item.color);
    setRenameDialogOpen(true);
  };

  const handleSaveColorName = () => {
    if (!renamingItem || !newColorName.trim()) return;
    renameColorInventoryItem(renamingItem.color, renamingItem.material, newColorName);
    refreshData();
    setRenameDialogOpen(false);
    setRenamingItem(null);
    toast({
      title: language === 'he' ? 'שם הצבע עודכן' : 'Color name updated',
    });
  };

  // Note: Opening new spools happens only via Load flow, not from inventory page


  // Keep inventory order stable - sort by id (creation order) instead of total grams
  const sortedInventory = [...inventory].sort((a, b) => a.id.localeCompare(b.id));

  // Calculate summary by color + material
  const inventorySummary = sortedInventory.map(item => ({
    ...item,
    totalGrams: getTotalGrams(item),
    isLowStock: getTotalGrams(item) < 1000, // Less than 1kg = low stock
  }));

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

      {/* Summary Table */}
      {inventory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {language === 'he' ? 'סיכום מלאי' : 'Inventory Summary'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-start py-2 px-2 font-medium text-muted-foreground">
                      {language === 'he' ? 'צבע' : 'Color'}
                    </th>
                    <th className="text-start py-2 px-2 font-medium text-muted-foreground">
                      {language === 'he' ? 'חומר' : 'Material'}
                    </th>
                    <th className="text-start py-2 px-2 font-medium text-muted-foreground">
                      {language === 'he' ? 'סה"כ' : 'Total'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {inventorySummary.map(item => (
                    <tr 
                      key={item.id} 
                      className={`border-b last:border-0 ${
                        item.isLowStock 
                          ? 'bg-yellow-100 dark:bg-yellow-900/30 animate-pulse' 
                          : ''
                      }`}
                    >
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <SpoolIcon color={getSpoolColor(item.color)} size={16} />
                          <span className={item.isLowStock ? 'font-semibold text-yellow-700 dark:text-yellow-300' : ''}>
                            {item.color}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-2">{item.material}</td>
                      <td className={`py-2 px-2 font-medium ${
                        item.isLowStock 
                          ? 'text-yellow-700 dark:text-yellow-300 font-bold' 
                          : ''
                      }`}>
                        {(item.totalGrams / 1000).toFixed(1)}kg
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Add Spools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {language === 'he' ? 'הוסף למלאי' : 'Add to Inventory'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tabs for Closed vs Open */}
          <Tabs value={addMode} onValueChange={(v) => setAddMode(v as 'closed' | 'open')}>
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="closed">
                {language === 'he' ? 'גלילים סגורים' : 'Closed Spools'}
              </TabsTrigger>
              <TabsTrigger value="open">
                {language === 'he' ? 'גלילים פתוחים' : 'Open Spools'}
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="closed" className="mt-4">
              <div className="flex flex-wrap items-end gap-3">
                {/* Color Selection */}
                <div className="space-y-1">
                  <Label className="text-xs">{language === 'he' ? 'צבע' : 'Color'}</Label>
                  <Select 
                    value={useCustomColor ? '__custom__' : quickAddColor} 
                    onValueChange={(v) => {
                      if (v === '__custom__') {
                        setUseCustomColor(true);
                      } else {
                        setUseCustomColor(false);
                        setQuickAddColor(v);
                      }
                    }}
                  >
                    <SelectTrigger className="w-28 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background border shadow-lg">
                      {availableColors.filter(c => c && c.trim()).map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                      <SelectItem value="__custom__">
                        {language === 'he' ? '+ צבע חדש' : '+ New color'}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Custom Color Input */}
                {useCustomColor && (
                  <div className="space-y-1">
                    <Label className="text-xs">{language === 'he' ? 'שם צבע' : 'Color name'}</Label>
                    <Input 
                      value={quickAddCustomColor}
                      onChange={(e) => setQuickAddCustomColor(e.target.value)}
                      placeholder={language === 'he' ? 'לדוגמא: Orange' : 'e.g. Orange'}
                      className="w-28 h-9"
                    />
                  </div>
                )}
                
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
            </TabsContent>
            
            <TabsContent value="open" className="mt-4">
              <div className="flex flex-wrap items-end gap-3">
                {/* Color Selection */}
                <div className="space-y-1">
                  <Label className="text-xs">{language === 'he' ? 'צבע' : 'Color'}</Label>
                  <Select 
                    value={useCustomColor ? '__custom__' : quickAddColor} 
                    onValueChange={(v) => {
                      if (v === '__custom__') {
                        setUseCustomColor(true);
                      } else {
                        setUseCustomColor(false);
                        setQuickAddColor(v);
                      }
                    }}
                  >
                    <SelectTrigger className="w-28 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background border shadow-lg">
                      {availableColors.filter(c => c && c.trim()).map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                      <SelectItem value="__custom__">
                        {language === 'he' ? '+ צבע חדש' : '+ New color'}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Custom Color Input */}
                {useCustomColor && (
                  <div className="space-y-1">
                    <Label className="text-xs">{language === 'he' ? 'שם צבע' : 'Color name'}</Label>
                    <Input 
                      value={quickAddCustomColor}
                      onChange={(e) => setQuickAddCustomColor(e.target.value)}
                      placeholder={language === 'he' ? 'לדוגמא: Orange' : 'e.g. Orange'}
                      className="w-28 h-9"
                    />
                  </div>
                )}
                
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
                  <Label className="text-xs">{language === 'he' ? 'גרמים' : 'Grams'}</Label>
                  <Input 
                    type="number" 
                    min={1} 
                    value={quickAddOpenGrams} 
                    onChange={(e) => setQuickAddOpenGrams(parseInt(e.target.value) || 100)}
                    className="w-20 h-9"
                  />
                </div>
                <Button onClick={handleAddOpenGrams} size="sm" className="h-9">
                  <Plus className="w-4 h-4 mr-1" />
                  {language === 'he' ? 'הוסף' : 'Add'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {language === 'he' 
                  ? 'הוסף גרמים לגלילים פתוחים קיימים (למשל גליל שקיבלת פתוח)'
                  : 'Add grams to existing open spools (e.g. a spool you received already open)'}
              </p>
            </TabsContent>
          </Tabs>
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
                      <div className="flex items-center gap-1">
                        <CardTitle className="text-base">{item.color}</CardTitle>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6"
                          onClick={() => handleOpenRenameDialog(item)}
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      </div>
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

                {/* Open Spools */}
                <div className="flex items-center justify-between p-2 bg-background rounded border">
                  <div>
                    <div className="text-sm font-medium">
                      {language === 'he' ? 'פתוחים' : 'Open'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.openSpoolCount || 0} {language === 'he' ? 'גלילים' : 'spools'} • {item.openTotalGrams}g
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-medium">
                      {item.openSpoolCount || 0}
                    </Badge>
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
              
              {/* Open Spool Count - PRIMARY FIELD */}
              <div className="space-y-2">
                <Label className="font-medium">
                  {language === 'he' ? 'כמה גלילים פתוחים יש?' : 'How many open spools?'}
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={editOpenSpoolCount}
                  onChange={(e) => setEditOpenSpoolCount(parseInt(e.target.value) || 0)}
                  placeholder="0"
                  className="text-lg"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'he' 
                    ? 'מספר הגלילים הפתוחים הפיזיים (על מדפסות + על המדף)'
                    : 'Number of physical open spools (on printers + on shelf)'}
                </p>
              </div>

              {/* Total Grams */}
              <div className="space-y-2">
                <Label>
                  {language === 'he' ? 'סה"כ גרמים על כל הפתוחים' : 'Total grams on all open spools'}
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
                    ? 'הערכה של סה"כ הגרמים על כל הגלילים הפתוחים'
                    : 'Estimated total grams across all open spools'}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button onClick={handleSaveOpenSpools}>
              {language === 'he' ? 'שמור' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Color Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'he' ? 'שנה שם צבע' : 'Rename Color'}
            </DialogTitle>
          </DialogHeader>
          {renamingItem && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 mb-4">
                <SpoolIcon color={getSpoolColor(renamingItem.color)} size={24} />
                <span className="font-medium">{renamingItem.material}</span>
              </div>
              <div className="space-y-2">
                <Label>
                  {language === 'he' ? 'שם הצבע' : 'Color name'}
                </Label>
                <Input
                  value={newColorName}
                  onChange={(e) => setNewColorName(e.target.value)}
                  placeholder={language === 'he' ? 'הזן שם צבע' : 'Enter color name'}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button onClick={handleSaveColorName} disabled={!newColorName.trim()}>
              {language === 'he' ? 'שמור' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InventoryPage;
