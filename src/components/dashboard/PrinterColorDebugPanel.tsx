import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Palette, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { getPrinters, Printer } from '@/services/storage';
import { useLanguage } from '@/contexts/LanguageContext';

interface PrinterColorDebugPanelProps {
  className?: string;
}

export const PrinterColorDebugPanel: React.FC<PrinterColorDebugPanelProps> = ({ className }) => {
  const { language } = useLanguage();
  const isHebrew = language === 'he';
  const printers = getPrinters().filter(p => p.status === 'active');

  return (
    <Card variant="glass" className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="w-5 h-5 text-primary" />
          {isHebrew ? 'צבעים פיזיים - Debug' : 'Physical Colors - Debug'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {printers.map((printer: Printer) => {
          const hasPhysical = printer.mountedColor || printer.confirmedSpoolColor;
          const confirmedAt = printer.confirmedSpoolAt;
          
          return (
            <div 
              key={printer.id}
              className="p-3 rounded-lg border bg-card/50 text-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{printer.name}</span>
                {hasPhysical ? (
                  <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {isHebrew ? 'צבע ידוע' : 'Color Known'}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                    <XCircle className="w-3 h-3 mr-1" />
                    {isHebrew ? 'אין צבע' : 'No Color'}
                  </Badge>
                )}
              </div>
              
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>
                  <span className="opacity-60">mounted:</span>
                  <div className="flex items-center gap-1">
                    {printer.mountedColor ? (
                      <>
                        <span 
                          className="w-3 h-3 rounded-full border"
                          style={{ backgroundColor: printer.mountedColor }}
                        />
                        <span>{printer.mountedColor}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
                
                <div>
                  <span className="opacity-60">confirmed:</span>
                  <div className="flex items-center gap-1">
                    {printer.confirmedSpoolColor ? (
                      <>
                        <span 
                          className="w-3 h-3 rounded-full border"
                          style={{ backgroundColor: printer.confirmedSpoolColor }}
                        />
                        <span>{printer.confirmedSpoolColor}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
                
                <div>
                  <span className="opacity-60">current:</span>
                  <div className="flex items-center gap-1">
                    {printer.currentColor ? (
                      <>
                        <span 
                          className="w-3 h-3 rounded-full border"
                          style={{ backgroundColor: printer.currentColor }}
                        />
                        <span>{printer.currentColor}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
              </div>
              
              {confirmedAt && (
                <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground/60">
                  <Clock className="w-3 h-3" />
                  <span>
                    {isHebrew ? 'אושר:' : 'Confirmed:'} {new Date(confirmedAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        
        {printers.length === 0 && (
          <div className="text-center text-muted-foreground py-4">
            {isHebrew ? 'אין מדפסות פעילות' : 'No active printers'}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
