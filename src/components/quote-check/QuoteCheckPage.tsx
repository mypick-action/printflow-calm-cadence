import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Calculator, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Calendar,
  Package,
  Clock,
  Lightbulb,
  RotateCcw
} from 'lucide-react';
import { getProducts, simulateQuote, QuoteCheckResult } from '@/services/storage';

export const QuoteCheckPage: React.FC = () => {
  const { language } = useLanguage();
  const products = getProducts();
  
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(100);
  const [dueDate, setDueDate] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'urgent' | 'critical'>('normal');
  const [result, setResult] = useState<QuoteCheckResult | null>(null);

  const handleCheck = () => {
    if (!productId || !dueDate || quantity <= 0) return;
    const checkResult = simulateQuote(productId, quantity, dueDate, urgency);
    setResult(checkResult);
  };

  const handleReset = () => {
    setProductId('');
    setQuantity(100);
    setDueDate('');
    setUrgency('normal');
    setResult(null);
  };

  const getResultIcon = () => {
    if (!result) return null;
    if (result.canAccept) return <CheckCircle2 className="w-12 h-12 text-success" />;
    if (result.canAcceptWithAdjustment) return <AlertTriangle className="w-12 h-12 text-warning" />;
    return <XCircle className="w-12 h-12 text-error" />;
  };

  const getResultBgClass = () => {
    if (!result) return '';
    if (result.canAccept) return 'bg-success/10 border-success/30';
    if (result.canAcceptWithAdjustment) return 'bg-warning/10 border-warning/30';
    return 'bg-error/10 border-error/30';
  };

  const getResultTitle = () => {
    if (!result) return '';
    if (result.canAccept) return language === 'he' ? 'ניתן לקבל ✓' : 'Can Accept ✓';
    if (result.canAcceptWithAdjustment) return language === 'he' ? 'ניתן לקבל עם התאמות' : 'Can Accept with Adjustments';
    return language === 'he' ? 'לא ניתן לקבל ללא מיקור חוץ' : 'Cannot Accept without Outsourcing';
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex p-3 bg-primary/10 rounded-2xl">
          <Calculator className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">
          {language === 'he' ? 'בדיקת הצעה' : 'Quote Check'}
        </h1>
        <p className="text-muted-foreground">
          {language === 'he' 
            ? 'בדקו אם אפשר לקבל הזמנה חדשה לפי הקיבולת הקיימת'
            : 'Check if you can accept a new order based on current capacity'}
        </p>
      </div>

      {/* Input Form */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle className="text-lg">
            {language === 'he' ? 'פרטי ההזמנה הפוטנציאלית' : 'Potential Order Details'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Product Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Package className="w-4 h-4 text-muted-foreground" />
              {language === 'he' ? 'מוצר' : 'Product'}
            </Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder={language === 'he' ? 'בחרו מוצר' : 'Select product'} />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} ({product.gramsPerUnit}g)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label htmlFor="quantity">
              {language === 'he' ? 'כמות' : 'Quantity'}
            </Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
            />
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label htmlFor="dueDate" className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              {language === 'he' ? 'תאריך יעד' : 'Due Date'}
            </Label>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {/* Urgency */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              {language === 'he' ? 'דחיפות' : 'Urgency'}
            </Label>
            <Select value={urgency} onValueChange={(v: 'normal' | 'urgent' | 'critical') => setUrgency(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">
                  {language === 'he' ? 'רגיל' : 'Normal'}
                </SelectItem>
                <SelectItem value="urgent">
                  {language === 'he' ? 'דחוף' : 'Urgent'}
                </SelectItem>
                <SelectItem value="critical">
                  {language === 'he' ? 'קריטי' : 'Critical'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button 
            onClick={handleCheck}
            className="w-full h-12 text-lg gap-2"
            disabled={!productId || !dueDate || quantity <= 0}
          >
            <Calculator className="w-5 h-5" />
            {language === 'he' ? 'בדוק זמינות' : 'Check Availability'}
          </Button>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card variant="elevated" className={`border-2 ${getResultBgClass()} animate-fade-in`}>
          <CardContent className="pt-6 space-y-6">
            {/* Result Header */}
            <div className="flex flex-col items-center text-center gap-4">
              {getResultIcon()}
              <div>
                <h3 className="text-xl font-bold">{getResultTitle()}</h3>
                <p className="text-muted-foreground mt-1">{result.message}</p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-background rounded-xl text-center">
                <div className="text-2xl font-bold text-foreground">{result.requiredDays}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'ימי עבודה נדרשים' : 'Days Required'}
                </div>
              </div>
              <div className="p-4 bg-background rounded-xl text-center">
                <div className="text-2xl font-bold text-foreground">{result.availableCapacityUnits}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'יחידות זמינות' : 'Available Units'}
                </div>
              </div>
            </div>

            {/* Suggestions */}
            {result.suggestions && result.suggestions.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Lightbulb className="w-4 h-4 text-warning" />
                  {language === 'he' ? 'הצעות' : 'Suggestions'}
                </div>
                <ul className="space-y-2">
                  {result.suggestions.map((suggestion, index) => (
                    <li 
                      key={index}
                      className="flex items-start gap-2 text-sm text-muted-foreground p-3 bg-background rounded-lg"
                    >
                      <span className="text-primary">•</span>
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleReset} className="flex-1 gap-2">
                <RotateCcw className="w-4 h-4" />
                {language === 'he' ? 'בדיקה חדשה' : 'New Check'}
              </Button>
              {result.canAccept && (
                <Button className="flex-1">
                  {language === 'he' ? 'צור פרויקט' : 'Create Project'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
