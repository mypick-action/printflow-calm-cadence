import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
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
import { Package, Plus, Minus, AlertTriangle, Edit2, Loader2, CloudOff, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { 
  getMaterialInventory, 
  upsertMaterialInventory,
  deleteMaterialInventory,
  type DbMaterialInventory,
  type MaterialInventoryInput,
} from '@/services/cloudStorage';
import { hydrateInventoryFromCloud, migrateInventoryToCloud } from '@/services/cloudBridge';
import { 
  getColorInventory, 
  getFactorySettings,
  ColorInventoryItem,
  getTotalGrams,
  KEYS,
} from '@/services/storage';
import { subscribeToInventoryChanges, notifyInventoryChanged } from '@/services/inventoryEvents';

// Cloud-first: cloud is source of truth, localStorage is cache only
export const InventoryPage: React.FC = () => {
  const { language } = useLanguage();
  const { workspaceId } = useAuth();
  const [inventory, setInventory] = useState<ColorInventoryItem[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>(['שחור', 'לבן', 'אפור', 'אדום', 'כחול', 'ירוק']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Add mode: 'closed' or 'open'
  const [addMode, setAddMode] = useState<'closed' | 'open'>('closed');
  
  // Quick add states
  const [quickAddColor, setQuickAddColor] = useState('שחור');
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
  
  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<ColorInventoryItem | null>(null);

  // Load inventory from cloud on mount
  const loadFromCloud = useCallback(async () => {
    console.log('[InventoryPage] loadFromCloud called, workspaceId:', workspaceId);
    
    if (!workspaceId) {
      console.log('[InventoryPage] No workspaceId yet, waiting...');
      // Don't set loading=false yet, keep waiting for auth
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Try to load from cloud first
      console.log('[InventoryPage] Fetching inventory for workspace:', workspaceId);
      const cloudInventory = await getMaterialInventory(workspaceId);
      console.log('[InventoryPage] Cloud inventory result:', cloudInventory.length, 'items');
      
      // If cloud is empty but local has data, offer migration
      const localInventory = getColorInventory();
      if (cloudInventory.length === 0 && localInventory.length > 0) {
        console.log('[InventoryPage] Cloud empty, local has data - migrating...');
        const result = await migrateInventoryToCloud(workspaceId);
        console.log('[InventoryPage] Migration result:', result);
        // Re-fetch after migration
        const updatedInventory = await getMaterialInventory(workspaceId);
        updateLocalCache(updatedInventory);
      } else {
        updateLocalCache(cloudInventory);
      }
    } catch (err) {
      console.error('[InventoryPage] Error loading from cloud:', err);
      setError(language === 'he' ? 'שגיאה בטעינת מלאי מהענן' : 'Error loading inventory from cloud');
      // Fallback to local cache
      const localInventory = getColorInventory();
      setInventory(localInventory);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, language]);

  // Convert cloud format to local format and update cache
  const updateLocalCache = (cloudInventory: DbMaterialInventory[]) => {
    const localFormat: ColorInventoryItem[] = cloudInventory.map(item => ({
      id: item.id,
      color: item.color,
      material: item.material,
      closedCount: item.closed_count,
      closedSpoolSizeGrams: item.closed_spool_size_grams,
      openTotalGrams: item.open_total_grams,
      openSpoolCount: item.open_spool_count,
      reorderPointGrams: item.reorder_point_grams ?? 2000,
      updatedAt: item.updated_at,
    }));
    
    setInventory(localFormat);
    localStorage.setItem(KEYS.COLOR_INVENTORY, JSON.stringify(localFormat));
    notifyInventoryChanged();
    
    // Update available colors
    const settings = getFactorySettings();
    const hebrewColors = ['שחור', 'לבן', 'אפור', 'אדום', 'כחול', 'ירוק', 'צהוב', 'כתום', 'סגול', 'ורוד', 'חום'];
    const settingsColors = settings?.colors || [];
    const inventoryColors = localFormat.map(item => item.color);
    const allColors = new Set([...hebrewColors, ...settingsColors, ...inventoryColors]);
    setAvailableColors(Array.from(allColors).filter(c => c && c.trim()));
  };

  useEffect(() => {
    loadFromCloud();
    const unsubscribe = subscribeToInventoryChanges(() => {
      // Only refresh if triggered externally (e.g., from loadSpoolOnPrinter)
      // Skip if we just made a cloud update ourselves
    });
    return unsubscribe;
  }, [loadFromCloud]);

  const getSelectedColor = () => {
    return useCustomColor ? quickAddCustomColor.trim() : quickAddColor;
  };

  // Cloud-first save helper
  const saveToCloud = async (item: MaterialInventoryInput): Promise<boolean> => {
    if (!workspaceId) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'לא מחובר לחשבון' : 'Not logged in',
        variant: 'destructive',
      });
      return false;
    }

    setSaving(true);
    try {
      const result = await upsertMaterialInventory(workspaceId, item);
      if (result.error) {
        throw result.error;
      }
      return true;
    } catch (err) {
      console.error('[InventoryPage] Cloud save failed:', err);
      toast({
        title: language === 'he' ? 'שגיאה בשמירה' : 'Save failed',
        description: language === 'he' ? 'לא ניתן לשמור לענן. נסה שוב.' : 'Could not save to cloud. Please try again.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAddClosedSpools = async () => {
    const color = getSelectedColor();
    if (!color || quickAddCount <= 0 || saving) return;
    
    const existing = inventory.find(i => 
      i.color.toLowerCase() === color.toLowerCase() && 
      i.material.toLowerCase() === quickAddMaterial.toLowerCase()
    );
    
    const newItem: MaterialInventoryInput = existing 
      ? {
          color: existing.color,
          material: existing.material,
          closed_count: existing.closedCount + quickAddCount,
          closed_spool_size_grams: existing.closedSpoolSizeGrams,
          open_total_grams: existing.openTotalGrams,
          open_spool_count: existing.openSpoolCount || 0,
          reorder_point_grams: existing.reorderPointGrams,
          updated_by: 'user',
        }
      : {
          color,
          material: quickAddMaterial,
          closed_count: quickAddCount,
          closed_spool_size_grams: quickAddSpoolSize,
          open_total_grams: 0,
          open_spool_count: 0,
          reorder_point_grams: 2000,
          updated_by: 'user',
        };

    const success = await saveToCloud(newItem);
    if (success) {
      await loadFromCloud(); // Refresh from cloud
      setQuickAddCount(1);
      if (useCustomColor) {
        setQuickAddCustomColor('');
        setUseCustomColor(false);
      }
      toast({
        title: language === 'he' ? 'גלילים נוספו' : 'Spools added',
        description: `+${quickAddCount} ${color} ${quickAddMaterial}`,
      });
    }
  };

  const handleAddOpenGrams = async () => {
    const color = getSelectedColor();
    if (!color || quickAddOpenGrams <= 0 || saving) return;
    
    const existing = inventory.find(i => 
      i.color.toLowerCase() === color.toLowerCase() && 
      i.material.toLowerCase() === quickAddMaterial.toLowerCase()
    );
    
    const newItem: MaterialInventoryInput = existing 
      ? {
          color: existing.color,
          material: existing.material,
          closed_count: existing.closedCount,
          closed_spool_size_grams: existing.closedSpoolSizeGrams,
          open_total_grams: existing.openTotalGrams + quickAddOpenGrams,
          open_spool_count: existing.openSpoolCount || 0,
          reorder_point_grams: existing.reorderPointGrams,
          updated_by: 'user',
        }
      : {
          color,
          material: quickAddMaterial,
          closed_count: 0,
          closed_spool_size_grams: quickAddSpoolSize,
          open_total_grams: quickAddOpenGrams,
          open_spool_count: 0,
          reorder_point_grams: 2000,
          updated_by: 'user',
        };

    const success = await saveToCloud(newItem);
    if (success) {
      await loadFromCloud();
      setQuickAddOpenGrams(100);
      if (useCustomColor) {
        setQuickAddCustomColor('');
        setUseCustomColor(false);
      }
      toast({
        title: language === 'he' ? 'גרמים נוספו' : 'Grams added',
        description: `+${quickAddOpenGrams}g ${color} ${quickAddMaterial}`,
      });
    }
  };

  const handleAdjustClosed = async (item: ColorInventoryItem, delta: number) => {
    if (item.closedCount + delta < 0 || saving) return;
    
    const newItem: MaterialInventoryInput = {
      color: item.color,
      material: item.material,
      closed_count: item.closedCount + delta,
      closed_spool_size_grams: item.closedSpoolSizeGrams,
      open_total_grams: item.openTotalGrams,
      open_spool_count: item.openSpoolCount || 0,
      reorder_point_grams: item.reorderPointGrams,
      updated_by: 'user',
    };

    const success = await saveToCloud(newItem);
    if (success) {
      await loadFromCloud();
    }
  };

  const handleOpenEditDialog = (item: ColorInventoryItem) => {
    setEditingItem(item);
    setEditOpenGrams(item.openTotalGrams);
    setEditOpenSpoolCount(item.openSpoolCount || 0);
    setEditDialogOpen(true);
  };

  const handleSaveOpenSpools = async () => {
    if (!editingItem || saving) return;
    
    const newItem: MaterialInventoryInput = {
      color: editingItem.color,
      material: editingItem.material,
      closed_count: editingItem.closedCount,
      closed_spool_size_grams: editingItem.closedSpoolSizeGrams,
      open_total_grams: editOpenGrams,
      open_spool_count: editOpenSpoolCount,
      reorder_point_grams: editingItem.reorderPointGrams,
      updated_by: 'user',
    };

    const success = await saveToCloud(newItem);
    if (success) {
      await loadFromCloud();
      setEditDialogOpen(false);
      setEditingItem(null);
      toast({
        title: language === 'he' ? 'מלאי עודכן' : 'Inventory updated',
      });
    }
  };

  const handleOpenRenameDialog = (item: ColorInventoryItem) => {
    setRenamingItem(item);
    setNewColorName(item.color);
    setRenameDialogOpen(true);
  };

  const handleSaveColorName = async () => {
    if (!renamingItem || !newColorName.trim() || saving) return;
    
    const trimmedNewColor = newColorName.trim();
    
    // If color name didn't change, just close dialog
    if (trimmedNewColor === renamingItem.color) {
      setRenameDialogOpen(false);
      setRenamingItem(null);
      return;
    }
    
    setSaving(true);
    
    try {
      // Since color is part of unique key, we need to: create new -> delete old
      const newItem: MaterialInventoryInput = {
        color: trimmedNewColor,
        material: renamingItem.material,
        closed_count: renamingItem.closedCount,
        closed_spool_size_grams: renamingItem.closedSpoolSizeGrams,
        open_total_grams: renamingItem.openTotalGrams,
        open_spool_count: renamingItem.openSpoolCount || 0,
        reorder_point_grams: renamingItem.reorderPointGrams,
        updated_by: 'user',
      };

      // Step 1: Create new record with new color name
      const success = await saveToCloud(newItem);
      
      if (success) {
        // Step 2: Delete old record
        const deleted = await deleteMaterialInventory(renamingItem.id);
        
        if (!deleted) {
          console.error('[InventoryPage] Failed to delete old color record:', renamingItem.id);
          // Still show success since new record was created
        }
        
        await loadFromCloud();
        setRenameDialogOpen(false);
        setRenamingItem(null);
        toast({
          title: language === 'he' ? 'שם הצבע עודכן' : 'Color name updated',
        });
      }
    } catch (error) {
      console.error('[InventoryPage] Error renaming color:', error);
      toast({
        title: language === 'he' ? 'שגיאה בשינוי שם הצבע' : 'Error renaming color',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Delete inventory item
  const handleDeleteItem = async () => {
    if (!deletingItem || saving) return;
    
    setSaving(true);
    try {
      const deleted = await deleteMaterialInventory(deletingItem.id);
      
      if (deleted) {
        await loadFromCloud();
        setDeleteDialogOpen(false);
        setDeletingItem(null);
        toast({
          title: language === 'he' ? 'הצבע נמחק מהמלאי' : 'Color removed from inventory',
        });
      } else {
        toast({
          title: language === 'he' ? 'שגיאה במחיקה' : 'Error deleting',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('[InventoryPage] Error deleting item:', error);
      toast({
        title: language === 'he' ? 'שגיאה במחיקה' : 'Error deleting',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
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

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">
          {language === 'he' ? 'טוען מלאי...' : 'Loading inventory...'}
        </span>
      </div>
    );
  }

  // Error state with retry
  if (error && inventory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <CloudOff className="w-12 h-12 text-destructive" />
        <p className="text-destructive">{error}</p>
        <Button onClick={loadFromCloud} variant="outline">
          {language === 'he' ? 'נסה שוב' : 'Try again'}
        </Button>
      </div>
    );
  }

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
        {saving && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
        )}
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
                <Button onClick={handleAddClosedSpools} size="sm" className="h-9" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
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
                <Button onClick={handleAddOpenGrams} size="sm" className="h-9" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
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
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={() => {
                            setDeletingItem(item);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
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
                      disabled={item.closedCount <= 0 || saving}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="w-8 text-center font-medium">{item.closedCount}</span>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => handleAdjustClosed(item, 1)}
                      disabled={saving}
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
            <Button onClick={handleSaveOpenSpools} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
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
            <Button onClick={handleSaveColorName} disabled={!newColorName.trim() || saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {language === 'he' ? 'שמור' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'he' ? 'מחיקת צבע מהמלאי' : 'Delete from Inventory'}
            </DialogTitle>
          </DialogHeader>
          {deletingItem && (
            <div className="py-4">
              <div className="flex items-center gap-2 mb-4">
                <SpoolIcon color={getSpoolColor(deletingItem.color)} size={24} />
                <span className="font-medium">{deletingItem.color}</span>
                <span className="text-muted-foreground">({deletingItem.material})</span>
              </div>
              <p className="text-muted-foreground">
                {language === 'he' 
                  ? `האם אתה בטוח שברצונך למחוק את הצבע הזה מהמלאי? יש ${(getTotalGrams(deletingItem) / 1000).toFixed(1)}kg במלאי.`
                  : `Are you sure you want to delete this color from inventory? There are ${(getTotalGrams(deletingItem) / 1000).toFixed(1)}kg in stock.`}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button variant="destructive" onClick={handleDeleteItem} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {language === 'he' ? 'מחק' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InventoryPage;
