import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Factory } from 'lucide-react';

const Auth: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    
    const { error } = await signInWithGoogle();
    
    if (error) {
      console.error('Google sign in error:', error);
      toast.error('שגיאה בהתחברות עם גוגל: ' + error.message);
      setLoading(false);
    }
    // Note: On success, the page will redirect to Google, so no need to reset loading
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-2xl mb-4">
            <Factory className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">PrintFlow</h1>
          <p className="text-muted-foreground mt-2">ניהול חכם לייצור הדפסות תלת מימד</p>
        </div>

        <Card variant="elevated" className="border-0 shadow-lg">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">ברוכים הבאים</CardTitle>
            <CardDescription>התחבר עם חשבון גוגל כדי להתחיל</CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <Button 
              onClick={handleGoogleSignIn} 
              className="w-full h-12 gap-3 text-base"
              variant="outline"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  מתחבר...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  התחבר עם Google
                </>
              )}
            </Button>
            
            <div className="text-center text-sm text-muted-foreground pt-2">
              <p>התחברות מאובטחת באמצעות חשבון Google שלך</p>
            </div>
          </CardContent>
        </Card>
        
        <p className="text-center text-sm text-muted-foreground mt-6">
          בהמשך ההתחברות אתה מסכים לתנאי השימוש
        </p>
      </div>
    </div>
  );
};

export default Auth;
