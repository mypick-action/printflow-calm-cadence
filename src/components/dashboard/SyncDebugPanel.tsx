// SyncDebugPanel - Debug panel for cloud/local sync status
// Shows workspaceId, cloud vs local counts, and reset options

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { hydrateLocalFromCloud } from '@/services/cloudBridge';
import * as cloudStorage from '@/services/cloudStorage';
import { hardResetLocalCache } from '@/services/storage';
import { recalculatePlan } from '@/services/planningRecalculator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Database, HardDrive, RefreshCw, Trash2, AlertTriangle, CloudOff, Zap } from 'lucide-react';

interface SyncCounts {
  cloud: { projects: number; cycles: number };
  local: { projects: number; cycles: number };
}

export const SyncDebugPanel: React.FC = () => {
  const { workspaceId } = useAuth();
  const [counts, setCounts] = useState<SyncCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeLogs, setIncludeLogs] = useState(false);

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

  // Hard Reset LOCAL ONLY: clear local → hydrate from cloud
  const handleLocalReset = async () => {
    if (!workspaceId) {
      setError('No workspaceId available');
      return;
    }
    
    setResetting(true);
    setError(null);
    
    try {
      console.log('[SyncDebugPanel] === LOCAL RESET START ===');
      
      // Step 1: Clear local cache
      console.log('[SyncDebugPanel] Step 1: Clearing local cache...');
      hardResetLocalCache();
      
      // Step 2: Hydrate from cloud (OVERWRITE mode)
      console.log('[SyncDebugPanel] Step 2: Hydrating from cloud (OVERWRITE)...');
      await hydrateLocalFromCloud(workspaceId, { 
        force: true, 
        includeProjects: true, 
        includePlannedCycles: true,
        includeProducts: false
      });
      
      console.log('[SyncDebugPanel] === LOCAL RESET COMPLETE - RELOADING ===');
      window.location.reload();
    } catch (e) {
      console.error('[SyncDebugPanel] Local reset failed:', e);
      setError(e instanceof Error ? e.message : 'Reset failed');
      setResetting(false);
    }
  };

  // PURGE CLOUD + REPLAN: delete cloud cycles → clear local → replan fresh
  const handlePurgeAndReplan = async () => {
    if (!workspaceId) {
      setError('No workspaceId available');
      return;
    }
    
    setPurging(true);
    setError(null);
    
    try {
      console.log('[SyncDebugPanel] === PURGE CLOUD + REPLAN START ===');
      
      // Step 1: Purge cloud cycles (and optionally logs)
      console.log('[SyncDebugPanel] Step 1: Purging cloud cycles...');
      const purgeResult = await cloudStorage.purgeCloudCycles(workspaceId, { 
        includeLogs: includeLogs 
      });
      console.log('[SyncDebugPanel] Purge result:', purgeResult);
      
      if (!purgeResult.success) {
        throw new Error('Failed to purge cloud cycles');
      }
      
      // Step 2: Clear local cache
      console.log('[SyncDebugPanel] Step 2: Clearing local cache...');
      hardResetLocalCache();
      
      // Step 3: Hydrate projects from cloud (cycles are now empty)
      console.log('[SyncDebugPanel] Step 3: Hydrating projects from cloud...');
      await hydrateLocalFromCloud(workspaceId, { 
        force: true, 
        includeProjects: true, 
        includePlannedCycles: true, // Will get empty list now
        includeProducts: false
      });
      
      // Step 4: Generate fresh plan
      console.log('[SyncDebugPanel] Step 4: Generating fresh plan...');
      const result = recalculatePlan('whole_week', true, 'purge_cloud_replan');
      console.log('[SyncDebugPanel] Replan result:', result);
      
      console.log('[SyncDebugPanel] === PURGE + REPLAN COMPLETE - RELOADING ===');
      window.location.reload();
    } catch (e) {
      console.error('[SyncDebugPanel] Purge and replan failed:', e);
      setError(e instanceof Error ? e.message : 'Purge failed');
      setPurging(false);
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
        
        {/* Include logs checkbox */}
        <div className="flex items-center gap-2 pt-2">
          <Checkbox 
            id="includeLogs" 
            checked={includeLogs} 
            onCheckedChange={(checked) => setIncludeLogs(checked === true)}
          />
          <label htmlFor="includeLogs" className="text-xs text-muted-foreground cursor-pointer">
            כולל מחיקת cycle_logs (היסטוריה)
          </label>
        </div>
        
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
            variant="secondary" 
            onClick={handleLocalReset} 
            disabled={resetting || purging || !workspaceId}
          >
            <HardDrive className="w-3 h-3 ml-1" />
            {resetting ? 'מאפס...' : 'Reset Local Only'}
          </Button>
          <Button 
            size="sm" 
            variant="destructive" 
            onClick={handlePurgeAndReplan} 
            disabled={resetting || purging || !workspaceId}
          >
            <CloudOff className="w-3 h-3 ml-1" />
            {purging ? 'מוחק...' : 'Purge Cloud + Replan'}
          </Button>
        </div>
        
        {/* Help text */}
        <div className="text-[10px] text-muted-foreground mt-2 space-y-1">
          <div><strong>Reset Local:</strong> מנקה localStorage → טוען מהענן (ללא שינוי בענן)</div>
          <div><strong>Purge Cloud + Replan:</strong> מוחק cycles מהענן → מנקה local → יוצר plan חדש מאפס</div>
        </div>
      </CardContent>
    </Card>
  );
};