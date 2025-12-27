import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  RotateCcw,
  Palette,
  Timer,
  TrendingUp,
  Truck,
  Zap
} from 'lucide-react';
import { getProducts, simulateQuote, QuoteCheckResult, getSpools } from '@/services/storage';

const availableColors = ['Black', 'White', 'Gray', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink'];

interface Suggestion {
  icon: React.ElementType;
  text: string;
  textEn: string;
}

const getSuggestions = (result: QuoteCheckResult, language: string): Suggestion[] => {
  if (result.canAccept) {
    return [
      { icon: CheckCircle2, text: 'הכל מוכן - אפשר לאשר ללקוח!', textEn: 'All set - you can confirm with the customer!' }
    ];
  }
  
  if (result.canAcceptWithAdjustment) {
    return [
      { icon: Timer, text: 'הוסיפו שעות נוספות ביום או יומיים', textEn: 'Add overtime for a day or two' },
      { icon: TrendingUp, text: 'הפחיתו יחידות למחזור לזמן אספקה מהיר יותר', textEn: 'Reduce units per cycle for faster delivery' },
      { icon: Package, text: 'קנו גליל גדול יותר כדי למנוע עצירות', textEn: 'Buy a larger spool to avoid stops' },
    ];
  }
  
  return [
    { icon: Truck, text: 'שקלו מיקור חוץ לחלק מההזמנה', textEn: 'Consider outsourcing part of the order' },
    { icon: Calendar, text: 'נסו לנהל משא ומתן על דדליין מאוחר יותר', textEn: 'Try negotiating a later deadline' },
    { icon: Zap, text: 'הצעה: השתמשו ב-AMS כגיבוי לעבודה רציפה', textEn: 'Tip: Use AMS backup for continuous work' },
  ];
};

export const QuoteCheckPage: React.FC = () => {
  const { language } = useLanguage();
  const products = getProducts();
  const spools = getSpools();
  
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(100);
  const [dueDate, setDueDate] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'urgent' | 'critical'>('normal');
  const [preferredColor, setPreferredColor] = useState('any');
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
    setPreferredColor('any');
    setResult(null);
  };

  const getResultIcon = () => {
    if (!result) return null;
    if (result.canAccept) return <CheckCircle2 className="w-14 h-14 text-success" />;
    if (result.canAcceptWithAdjustment) return <AlertTriangle className="w-14 h-14 text-warning" />;
    return <XCircle className="w-14 h-14 text-error" />;
  };

  const getResultBgClass = () => {
    if (!result) return '';
    if (result.canAccept) return 'bg-success/10 border-success/30';
    if (result.canAcceptWithAdjustment) return 'bg-warning/10 border-warning/30';
    return 'bg-error/10 border-error/30';
  };

  const getResultTitle = () => {
    if (!result) return '';
    if (result.canAccept) {
      return language === 'he' ? '✓ אפשר לקבל!' : '✓ Can Accept!';
    }
    if (result.canAcceptWithAdjustment) {
      return language === 'he' ? 'אפשר עם התאמות קטנות' : 'Possible with Small Adjustments';
    }
    return language === 'he' ? 'צריך מיקור חוץ' : 'Requires Outsourcing';
  };

  const getResultMessage = () => {
    if (!result) return '';
    if (result.canAccept) {
      return language === 'he' 
        ? 'יש לכם מספיק קיבולת לסיים בזמן. קדימה!' 
        : 'You have enough capacity to finish on time. Go for it!';
    }
    if (result.canAcceptWithAdjustment) {
      return language === 'he'
        ? 'זה אפשרי, אבל תצטרכו לעשות קצת התאמות. הנה כמה רעיונות:'
        : "It's doable, but you'll need some adjustments. Here are some ideas:";
    }
    return language === 'he'
      ? 'ההזמנה גדולה מהקיבולת הזמינה. הנה מה שאפשר לעשות:'
      : 'The order exceeds available capacity. Here\'s what you can do:';
  };

  // Check if preferred color is in stock
  const colorInStock = preferredColor && preferredColor !== 'any'
    ? spools.some(s => s.color.toLowerCase() === preferredColor.toLowerCase() && s.gramsRemainingEst > 100)
    : true;

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
            ? 'בדקו מהר אם אפשר לקבל הזמנה חדשה'
            : 'Quickly check if you can take a new order'}
        </p>
      </div>

      {/* Input Form */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle className="text-lg">
            {language === 'he' ? 'מה ההזמנה?' : "What's the order?"}
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
              <SelectContent className="bg-background border shadow-lg">
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
              {language === 'he' ? 'כמות יחידות' : 'Quantity (units)'}
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
              {language === 'he' ? 'מתי צריך?' : 'When is it due?'}
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
              {language === 'he' ? 'כמה דחוף?' : 'How urgent?'}
            </Label>
            <Select value={urgency} onValueChange={(v: 'normal' | 'urgent' | 'critical') => setUrgency(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg">
                <SelectItem value="normal">
                  {language === 'he' ? '😊 רגיל - יש זמן' : '😊 Normal - no rush'}
                </SelectItem>
                <SelectItem value="urgent">
                  {language === 'he' ? '⚡ דחוף - לקוח חשוב' : '⚡ Urgent - important client'}
                </SelectItem>
                <SelectItem value="critical">
                  {language === 'he' ? '🔥 קריטי - חייב להיות בזמן' : '🔥 Critical - must be on time'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Preferred Color (Optional) */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-muted-foreground" />
              {language === 'he' ? 'צבע מועדף (אופציונלי)' : 'Preferred Color (optional)'}
            </Label>
            <Select value={preferredColor} onValueChange={setPreferredColor}>
              <SelectTrigger>
                <SelectValue placeholder={language === 'he' ? 'בחרו צבע' : 'Select color'} />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg">
                <SelectItem value="any">
                  {language === 'he' ? 'לא משנה' : 'Any color'}
                </SelectItem>
                {availableColors.filter(c => c && c.trim()).map((color) => (
                  <SelectItem key={color} value={color}>
                    {color}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preferredColor && preferredColor !== 'any' && !colorInStock && (
              <p className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {language === 'he' ? 'הצבע הזה לא במלאי - ייתכן שתצטרכו להזמין' : 'This color may not be in stock - you might need to order'}
              </p>
            )}
          </div>

          <Button 
            onClick={handleCheck}
            className="w-full h-12 text-lg gap-2"
            disabled={!productId || !dueDate || quantity <= 0}
          >
            <Calculator className="w-5 h-5" />
            {language === 'he' ? 'בדוק עכשיו' : 'Check Now'}
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
                <h3 className="text-2xl font-bold">{getResultTitle()}</h3>
                <p className="text-muted-foreground mt-2 max-w-md">{getResultMessage()}</p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-background rounded-xl text-center">
                <div className="text-3xl font-bold text-foreground">{result.requiredDays}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'ימים לייצור' : 'Days to Produce'}
                </div>
              </div>
              <div className="p-4 bg-background rounded-xl text-center">
                <div className="text-3xl font-bold text-foreground">{result.availableCapacityUnits}</div>
                <div className="text-sm text-muted-foreground">
                  {language === 'he' ? 'יחידות פנויות' : 'Available Capacity'}
                </div>
              </div>
            </div>

            {/* Friendly Suggestions */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Lightbulb className="w-4 h-4 text-warning" />
                {language === 'he' ? 'מה לעשות?' : 'What to do?'}
              </div>
              <div className="space-y-2">
                {getSuggestions(result, language).map((suggestion, index) => {
                  const Icon = suggestion.icon;
                  return (
                    <div 
                      key={index}
                      className="flex items-center gap-3 text-sm p-3 bg-background rounded-lg"
                    >
                      <div className="flex-shrink-0 p-2 rounded-lg bg-muted">
                        <Icon className="w-4 h-4 text-foreground" />
                      </div>
                      <span className="text-foreground">
                        {language === 'he' ? suggestion.text : suggestion.textEn}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={handleReset} className="flex-1 gap-2">
                <RotateCcw className="w-4 h-4" />
                {language === 'he' ? 'בדיקה חדשה' : 'New Check'}
              </Button>
              {(result.canAccept || result.canAcceptWithAdjustment) && (
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
