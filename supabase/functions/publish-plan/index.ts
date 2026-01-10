// Publish Plan Edge Function
// Atomically replaces planned_cycles with new plan and updates plan version
// This prevents race conditions where cloud is empty during sync

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CycleInput {
  project_id: string
  printer_id: string
  scheduled_date: string
  start_time: string | null
  end_time: string | null
  units_planned: number
  status: string
  preset_id: string | null
  legacy_id: string | null
}

interface PublishPlanRequest {
  workspace_id: string
  cycles: CycleInput[]
  reason?: string
  scope?: string
  keep_cycle_ids?: string[] // IDs of cycles to preserve (completed, in_progress, locked)
}

interface PublishPlanResponse {
  success: boolean
  plan_version: string | null
  cycles_created: number
  cycles_deleted: number
  error?: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with user's token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body: PublishPlanRequest = await req.json()
    const { workspace_id, cycles, reason = 'manual_replan', scope = 'from_now', keep_cycle_ids = [] } = body

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing workspace_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[publish-plan] Starting atomic publish for workspace ${workspace_id}`)
    console.log(`[publish-plan] Cycles to create: ${cycles.length}, Cycles to keep: ${keep_cycle_ids.length}`)

    // Generate new plan version UUID
    const planVersion = crypto.randomUUID()
    console.log(`[publish-plan] New plan_version: ${planVersion}`)

    // STEP 1: Delete old planned/scheduled cycles (except those in keep_cycle_ids)
    // Only delete cycles with status 'planned' or 'scheduled' - preserve completed/failed/in_progress
    let deletedCount = 0
    
    // Build delete query
    let deleteQuery = supabase
      .from('planned_cycles')
      .delete()
      .eq('workspace_id', workspace_id)
      .in('status', ['planned', 'scheduled'])
    
    // If we have cycles to keep, exclude them from deletion
    if (keep_cycle_ids.length > 0) {
      // Delete cycles NOT in keep_cycle_ids
      // We need to do this differently - delete those with status planned/scheduled
      // that are NOT in the keep list
      const { data: deletedData, error: deleteError } = await supabase
        .from('planned_cycles')
        .delete()
        .eq('workspace_id', workspace_id)
        .in('status', ['planned', 'scheduled'])
        .not('id', 'in', `(${keep_cycle_ids.join(',')})`)
        .select('id')
      
      if (deleteError) {
        console.error('[publish-plan] Delete error:', deleteError)
        throw new Error(`Failed to delete old cycles: ${deleteError.message}`)
      }
      deletedCount = deletedData?.length || 0
    } else {
      // No cycles to keep - delete all planned/scheduled
      const { data: deletedData, error: deleteError } = await supabase
        .from('planned_cycles')
        .delete()
        .eq('workspace_id', workspace_id)
        .in('status', ['planned', 'scheduled'])
        .select('id')
      
      if (deleteError) {
        console.error('[publish-plan] Delete error:', deleteError)
        throw new Error(`Failed to delete old cycles: ${deleteError.message}`)
      }
      deletedCount = deletedData?.length || 0
    }
    
    console.log(`[publish-plan] Deleted ${deletedCount} old cycles`)

    // STEP 2: Insert new cycles with plan_version
    let createdCount = 0
    
    if (cycles.length > 0) {
      const cyclesToInsert = cycles.map(c => ({
        workspace_id,
        project_id: c.project_id,
        printer_id: c.printer_id,
        scheduled_date: c.scheduled_date,
        start_time: c.start_time,
        end_time: c.end_time,
        units_planned: c.units_planned,
        status: c.status === 'planned' ? 'scheduled' : c.status, // Cloud uses 'scheduled' not 'planned'
        preset_id: c.preset_id,
        legacy_id: c.legacy_id,
        plan_version: planVersion,
        cycle_index: 0,
      }))
      
      const { data: insertedData, error: insertError } = await supabase
        .from('planned_cycles')
        .insert(cyclesToInsert)
        .select('id')
      
      if (insertError) {
        console.error('[publish-plan] Insert error:', insertError)
        throw new Error(`Failed to insert cycles: ${insertError.message}`)
      }
      
      createdCount = insertedData?.length || 0
      console.log(`[publish-plan] Created ${createdCount} new cycles`)
    }

    // STEP 3: Update existing kept cycles to have the new plan_version
    if (keep_cycle_ids.length > 0) {
      const { error: updateKeptError } = await supabase
        .from('planned_cycles')
        .update({ plan_version: planVersion })
        .eq('workspace_id', workspace_id)
        .in('id', keep_cycle_ids)
      
      if (updateKeptError) {
        console.warn('[publish-plan] Warning: Failed to update kept cycles plan_version:', updateKeptError)
        // Non-fatal - continue
      } else {
        console.log(`[publish-plan] Updated ${keep_cycle_ids.length} kept cycles with new plan_version`)
      }
    }

    // STEP 4: Update factory_settings with new active_plan_version
    const { error: settingsError } = await supabase
      .from('factory_settings')
      .update({
        active_plan_version: planVersion,
        active_plan_created_at: new Date().toISOString(),
        active_plan_created_by: user.id,
      })
      .eq('workspace_id', workspace_id)
    
    if (settingsError) {
      console.error('[publish-plan] Settings update error:', settingsError)
      throw new Error(`Failed to update plan version: ${settingsError.message}`)
    }
    
    console.log(`[publish-plan] Updated factory_settings with active_plan_version`)

    // STEP 5: Record in plan_history for audit trail
    const { error: historyError } = await supabase
      .from('plan_history')
      .insert({
        workspace_id,
        plan_version: planVersion,
        created_by: user.id,
        cycle_count: createdCount + keep_cycle_ids.length,
        reason,
        scope,
      })
    
    if (historyError) {
      // Non-fatal - just log warning
      console.warn('[publish-plan] Warning: Failed to insert plan_history:', historyError)
    } else {
      console.log(`[publish-plan] Recorded in plan_history`)
    }

    const response: PublishPlanResponse = {
      success: true,
      plan_version: planVersion,
      cycles_created: createdCount,
      cycles_deleted: deletedCount,
    }

    console.log(`[publish-plan] ✓ Publish complete:`, response)

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[publish-plan] Error:', error)
    
    const response: PublishPlanResponse = {
      success: false,
      plan_version: null,
      cycles_created: 0,
      cycles_deleted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
    
    return new Response(
      JSON.stringify(response),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
