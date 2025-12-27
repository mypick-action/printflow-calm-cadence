import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Printer as PrinterIcon, Settings2, CircleDot, Box, Layers } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getPrinters, 
  updatePrinter,
  getSpools,
  Printer, 
  Spool,
  getFactorySettings,
} from '@/services/storage';

export const PrintersPage: React.FC = () => {
  const { language } = useLanguage();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [spools, setSpools] = useState<Spool[]>([]);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [availableColors, setAvailableColors] = useState<string[]>([]);

  useEffect(() => {
    setPrinters(getPrinters());
    setSpools(getSpools());
    const settings = getFactorySettings();
    if (settings?.colors) {
      setAvailableColors(settings.colors);
    }
  }, []);

  const handleEditPrinter = (printer: Printer) => {
    setEditingPrinter({ ...printer });
    setSheetOpen(true);
  };

  const handleSavePrinter = () => {
    if (!editingPrinter) return;
    
    updatePrinter(editingPrinter.id, editingPrinter);
    setPrinters(getPrinters());
    setSheetOpen(false);
    setEditingPrinter(null);
    
    toast({
      title: language === 'he' ? 'מדפסת עודכנה' : 'Printer updated',
      description: editingPrinter.name,
    });
  };

  const getAssignedSpools = (printerId: string) => {
    return spools.filter(s => s.assignedPrinterId === printerId && s.state !== 'empty');
  };

  const getAmsModeBadge = (printer: Printer) => {
    if (!printer.hasAMS) return null;
    
    const config = {
      backup_same_color: { 
        label: language === 'he' ? 'גיבוי צבע' : 'Backup', 
        className: 'bg-primary/10 text-primary border-primary/20' 
      },
      multi_color: { 
        label: language === 'he' ? 'רב-צבעי' : 'Multi-color', 
        className: 'bg-secondary/80 text-secondary-foreground' 
      },
    };
    
    const mode = printer.amsMode || 'backup_same_color';
    return (
      <Badge variant="outline" className={config[mode].className}>
        {config[mode].label}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-xl">
          <PrinterIcon className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {language === 'he' ? 'מדפסות' : 'Printers'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {language === 'he' ? 'ניהול והגדרות מדפסות' : 'Manage printer settings'}
          </p>
        </div>
      </div>

      {/* Printers List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {printers.map((printer) => {
          const assignedSpools = getAssignedSpools(printer.id);
          
          return (
            <Card 
              key={printer.id} 
              className={`cursor-pointer transition-all hover:shadow-md ${!printer.active ? 'opacity-60' : ''}`}
              onClick={() => handleEditPrinter(printer)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <PrinterIcon className="w-5 h-5 text-primary" />
                    {printer.name}
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Settings2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Current color/material */}
                <div className="flex items-center gap-2">
                  <CircleDot className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">
                    {printer.currentColor || (language === 'he' ? 'לא מוגדר' : 'Not set')}
                  </span>
                  {printer.currentMaterial && (
                    <span className="text-xs text-muted-foreground">({printer.currentMaterial})</span>
                  )}
                </div>
                
                {/* AMS Status */}
                <div className="flex items-center gap-2">
                  <Box className="w-4 h-4 text-muted-foreground" />
                  {printer.hasAMS ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">AMS ({printer.amsSlots || 4} slots)</span>
                      {getAmsModeBadge(printer)}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {language === 'he' ? 'ללא AMS' : 'No AMS'}
                    </span>
                  )}
                </div>

                {/* Assigned spools for AMS backup mode */}
                {printer.hasAMS && printer.amsMode === 'backup_same_color' && assignedSpools.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">
                      {assignedSpools.length} {language === 'he' ? 'גלילים מוקצים' : 'spools assigned'}
                    </span>
                  </div>
                )}

                {/* Status badge */}
                <div className="pt-2 border-t">
                  <Badge variant={printer.active ? 'default' : 'secondary'}>
                    {printer.active 
                      ? (language === 'he' ? 'פעילה' : 'Active')
                      : (language === 'he' ? 'לא פעילה' : 'Inactive')
                    }
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edit Printer Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <PrinterIcon className="w-5 h-5 text-primary" />
              {language === 'he' ? 'עריכת מדפסת' : 'Edit Printer'}
            </SheetTitle>
          </SheetHeader>
          
          {editingPrinter && (
            <div className="space-y-6 py-6">
              {/* Printer Name */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'שם המדפסת' : 'Printer Name'}</Label>
                <Input
                  value={editingPrinter.name}
                  onChange={(e) => setEditingPrinter({ ...editingPrinter, name: e.target.value })}
                />
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between">
                <Label>{language === 'he' ? 'מדפסת פעילה' : 'Printer Active'}</Label>
                <Switch
                  checked={editingPrinter.active}
                  onCheckedChange={(v) => setEditingPrinter({ ...editingPrinter, active: v })}
                />
              </div>

              {/* Current Color */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'צבע נוכחי' : 'Current Color'}</Label>
                <Select 
                  value={editingPrinter.currentColor || ''} 
                  onValueChange={(v) => setEditingPrinter({ ...editingPrinter, currentColor: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחר צבע' : 'Select color'} />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg">
                    {availableColors.map((color) => (
                      <SelectItem key={color} value={color}>{color}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Current Material */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'חומר נוכחי' : 'Current Material'}</Label>
                <Select 
                  value={editingPrinter.currentMaterial || ''} 
                  onValueChange={(v) => setEditingPrinter({ ...editingPrinter, currentMaterial: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחר חומר' : 'Select material'} />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg">
                    <SelectItem value="PLA">PLA</SelectItem>
                    <SelectItem value="PETG">PETG</SelectItem>
                    <SelectItem value="ABS">ABS</SelectItem>
                    <SelectItem value="TPU">TPU</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* AMS Section */}
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <h3 className="font-semibold flex items-center gap-2">
                  <Box className="w-4 h-4" />
                  AMS {language === 'he' ? 'הגדרות' : 'Settings'}
                </h3>
                
                {/* Has AMS Toggle */}
                <div className="flex items-center justify-between">
                  <Label>{language === 'he' ? 'יש AMS?' : 'Has AMS?'}</Label>
                  <Switch
                    checked={editingPrinter.hasAMS}
                    onCheckedChange={(v) => setEditingPrinter({ 
                      ...editingPrinter, 
                      hasAMS: v,
                      amsSlots: v ? (editingPrinter.amsSlots || 4) : undefined,
                      amsMode: v ? (editingPrinter.amsMode || 'backup_same_color') : undefined,
                    })}
                  />
                </div>

                {editingPrinter.hasAMS && (
                  <>
                    {/* AMS Slots */}
                    <div className="space-y-2">
                      <Label>{language === 'he' ? 'מספר משבצות' : 'Number of Slots'}</Label>
                      <Select 
                        value={String(editingPrinter.amsSlots || 4)} 
                        onValueChange={(v) => setEditingPrinter({ ...editingPrinter, amsSlots: parseInt(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background border shadow-lg">
                          <SelectItem value="4">4 {language === 'he' ? 'משבצות' : 'slots'}</SelectItem>
                          <SelectItem value="8">8 {language === 'he' ? 'משבצות' : 'slots'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* AMS Mode */}
                    <div className="space-y-2">
                      <Label>{language === 'he' ? 'מצב AMS' : 'AMS Mode'}</Label>
                      <Select 
                        value={editingPrinter.amsMode || 'backup_same_color'} 
                        onValueChange={(v) => setEditingPrinter({ 
                          ...editingPrinter, 
                          amsMode: v as 'backup_same_color' | 'multi_color' 
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background border shadow-lg">
                          <SelectItem value="backup_same_color">
                            <div className="flex flex-col">
                              <span>{language === 'he' ? 'גיבוי אותו צבע' : 'Backup same-color'}</span>
                              <span className="text-xs text-muted-foreground">
                                {language === 'he' ? 'מילוי אוטומטי כשנגמר' : 'Auto-refill when empty'}
                              </span>
                            </div>
                          </SelectItem>
                          <SelectItem value="multi_color">
                            <div className="flex flex-col">
                              <span>{language === 'he' ? 'הדפסה רב-צבעית' : 'Multi-color printing'}</span>
                              <span className="text-xs text-muted-foreground">
                                {language === 'he' ? 'צבעים שונים בהדפסה אחת' : 'Different colors in one print'}
                              </span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Assigned Spools for backup mode */}
                    {editingPrinter.amsMode === 'backup_same_color' && (
                      <div className="space-y-2 pt-2 border-t">
                        <Label className="text-sm">
                          {language === 'he' ? 'גלילים מוקצים' : 'Assigned Spools'}
                        </Label>
                        {(() => {
                          const assignedSpools = getAssignedSpools(editingPrinter.id);
                          if (assignedSpools.length === 0) {
                            return (
                              <p className="text-sm text-muted-foreground">
                                {language === 'he' 
                                  ? 'אין גלילים מוקצים. הקצו גלילים מדף המלאי.'
                                  : 'No spools assigned. Assign spools from Inventory.'}
                              </p>
                            );
                          }
                          return (
                            <div className="space-y-2">
                              {assignedSpools.map((spool) => (
                                <div key={spool.id} className="flex items-center justify-between p-2 bg-background rounded border">
                                  <div className="flex items-center gap-2">
                                    <CircleDot className="w-4 h-4" />
                                    <span className="text-sm">{spool.color}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {spool.gramsRemainingEst}g
                                    </span>
                                  </div>
                                  <Badge variant="outline" className="text-xs">
                                    Slot {(spool.amsSlotIndex ?? 0) + 1}
                                  </Badge>
                                </div>
                              ))}
                              <p className="text-xs text-muted-foreground">
                                {language === 'he' 
                                  ? `סה"כ: ${assignedSpools.reduce((sum, s) => sum + s.gramsRemainingEst, 0)}g זמינים`
                                  : `Total: ${assignedSpools.reduce((sum, s) => sum + s.gramsRemainingEst, 0)}g available`}
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Max Spool Weight */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'משקל גליל מקסימלי' : 'Max Spool Weight'}</Label>
                <Select 
                  value={String(editingPrinter.maxSpoolWeight || 1000)} 
                  onValueChange={(v) => setEditingPrinter({ ...editingPrinter, maxSpoolWeight: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg">
                    <SelectItem value="1000">1kg</SelectItem>
                    <SelectItem value="2000">2kg</SelectItem>
                    <SelectItem value="5000">5kg</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {language === 'he' 
                    ? 'גודל הגליל המקסימלי שהמדפסת תומכת בו'
                    : 'Maximum spool size the printer supports'}
                </p>
              </div>

              {/* Save Button */}
              <div className="flex gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setSheetOpen(false)} className="flex-1">
                  {language === 'he' ? 'ביטול' : 'Cancel'}
                </Button>
                <Button onClick={handleSavePrinter} className="flex-1">
                  {language === 'he' ? 'שמור' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {printers.length === 0 && (
        <Card className="p-8 text-center">
          <PrinterIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold mb-2">
            {language === 'he' ? 'אין מדפסות' : 'No printers'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {language === 'he' ? 'הגדירו מדפסות בתהליך ההתחלה' : 'Set up printers in the onboarding process'}
          </p>
        </Card>
      )}
    </div>
  );
};
