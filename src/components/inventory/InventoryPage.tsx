import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Package, Plus, MoreHorizontal, AlertCircle, Scale, MapPin, Printer as PrinterIcon, Calendar } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getSpools, 
  createSpool,
  updateSpool,
  getPrinters,
  getFactorySettings,
  Spool,
  Printer,
} from '@/services/storage';
import { format, differenceInDays } from 'date-fns';

export const InventoryPage: React.FC = () => {
  const { language } = useLanguage();
  const [spools, setSpools] = useState<Spool[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>(['Black', 'White', 'Gray', 'Red', 'Blue', 'Green']);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSpool, setEditingSpool] = useState<Spool | null>(null);
  
  // Quick add states
  const [quickAddColor, setQuickAddColor] = useState('Black');
  const [quickAddMaterial, setQuickAddMaterial] = useState('PLA');
  const [quickAddSize, setQuickAddSize] = useState<1000 | 2000 | 5000>(1000);
  const [quickAddQty, setQuickAddQty] = useState(1);
  const [quickOpenGrams, setQuickOpenGrams] = useState(500);

  useEffect(() => {
    refreshData();
  }, []);

  const refreshData = () => {
    setSpools(getSpools());
    setPrinters(getPrinters());
    const settings = getFactorySettings();
    // Default colors if none configured
    const defaultColors = ['Black', 'White', 'Gray', 'Red', 'Blue', 'Green'];
    const colors = settings?.colors?.length > 0 ? settings.colors : defaultColors;
    setAvailableColors(colors);
    if (!quickAddColor && colors.length > 0) {
      setQuickAddColor(colors[0]);
    }
  };

  const handleAddClosedSpools = () => {
    if (!quickAddColor) return;
    
    for (let i = 0; i < quickAddQty; i++) {
      createSpool({
        color: quickAddColor,
        material: quickAddMaterial,
        packageSize: quickAddSize,
        gramsRemainingEst: quickAddSize,
        state: 'new',
        location: 'stock',
        needsAudit: false,
      });
    }
    
    refreshData();
    setQuickAddQty(1);
    
    toast({
      title: language === 'he' ? 'גלילים נוספו' : 'Spools added',
      description: `${quickAddQty}x ${quickAddColor} ${quickAddSize/1000}kg`,
    });
  };

  const handleAddOpenSpool = () => {
    if (!quickAddColor || quickOpenGrams <= 0) return;
    
    createSpool({
      color: quickAddColor,
      material: quickAddMaterial,
      packageSize: 1000, // assume 1kg for partial
      gramsRemainingEst: quickOpenGrams,
      state: 'open',
      location: 'stock',
      needsAudit: true,
      lastAuditDate: new Date().toISOString().split('T')[0],
      lastAuditGrams: quickOpenGrams,
    });
    
    refreshData();
    setQuickOpenGrams(500);
    
    toast({
      title: language === 'he' ? 'גליל פתוח נוסף' : 'Open spool added',
      description: `${quickAddColor} - ${quickOpenGrams}g`,
    });
  };

  const handleMarkEmpty = (spool: Spool) => {
    updateSpool(spool.id, { state: 'empty', gramsRemainingEst: 0 });
    refreshData();
    toast({
      title: language === 'he' ? 'גליל סומן כריק' : 'Spool marked empty',
    });
  };

  const handleEditSpool = (spool: Spool) => {
    setEditingSpool({ ...spool });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingSpool) return;
    
    updateSpool(editingSpool.id, editingSpool);
    refreshData();
    setEditDialogOpen(false);
    setEditingSpool(null);
    
    toast({
      title: language === 'he' ? 'גליל עודכן' : 'Spool updated',
    });
  };

  const handleUpdateAudit = (spool: Spool, newGrams: number) => {
    updateSpool(spool.id, {
      gramsRemainingEst: newGrams,
      lastAuditDate: new Date().toISOString().split('T')[0],
      lastAuditGrams: newGrams,
      needsAudit: false,
      state: newGrams > 0 ? 'open' : 'empty',
    });
    refreshData();
    toast({
      title: language === 'he' ? 'ביקורת עודכנה' : 'Audit updated',
    });
  };

  const getStateBadge = (state: Spool['state']) => {
    const config = {
      new: { label: language === 'he' ? 'חדש' : 'New', className: 'bg-success/10 text-success border-success/20' },
      open: { label: language === 'he' ? 'פתוח' : 'Open', className: 'bg-warning/10 text-warning border-warning/20' },
      empty: { label: language === 'he' ? 'ריק' : 'Empty', className: 'bg-muted text-muted-foreground' },
    };
    return <Badge variant="outline" className={config[state].className}>{config[state].label}</Badge>;
  };

  const getLocationLabel = (location: Spool['location']) => {
    const labels = {
      stock: language === 'he' ? 'מלאי' : 'Stock',
      printer: language === 'he' ? 'מדפסת' : 'Printer',
      shelf: language === 'he' ? 'מדף' : 'Shelf',
      ams: 'AMS',
    };
    return labels[location];
  };

  const getPrinterName = (printerId?: string) => {
    if (!printerId) return '-';
    const printer = printers.find(p => p.id === printerId);
    return printer?.name || '-';
  };

  // Get spools that need audit (open spools not audited in 7 days)
  const spoolsNeedingAudit = spools.filter(s => {
    if (s.state !== 'open') return false;
    if (!s.lastAuditDate) return true;
    return differenceInDays(new Date(), new Date(s.lastAuditDate)) >= 7;
  });

  const activeSpools = spools.filter(s => s.state !== 'empty');
  const emptySpools = spools.filter(s => s.state === 'empty');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-xl">
          <Package className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {language === 'he' ? 'מלאי גלילים' : 'Spool Inventory'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {language === 'he' ? `${activeSpools.length} גלילים פעילים` : `${activeSpools.length} active spools`}
          </p>
        </div>
      </div>

      {/* Quick Add Section */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Add Closed Spools */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              {language === 'he' ? 'הוסף גלילים סגורים' : 'Add Closed Spools'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{language === 'he' ? 'צבע' : 'Color'}</Label>
                <Select value={quickAddColor} onValueChange={setQuickAddColor}>
                  <SelectTrigger className="h-9">
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
                  <SelectTrigger className="h-9">
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
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{language === 'he' ? 'גודל' : 'Size'}</Label>
                <Select value={String(quickAddSize)} onValueChange={(v) => setQuickAddSize(parseInt(v) as 1000 | 2000 | 5000)}>
                  <SelectTrigger className="h-9">
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
                  value={quickAddQty} 
                  onChange={(e) => setQuickAddQty(parseInt(e.target.value) || 1)}
                  className="h-9"
                />
              </div>
            </div>
            <Button onClick={handleAddClosedSpools} className="w-full" size="sm">
              <Plus className="w-4 h-4 mr-1" />
              {language === 'he' ? 'הוסף למלאי' : 'Add to Stock'}
            </Button>
          </CardContent>
        </Card>

        {/* Add Open Spool */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="w-4 h-4" />
              {language === 'he' ? 'הוסף גליל פתוח' : 'Add Open Spool'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{language === 'he' ? 'צבע' : 'Color'}</Label>
                <Select value={quickAddColor} onValueChange={setQuickAddColor}>
                  <SelectTrigger className="h-9">
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
                  <SelectTrigger className="h-9">
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
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{language === 'he' ? 'גרמים נותרים' : 'Grams Remaining'}</Label>
              <Input 
                type="number" 
                min={1} 
                value={quickOpenGrams} 
                onChange={(e) => setQuickOpenGrams(parseInt(e.target.value) || 0)}
                className="h-9"
                placeholder="500"
              />
            </div>
            <Button onClick={handleAddOpenSpool} variant="outline" className="w-full" size="sm">
              <Plus className="w-4 h-4 mr-1" />
              {language === 'he' ? 'הוסף גליל פתוח' : 'Add Open Spool'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Audit Reminders */}
      {spoolsNeedingAudit.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-warning">
              <AlertCircle className="w-4 h-4" />
              {language === 'he' ? 'גלילים לביקורת שבועית' : 'Weekly Audit Needed'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {spoolsNeedingAudit.map(spool => (
                <div key={spool.id} className="flex items-center justify-between p-2 bg-background rounded border">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{spool.color}</span>
                    <span className="text-sm text-muted-foreground">{spool.material}</span>
                    <span className="text-sm">~{spool.gramsRemainingEst}g</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input 
                      type="number" 
                      className="w-20 h-8"
                      placeholder={String(spool.gramsRemainingEst)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const input = e.target as HTMLInputElement;
                          handleUpdateAudit(spool, parseInt(input.value) || spool.gramsRemainingEst);
                          input.value = '';
                        }
                      }}
                    />
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={(e) => {
                        const input = (e.target as HTMLElement).previousSibling as HTMLInputElement;
                        handleUpdateAudit(spool, parseInt(input?.value) || spool.gramsRemainingEst);
                      }}
                    >
                      {language === 'he' ? 'עדכן' : 'Update'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventory Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {language === 'he' ? 'רשימת מלאי' : 'Inventory List'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeSpools.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{language === 'he' ? 'אין גלילים במלאי' : 'No spools in inventory'}</p>
              <p className="text-sm">{language === 'he' ? 'הוסיפו גלילים למעלה' : 'Add spools above'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{language === 'he' ? 'צבע' : 'Color'}</TableHead>
                    <TableHead>{language === 'he' ? 'חומר' : 'Material'}</TableHead>
                    <TableHead>{language === 'he' ? 'מצב' : 'State'}</TableHead>
                    <TableHead className="text-center">{language === 'he' ? 'גודל' : 'Size'}</TableHead>
                    <TableHead className="text-center">{language === 'he' ? 'נותר' : 'Remaining'}</TableHead>
                    <TableHead>{language === 'he' ? 'מיקום' : 'Location'}</TableHead>
                    <TableHead>{language === 'he' ? 'מדפסת' : 'Printer'}</TableHead>
                    <TableHead>{language === 'he' ? 'ביקורת אחרונה' : 'Last Audit'}</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSpools.map(spool => (
                    <TableRow key={spool.id}>
                      <TableCell className="font-medium">{spool.color}</TableCell>
                      <TableCell>{spool.material}</TableCell>
                      <TableCell>{getStateBadge(spool.state)}</TableCell>
                      <TableCell className="text-center">{spool.packageSize / 1000}kg</TableCell>
                      <TableCell className="text-center font-medium">{spool.gramsRemainingEst}g</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-muted-foreground" />
                          {getLocationLabel(spool.location)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {spool.assignedPrinterId ? (
                          <div className="flex items-center gap-1">
                            <PrinterIcon className="w-3 h-3 text-muted-foreground" />
                            {getPrinterName(spool.assignedPrinterId)}
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {spool.lastAuditDate ? (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(spool.lastAuditDate), 'dd/MM')}
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-background border shadow-lg">
                            <DropdownMenuItem onClick={() => handleEditSpool(spool)}>
                              {language === 'he' ? 'ערוך' : 'Edit'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleMarkEmpty(spool)}>
                              {language === 'he' ? 'סמן כריק' : 'Mark Empty'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Empty Spools (collapsed) */}
      {emptySpools.length > 0 && (
        <Card className="opacity-60">
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-muted-foreground">
              {language === 'he' ? `${emptySpools.length} גלילים ריקים` : `${emptySpools.length} empty spools`}
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{language === 'he' ? 'עריכת גליל' : 'Edit Spool'}</DialogTitle>
          </DialogHeader>
          {editingSpool && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{language === 'he' ? 'צבע' : 'Color'}</Label>
                  <Select value={editingSpool.color} onValueChange={(v) => setEditingSpool({...editingSpool, color: v})}>
                    <SelectTrigger>
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
                  <Label>{language === 'he' ? 'חומר' : 'Material'}</Label>
                  <Select value={editingSpool.material} onValueChange={(v) => setEditingSpool({...editingSpool, material: v})}>
                    <SelectTrigger>
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
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{language === 'he' ? 'גרמים נותרים' : 'Grams Remaining'}</Label>
                  <Input 
                    type="number"
                    value={editingSpool.gramsRemainingEst}
                    onChange={(e) => setEditingSpool({...editingSpool, gramsRemainingEst: parseInt(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{language === 'he' ? 'מיקום' : 'Location'}</Label>
                  <Select value={editingSpool.location} onValueChange={(v) => setEditingSpool({...editingSpool, location: v as Spool['location']})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background border shadow-lg">
                      <SelectItem value="stock">{language === 'he' ? 'מלאי' : 'Stock'}</SelectItem>
                      <SelectItem value="printer">{language === 'he' ? 'מדפסת' : 'Printer'}</SelectItem>
                      <SelectItem value="shelf">{language === 'he' ? 'מדף' : 'Shelf'}</SelectItem>
                      <SelectItem value="ams">AMS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Show assigned printer as read-only info */}
              {editingSpool.assignedPrinterId && (
                <div className="space-y-1 p-3 rounded-lg bg-muted/50 border">
                  <Label className="text-sm text-muted-foreground">
                    {language === 'he' ? 'טעון על מדפסת' : 'Loaded on Printer'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <PrinterIcon className="w-4 h-4 text-primary" />
                    <span className="font-medium">{getPrinterName(editingSpool.assignedPrinterId)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {language === 'he' 
                      ? 'לשינוי הגליל על המדפסת, עבור לדף מדפסות'
                      : 'To change spool on printer, go to Printers page'}
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="flex-1">
                  {language === 'he' ? 'ביטול' : 'Cancel'}
                </Button>
                <Button onClick={handleSaveEdit} className="flex-1">
                  {language === 'he' ? 'שמור' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
