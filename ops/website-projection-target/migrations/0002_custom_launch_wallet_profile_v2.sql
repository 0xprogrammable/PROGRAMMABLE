BEGIN;

ALTER TABLE programmable_website_projection_v1.projection_records
  ADD COLUMN custom_launching_wallet_namespace text,
  ADD COLUMN custom_launching_wallet_value text,
  ADD COLUMN custom_post_launch_authority_inventory_hash text;

ALTER TABLE programmable_website_projection_v1.projection_records
  DROP CONSTRAINT projection_records_lane_metadata_check;

ALTER TABLE programmable_website_projection_v1.projection_records
  ADD CONSTRAINT projection_records_lane_metadata_check CHECK (
    (
      lane = 'website.entitlement'
      AND github_user_id ~ '^[1-9][0-9]{0,63}$'
      AND github_principal_hash ~ '^sha256:[0-9a-f]{64}$'
      AND length(application_id) BETWEEN 1 AND 512
      AND length(application_revision) BETWEEN 1 AND 512
      AND github_repository_id ~ '^[1-9][0-9]{0,63}$'
      AND launch_entitlement_binding_hash ~ '^sha256:[0-9a-f]{64}$'
      AND valid_from IS NOT NULL
      AND valid_until IS NOT NULL
      AND valid_from < valid_until
      AND custom_project_id IS NULL
      AND custom_launch_id IS NULL
      AND custom_github_principal_hash IS NULL
      AND custom_finalized_at IS NULL
      AND custom_launching_wallet_namespace IS NULL
      AND custom_launching_wallet_value IS NULL
      AND custom_post_launch_authority_inventory_hash IS NULL
    )
    OR (
      lane = 'website.custom-launched'
      AND github_user_id IS NULL
      AND github_principal_hash IS NULL
      AND application_id IS NULL
      AND application_revision IS NULL
      AND github_repository_id IS NULL
      AND launch_entitlement_binding_hash IS NULL
      AND valid_from IS NULL
      AND valid_until IS NULL
      AND custom_project_id ~ '^sha256:[0-9a-f]{64}$'
      AND custom_launch_id ~ '^sha256:[0-9a-f]{64}$'
      AND custom_github_principal_hash ~ '^sha256:[0-9a-f]{64}$'
      AND custom_finalized_at IS NOT NULL
      AND custom_launching_wallet_namespace ~ '^eip155:[1-9][0-9]*$'
      AND custom_launching_wallet_value ~ '^0x[0-9a-f]{40}$'
      AND custom_post_launch_authority_inventory_hash ~ '^sha256:[0-9a-f]{64}$'
    )
  );

DROP INDEX programmable_website_projection_v1.projection_records_custom_profile_idx;

CREATE INDEX projection_records_custom_wallet_profile_idx
  ON programmable_website_projection_v1.projection_records
  (custom_launching_wallet_namespace, custom_launching_wallet_value,
   custom_finalized_at DESC, custom_project_id)
  WHERE lane = 'website.custom-launched';

COMMIT;
