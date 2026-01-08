// Material Purchasing Panel
// Shows material shortfalls for 7-14 days planning horizon with order-by dates

import React, { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, AlertTriangle, Calendar, Package } from 'lucide-react';
import { getPlannedCycles, getProjectsSync, getProducts, getFactorySettings, findProjectById } from '@/services/storage';
import { getAvailableGramsByColor } from '@/services/materialAdapter';
import { normalizeColor } from '@/services/colorNormalization';
import { format, addDays, addHours } from 'date-fns';

interface MaterialShortfall {
  color: string;
  requiredGrams: number;
  availableGrams: number;
  shortfallGrams: number;
  orderByDate: Date;
  affectedProjectNames: string[];
  daysUntilNeeded: number;
}

interface MaterialPurchasingPanelProps {
  planningHorizonDays?: number;
  className?: string;
}

export const MaterialPurchasingPanel: React.FC<MaterialPurchasingPanelProps> = ({
  planningHorizonDays = 14,
  className = '',
}) => {
  const { language } = useLanguage();

  const shortfalls = useMemo(() => {
    const settings = getFactorySettings();
    const leadTimeHours = settings?.materialLeadTimeHours ?? 48;
    const cycles = getPlannedCycles();
    const projects = getProjectsSync();
    const products = getProducts();

    const now = new Date();
    const horizonEnd = addDays(now, planningHorizonDays);

    // Group cycles by color within the planning horizon
    const colorRequirements: Map<string, {
      totalGrams: number;
      earliestDate: Date;
      projectNames: Set<string>;
    }> = new Map();

    cycles
      .filter(c => {
        const cycleDate = new Date(c.startTime);
        return cycleDate >= now && cycleDate <= horizonEnd && c.status === 'planned';
      })
      .forEach(cycle => {
        const project = findProjectById(projects, cycle.projectId);
        if (!project?.color) return;

        const colorKey = normalizeColor(project.color);
        const existing = colorRequirements.get(colorKey);
        const cycleDate = new Date(cycle.startTime);

        if (existing) {
          existing.totalGrams += cycle.gramsPlanned;
          if (cycleDate < existing.earliestDate) {
            existing.earliestDate = cycleDate;
          }
          existing.projectNames.add(project.name);
        } else {
          colorRequirements.set(colorKey, {
            totalGrams: cycle.gramsPlanned,
            earliestDate: cycleDate,
            projectNames: new Set([project.name]),
          });
        }
      });

    // Check each color for shortfalls
    const result: MaterialShortfall[] = [];

    colorRequirements.forEach((req, colorKey) => {
      const availableGrams = getAvailableGramsByColor(colorKey);
      
      if (req.totalGrams > availableGrams) {
        const shortfallGrams = req.totalGrams - availableGrams;
        // Order-by date = earliest need date - lead time
        const orderByDate = addHours(req.earliestDate, -leadTimeHours);
        const daysUntilNeeded = Math.ceil((req.earliestDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        result.push({
          color: colorKey,
          requiredGrams: req.totalGrams,
          availableGrams,
          shortfallGrams,
          orderByDate,
          affectedProjectNames: Array.from(req.projectNames),
          daysUntilNeeded,
        });
      }
    });

    // Sort by order-by date (most urgent first)
    return result.sort((a, b) => a.orderByDate.getTime() - b.orderByDate.getTime());
  }, [planningHorizonDays]);

  const settings = getFactorySettings();
  const leadTimeHours = settings?.materialLeadTimeHours ?? 48;

  if (shortfalls.length === 0) {
    return null; // Don't show panel if no shortfalls
  }

  const isOverdue = (orderByDate: Date) => orderByDate < new Date();

  return (
    <Card variant="elevated" className={`border-warning/30 ${className}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingCart className="w-5 h-5 text-warning" />
          {language === 'he' ? 'דרישות רכש חומרים' : 'Material Purchasing'}
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">
            {shortfalls.length}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {language === 'he' 
            ? `תכנון ${planningHorizonDays} ימים קדימה • Lead time: ${leadTimeHours} שעות`
            : `${planningHorizonDays}-day planning horizon • Lead time: ${leadTimeHours}h`}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {shortfalls.map((shortfall, index) => (
          <div 
            key={`${shortfall.color}-${index}`}
            className={`p-3 rounded-lg border ${
              isOverdue(shortfall.orderByDate)
                ? 'bg-error/10 border-error/30'
                : 'bg-warning/5 border-warning/20'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium capitalize">{shortfall.color}</span>
                  {isOverdue(shortfall.orderByDate) && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {language === 'he' ? 'באיחור!' : 'Overdue!'}
                    </Badge>
                  )}
                </div>
                
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>
                    {language === 'he' ? 'חסר:' : 'Missing:'}{' '}
                    <span className="font-medium text-foreground">
                      {Math.round(shortfall.shortfallGrams)}g
                    </span>
                    {' '}
                    ({language === 'he' ? 'נדרש' : 'need'} {Math.round(shortfall.requiredGrams)}g, 
                    {' '}{language === 'he' ? 'יש' : 'have'} {Math.round(shortfall.availableGrams)}g)
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {language === 'he' ? 'להזמין עד:' : 'Order by:'}{' '}
                    <span className={`font-medium ${isOverdue(shortfall.orderByDate) ? 'text-error' : 'text-foreground'}`}>
                      {format(shortfall.orderByDate, 'dd/MM HH:mm')}
                    </span>
                    <span className="text-xs">
                      ({shortfall.daysUntilNeeded} {language === 'he' ? 'ימים עד שימוש' : 'days until use'})
                    </span>
                  </div>
                  
                  <div className="text-xs">
                    {language === 'he' ? 'פרויקטים:' : 'Projects:'}{' '}
                    {shortfall.affectedProjectNames.slice(0, 3).join(', ')}
                    {shortfall.affectedProjectNames.length > 3 && (
                      <span> +{shortfall.affectedProjectNames.length - 3}</span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="text-right flex-shrink-0">
                <div className="text-lg font-bold text-warning">
                  {Math.ceil(shortfall.shortfallGrams / 1000)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {language === 'he' ? 'גלילים' : 'spools'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
