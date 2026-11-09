/**
 * Hand-written database types for the tables the app touches.
 *
 * Deliberately not generated into this file by `supabase gen types`: the
 * generated output includes every column of every table, and having the shapes
 * written out by hand keeps the plaintext/ciphertext split visible at the type
 * level. A reviewer can read this file and see exactly which fields the server
 * can read in the clear.
 *
 * Regenerate-and-diff is still worth doing when the schema changes:
 *   supabase gen types typescript --local --schema vault,custody,account,legal
 */

export type CustodyPointTypeRow = 'person' | 'institution' | 'location' | 'other';
export type CustodyHoldingRow = 'full_copy' | 'split_part';
export type CustodyModeRow = 'redundancy' | 'split' | 'hybrid';
export type ItemKindRow = 'text' | 'document' | 'video' | 'audio' | 'custody_plan' | 'asset_inventory';
export type DisclosureStageRow = 'messages' | 'inventory_education' | 'legal_documents' | 'wallet_access';
export type VaultStatusRow = 'active' | 'locked_by_owner_veto' | 'released_to_executor';

/** base64 of a bytea column as PostgREST returns it. */
export type Base64 = string;

export interface VaultRow {
  id: string;
  owner_id: string;
  label: string;
  status: VaultStatusRow;
  purpose: string | null;
  waiting_period_days: number;
  created_at: string;
  updated_at: string;
}

export interface VaultKeyRow {
  id: string;
  vault_id: string;
  kind: 'primary' | 'duress';
  kdf_profile_id: number;
  kdf_salt: Base64;
  wrapped_vmk_iv: Base64;
  wrapped_vmk: Base64;
  sentinel_iv: Base64;
  sentinel: Base64;
  envelope_version: number;
  created_at: string;
}

export interface ItemRow {
  id: string;
  vault_id: string;
  kind: ItemKindRow;
  disclosure_stage: DisclosureStageRow;
  /** PLAINTEXT. Visible to a locked session by design (spec §5.2). */
  name: string;
  plaintext_bytes: number;
  wrapped_dek_iv: Base64;
  wrapped_dek: Base64;
  content_iv: Base64 | null;
  content: Base64 | null;
  storage_path: string | null;
  chunk_count: number;
  envelope_version: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CustodyPlanRow {
  vault_id: string;
  mode: CustodyModeRow;
  passphrase_word_count: number;
  part_count: number;
  verification_interval_months: number;
  plan_last_modified_at: string;
  letter_last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustodyPointRow {
  id: string;
  vault_id: string;
  /** PLAINTEXT. The identity and location are inside `detail`, encrypted. */
  point_type: CustodyPointTypeRow;
  holding: CustodyHoldingRow;
  part_index: number | null;
  detail_wrapped_dek_iv: Base64;
  detail_wrapped_dek: Base64;
  detail_iv: Base64;
  detail: Base64;
  envelope_version: number;
  last_verified_at: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CustodyCheckRow {
  id: string;
  point_id: string;
  vault_id: string;
  checked_at: string;
  outcome: 'intact' | 'moved' | 'missing' | 'unreachable';
  created_at: string;
}

export interface AuditLogRow {
  id: number;
  vault_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AccountSecurityRow {
  user_id: string;
  passkey_enrolled_at: string | null;
  totp_enrolled_at: string | null;
  session_timeout_seconds: number;
  vault_lock_timeout_seconds: number;
}

export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string[];
  device_label: string | null;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface StateRequirementRow {
  id: string;
  state_code: string;
  version: number;
  status: 'draft' | 'in_review' | 'published' | 'retired';
  checklist: Array<{ heading: string; detail: string }>;
  holographic_will_recognised: boolean | null;
  remote_notarisation_available: boolean | null;
  electronic_wills_act_adopted: boolean | null;
  rufadaa_adopted: boolean | null;
  rufadaa_citation: string | null;
  notes: string | null;
  source_citations: Array<{ label: string; url?: string; cite?: string }>;
  last_reviewed_at: string | null;
  reviewed_by: string | null;
  reviewer_bar_number: string | null;
  reviewer_jurisdiction: string | null;
}

/**
 * Minimal shape for @supabase/supabase-js generics. Only the schemas and tables
 * the app actually queries are declared; anything else is a compile error, which
 * is the intended safety net.
 */
export interface Database {
  vault: {
    Tables: {
      vaults: { Row: VaultRow; Insert: Partial<VaultRow>; Update: Partial<VaultRow> };
      vault_keys: { Row: VaultKeyRow; Insert: Partial<VaultKeyRow>; Update: never };
      items: { Row: ItemRow; Insert: Partial<ItemRow>; Update: Partial<ItemRow> };
      audit_log: { Row: AuditLogRow; Insert: Partial<AuditLogRow>; Update: never };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  custody: {
    Tables: {
      plans: { Row: CustodyPlanRow; Insert: Partial<CustodyPlanRow>; Update: Partial<CustodyPlanRow> };
      points: { Row: CustodyPointRow; Insert: Partial<CustodyPointRow>; Update: Partial<CustodyPointRow> };
      checks: { Row: CustodyCheckRow; Insert: Partial<CustodyCheckRow>; Update: never };
    };
    Views: Record<string, never>;
    Functions: {
      record_letter_generated: { Args: { p_vault_id: string }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  account: {
    Tables: {
      account_security: {
        Row: AccountSecurityRow;
        Insert: Partial<AccountSecurityRow>;
        Update: Partial<AccountSecurityRow>;
      };
      passkeys: { Row: PasskeyRow; Insert: Partial<PasskeyRow>; Update: Partial<PasskeyRow> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  legal: {
    Tables: {
      state_requirements: {
        Row: StateRequirementRow;
        Insert: never;
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
