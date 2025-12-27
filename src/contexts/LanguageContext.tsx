import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Language = 'he' | 'en';
type Direction = 'rtl' | 'ltr';

interface LanguageContextType {
  language: Language;
  direction: Direction;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  he: {
    // App name & general
    'app.name': 'PrintFlow',
    'app.tagline': 'ניהול פשוט של חוות הדפסה תלת-ממדית',
    
    // Navigation
    'nav.dashboard': 'לוח בקרה',
    'nav.projects': 'פרויקטים',
    'nav.quoteCheck': 'בדיקת הצעה',
    'nav.planning': 'תכנון',
    'nav.inventory': 'מלאי',
    'nav.printers': 'מדפסות',
    'nav.endCycleLog': 'דיווח סיום מחזור',
    'nav.settings': 'הגדרות',
    
    // Onboarding
    'onboarding.welcome': 'ברוכים הבאים ל-PrintFlow!',
    'onboarding.welcomeDesc': 'בואו נגדיר את המערכת בכמה שלבים פשוטים',
    'onboarding.step': 'שלב',
    'onboarding.of': 'מתוך',
    
    // Step 1
    'onboarding.step1.title': 'פרטי המפעל',
    'onboarding.step1.printerCount': 'כמה מדפסות יש לכם?',
    'onboarding.step1.workdays': 'ימי עבודה',
    'onboarding.step1.workHours': 'שעות עבודה',
    'onboarding.step1.startTime': 'שעת התחלה',
    'onboarding.step1.endTime': 'שעת סיום',
    'onboarding.step1.printerNames': 'שמות המדפסות (אופציונלי)',
    'onboarding.step1.tooltip': 'משמש לחישוב קיבולת הייצור שלכם.',
    
    // Days
    'day.sunday': 'ראשון',
    'day.monday': 'שני',
    'day.tuesday': 'שלישי',
    'day.wednesday': 'רביעי',
    'day.thursday': 'חמישי',
    'day.friday': 'שישי',
    'day.saturday': 'שבת',
    
    // Step 2
    'onboarding.step2.title': 'התנהגות מחוץ לשעות העבודה',
    'onboarding.step2.question': 'מה קורה למדפסות אחרי יום העבודה?',
    'onboarding.step2.option1': 'לא מדפיסים ללא נוכחות צוות',
    'onboarding.step2.option1Desc': 'המדפסות נעצרות בסוף היום',
    'onboarding.step2.option2': 'שולחים מחזור אחד אחרון בסוף היום',
    'onboarding.step2.option2Desc': 'המדפסת מסיימת את המחזור וממתינה לבוקר (מומלץ)',
    'onboarding.step2.option3': 'המדפסות ממשיכות לעבוד אוטומטית',
    'onboarding.step2.option3Desc': 'אוטומציה מלאה (החלפת מגשים אוטומטית)',
    'onboarding.step2.tooltip': 'בחרו אפשרות 3 רק אם המדפסות יכולות להתחיל מחזורים חדשים בעצמן.',
    'onboarding.step2.recommended': 'מומלץ',
    
    // Step 3
    'onboarding.step3.title': 'חומרים וצבעים',
    'onboarding.step3.colors': 'צבעים זמינים',
    'onboarding.step3.addColor': 'הוסף צבע',
    'onboarding.step3.spoolWeight': 'משקל גליל סטנדרטי (גרם)',
    'onboarding.step3.deliveryDays': 'כמה ימים לוקח לקבל גלילים חדשים?',
    'onboarding.step3.tooltip': 'משמש להתרעה לפני שנגמר החומר.',
    
    // Summary
    'onboarding.summary.title': 'הכל מוכן!',
    'onboarding.summary.item1': 'המערכת מתכננת את העבודה שלכם',
    'onboarding.summary.item2': 'אתם מדווחים מה קרה',
    'onboarding.summary.item3': 'לכל בעיה יש פתרון',
    'onboarding.summary.start': 'להתחיל לעבוד',
    
    // Common
    'common.next': 'הבא',
    'common.back': 'חזרה',
    'common.save': 'שמור',
    'common.cancel': 'ביטול',
    'common.delete': 'מחק',
    'common.edit': 'ערוך',
    'common.add': 'הוסף',
    'common.search': 'חיפוש',
    'common.filter': 'סינון',
    'common.loading': 'טוען...',
    'common.error': 'שגיאה',
    'common.success': 'הצלחה',
    
    // Dashboard
    'dashboard.goodMorning': 'בוקר טוב!',
    'dashboard.todayPlan': 'תכנית העבודה להיום',
    'dashboard.allReady': 'הכל מוכן לעבודה',
    'dashboard.reportIssue': 'דווח על בעיה',
    'dashboard.overview': 'סקירה',
    'dashboard.actionItems': 'דרוש טיפול',
    'dashboard.noIssues': 'אין בעיות היום',
    'dashboard.leaveSpool': 'השאר גליל',
    'dashboard.endOfDayCycle': 'מחזור סוף יום',
    
    // Printers
    'printer.name': 'מדפסת',
    'printer.status': 'סטטוס',
    'printer.currentJob': 'עבודה נוכחית',
    'printer.idle': 'פנויה',
    'printer.printing': 'מדפיסה',
    
    // Projects
    'project.name': 'שם הפרויקט',
    'project.product': 'מוצר',
    'project.quantity': 'כמות',
    'project.dueDate': 'תאריך יעד',
    'project.status': 'סטטוס',
    'project.progress': 'התקדמות',
    
    // Colors (defaults)
    'color.black': 'שחור',
    'color.white': 'לבן',
    'color.gray': 'אפור',
    'color.red': 'אדום',
    'color.blue': 'כחול',
    'color.green': 'ירוק',
    'color.yellow': 'צהוב',
    'color.orange': 'כתום',
    'color.purple': 'סגול',
    'color.pink': 'ורוד',
    'color.brown': 'חום',
    'color.transparent': 'שקוף',
  },
  en: {
    // App name & general
    'app.name': 'PrintFlow',
    'app.tagline': 'Simple 3D printing farm management',
    
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.projects': 'Projects',
    'nav.quoteCheck': 'Quote Check',
    'nav.planning': 'Planning',
    'nav.inventory': 'Inventory',
    'nav.printers': 'Printers',
    'nav.endCycleLog': 'End-Cycle Log',
    'nav.settings': 'Settings',
    
    // Onboarding
    'onboarding.welcome': 'Welcome to PrintFlow!',
    'onboarding.welcomeDesc': "Let's set up your system in a few simple steps",
    'onboarding.step': 'Step',
    'onboarding.of': 'of',
    
    // Step 1
    'onboarding.step1.title': 'Factory Basics',
    'onboarding.step1.printerCount': 'How many printers do you have?',
    'onboarding.step1.workdays': 'Workdays',
    'onboarding.step1.workHours': 'Work Hours',
    'onboarding.step1.startTime': 'Start Time',
    'onboarding.step1.endTime': 'End Time',
    'onboarding.step1.printerNames': 'Printer Names (optional)',
    'onboarding.step1.tooltip': 'Used to calculate your production capacity.',
    
    // Days
    'day.sunday': 'Sunday',
    'day.monday': 'Monday',
    'day.tuesday': 'Tuesday',
    'day.wednesday': 'Wednesday',
    'day.thursday': 'Thursday',
    'day.friday': 'Friday',
    'day.saturday': 'Saturday',
    
    // Step 2
    'onboarding.step2.title': 'After-hours Behavior',
    'onboarding.step2.question': 'What happens to your printers after the workday ends?',
    'onboarding.step2.option1': 'We do not print without staff present',
    'onboarding.step2.option1Desc': 'Printers stop at end of day',
    'onboarding.step2.option2': 'We send ONE last print cycle at the end of the workday',
    'onboarding.step2.option2Desc': 'Printer finishes that cycle and waits until morning',
    'onboarding.step2.option3': 'Printers continue working automatically without staff',
    'onboarding.step2.option3Desc': 'Full automation (auto-restart / tray replacement)',
    'onboarding.step2.tooltip': 'Choose option 3 only if printers can start new cycles on their own.',
    'onboarding.step2.recommended': 'Recommended',
    
    // Step 3
    'onboarding.step3.title': 'Materials & Colors',
    'onboarding.step3.colors': 'Available Colors',
    'onboarding.step3.addColor': 'Add Color',
    'onboarding.step3.spoolWeight': 'Standard Spool Weight (grams)',
    'onboarding.step3.deliveryDays': 'How many days to receive new filament rolls?',
    'onboarding.step3.tooltip': 'Used to warn you before running out of material.',
    
    // Summary
    'onboarding.summary.title': 'All Set!',
    'onboarding.summary.item1': 'The system plans your work',
    'onboarding.summary.item2': 'You report what happened',
    'onboarding.summary.item3': 'Every problem has a solution',
    'onboarding.summary.start': 'Start working',
    
    // Common
    'common.next': 'Next',
    'common.back': 'Back',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    
    // Dashboard
    'dashboard.goodMorning': 'Good Morning!',
    'dashboard.todayPlan': "Today's Work Plan",
    'dashboard.allReady': 'All set for today',
    'dashboard.reportIssue': 'Report Issue',
    'dashboard.overview': 'Overview',
    'dashboard.actionItems': 'Action Items',
    'dashboard.noIssues': 'No issues today',
    'dashboard.leaveSpool': 'Leave spool',
    'dashboard.endOfDayCycle': 'End-of-day cycle',
    
    // Printers
    'printer.name': 'Printer',
    'printer.status': 'Status',
    'printer.currentJob': 'Current Job',
    'printer.idle': 'Idle',
    'printer.printing': 'Printing',
    
    // Projects
    'project.name': 'Project Name',
    'project.product': 'Product',
    'project.quantity': 'Quantity',
    'project.dueDate': 'Due Date',
    'project.status': 'Status',
    'project.progress': 'Progress',
    
    // Colors (defaults)
    'color.black': 'Black',
    'color.white': 'White',
    'color.gray': 'Gray',
    'color.red': 'Red',
    'color.blue': 'Blue',
    'color.green': 'Green',
    'color.yellow': 'Yellow',
    'color.orange': 'Orange',
    'color.purple': 'Purple',
    'color.pink': 'Pink',
    'color.brown': 'Brown',
    'color.transparent': 'Transparent',
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('he');
  
  const direction: Direction = language === 'he' ? 'rtl' : 'ltr';
  
  useEffect(() => {
    document.documentElement.setAttribute('dir', direction);
    document.documentElement.setAttribute('lang', language);
  }, [language, direction]);
  
  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('printflow-language', lang);
  };
  
  useEffect(() => {
    const savedLang = localStorage.getItem('printflow-language') as Language | null;
    if (savedLang && (savedLang === 'he' || savedLang === 'en')) {
      setLanguageState(savedLang);
    }
  }, []);
  
  const t = (key: string): string => {
    return translations[language][key] || key;
  };
  
  return (
    <LanguageContext.Provider value={{ language, direction, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
