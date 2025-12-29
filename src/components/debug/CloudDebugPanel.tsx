import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getCloudLocalComparison, hydrateLocalFromCloud } from '@/services/cloudBridge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, Database, HardDrive } from 'lucide-react';

interface ComparisonData {
  cloud: { printersCount: number; hasSettings: boolean; afterHoursBehavior?: string };
  local: { printersCount: number; hasSettings: boolean; afterHoursBehavior?: string };
  lastHydratedAt: string | null;
}

export const CloudDebugPanel: React.FC = () => {
  const { workspaceId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [data, setData] = useState<ComparisonData | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      await hydrateLocalFromCloud(workspaceId, { force: true, includeProjects: true });
      await runComparison(); // Refresh data after hydration
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setHydrating(false);
    }
  };

  const hasMismatch = data && (
    data.cloud.printersCount !== data.local.printersCount ||
    data.cloud.hasSettings !== data.local.hasSettings
  );

  return (
    <Card className="border-dashed border-muted-foreground/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Database className="w-4 h-4" />
          Debug: Cloud ↔ Local
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
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
  );
};
