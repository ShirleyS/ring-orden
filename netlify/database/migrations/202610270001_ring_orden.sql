-- Netlify Database schema owned by server functions; merchant data remains private.
CREATE SCHEMA ring_netlify;
REVOKE ALL ON SCHEMA ring_netlify FROM PUBLIC;

CREATE TABLE ring_netlify.app_state (
 merchant_id text PRIMARY KEY,
 owner_subject text NOT NULL UNIQUE CHECK(length(owner_subject)>0),
 name text NOT NULL,
 payload jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(payload->'merchant')='object' AND payload->'merchant'->>'id' IS NOT NULL AND payload->'merchant'->>'id'=merchant_id)
);
CREATE TABLE ring_netlify.memberships (
 merchant_id text NOT NULL REFERENCES ring_netlify.app_state(merchant_id),
 user_subject text NOT NULL CHECK(length(user_subject)>0),
 email text NOT NULL,
 name text NOT NULL,
 role text NOT NULL CHECK(role IN ('MANAGER','STAFF')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_id,user_subject)
);
CREATE INDEX ring_netlify_membership_subject ON ring_netlify.memberships(user_subject);
CREATE TABLE ring_netlify.invitations (
 id text PRIMARY KEY,
 merchant_id text NOT NULL REFERENCES ring_netlify.app_state(merchant_id),
 token_hash text NOT NULL UNIQUE,
 email text NOT NULL,
 name text NOT NULL,
 role text NOT NULL CHECK(role IN ('MANAGER','STAFF')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 accepted_by text,
 accepted_at timestamptz
);
CREATE TABLE ring_netlify.integration_events (
 event_id text PRIMARY KEY,
 merchant_id text NOT NULL REFERENCES ring_netlify.app_state(merchant_id),
 provider text NOT NULL,
 event_type text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ring_netlify_event_merchant ON ring_netlify.integration_events(merchant_id,created_at);
ALTER TABLE ring_netlify.app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ring_netlify.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE ring_netlify.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ring_netlify.integration_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA ring_netlify FROM PUBLIC;
