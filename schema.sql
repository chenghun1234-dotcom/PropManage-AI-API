DROP TABLE IF EXISTS requests_log;
CREATE TABLE requests_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  request_payload TEXT,
  response_payload TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS properties;
CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  property_name TEXT NOT NULL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Initial seed data
INSERT INTO properties (id, property_name, metadata) VALUES 
('prop_001', 'Green Valley Apartments', '{"deposit": "$2000", "pet_policy": "Small pets allowed", "parking": "Included"}');
