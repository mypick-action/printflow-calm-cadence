import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Sparkles, Database, PlayCircle, Printer } from 'lucide-react';

interface BootstrapScreenProps {
  onStartFresh: () => void;
  onLoadDemo: () => void;
}

export const BootstrapScreen: React.FC<BootstrapScreenProps> = ({
  onStartFresh,
  onLoadDemo,
}) => {
  const { language } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState<'fresh' | 'demo' | null>(null);

  const handleStartFresh = () => {
    setSelectedOption('fresh');
    setIsLoading(true);
    // Small delay for visual feedback
    setTimeout(() => {
      onStartFresh();
    }, 300);
  };

  const handleLoadDemo = () => {
    setSelectedOption('demo');
    setIsLoading(true);
    // Small delay for visual feedback
    setTimeout(() => {
      onLoadDemo();
    }, 300);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex flex-col items-center justify-center p-4">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      {/* Logo & Welcome */}
      <div className="text-center mb-8 space-y-4">
        <div className="flex items-center justify-center gap-3">
          <div className="p-3 bg-primary/10 rounded-2xl">
            <Printer className="w-10 h-10 text-primary" />
          </div>
        </div>
        <h1 className="text-4xl font-bold text-foreground">
          {language === 'he' ? '!ברוכים הבאים ל-PrintFlow' : 'Welcome to PrintFlow!'}
        </h1>
        <p className="text-lg text-muted-foreground max-w-md">
          {language === 'he' 
            ? 'מערכת תכנון וניהול לייצור בהדפסת 3D'
            : 'Planning and management system for 3D printing production'}
        </p>
      </div>

      {/* Choice Cards */}
      <div className="grid md:grid-cols-2 gap-6 max-w-2xl w-full">
        {/* Start Fresh Option */}
        <Card 
          variant="elevated" 
          className={`cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg border-2 ${
            selectedOption === 'fresh' ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-primary/30'
          }`}
          onClick={!isLoading ? handleStartFresh : undefined}
        >
          <CardHeader className="text-center pb-3">
            <div className="flex justify-center mb-3">
              <div className="p-3 bg-success/10 rounded-xl">
                <Sparkles className="w-8 h-8 text-success" />
              </div>
            </div>
            <CardTitle className="text-xl">
              {language === 'he' ? 'התחל מאפס' : 'Start Fresh'}
            </CardTitle>
            <Badge variant="outline" className="w-fit mx-auto bg-success/10 text-success border-success/20">
              {language === 'he' ? 'מומלץ' : 'Recommended'}
            </Badge>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <CardDescription className="text-base">
              {language === 'he' 
                ? 'התחל עם מערכת נקייה והגדר את המפעל שלך צעד אחר צעד'
                : 'Start with a clean system and set up your factory step by step'}
            </CardDescription>
            <ul className="text-sm text-muted-foreground space-y-1 text-right" dir={language === 'he' ? 'rtl' : 'ltr'}>
              <li>✓ {language === 'he' ? 'ללא נתוני דוגמה' : 'No sample data'}</li>
              <li>✓ {language === 'he' ? 'הגדרה מודרכת' : 'Guided setup'}</li>
              <li>✓ {language === 'he' ? 'מוכן לייצור אמיתי' : 'Ready for real production'}</li>
            </ul>
            <Button 
              size="lg" 
              className="w-full gap-2"
              disabled={isLoading}
            >
              {isLoading && selectedOption === 'fresh' ? (
                <span className="animate-pulse">
                  {language === 'he' ? 'מתחיל...' : 'Starting...'}
                </span>
              ) : (
                <>
                  <PlayCircle className="w-5 h-5" />
                  {language === 'he' ? 'התחל עכשיו' : 'Start Now'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Load Demo Option */}
        <Card 
          variant="elevated"
          className={`cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg border-2 ${
            selectedOption === 'demo' ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-muted-foreground/30'
          }`}
          onClick={!isLoading ? handleLoadDemo : undefined}
        >
          <CardHeader className="text-center pb-3">
            <div className="flex justify-center mb-3">
              <div className="p-3 bg-primary/10 rounded-xl">
                <Database className="w-8 h-8 text-primary" />
              </div>
            </div>
            <CardTitle className="text-xl">
              {language === 'he' ? 'טען נתוני הדגמה' : 'Load Demo Data'}
            </CardTitle>
            <Badge variant="outline" className="w-fit mx-auto">
              {language === 'he' ? 'לתצוגה מקדימה' : 'Preview Mode'}
            </Badge>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <CardDescription className="text-base">
              {language === 'he' 
                ? 'הכר את המערכת עם פרויקטים ומוצרים לדוגמה'
                : 'Explore the system with sample projects and products'}
            </CardDescription>
            <ul className="text-sm text-muted-foreground space-y-1 text-right" dir={language === 'he' ? 'rtl' : 'ltr'}>
              <li>• {language === 'he' ? 'פרויקטים לדוגמה' : 'Sample projects'}</li>
              <li>• {language === 'he' ? 'מוצרים מוגדרים' : 'Pre-configured products'}</li>
              <li>• {language === 'he' ? 'ניתן לאפס בכל עת' : 'Can reset anytime'}</li>
            </ul>
            <Button 
              variant="outline" 
              size="lg" 
              className="w-full gap-2"
              disabled={isLoading}
            >
              {isLoading && selectedOption === 'demo' ? (
                <span className="animate-pulse">
                  {language === 'he' ? 'טוען...' : 'Loading...'}
                </span>
              ) : (
                <>
                  <Database className="w-5 h-5" />
                  {language === 'he' ? 'טען הדגמה' : 'Load Demo'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Footer note */}
      <p className="text-sm text-muted-foreground mt-8 text-center max-w-md">
        {language === 'he' 
          ? 'כל הנתונים נשמרים מקומית במכשיר זה בלבד. תוכל לאפס בכל עת דרך ההגדרות.'
          : 'All data is stored locally on this device only. You can reset anytime via Settings.'}
      </p>
    </div>
  );
};
