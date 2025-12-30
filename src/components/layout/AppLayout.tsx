import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { 
  LayoutDashboard, 
  FolderKanban, 
  Calculator, 
  CalendarDays, 
  Package, 
  Printer, 
  ClipboardCheck, 
  Settings,
  Menu,
  X,
  Boxes,
  LogOut
} from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children, currentPage, onNavigate }) => {
  const { t, direction, language } = useLanguage();
  const { signOut, profile } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const navItems = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { id: 'operationalDashboard', label: language === 'he' ? 'לוח בקרה' : 'Operations', icon: LayoutDashboard },
    { id: 'weekly', label: language === 'he' ? 'תכנון שבועי' : 'Weekly', icon: CalendarDays },
    { id: 'projects', label: t('nav.projects'), icon: FolderKanban },
    { id: 'products', label: t('nav.products') || 'Products', icon: Package },
    { id: 'inventory', label: t('nav.inventory') || 'Inventory', icon: Boxes },
    { id: 'quoteCheck', label: t('nav.quoteCheck'), icon: Calculator },
    { id: 'planning', label: t('nav.planning'), icon: CalendarDays },
    { id: 'printers', label: t('nav.printers'), icon: Printer },
    { id: 'endCycleLog', label: t('nav.endCycleLog'), icon: ClipboardCheck },
    { id: 'settings', label: t('nav.settings'), icon: Settings },
  ];
  
  const handleSignOut = async () => {
    await signOut();
  };
  
  return (
    <div className="min-h-screen gradient-bg overflow-x-hidden" dir={direction}>
      {/* Mobile header */}
      <header className={`
        lg:hidden sticky top-0 z-40 bg-card/95 backdrop-blur-sm border-b border-border px-4 py-3 mobile-safe-top
        transition-opacity duration-300
        ${sidebarOpen ? 'pointer-events-none opacity-50' : ''}
      `}>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-6 h-6" />
          </Button>
          <h1 className="text-xl font-bold text-primary">{t('app.name')}</h1>
          <LanguageSwitcher />
        </div>
      </header>
      
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`
        fixed top-0 z-[60] h-full w-72 bg-sidebar border-e border-sidebar-border
        transition-transform duration-300 ease-in-out will-change-transform
        ${direction === 'rtl' ? 'right-0' : 'left-0'}
        ${sidebarOpen ? 'translate-x-0' : direction === 'rtl' ? 'translate-x-full' : '-translate-x-full'}
        lg:translate-x-0
      `}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-sidebar-border">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => {
                  onNavigate('dashboard');
                  setSidebarOpen(false);
                }}
                className="text-2xl font-bold text-sidebar-primary hover:opacity-80 transition-opacity cursor-pointer"
              >
                {t('app.name')}
              </button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="lg:hidden"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <p className="text-sm text-sidebar-foreground/70 mt-1">{t('app.tagline')}</p>
            {profile?.email && (
              <p className="text-xs text-sidebar-foreground/50 mt-2 truncate">
                {profile.email}
              </p>
            )}
          </div>
          
          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              
              return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.id);
                      setSidebarOpen(false);
                    }}
                    className={`
                      w-full flex items-center gap-3 px-4 py-4 rounded-xl transition-all duration-200 min-h-[48px]
                      ${isActive 
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-soft' 
                        : 'text-sidebar-foreground hover:bg-sidebar-accent'
                      }
                    `}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium">{item.label}</span>
                  </button>
              );
            })}
          </nav>
          
          {/* Footer with language switcher and logout */}
          <div className="p-4 border-t border-sidebar-border space-y-3 mobile-safe-bottom">
            {/* Language switcher (desktop) */}
            <div className="hidden lg:block">
              <LanguageSwitcher />
            </div>
            
            {/* Logout button */}
            <Button 
              variant="ghost" 
              className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleSignOut}
            >
              <LogOut className="w-5 h-5" />
              <span>{language === 'he' ? 'התנתקות' : 'Sign Out'}</span>
            </Button>
          </div>
        </div>
      </aside>
      
      {/* Main content */}
      <main className={`
        min-h-screen transition-all duration-300
        ${direction === 'rtl' ? 'lg:mr-72' : 'lg:ml-72'}
      `}>
        <div className="p-4 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};
