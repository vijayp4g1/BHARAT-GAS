-- Schema for Bharat Gas Consumer Location System (BGCLS)

-- 0. Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Create tables
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('MANAGER', 'AGENT')),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE consumers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consumer_number TEXT UNIQUE NOT NULL,
    consumer_name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    address TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'Not Collected' CHECK (verification_status IN ('Not Collected', 'Pending', 'Verified', 'Rejected')),
    assigned_agent_id UUID REFERENCES agents(id),
    area_code TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger to auto-update consumers updated_at
CREATE OR REPLACE FUNCTION update_consumer_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_consumer_updated_at
BEFORE UPDATE ON consumers
FOR EACH ROW EXECUTE FUNCTION update_consumer_updated_at();

CREATE TABLE consumer_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consumer_id UUID REFERENCES consumers(id) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION NOT NULL CHECK (accuracy <= 100), -- Reject poor GPS
    location_point GEOGRAPHY(POINT), -- PostGIS spatial column
    uploaded_by UUID REFERENCES agents(id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for spatial queries
CREATE INDEX idx_consumer_locations_geom ON consumer_locations USING GIST (location_point);

-- Trigger to auto-update location_point from lat/lng
CREATE OR REPLACE FUNCTION update_location_point()
RETURNS TRIGGER AS $$
BEGIN
    NEW.location_point := st_makepoint(NEW.longitude, NEW.latitude)::geography;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_location_point
BEFORE INSERT OR UPDATE OF latitude, longitude ON consumer_locations
FOR EACH ROW EXECUTE FUNCTION update_location_point();

CREATE TABLE consumer_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consumer_id UUID REFERENCES consumers(id) NOT NULL,
    photo_url TEXT NOT NULL,
    photo_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    rejection_reason TEXT,
    uploaded_by UUID REFERENCES agents(id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    performed_by UUID REFERENCES agents(id),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE delivery_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consumer_id UUID REFERENCES consumers(id) NOT NULL,
    note TEXT NOT NULL,
    uploaded_by UUID REFERENCES agents(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger for audit logging on location uploads
CREATE OR REPLACE FUNCTION log_location_upload()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs (action_type, entity_id, performed_by)
    VALUES ('LOCATION_UPLOADED', NEW.consumer_id, NEW.uploaded_by);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_location_upload
AFTER INSERT ON consumer_locations
FOR EACH ROW EXECUTE FUNCTION log_location_upload();


-- 2. Setup Row Level Security (RLS)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumers ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_notes ENABLE ROW LEVEL SECURITY;

-- 3. Create basic RLS policies (allow all authenticated users for now for ease of development)
CREATE POLICY "Allow authenticated read/write on consumers" ON consumers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated read/write on locations" ON consumer_locations FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated read/write on photos" ON consumer_photos FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated read on agents" ON agents FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated read/write on audit_logs" ON audit_logs FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated read/write on delivery_notes" ON delivery_notes FOR ALL USING (auth.role() = 'authenticated');

-- 4. Create Storage Bucket for photos
INSERT INTO storage.buckets (id, name, public) VALUES ('consumer-photos', 'consumer-photos', true);
CREATE POLICY "Allow public read on photos bucket" ON storage.objects FOR SELECT USING (bucket_id = 'consumer-photos');
CREATE POLICY "Allow authenticated uploads to photos bucket" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'consumer-photos' AND auth.role() = 'authenticated');

-- 5. RPC Functions
-- Fetch consumers within a bounding box
CREATE OR REPLACE FUNCTION get_consumers_in_bounds(
    min_lat DOUBLE PRECISION,
    min_lng DOUBLE PRECISION,
    max_lat DOUBLE PRECISION,
    max_lng DOUBLE PRECISION
)
RETURNS TABLE (
    consumer_id UUID,
    consumer_name TEXT,
    consumer_number TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id, c.consumer_name, c.consumer_number, l.latitude, l.longitude
    FROM consumer_locations l
    JOIN consumers c ON c.id = l.consumer_id
    WHERE l.location_point && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography;
END;
$$ LANGUAGE plpgsql STABLE;

-- Sync Consumer RPC for offline conflict resolution
CREATE OR REPLACE FUNCTION sync_consumer(
    p_id UUID,
    p_consumer_number TEXT,
    p_consumer_name TEXT,
    p_mobile TEXT,
    p_address TEXT,
    p_verification_status TEXT,
    p_assigned_agent_id UUID,
    p_area_code TEXT,
    p_created_at TIMESTAMP WITH TIME ZONE,
    p_updated_at TIMESTAMP WITH TIME ZONE
)
RETURNS BOOLEAN AS $$
DECLARE
    v_existing_updated_at TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Check if record exists and get its updated_at
    SELECT updated_at INTO v_existing_updated_at
    FROM consumers
    WHERE id = p_id;

    IF FOUND THEN
        -- If local update is older than server update, reject it
        IF v_existing_updated_at > p_updated_at THEN
            RETURN FALSE; -- Conflict, local lost
        ELSE
            -- Update record
            UPDATE consumers SET
                consumer_number = p_consumer_number,
                consumer_name = p_consumer_name,
                mobile = p_mobile,
                address = p_address,
                verification_status = p_verification_status,
                assigned_agent_id = p_assigned_agent_id,
                area_code = p_area_code,
                updated_at = p_updated_at
            WHERE id = p_id;
            RETURN TRUE;
        END IF;
    ELSE
        -- Insert new record
        INSERT INTO consumers (
            id, consumer_number, consumer_name, mobile, address, 
            verification_status, assigned_agent_id, area_code, 
            created_at, updated_at
        ) VALUES (
            p_id, p_consumer_number, p_consumer_name, p_mobile, p_address,
            p_verification_status, p_assigned_agent_id, p_area_code,
            p_created_at, p_updated_at
        );
        RETURN TRUE;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. Real-time Agent Location Tracking
CREATE TABLE agent_locations (
    agent_id UUID PRIMARY KEY REFERENCES agents(id),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for agent_locations
ALTER TABLE agent_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can update own location" 
ON agent_locations FOR ALL 
USING (auth.uid() = agent_id);

CREATE POLICY "Managers can view agent locations" 
ON agent_locations FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM agents 
        WHERE id = auth.uid() AND role = 'MANAGER'
    )
);

-- Enable Realtime for agent_locations
-- Supabase requires this to push changes over WebSockets
ALTER PUBLICATION supabase_realtime ADD TABLE agent_locations;
