// Generated from the SQL migration by scripts/generate-types.mjs. Do not edit.
export type Database = {
  public: {
    Tables: {
      account_events: {
        Row: {
          id: string;
          account_id: string;
          actor_id: string;
          event: string;
          reason: string | null;
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          account_id: string;
          actor_id: string;
          event: string;
          reason: string | null;
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          account_id: string;
          actor_id: string;
          event: string;
          reason: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      bid_events: {
        Row: {
          id: string;
          bid_id: string;
          actor_id: string;
          event: string;
          reason: string | null;
          file_id: string | null;
          created_at: string;
          details: unknown | null;
        };
        Insert: Partial<{
          id: string;
          bid_id: string;
          actor_id: string;
          event: string;
          reason: string | null;
          file_id: string | null;
          created_at: string;
          details: unknown | null;
        }>;
        Update: Partial<{
          id: string;
          bid_id: string;
          actor_id: string;
          event: string;
          reason: string | null;
          file_id: string | null;
          created_at: string;
          details: unknown | null;
        }>;
        Relationships: [];
      };
      bid_import_receipts: {
        Row: {
          actor_id: string;
          request_id: string;
          result: unknown;
          created_at: string;
          payload_hash: string;
        };
        Insert: Partial<{
          actor_id: string;
          request_id: string;
          result: unknown;
          created_at: string;
          payload_hash: string;
        }>;
        Update: Partial<{
          actor_id: string;
          request_id: string;
          result: unknown;
          created_at: string;
          payload_hash: string;
        }>;
        Relationships: [];
      };
      bid_purge_operations: {
        Row: {
          id: string;
          actor_id: string;
          scope: string;
          bidder_id: string | null;
          targets: unknown;
          count: number;
          created_at: string;
          expires_at: string;
          completed_at: string | null;
        };
        Insert: Partial<{
          id: string;
          actor_id: string;
          scope: string;
          bidder_id: string | null;
          targets: unknown;
          count: number;
          created_at: string;
          expires_at: string;
          completed_at: string | null;
        }>;
        Update: Partial<{
          id: string;
          actor_id: string;
          scope: string;
          bidder_id: string | null;
          targets: unknown;
          count: number;
          created_at: string;
          expires_at: string;
          completed_at: string | null;
        }>;
        Relationships: [];
      };
      bidders: {
        Row: {
          user_id: string;
          workspace_id: string;
          default_rate_cents: number | null;
          archived: boolean;
        };
        Insert: Partial<{
          user_id: string;
          workspace_id: string;
          default_rate_cents: number | null;
          archived: boolean;
        }>;
        Update: Partial<{
          user_id: string;
          workspace_id: string;
          default_rate_cents: number | null;
          archived: boolean;
        }>;
        Relationships: [];
      };
      bids: {
        Row: {
          id: string;
          workspace_id: string;
          bidder_id: string;
          resume_id: string;
          company: string;
          role_name: string;
          url: string;
          normalized_url: string;
          source: string;
          arrangement: string;
          job_status: string;
          applied: boolean;
          found_at: string;
          applied_at: string | null;
          first_applied_at: string | null;
          rate_cents: number | null;
          evidence_file_id: string | null;
          rejected_hashes: string[];
          version: number;
          created_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<{
          id: string;
          workspace_id: string;
          bidder_id: string;
          resume_id: string;
          company: string;
          role_name: string;
          url: string;
          normalized_url: string;
          source: string;
          arrangement: string;
          job_status: string;
          applied: boolean;
          found_at: string;
          applied_at: string | null;
          first_applied_at: string | null;
          rate_cents: number | null;
          evidence_file_id: string | null;
          rejected_hashes: string[];
          version: number;
          created_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
        }>;
        Update: Partial<{
          id: string;
          workspace_id: string;
          bidder_id: string;
          resume_id: string;
          company: string;
          role_name: string;
          url: string;
          normalized_url: string;
          source: string;
          arrangement: string;
          job_status: string;
          applied: boolean;
          found_at: string;
          applied_at: string | null;
          first_applied_at: string | null;
          rate_cents: number | null;
          evidence_file_id: string | null;
          rejected_hashes: string[];
          version: number;
          created_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
        }>;
        Relationships: [];
      };
      files: {
        Row: {
          id: string;
          workspace_id: string;
          bidder_id: string;
          kind: string;
          resume_id: string | null;
          bid_id: string | null;
          filename: string;
          mime: string;
          size_bytes: number;
          storage_path: string;
          sha256: string | null;
          finalized: boolean;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          workspace_id: string;
          bidder_id: string;
          kind: string;
          resume_id: string | null;
          bid_id: string | null;
          filename: string;
          mime: string;
          size_bytes: number;
          storage_path: string;
          sha256: string | null;
          finalized: boolean;
          created_by: string;
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          workspace_id: string;
          bidder_id: string;
          kind: string;
          resume_id: string | null;
          bid_id: string | null;
          filename: string;
          mime: string;
          size_bytes: number;
          storage_path: string;
          sha256: string | null;
          finalized: boolean;
          created_by: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          display_name: string;
          default_rate_cents: number | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          workspace_id: string;
          email: string;
          display_name: string;
          default_rate_cents: number | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          workspace_id: string;
          email: string;
          display_name: string;
          default_rate_cents: number | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string;
          role: string;
          archived: boolean;
          created_at: string;
          approval_status: string;
          approval_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
        };
        Insert: Partial<{
          id: string;
          email: string;
          display_name: string;
          role: string;
          archived: boolean;
          created_at: string;
          approval_status: string;
          approval_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
        }>;
        Update: Partial<{
          id: string;
          email: string;
          display_name: string;
          role: string;
          archived: boolean;
          created_at: string;
          approval_status: string;
          approval_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
        }>;
        Relationships: [];
      };
      resumes: {
        Row: {
          id: string;
          workspace_id: string;
          bidder_id: string;
          identifier: string;
          candidate_name: string;
          email: string;
          phone: string;
          address: string;
          links: string;
          instructions: string;
          rate_override_cents: number | null;
          file_id: string | null;
          archived: boolean;
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          workspace_id: string;
          bidder_id: string;
          identifier: string;
          candidate_name: string;
          email: string;
          phone: string;
          address: string;
          links: string;
          instructions: string;
          rate_override_cents: number | null;
          file_id: string | null;
          archived: boolean;
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          workspace_id: string;
          bidder_id: string;
          identifier: string;
          candidate_name: string;
          email: string;
          phone: string;
          address: string;
          links: string;
          instructions: string;
          rate_override_cents: number | null;
          file_id: string | null;
          archived: boolean;
          created_at: string;
        }>;
        Relationships: [];
      };
      storage_cleanup_tasks: {
        Row: {
          id: string;
          operation_id: string;
          storage_path: string | null;
          attempts: number;
          first_removed_at: string | null;
          next_attempt_at: string;
          completed_at: string | null;
          lease_id: string | null;
          lease_until: string | null;
          last_error: string | null;
        };
        Insert: Partial<{
          id: string;
          operation_id: string;
          storage_path: string | null;
          attempts: number;
          first_removed_at: string | null;
          next_attempt_at: string;
          completed_at: string | null;
          lease_id: string | null;
          lease_until: string | null;
          last_error: string | null;
        }>;
        Update: Partial<{
          id: string;
          operation_id: string;
          storage_path: string | null;
          attempts: number;
          first_removed_at: string | null;
          next_attempt_at: string;
          completed_at: string | null;
          lease_id: string | null;
          lease_until: string | null;
          last_error: string | null;
        }>;
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          timezone: string;
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          owner_id: string;
          name: string;
          timezone: string;
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          owner_id: string;
          name: string;
          timezone: string;
          created_at: string;
        }>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      require_manager: { Args: { w: string | null }; Returns: undefined };
      url_decode: { Args: { s: string | null }; Returns: string };
      url_encode: { Args: { s: string | null }; Returns: string };
      update_client: {
        Args: {
          p_client: string | null;
          p_name: string | null;
          p_archived: boolean | null;
        };
        Returns: undefined;
      };
      normalize_job_url: { Args: { u: string | null }; Returns: string };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      manages: { Args: { w: string | null }; Returns: boolean };
      can_read: {
        Args: { w: string | null; b: string | null };
        Returns: boolean;
      };
      can_manage_account: {
        Args: { p_account: string | null };
        Returns: boolean;
      };
      invite_bidder: {
        Args: {
          p_workspace: string | null;
          p_email: string | null;
          p_name: string | null;
          p_rate: number | null;
        };
        Returns: string;
      };
      save_resume: {
        Args: {
          p_id: string | null;
          p_workspace: string | null;
          p_bidder: string | null;
          p_identifier: string | null;
          p_name: string | null;
          p_email: string | null;
          p_phone: string | null;
          p_address: string | null;
          p_links: string | null;
          p_instructions: string | null;
          p_rate: number | null;
        };
        Returns: string;
      };
      archive_resume: {
        Args: { p_id: string | null; p_archived: boolean | null };
        Returns: undefined;
      };
      save_settings: {
        Args: {
          p_name: string | null;
          p_workspace: string | null;
          p_workspace_name: string | null;
          p_timezone: string | null;
        };
        Returns: undefined;
      };
      prepare_file: {
        Args: {
          p_kind: string | null;
          p_target: string | null;
          p_name: string | null;
          p_mime: string | null;
          p_size: number | null;
        };
        Returns: string;
      };
      set_applied: {
        Args: {
          p_bid: string | null;
          p_applied: boolean | null;
          p_file: string | null;
          p_reason: string | null;
        };
        Returns: undefined;
      };
      review_client: {
        Args: {
          p_client: string | null;
          p_status: string | null;
          p_reason: string | null;
        };
        Returns: undefined;
      };
      record_account_event: {
        Args: { p_account: string | null; p_event: string | null };
        Returns: undefined;
      };
      update_bidder: {
        Args: {
          p_bidder: string | null;
          p_name: string | null;
          p_rate: number | null;
          p_archived: boolean | null;
        };
        Returns: undefined;
      };
      save_bid: {
        Args: {
          p_id: string | null;
          p_resume: string | null;
          p_company: string | null;
          p_role: string | null;
          p_url: string | null;
          p_source: string | null;
          p_arrangement: string | null;
          p_status: string | null;
        };
        Returns: string;
      };
      trash_bid: {
        Args: { p_bid: string | null; p_deleted: boolean | null };
        Returns: undefined;
      };
      finalize_verified_file: {
        Args: {
          p_id: string | null;
          p_sha: string | null;
          p_actor: string | null;
        };
        Returns: undefined;
      };
      retry_bid_cleanup: {
        Args: { p_operation: string | null };
        Returns: unknown;
      };
      bulk_bid_state: {
        Args: { p_targets: unknown | null; p_deleted: boolean | null };
        Returns: number;
      };
      update_bid_cell: {
        Args: {
          p_bid: string | null;
          p_field: string | null;
          p_value: string | null;
          p_version: number | null;
        };
        Returns: unknown;
      };
      validate_bid_import: {
        Args: {
          p_resume: string | null;
          p_date: string | null;
          p_rows: unknown | null;
        };
        Returns: unknown;
      };
      prepare_bid_purge: {
        Args: {
          p_mode: string | null;
          p_targets: unknown | null;
          p_bidder: string | null;
        };
        Returns: unknown;
      };
      confirm_bid_purge: {
        Args: { p_operation: string | null };
        Returns: unknown;
      };
      bid_purge_status: {
        Args: { p_operation: string | null };
        Returns: unknown;
      };
      recent_bid_purges: { Args: Record<string, never>; Returns: unknown };
      claim_storage_cleanup: {
        Args: { p_operation: string | null; p_limit: number | null };
        Returns: Database["public"]["Tables"]["storage_cleanup_tasks"]["Row"][];
      };
      finish_storage_cleanup: {
        Args: {
          p_task: string | null;
          p_lease: string | null;
          p_success: boolean | null;
        };
        Returns: undefined;
      };
      import_bids: {
        Args: {
          p_resume: string | null;
          p_date: string | null;
          p_rows: unknown | null;
          p_request: string | null;
        };
        Returns: unknown;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
export type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
