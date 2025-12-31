import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getCloudLocalComparison, hydrateLocalFromCloud } from '@/services/cloudBridge';
import { resetWorkspaceData } from '@/services/cloudStorage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RefreshCw, Database, HardDrive, Trash2, AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ComparisonData {
  cloud: { printersCount: number; hasSettings: boolean; afterHoursBehavior?: string };
  local: { printersCount: number; hasSettings: boolean; afterHoursBehavior?: string };
  lastHydratedAt: string | null;
}

export const CloudDebugPanel: React.FC = () => {
  const { workspaceId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [data, setData] = useState<ComparisonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Reset confirmation state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showResetConfirm2, setShowResetConfirm2] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');

  const runComparison = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getCloudLocalComparison(workspaceId);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  const forceHydrate = async () => {
    if (!workspaceId) return;
    setHydrating(true);
    setError(null);
    try {
      await hydrateLocalFromCloud(workspaceId, { force: true, includeProjects: true, includePlannedCycles: true, includeProducts: true });
      await runComparison(); // Refresh data after hydration
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setHydrating(false);
    }
  };

  const handleResetStep1 = () => {
    setShowResetConfirm(true);
  };

  const handleResetStep2 = () => {
    setShowResetConfirm(false);
    setShowResetConfirm2(true);
    setResetConfirmText('');
  };

  const handleResetFinal = async () => {
    if (resetConfirmText !== 'RESET' || !workspaceId) return;
    
    setShowResetConfirm2(false);
    setResetting(true);
    setError(null);
    
    try {
      const success = await resetWorkspaceData(workspaceId);
      if (success) {
        // Reload the page to get fresh state
        window.location.reload();
      } else {
        setError('Failed to reset workspace');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error resetting');
    } finally {
      setResetting(false);
    }
  };

  const hasMismatch = data && (
    data.cloud.printersCount !== data.local.printersCount ||
    data.cloud.hasSettings !== data.local.hasSettings
  );

  return (
    <>
      <Card className="border-dashed border-muted-foreground/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="w-4 h-4" />
            Debug: Cloud ↔ Local
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={runComparison}
              disabled={loading || !workspaceId}
            >
              {loading ? 'Loading...' : 'Compare'}
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={forceHydrate}
              disabled={hydrating || !workspaceId}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${hydrating ? 'animate-spin' : ''}`} />
              {hydrating ? 'Syncing...' : 'Force Sync'}
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={handleResetStep1}
              disabled={resetting || !workspaceId}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              {resetting ? 'Resetting...' : 'Reset All'}
            </Button>
          </div>

          {!workspaceId && (
            <p className="text-sm text-muted-foreground">No workspaceId</p>
          )}
          
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {data && (
            <div className="space-y-2 text-xs font-mono">
              {hasMismatch && (
                <div className="p-2 bg-warning/10 border border-warning/30 rounded text-warning">
                  ⚠️ Mismatch detected
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Database className="w-3 h-3" /> Cloud
                  </div>
                  <div>Printers: {data.cloud.printersCount}</div>
                  <div>Settings: {data.cloud.hasSettings ? '✓' : '✗'}</div>
                  <div>After Hours: {data.cloud.afterHoursBehavior || 'N/A'}</div>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <HardDrive className="w-3 h-3" /> Local
                  </div>
                  <div>Printers: {data.local.printersCount}</div>
                  <div>Settings: {data.local.hasSettings ? '✓' : '✗'}</div>
                  <div>After Hours: {data.local.afterHoursBehavior || 'N/A'}</div>
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <span className="text-muted-foreground">Last Hydrated: </span>
                {data.lastHydratedAt 
                  ? new Date(data.lastHydratedAt).toLocaleString() 
                  : 'Never'}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset Confirmation Step 1 */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              מחיקת כל הנתונים
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              פעולה זו תמחק את כל המוצרים, הפרויקטים, המחזורים והמלאי מהענן ומהמכשיר הזה.
              <br /><br />
              <strong>לא ניתן לבטל פעולה זו!</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleResetStep2}
              className="bg-destructive hover:bg-destructive/90"
            >
              המשך
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Confirmation Step 2 - Type RESET */}
      <AlertDialog open={showResetConfirm2} onOpenChange={setShowResetConfirm2}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              אישור סופי
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right space-y-4">
              <p>הקלד <strong>RESET</strong> כדי לאשר את מחיקת כל הנתונים:</p>
              <Input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value.toUpperCase())}
                placeholder="RESET"
                className="font-mono text-center"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel onClick={() => setResetConfirmText('')}>ביטול</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleResetFinal}
              disabled={resetConfirmText !== 'RESET'}
              className="bg-destructive hover:bg-destructive/90"
            >
              מחק הכל
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
