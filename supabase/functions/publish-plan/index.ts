// Publish Plan Edge Function - V2
// Uses Postgres RPC function for TRUE atomic transaction
// No intermediate state where cloud is empty/partial

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
    const { workspace_id, cycles, reason = 'manual_replan', scope = 'from_now' } = body

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing workspace_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[publish-plan] Starting ATOMIC publish for workspace ${workspace_id}`)
    console.log(`[publish-plan] Cycles to create: ${cycles.length}`)

    // Call the atomic Postgres function
    // This runs DELETE + INSERT + UPDATE in a single transaction
    const { data: rpcResult, error: rpcError } = await supabase.rpc('publish_plan', {
      p_workspace_id: workspace_id,
      p_user_id: user.id,
      p_cycles: cycles, // JSONB array
      p_reason: reason,
      p_scope: scope,
    })

    if (rpcError) {
      console.error('[publish-plan] RPC error:', rpcError)
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: rpcError.message,
          plan_version: null,
          cycles_created: 0,
          cycles_deleted: 0,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // RPC returns JSONB with success, plan_version, cycles_created, cycles_deleted
    const result = rpcResult as {
      success: boolean
      plan_version: string | null
      cycles_created: number
      cycles_deleted: number
      error?: string
    }

    console.log(`[publish-plan] ✓ Atomic publish complete:`, result)

    const response: PublishPlanResponse = {
      success: result.success,
      plan_version: result.plan_version,
      cycles_created: result.cycles_created,
      cycles_deleted: result.cycles_deleted,
      error: result.error,
    }

    return new Response(
      JSON.stringify(response),
      { status: result.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
