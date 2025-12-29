// AssignmentChoiceModal - After creating a project, let user choose manual or automatic assignment
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Cpu, Play } from 'lucide-react';
import { Project } from '@/services/storage';

interface AssignmentChoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  onManualAssignment: () => void;
  onAutomaticAssignment: () => void;
}

export const AssignmentChoiceModal: React.FC<AssignmentChoiceModalProps> = ({
  open,
  onOpenChange,
  project,
  onManualAssignment,
  onAutomaticAssignment,
}) => {
  const { language } = useLanguage();

  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir={language === 'he' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>
            {language === 'he' ? 'איך להקצות את הפרויקט?' : 'How to assign the project?'}
          </DialogTitle>
          <DialogDescription>
            {language === 'he' 
              ? `הפרויקט "${project.name}" נוצר בהצלחה. בחר כיצד להקצות אותו למדפסת.`
              : `Project "${project.name}" created successfully. Choose how to assign it to a printer.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-4">
          {/* Manual Assignment Option */}
          <Button
            variant="outline"
            className="h-auto p-4 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5"
            onClick={() => {
              onOpenChange(false);
              onManualAssignment();
            }}
          >
            <div className="flex items-center gap-2 text-primary">
              <Printer className="w-6 h-6" />
              <Play className="w-5 h-5" />
            </div>
            <div className="text-center">
              <div className="font-semibold">
                {language === 'he' ? 'הקצאה ידנית' : 'Manual Assignment'}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {language === 'he' 
                  ? 'אני אבחר על איזו מדפסת לשים ואתחיל הדפסה עכשיו'
                  : 'I\'ll choose which printer to use and start printing now'}
              </div>
            </div>
          </Button>

          {/* Automatic Assignment Option */}
          <Button
            variant="outline"
            className="h-auto p-4 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5"
            onClick={() => {
              onOpenChange(false);
              onAutomaticAssignment();
            }}
          >
            <div className="flex items-center gap-2 text-primary">
              <Cpu className="w-6 h-6" />
            </div>
            <div className="text-center">
              <div className="font-semibold">
                {language === 'he' ? 'הקצאה אוטומטית' : 'Automatic Assignment'}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {language === 'he' 
                  ? 'המערכת תתכנן ותקצה את הפרויקט למדפסת הזמינה הבאה'
                  : 'The system will plan and assign to the next available printer'}
              </div>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
