export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      cycle_logs: {
        Row: {
          completed_at: string
          created_at: string
          cycle_hours: number | null
          decision: string | null
          grams_used: number
          id: string
          notes: string | null
          preset_id: string | null
          printer_id: string | null
          project_id: string | null
          spool_id: string | null
          units_completed: number
          units_failed: number
          workspace_id: string
        }
        Insert: {
          completed_at?: string
          created_at?: string
          cycle_hours?: number | null
          decision?: string | null
          grams_used?: number
          id?: string
          notes?: string | null
          preset_id?: string | null
          printer_id?: string | null
          project_id?: string | null
          spool_id?: string | null
          units_completed?: number
          units_failed?: number
          workspace_id: string
        }
        Update: {
          completed_at?: string
          created_at?: string
          cycle_hours?: number | null
          decision?: string | null
          grams_used?: number
          id?: string
          notes?: string | null
          preset_id?: string | null
          printer_id?: string | null
          project_id?: string | null
          spool_id?: string | null
          units_completed?: number
          units_failed?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_logs_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "plate_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_logs_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_logs_spool_id_fkey"
            columns: ["spool_id"]
            isOneToOne: false
            referencedRelation: "spools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      factory_settings: {
        Row: {
          after_hours_behavior: string
          created_at: string
          factory_name: string
          id: string
          last_plan_day: string | null
          transition_minutes: number
          updated_at: string
          weekly_work_hours: Json
          workspace_id: string
        }
        Insert: {
          after_hours_behavior?: string
          created_at?: string
          factory_name?: string
          id?: string
          last_plan_day?: string | null
          transition_minutes?: number
          updated_at?: string
          weekly_work_hours?: Json
          workspace_id: string
        }
        Update: {
          after_hours_behavior?: string
          created_at?: string
          factory_name?: string
          id?: string
          last_plan_day?: string | null
          transition_minutes?: number
          updated_at?: string
          weekly_work_hours?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "factory_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      material_inventory: {
        Row: {
          closed_count: number
          closed_spool_size_grams: number
          color: string
          created_at: string
          id: string
          material: string
          open_spool_count: number
          open_total_grams: number
          reorder_point_grams: number | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          closed_count?: number
          closed_spool_size_grams?: number
          color: string
          created_at?: string
          id?: string
          material?: string
          open_spool_count?: number
          open_total_grams?: number
          reorder_point_grams?: number | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          closed_count?: number
          closed_spool_size_grams?: number
          color?: string
          created_at?: string
          id?: string
          material?: string
          open_spool_count?: number
          open_total_grams?: number
          reorder_point_grams?: number | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_inventory_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      planned_cycles: {
        Row: {
          created_at: string
          cycle_index: number
          end_time: string | null
          id: string
          legacy_id: string | null
          preset_id: string | null
          printer_id: string
          project_id: string
          scheduled_date: string
          start_time: string | null
          status: string
          units_planned: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          cycle_index?: number
          end_time?: string | null
          id?: string
          legacy_id?: string | null
          preset_id?: string | null
          printer_id: string
          project_id: string
          scheduled_date: string
          start_time?: string | null
          status?: string
          units_planned?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          cycle_index?: number
          end_time?: string | null
          id?: string
          legacy_id?: string | null
          preset_id?: string | null
          printer_id?: string
          project_id?: string
          scheduled_date?: string
          start_time?: string | null
          status?: string
          units_planned?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planned_cycles_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "plate_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_cycles_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_cycles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_cycles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      plate_presets: {
        Row: {
          allowed_for_night_cycle: boolean
          created_at: string
          cycle_hours: number
          grams_per_unit: number
          id: string
          legacy_id: string | null
          name: string
          product_id: string | null
          units_per_plate: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          allowed_for_night_cycle?: boolean
          created_at?: string
          cycle_hours?: number
          grams_per_unit?: number
          id?: string
          legacy_id?: string | null
          name: string
          product_id?: string | null
          units_per_plate?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          allowed_for_night_cycle?: boolean
          created_at?: string
          cycle_hours?: number
          grams_per_unit?: number
          id?: string
          legacy_id?: string | null
          name?: string
          product_id?: string | null
          units_per_plate?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plate_presets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plate_presets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      printers: {
        Row: {
          ams_backup_mode: boolean | null
          ams_multi_color: boolean | null
          ams_slots: number | null
          can_start_new_cycles_after_hours: boolean
          created_at: string
          current_preset_id: string | null
          display_order: number | null
          has_ams: boolean
          id: string
          max_spool_weight: number | null
          model: string | null
          mounted_spool_id: string | null
          name: string
          notes: string | null
          physical_plate_capacity: number
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ams_backup_mode?: boolean | null
          ams_multi_color?: boolean | null
          ams_slots?: number | null
          can_start_new_cycles_after_hours?: boolean
          created_at?: string
          current_preset_id?: string | null
          display_order?: number | null
          has_ams?: boolean
          id?: string
          max_spool_weight?: number | null
          model?: string | null
          mounted_spool_id?: string | null
          name: string
          notes?: string | null
          physical_plate_capacity?: number
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ams_backup_mode?: boolean | null
          ams_multi_color?: boolean | null
          ams_slots?: number | null
          can_start_new_cycles_after_hours?: boolean
          created_at?: string
          current_preset_id?: string | null
          display_order?: number | null
          has_ams?: boolean
          id?: string
          max_spool_weight?: number | null
          model?: string | null
          mounted_spool_id?: string | null
          name?: string
          notes?: string | null
          physical_plate_capacity?: number
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "printers_current_preset_id_fkey"
            columns: ["current_preset_id"]
            isOneToOne: false
            referencedRelation: "plate_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "printers_mounted_spool_fkey"
            columns: ["mounted_spool_id"]
            isOneToOne: false
            referencedRelation: "spools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "printers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          color: string
          created_at: string
          default_grams_per_unit: number
          default_print_time_hours: number
          default_units_per_plate: number
          id: string
          legacy_id: string | null
          material: string
          name: string
          notes: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          default_grams_per_unit?: number
          default_print_time_hours?: number
          default_units_per_plate?: number
          id?: string
          legacy_id?: string | null
          material?: string
          name: string
          notes?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          default_grams_per_unit?: number
          default_print_time_hours?: number
          default_units_per_plate?: number
          id?: string
          legacy_id?: string | null
          material?: string
          name?: string
          notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          current_workspace_id: string | null
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_workspace_id?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_workspace_id?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_current_workspace_id_fkey"
            columns: ["current_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          assigned_printer_id: string | null
          color: string | null
          created_at: string
          custom_cycle_hours: number | null
          deadline: string | null
          id: string
          include_in_planning: boolean
          is_recovery_project: boolean
          legacy_id: string | null
          name: string
          notes: string | null
          parent_project_id: string | null
          preset_id: string | null
          priority: string
          product_id: string | null
          quantity_completed: number
          quantity_failed: number
          quantity_target: number
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_printer_id?: string | null
          color?: string | null
          created_at?: string
          custom_cycle_hours?: number | null
          deadline?: string | null
          id?: string
          include_in_planning?: boolean
          is_recovery_project?: boolean
          legacy_id?: string | null
          name: string
          notes?: string | null
          parent_project_id?: string | null
          preset_id?: string | null
          priority?: string
          product_id?: string | null
          quantity_completed?: number
          quantity_failed?: number
          quantity_target?: number
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_printer_id?: string | null
          color?: string | null
          created_at?: string
          custom_cycle_hours?: number | null
          deadline?: string | null
          id?: string
          include_in_planning?: boolean
          is_recovery_project?: boolean
          legacy_id?: string | null
          name?: string
          notes?: string | null
          parent_project_id?: string | null
          preset_id?: string | null
          priority?: string
          product_id?: string | null
          quantity_completed?: number
          quantity_failed?: number
          quantity_target?: number
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_assigned_printer_id_fkey"
            columns: ["assigned_printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_parent_project_id_fkey"
            columns: ["parent_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "plate_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      spools: {
        Row: {
          color: string
          color_hex: string | null
          cost_per_kg: number | null
          created_at: string
          id: string
          material: string
          notes: string | null
          remaining_grams: number
          status: string
          supplier: string | null
          updated_at: string
          weight_grams: number
          workspace_id: string
        }
        Insert: {
          color: string
          color_hex?: string | null
          cost_per_kg?: number | null
          created_at?: string
          id?: string
          material?: string
          notes?: string | null
          remaining_grams?: number
          status?: string
          supplier?: string | null
          updated_at?: string
          weight_grams?: number
          workspace_id: string
        }
        Update: {
          color?: string
          color_hex?: string | null
          cost_per_kg?: number | null
          created_at?: string
          id?: string
          material?: string
          notes?: string | null
          remaining_grams?: number
          status?: string
          supplier?: string | null
          updated_at?: string
          weight_grams?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spools_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      confirm_day_change: {
        Args: { p_date?: string; p_workspace_id: string }
        Returns: boolean
      }
      get_user_workspace_id: { Args: never; Returns: string }
      try_acquire_day_change_lock: {
        Args: { p_today_date: string; p_workspace_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
