import React, { useState, useEffect } from 'react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { OnboardingWizard, OnboardingData } from '@/components/onboarding/OnboardingWizard';
import { AppLayout } from '@/components/layout/AppLayout';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { ProjectsPage } from '@/components/projects/ProjectsPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Construction } from 'lucide-react';

const PrintFlowApp: React.FC = () => {
  const { language } = useLanguage();
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [factoryData, setFactoryData] = useState<OnboardingData | null>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  
  // Check for saved onboarding data
  useEffect(() => {
    const saved = localStorage.getItem('printflow-onboarding');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setFactoryData(data);
        setOnboardingComplete(true);
      } catch (e) {
        console.error('Failed to parse saved data');
      }
    }
  }, []);
  
  const handleOnboardingComplete = (data: OnboardingData) => {
    setFactoryData(data);
    setOnboardingComplete(true);
    localStorage.setItem('printflow-onboarding', JSON.stringify(data));
  };
  
  if (!onboardingComplete) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }
  
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard printerNames={factoryData?.printerNames || []} />;
      case 'projects':
        return <ProjectsPage />;
      default:
        return (
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Construction className="w-6 h-6 text-warning" />
                {language === 'he' ? 'בקרוב...' : 'Coming soon...'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {language === 'he' 
                  ? 'עמוד זה נמצא בפיתוח. בקרוב יהיה זמין!'
                  : 'This page is under development. Coming soon!'}
              </p>
            </CardContent>
          </Card>
        );
    }
  };
  
  return (
    <AppLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {renderPage()}
    </AppLayout>
  );
};

const Index: React.FC = () => {
  return (
    <LanguageProvider>
      <PrintFlowApp />
    </LanguageProvider>
  );
};

export default Index;
