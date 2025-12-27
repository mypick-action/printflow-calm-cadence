import React, { createContext, useContext, useState, useCallback } from 'react';

interface NavigationState {
  openPrinterId?: string;
  focusField?: string;
}

interface NavigationContextType {
  currentPage: string;
  navigationState: NavigationState;
  navigateTo: (page: string, state?: NavigationState) => void;
  clearNavigationState: () => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const NavigationProvider: React.FC<{
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}> = ({ children, currentPage, onNavigate }) => {
  const [navigationState, setNavigationState] = useState<NavigationState>({});

  const navigateTo = useCallback((page: string, state?: NavigationState) => {
    console.log('[NavigationContext] navigateTo called:', page, state);
    if (state) {
      console.log('[NavigationContext] Setting navigationState:', state);
      setNavigationState(state);
    }
    console.log('[NavigationContext] Calling onNavigate:', page);
    onNavigate(page);
  }, [onNavigate]);

  const clearNavigationState = useCallback(() => {
    setNavigationState({});
  }, []);

  return (
    <NavigationContext.Provider value={{ currentPage, navigationState, navigateTo, clearNavigationState }}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};
