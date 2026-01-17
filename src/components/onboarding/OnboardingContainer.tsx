import React from 'react';
import { useOnboardingComplete } from '@/components/hooks/useOnboardingComplete';
import { OnboardingWizard, OnboardingData } from './OnboardingWizard';

interface OnboardingContainerProps {
  onFinished?: () => void;
}

export const OnboardingContainer: React.FC<OnboardingContainerProps> = ({ onFinished }) => {
  const { completeOnboarding, isLoading, error } = useOnboardingComplete();

  const handleComplete = async (data: OnboardingData): Promise<boolean> => {
    const success = await completeOnboarding(data);
    if (success) {
      localStorage.setItem('printflow_onboarding_complete', 'true');
      onFinished?.();
    }
    return success;
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4 text-red-600">Error</h2>
          <p className="text-lg mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <OnboardingWizard onComplete={handleComplete} isLoading={isLoading} />;
};
