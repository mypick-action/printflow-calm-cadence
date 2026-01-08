// ============= BAMBU EVENTS EDGE FUNCTION =============
// Handles started/finished events from Bambu printers via local bridge
// Matches printer by bambu_serial field

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BambuEvent {
  event_type: 'started' | 'finished';
  bambu_serial: string;
  timestamp?: string;
  // For finished events
  grams_consumed?: number;
  // Optional: for matching to specific cycle
  cycle_id?: string;
  // Optional: planned consumption if actual not available
  planned_units?: number;
  grams_per_unit?: number;
}

interface PrinterRow {
  id: string;
  name: string;
  bambu_serial: string | null;
  mounted_color: string | null;
  mount_state: string | null;
  loaded_grams_estimate: number | null;
}

interface PlannedCycleRow {
  id: string;
  printer_id: string;
  project_id: string;
  status: string;
  grams_planned: number;
  units_planned: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const event: BambuEvent = await req.json();
    console.log('[bambu-events] Received event:', JSON.stringify(event));

    // Validate event
    if (!event.event_type || !event.bambu_serial) {
      console.error('[bambu-events] Missing required fields');
      return new Response(
        JSON.stringify({ error: 'Missing event_type or bambu_serial' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['started', 'finished'].includes(event.event_type)) {
      console.error('[bambu-events] Invalid event_type:', event.event_type);
      return new Response(
        JSON.stringify({ error: 'event_type must be "started" or "finished"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find printer by bambu_serial
    // Note: This requires the printers table to have a bambu_serial column
    // For now, we'll search in a flexible way
    const { data: printers, error: printerError } = await supabase
      .from('printers')
      .select('*')
      .limit(100);

    if (printerError) {
      console.error('[bambu-events] Error fetching printers:', printerError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch printers', details: printerError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find printer with matching bambu_serial (stored in notes or a dedicated field)
    // Since bambu_serial might not be a column yet, check notes field as fallback
    const printer = printers?.find((p: any) => {
      // Check direct field if exists
      if (p.bambu_serial === event.bambu_serial) return true;
      // Check notes as fallback (format: "bambu:SERIAL")
      if (p.notes?.includes(`bambu:${event.bambu_serial}`)) return true;
      return false;
    });

    if (!printer) {
      console.warn('[bambu-events] No printer found for serial:', event.bambu_serial);
      return new Response(
        JSON.stringify({ 
          error: 'Printer not found', 
          bambu_serial: event.bambu_serial,
          hint: 'Add bambu_serial to printer or add "bambu:SERIAL" to notes'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[bambu-events] Matched printer:', printer.name, printer.id);

    // Handle event type
    if (event.event_type === 'started') {
      // Update printer state to in_use
      const { error: updateError } = await supabase
        .from('printers')
        .update({ 
          status: 'active',
          // Note: mount_state might need to be added to schema
        })
        .eq('id', printer.id);

      if (updateError) {
        console.error('[bambu-events] Error updating printer:', updateError);
      }

      // VALIDATION: First, complete any existing in_progress cycles for this printer
      const { data: existingInProgress, error: existingError } = await supabase
        .from('planned_cycles')
        .select('id')
        .eq('printer_id', printer.id)
        .eq('status', 'in_progress');

      if (!existingError && existingInProgress && existingInProgress.length > 0) {
        console.log(`[bambu-events] Found ${existingInProgress.length} existing in_progress cycles, completing them`);
        const { error: completeError } = await supabase
          .from('planned_cycles')
          .update({ 
            status: 'completed',
            end_time: new Date().toISOString(),
          })
          .eq('printer_id', printer.id)
          .eq('status', 'in_progress');
        
        if (completeError) {
          console.error('[bambu-events] Error completing existing cycles:', completeError);
        }
      }

      // Find and update waiting/planned cycle to in_progress
      const { data: cycles, error: cycleError } = await supabase
        .from('planned_cycles')
        .select('*')
        .eq('printer_id', printer.id)
        .in('status', ['planned', 'scheduled'])
        .order('start_time', { ascending: true })
        .limit(1);

      if (cycleError) {
        console.error('[bambu-events] Error fetching cycles:', cycleError);
      } else if (cycles && cycles.length > 0) {
        const cycle = cycles[0];
        const { error: cycleUpdateError } = await supabase
          .from('planned_cycles')
          .update({ 
            status: 'in_progress',
            start_time: new Date().toISOString(),
          })
          .eq('id', cycle.id);

        if (cycleUpdateError) {
          console.error('[bambu-events] Error updating cycle:', cycleUpdateError);
        } else {
          console.log('[bambu-events] Marked cycle as in_progress:', cycle.id);
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          event: 'started',
          printer_id: printer.id,
          printer_name: printer.name,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (event.event_type === 'finished') {
      // Calculate grams consumed
      let gramsConsumed = event.grams_consumed || 0;
      
      // Fallback: calculate from planned if not provided
      if (!gramsConsumed && event.planned_units && event.grams_per_unit) {
        gramsConsumed = event.planned_units * event.grams_per_unit;
        console.log('[bambu-events] Using planned consumption:', gramsConsumed);
      }

      // Find in_progress cycle for this printer
      const { data: cycles, error: cycleError } = await supabase
        .from('planned_cycles')
        .select('*')
        .eq('printer_id', printer.id)
        .eq('status', 'in_progress')
        .limit(1);

      let cycleId: string | null = null;
      let needsManualReconcile = false;

      if (cycleError) {
        console.error('[bambu-events] Error fetching in_progress cycle:', cycleError);
      } else if (cycles && cycles.length > 0) {
        const cycle = cycles[0];
        cycleId = cycle.id;

        // Use cycle's gramsPlanned if no consumption data provided
        if (!gramsConsumed && cycle.grams_planned) {
          gramsConsumed = cycle.grams_planned;
          console.log('[bambu-events] Using cycle planned grams:', gramsConsumed);
        }

        // Mark cycle as completed
        const { error: cycleUpdateError } = await supabase
          .from('planned_cycles')
          .update({ 
            status: 'completed',
            end_time: new Date().toISOString(),
          })
          .eq('id', cycle.id);

        if (cycleUpdateError) {
          console.error('[bambu-events] Error completing cycle:', cycleUpdateError);
        } else {
          console.log('[bambu-events] Marked cycle as completed:', cycle.id);
        }
      } else {
        console.warn('[bambu-events] No in_progress cycle found for printer');
        needsManualReconcile = true;
      }

      // Update printer state back to idle (active)
      const { error: updateError } = await supabase
        .from('printers')
        .update({ 
          status: 'active',
        })
        .eq('id', printer.id);

      if (updateError) {
        console.error('[bambu-events] Error updating printer:', updateError);
      }

      // Note: Material consumption would be handled by the frontend
      // when it receives the cycle completion notification
      // This edge function doesn't directly update ColorInventory

      return new Response(
        JSON.stringify({ 
          success: true, 
          event: 'finished',
          printer_id: printer.id,
          printer_name: printer.name,
          cycle_id: cycleId,
          grams_consumed: gramsConsumed,
          needs_manual_reconcile: needsManualReconcile,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unhandled event type' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[bambu-events] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
