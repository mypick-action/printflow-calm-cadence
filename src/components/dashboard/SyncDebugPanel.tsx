// SyncDebugPanel - Temporary debug panel for cloud/local sync status
// Shows workspaceId, cloud vs local counts, and Hard Reset button

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { hydrateLocalFromCloud } from '@/services/cloudBridge';
import * as cloudStorage from '@/services/cloudStorage';
import { hardResetLocalCache } from '@/services/storage';
import { recalculatePlan } from '@/services/planningRecalculator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Database, HardDrive, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';

interface SyncCounts {
  cloud: { projects: number; cycles: number };
  local: { projects: number; cycles: number };
}

export const SyncDebugPanel: React.FC = () => {
  const { workspaceId } = useAuth();
  const [counts, setCounts] = useState<SyncCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCounts = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    
    try {
      // Cloud counts
      const cloudProjects = await cloudStorage.getProjects(workspaceId);
      const cloudCycles = await cloudStorage.getPlannedCycles(workspaceId);
      
      // Local counts (direct localStorage read)
      const localProjectsRaw = localStorage.getItem('printflow_projects');
      const localCyclesRaw = localStorage.getItem('printflow_planned_cycles');
      const localProjects = localProjectsRaw ? JSON.parse(localProjectsRaw) : [];
      const localCycles = localCyclesRaw ? JSON.parse(localCyclesRaw) : [];
      
      setCounts({
        cloud: { projects: cloudProjects.length, cycles: cloudCycles.length },
        local: { projects: localProjects.length, cycles: localCycles.length },
      });
      
      console.log('[SyncDebugPanel] Counts refreshed:', {
        cloud: { projects: cloudProjects.length, cycles: cloudCycles.length },
        local: { projects: localProjects.length, cycles: localCycles.length },
      });
    } catch (e) {
      console.error('[SyncDebugPanel] Error fetching counts:', e);
      setError(e instanceof Error ? e.message : 'Failed to fetch counts');
    } finally {
      setLoading(false);
    }
  };

  // Hard Reset with FULL await chain: clear → hydrate projects → hydrate cycles → replan → refresh
  const handleHardReset = async () => {
    if (!workspaceId) {
      setError('No workspaceId available');
      return;
    }
    
    setResetting(true);
    setError(null);
    
    try {
      console.log('[SyncDebugPanel] === HARD RESET START ===');
      
      // Step 1: Clear all local cache (except PRODUCTS - protected)
      console.log('[SyncDebugPanel] Step 1: Clearing local cache...');
      hardResetLocalCache();
      
      // Step 2: Hydrate projects from cloud (OVERWRITE mode)
      console.log('[SyncDebugPanel] Step 2: Hydrating projects from cloud (OVERWRITE)...');
      await hydrateLocalFromCloud(workspaceId, { 
        force: true, 
        includeProjects: true, 
        includePlannedCycles: true, // This will also hydrate cycles in OVERWRITE mode
        includeProducts: false // DON'T touch products - protected
      });
      
      // Step 3: Recalculate plan (AFTER hydration complete)
      console.log('[SyncDebugPanel] Step 3: Recalculating plan...');
      const result = recalculatePlan('whole_week', true, 'hard_reset');
      console.log('[SyncDebugPanel] Replan result:', result);
      
      console.log('[SyncDebugPanel] === HARD RESET COMPLETE - RELOADING ===');
      
      // Step 4: Force page reload
      window.location.reload();
    } catch (e) {
      console.error('[SyncDebugPanel] Hard reset failed:', e);
      setError(e instanceof Error ? e.message : 'Reset failed');
      setResetting(false);
    }
  };

  // Load counts on mount
  useEffect(() => {
    if (workspaceId) {
      refreshCounts();
    }
  }, [workspaceId]);

  const hasMismatch = counts && (
    counts.cloud.projects !== counts.local.projects || 
    counts.cloud.cycles !== counts.local.cycles
  );

  return (
    <Card className="border-dashed border-yellow-500/50 bg-yellow-50/10 dark:bg-yellow-900/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="w-4 h-4" />
          Debug: Sync Status
          {hasMismatch && (
            <Badge variant="destructive" className="mr-2">
              <AlertTriangle className="w-3 h-3 ml-1" />
              Mismatch!
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs font-mono">
        {/* Workspace ID */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Workspace:</span>
          <span className="truncate max-w-[200px]" title={workspaceId || 'None'}>
            {workspaceId ? `${workspaceId.slice(0, 8)}...` : 'None'}
          </span>
        </div>
        
        {/* Error message */}
        {error && (
          <div className="text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}
        
        {/* Counts Grid */}
        {counts && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-blue-500">
                <Database className="w-3 h-3" /> Cloud
              </div>
              <div>Projects: <span className="font-bold">{counts.cloud.projects}</span></div>
              <div>Cycles: <span className="font-bold">{counts.cloud.cycles}</span></div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-green-500">
                <HardDrive className="w-3 h-3" /> Local
              </div>
              <div>Projects: <span className={`font-bold ${counts.cloud.projects !== counts.local.projects ? 'text-destructive' : ''}`}>
                {counts.local.projects}
              </span></div>
              <div>Cycles: <span className={`font-bold ${counts.cloud.cycles !== counts.local.cycles ? 'text-destructive' : ''}`}>
                {counts.local.cycles}
              </span></div>
            </div>
          </div>
        )}
        
        {/* Loading state */}
        {loading && !counts && (
          <div className="text-muted-foreground">Loading counts...</div>
        )}
        
        {/* Actions */}
        <div className="flex gap-2 pt-2 flex-wrap">
          <Button 
            size="sm" 
            variant="outline" 
            onClick={refreshCounts} 
            disabled={loading || !workspaceId}
          >
            <RefreshCw className={`w-3 h-3 ml-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button 
            size="sm" 
            variant="destructive" 
            onClick={handleHardReset} 
            disabled={resetting || !workspaceId}
          >
            <Trash2 className="w-3 h-3 ml-1" />
            {resetting ? 'מאפס...' : 'Hard Reset (FULL)'}
          </Button>
        </div>
        
        {/* Help text */}
        <div className="text-[10px] text-muted-foreground mt-2">
          Hard Reset: מנקה cache מקומי → טוען מהענן (overwrite) → מחשב plan מחדש
        </div>
      </CardContent>
    </Card>
  );
};
