import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Factory, Mail, Lock, User } from 'lucide-react';
import { z } from 'zod';

const emailSchema = z.string().email('כתובת מייל לא תקינה');
const passwordSchema = z.string().min(6, 'הסיסמה חייבת להכיל לפחות 6 תווים');

const Auth: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signIn, signUp, signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  
  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [factoryName, setFactoryName] = useState('');
  
  // Errors
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  const validateForm = (): boolean => {
    let valid = true;
    setEmailError('');
    setPasswordError('');
    setConfirmError('');

    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setEmailError(emailResult.error.errors[0].message);
      valid = false;
    }

    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      setPasswordError(passwordResult.error.errors[0].message);
      valid = false;
    }

    if (isSignUp && password !== confirmPassword) {
      setConfirmError('הסיסמאות לא תואמות');
      valid = false;
    }

    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await signUp(email, password, factoryName || undefined);
        if (error) {
          if (error.message.includes('already registered')) {
            toast.error('משתמש עם מייל זה כבר קיים');
          } else {
            toast.error('שגיאה בהרשמה: ' + error.message);
          }
        } else {
          toast.success('נרשמת בהצלחה! מתחבר...');
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast.error('מייל או סיסמה שגויים');
          } else {
            toast.error('שגיאה בהתחברות: ' + error.message);
          }
        }
      }
    } catch (error) {
      toast.error('שגיאה לא צפויה');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    
    const { error } = await signInWithGoogle();
    
    if (error) {
      toast.error('שגיאה בהתחברות עם גוגל: ' + error.message);
      setLoading(false);
    }
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
            <CardTitle className="text-xl">
              {isSignUp ? 'יצירת חשבון חדש' : 'ברוכים הבאים'}
            </CardTitle>
            <CardDescription>
              {isSignUp ? 'הזן את פרטיך כדי להירשם' : 'התחבר לחשבון שלך'}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Factory Name - only for signup */}
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="factoryName" className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    שם המפעל (אופציונלי)
                  </Label>
                  <Input
                    id="factoryName"
                    type="text"
                    placeholder="לדוגמה: המפעל שלי"
                    value={factoryName}
                    onChange={(e) => setFactoryName(e.target.value)}
                    disabled={loading}
                  />
                </div>
              )}
              
              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  אימייל
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className={emailError ? 'border-destructive' : ''}
                />
                {emailError && (
                  <p className="text-sm text-destructive">{emailError}</p>
                )}
              </div>
              
              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password" className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  סיסמה
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className={passwordError ? 'border-destructive' : ''}
                />
                {passwordError && (
                  <p className="text-sm text-destructive">{passwordError}</p>
                )}
              </div>
              
              {/* Confirm Password - only for signup */}
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    אישור סיסמה
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    className={confirmError ? 'border-destructive' : ''}
                  />
                  {confirmError && (
                    <p className="text-sm text-destructive">{confirmError}</p>
                  )}
                </div>
              )}
              
              <Button 
                type="submit"
                className="w-full h-12 text-base"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin ml-2" />
                    {isSignUp ? 'נרשם...' : 'מתחבר...'}
                  </>
                ) : (
                  isSignUp ? 'הירשם' : 'התחבר'
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">או</span>
              </div>
            </div>

            {/* Google Button */}
            <Button 
              onClick={handleGoogleSignIn} 
              className="w-full h-12 gap-3 text-base"
              variant="outline"
              disabled={loading}
              type="button"
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
            
            {/* Toggle signup/signin */}
            <div className="text-center text-sm pt-2">
              {isSignUp ? (
                <p className="text-muted-foreground">
                  כבר יש לך חשבון?{' '}
                  <button 
                    type="button"
                    onClick={() => setIsSignUp(false)}
                    className="text-primary hover:underline font-medium"
                    disabled={loading}
                  >
                    התחבר
                  </button>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  עוד אין לך חשבון?{' '}
                  <button 
                    type="button"
                    onClick={() => setIsSignUp(true)}
                    className="text-primary hover:underline font-medium"
                    disabled={loading}
                  >
                    הירשם עכשיו
                  </button>
                </p>
              )}
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
