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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          vessel_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          vessel_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_members: {
        Row: {
          created_at: string
          department: Database["public"]["Enums"]["department"]
          eligible: boolean
          full_name: string
          id: string
          ineligible_note: string | null
          ineligible_reason:
            | Database["public"]["Enums"]["ineligibility_reason"]
            | null
          position: string
          updated_at: string
          vessel_id: string
        }
        Insert: {
          created_at?: string
          department: Database["public"]["Enums"]["department"]
          eligible?: boolean
          full_name: string
          id?: string
          ineligible_note?: string | null
          ineligible_reason?:
            | Database["public"]["Enums"]["ineligibility_reason"]
            | null
          position: string
          updated_at?: string
          vessel_id: string
        }
        Update: {
          created_at?: string
          department?: Database["public"]["Enums"]["department"]
          eligible?: boolean
          full_name?: string
          id?: string
          ineligible_note?: string | null
          ineligible_reason?:
            | Database["public"]["Enums"]["ineligibility_reason"]
            | null
          position?: string
          updated_at?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_members_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      fairness_events: {
        Row: {
          created_at: string
          crew_id: string | null
          detail: Json | null
          id: string
          lane_id: string
          reason_code: string
          schedule_id: string | null
          vessel_id: string
          watch_date: string | null
        }
        Insert: {
          created_at?: string
          crew_id?: string | null
          detail?: Json | null
          id?: string
          lane_id: string
          reason_code: string
          schedule_id?: string | null
          vessel_id: string
          watch_date?: string | null
        }
        Update: {
          created_at?: string
          crew_id?: string | null
          detail?: Json | null
          id?: string
          lane_id?: string
          reason_code?: string
          schedule_id?: string | null
          vessel_id?: string
          watch_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fairness_events_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fairness_events_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "watch_lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fairness_events_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fairness_events_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      fairness_ledger: {
        Row: {
          consecutive_run: number
          crew_id: string
          fairness_score: number | null
          friday_watches: number
          id: string
          lane_id: string
          last_watch_date: string | null
          last_weekend_date: string | null
          total_watches: number
          updated_at: string
          vessel_id: string
          weekday_watches: number
          weekend_watches: number
        }
        Insert: {
          consecutive_run?: number
          crew_id: string
          fairness_score?: number | null
          friday_watches?: number
          id?: string
          lane_id: string
          last_watch_date?: string | null
          last_weekend_date?: string | null
          total_watches?: number
          updated_at?: string
          vessel_id: string
          weekday_watches?: number
          weekend_watches?: number
        }
        Update: {
          consecutive_run?: number
          crew_id?: string
          fairness_score?: number | null
          friday_watches?: number
          id?: string
          lane_id?: string
          last_watch_date?: string | null
          last_weekend_date?: string | null
          total_watches?: number
          updated_at?: string
          vessel_id?: string
          weekday_watches?: number
          weekend_watches?: number
        }
        Relationships: [
          {
            foreignKeyName: "fairness_ledger_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fairness_ledger_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "watch_lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fairness_ledger_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          onboarding_complete: boolean
          onboarding_step: Database["public"]["Enums"]["onboarding_step"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          product_tier: Database["public"]["Enums"]["product_tier"] | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          vessel_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          onboarding_complete?: boolean
          onboarding_step?: Database["public"]["Enums"]["onboarding_step"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          product_tier?: Database["public"]["Enums"]["product_tier"] | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          vessel_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          onboarding_complete?: boolean
          onboarding_step?: Database["public"]["Enums"]["onboarding_step"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          product_tier?: Database["public"]["Enums"]["product_tier"] | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          vessel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          end_date: string
          generated_at: string
          horizon_weeks: number
          id: string
          is_current: boolean
          start_date: string
          vessel_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          generated_at?: string
          horizon_weeks: number
          id?: string
          is_current?: boolean
          start_date: string
          vessel_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          generated_at?: string
          horizon_weeks?: number
          id?: string
          is_current?: boolean
          start_date?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_uploads: {
        Row: {
          bucket: string
          created_at: string
          id: string
          kind: string
          object_path: string
          parsed: boolean
          vessel_id: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          kind: string
          object_path: string
          parsed?: boolean
          vessel_id: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          kind?: string
          object_path?: string
          parsed?: boolean
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_uploads_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      vessels: {
        Row: {
          created_at: string
          id: string
          length_m: number | null
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          length_m?: number | null
          name?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          length_m?: number | null
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      watch_assignments: {
        Row: {
          created_at: string
          crew_id: string
          day_type: Database["public"]["Enums"]["day_type"]
          id: string
          is_friday: boolean
          lane_id: string
          schedule_id: string
          vessel_id: string
          watch_date: string
        }
        Insert: {
          created_at?: string
          crew_id: string
          day_type: Database["public"]["Enums"]["day_type"]
          id?: string
          is_friday?: boolean
          lane_id: string
          schedule_id: string
          vessel_id: string
          watch_date: string
        }
        Update: {
          created_at?: string
          crew_id?: string
          day_type?: Database["public"]["Enums"]["day_type"]
          id?: string
          is_friday?: boolean
          lane_id?: string
          schedule_id?: string
          vessel_id?: string
          watch_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "watch_assignments_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_assignments_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "watch_lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_assignments_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_assignments_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_lanes: {
        Row: {
          active: boolean
          created_at: string
          department: Database["public"]["Enums"]["department"] | null
          id: string
          kind: Database["public"]["Enums"]["watch_lane_kind"]
          label: string
          vessel_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department?: Database["public"]["Enums"]["department"] | null
          id?: string
          kind: Database["public"]["Enums"]["watch_lane_kind"]
          label: string
          vessel_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department?: Database["public"]["Enums"]["department"] | null
          id?: string
          kind?: Database["public"]["Enums"]["watch_lane_kind"]
          label?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watch_lanes_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_settings: {
        Row: {
          created_at: string
          horizon_weeks: number
          include_weekends: boolean
          schedule_start_date: string
          selected_departments: Database["public"]["Enums"]["department"][]
          tier: Database["public"]["Enums"]["product_tier"]
          updated_at: string
          vessel_id: string
          weekday_rotation_anchor: number | null
          weekend_rotation_anchor: number | null
        }
        Insert: {
          created_at?: string
          horizon_weeks?: number
          include_weekends?: boolean
          schedule_start_date: string
          selected_departments?: Database["public"]["Enums"]["department"][]
          tier: Database["public"]["Enums"]["product_tier"]
          updated_at?: string
          vessel_id: string
          weekday_rotation_anchor?: number | null
          weekend_rotation_anchor?: number | null
        }
        Update: {
          created_at?: string
          horizon_weeks?: number
          include_weekends?: boolean
          schedule_start_date?: string
          selected_departments?: Database["public"]["Enums"]["department"][]
          tier?: Database["public"]["Enums"]["product_tier"]
          updated_at?: string
          vessel_id?: string
          weekday_rotation_anchor?: number | null
          weekend_rotation_anchor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "watch_settings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: true
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_vessel_id: { Args: never; Returns: string }
    }
    Enums: {
      day_type: "weekday" | "weekend"
      department: "deck" | "interior" | "engineering" | "officer"
      ineligibility_reason:
        | "leave"
        | "sick"
        | "training"
        | "role_exempt"
        | "other"
      onboarding_step: "crew" | "settings" | "generate" | "complete"
      payment_status: "unpaid" | "active" | "past_due" | "canceled"
      product_tier: "solo" | "dual" | "triple"
      watch_lane_kind: "solo" | "dept"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      day_type: ["weekday", "weekend"],
      department: ["deck", "interior", "engineering", "officer"],
      ineligibility_reason: [
        "leave",
        "sick",
        "training",
        "role_exempt",
        "other",
      ],
      onboarding_step: ["crew", "settings", "generate", "complete"],
      payment_status: ["unpaid", "active", "past_due", "canceled"],
      product_tier: ["solo", "dual", "triple"],
      watch_lane_kind: ["solo", "dept"],
    },
  },
} as const
